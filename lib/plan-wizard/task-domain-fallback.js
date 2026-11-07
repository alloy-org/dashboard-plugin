// Tag untagged task notes todo and add them to a planning domain when the notebook does not use tags, then refresh the
// shared task read once the host lists the included notes' tasks, before discovery starts. Before the Planning splash
// asks for an import, every note holding tasks outside the domain is tagged and included the same way.

import { DASHBOARD_NOTE_TAG, DEFAULT_PLANNING_TAG } from "constants/settings";
import { checkedAppResult } from "plan-wizard/vision-guide-notes";
import { fetchDomainOrAllNotesTasks, forgetSharedTaskReads } from "util/all-notes-tasks";
import { logIfEnabled } from "util/log";
import { arrayFromFilterNotesResult } from "util/note-handles";

const DAY_MILLISECONDS = 86400000;
// Notes changed this recently decide whether the notebook uses tags at all.
const TAG_USAGE_WINDOW_MILLISECONDS = 30 * DAY_MILLISECONDS;
// Notes changed this recently, with open tasks or tasks completed in the same window, are tagged todo.
const ELIGIBLE_NOTE_WINDOW_MILLISECONDS = 90 * DAY_MILLISECONDS;
// Cap on untagged notes without open tasks that are read for recently completed tasks.
const MAX_COMPLETED_TASK_NOTES_TO_SCAN = 250;
// Tags the host and Plan Builder apply themselves, which say nothing about whether the user organizes with tags.
const IGNORED_TAGS = ["daily-jots", "starter-notes"];
// Notes carrying these tags are sample content or notes the dashboard writes, never the user's own task notes.
const EXCLUDED_OUTSIDE_NOTE_TAGS = ["starter-notes", DASHBOARD_NOTE_TAG, DEFAULT_PLANNING_TAG];
// Cap on notes outside the domain tagged and included in one pass, protecting mobile clients from a long write run.
const MAX_OUTSIDE_NOTES_TO_INCLUDE = 250;
// How many times the domain is read after inclusion, waiting for the host to list the included notes' tasks.
const MAX_DOMAIN_READ_ATTEMPTS = 5;
// Pause between those reads.
const DOMAIN_READ_RETRY_MILLISECONDS = 1000;

// ----------------------------------------------------------------------------------------------
// @desc Tag the notes todo and include them directly in the selected domain, whose filters may not use todo.
//   A failed note is logged and skipped so the remaining notes can still be included.
// @param {object} app - Amplenote app interface.
// @param {object} options - { domainUuid, isActive, notes }; isActive guards writes after closing or switching scope.
// @returns {Promise<object>} { failedNoteCount, includedNoteUuids } - the number of notes that could not be tagged or
//   included, and the UUIDs of the notes that were both tagged and included.
async function includeTaskNotes(app, { domainUuid, isActive, notes }) {
  let failedNoteCount = 0;
  const includedNoteUuids = new Set();
  for (const note of notes) {
    if (!isActive()) break;
    try {
      const handle = { uuid: note.uuid };
      const tagged = checkedAppResult(await app.addNoteTag(handle, "todo"));
      if (!tagged) throw new Error("Could not add the todo tag");
      if (!isActive()) break;
      const included = checkedAppResult(await app.addTaskDomainNote(domainUuid, handle));
      if (!included) throw new Error("Could not include the note in the Task Domain");
      includedNoteUuids.add(note.uuid);
    } catch (error) {
      failedNoteCount += 1;
      logIfEnabled("[plan-task-domain-fallback] could not include note", { message: error?.message, noteUuid: note.uuid });
    }
  }
  return { failedNoteCount, includedNoteUuids };
}

// ----------------------------------------------------------------------------------------------
// @desc Read the domain's tasks fresh until they include a task from one of the included notes, so the shared read
//   that intent and project discovery reuse is not one the host answered before it applied the inclusion. When the
//   host still has not listed them after the last attempt, the shared reads are dropped so the next reader asks again
//   rather than reusing the incomplete read.
// @param {object} app - Amplenote app interface.
// @param {object} options - { domainUuid, includedNoteUuids, isActive, wait }; wait(milliseconds) pauses between reads.
// @returns {Promise<boolean>} True when a read listed a task from an included note.
async function awaitIncludedNoteTasks(app, { domainUuid, includedNoteUuids, isActive, wait }) {
  for (let attempt = 1; attempt <= MAX_DOMAIN_READ_ATTEMPTS; attempt += 1) {
    const tasks = await fetchDomainOrAllNotesTasks(app, domainUuid, { fresh: true, includeDone: true });
    const listedTasks = Array.isArray(tasks) ? tasks : [];
    if (listedTasks.some(task => includedNoteUuids.has(task?.noteUUID))) return true;
    if (!isActive() || attempt === MAX_DOMAIN_READ_ATTEMPTS) break;
    await wait(DOMAIN_READ_RETRY_MILLISECONDS);
    if (!isActive()) break;
  }
  logIfEnabled("[plan-task-domain-fallback] domain tasks do not yet list the included notes", { domainUuid,
    includedNoteCount: includedNoteUuids.size });
  forgetSharedTaskReads(app);
  return false;
}

// ----------------------------------------------------------------------------------------------
// @desc Log why the domain's task list may still omit the included notes, separating the two explanations: the
//   host's domain no longer lists the notes (a task-domain fetch replaced the pending inclusion), or the notes hold no
//   open tasks (the host's domain task list returns open tasks only). Each lookup that fails is logged and skipped.
// @param {object} app - Amplenote app interface.
// @param {object} options - { domainUuid, includedNoteUuids }; includedNoteUuids is the Set of notes tagged and included.
// @returns {Promise<void>} Resolves once both lookups are logged.
async function logIncludedNoteDiagnostics(app, { domainUuid, includedNoteUuids }) {
  const noteUuids = [...includedNoteUuids];
  if (typeof app.getTaskDomains === "function") {
    try {
      const domains = await app.getTaskDomains();
      const domain = (Array.isArray(domains) ? domains : []).find(candidate => candidate?.uuid === domainUuid);
      const domainNoteUuids = new Set((domain?.notes || []).map(note => note?.uuid));
      const missingNoteUuids = noteUuids.filter(noteUuid => !domainNoteUuids.has(noteUuid));
      logIfEnabled("[plan-task-domain-fallback] host domain membership after inclusion", { domainFound: !!domain, domainUuid,
        domainNoteCount: domainNoteUuids.size, includedNoteCount: noteUuids.length, missingNoteUuids });
    } catch (error) {
      logIfEnabled("[plan-task-domain-fallback] could not read task domains for diagnostics", error?.message);
    }
  }
  if (typeof app.getNoteTasks !== "function") return;
  // Pair each settled result with its UUID by index: the app bridge's thenable does not chain .then() reliably.
  const settled = await Promise.allSettled(noteUuids.map(noteUuid => app.getNoteTasks({ uuid: noteUuid }, { includeDone: true })));
  const taskCountsByNote = noteUuids.map((noteUuid, index) => {
    const outcome = settled[index];
    if (outcome.status === "rejected") return { error: outcome.reason?.message ?? String(outcome.reason), noteUuid };
    const tasks = Array.isArray(outcome.value) ? outcome.value : [];
    const doneTasks = tasks.filter(task => task?.completedAt || task?.dismissedAt || task?.crossedOutAt);
    return { doneTaskCount: doneTasks.length, noteUuid, openTaskCount: tasks.length - doneTasks.length };
  });
  logIfEnabled("[plan-task-domain-fallback] included note task counts", { domainUuid, taskCountsByNote });
}

// ----------------------------------------------------------------------------------------------
// @desc Pause for a number of milliseconds.
// @param {number} milliseconds - Length of the pause.
// @returns {Promise<void>} Resolves once the pause ends.
function waitMilliseconds(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

// ----------------------------------------------------------------------------------------------
// @desc When Plan Builder opens on a Task Domain, add todo to the notebook's untagged task notes without asking, but
//   only when the notebook does not organize with tags: every note with open tasks changed in the past 30 days,
//   apart from daily-jots and starter-notes, must carry no tag. The notes tagged are those changed in the past three
//   months that carry no tag and hold open tasks or tasks completed in those three months; a note with any other tag
//   is never tagged. The domain is then read fresh until the host lists the included notes' tasks, and that read
//   replaces the shared cache, so intent and project discovery see the added tasks. Failures are logged rather than
//   shown, and planning continues with the tasks the domain has.
// @param {object} app - Amplenote app interface with task-domain, note-filter, note-task, and tagging methods.
// @param {object} options - { domainUuid, isActive, referenceDate, wait }; isActive cancels pending work when the
//   builder closes or changes scope, and wait(milliseconds) pauses between domain reads. All Notes has no domain to
//   expand and skips this fallback.
// @returns {Promise<number>} Number of notes tagged and included in the domain; 0 when no note qualified.
export async function preparePlanTaskDomain(app, { domainUuid = null, isActive = () => true, referenceDate = new Date(),
    wait = waitMilliseconds } = {}) {
  if (!domainUuid || !isActive()) return 0;
  if (typeof app.addNoteTag !== "function" || typeof app.addTaskDomainNote !== "function") return 0;
  const openTaskNotes = await arrayFromFilterNotesResult(app.filterNotes({ group: "taskLists" }, "changed"));
  if (!isActive() || !notebookSkipsTags(openTaskNotes, referenceDate)) return 0;
  const notes = await untaggedTaskNotes(app, openTaskNotes, referenceDate);
  if (!isActive() || !notes.length) return 0;
  const { failedNoteCount, includedNoteUuids } = await includeTaskNotes(app, { domainUuid, isActive, notes });
  logIfEnabled("[plan-task-domain-fallback] tagged task notes todo", { failedNoteCount, noteCount: notes.length });
  forgetSharedTaskReads(app);
  if (!includedNoteUuids.size) return 0;
  const listed = await awaitIncludedNoteTasks(app, { domainUuid, includedNoteUuids, isActive, wait });
  if (!listed) await logIncludedNoteDiagnostics(app, { domainUuid, includedNoteUuids });
  return includedNoteUuids.size;
}

// ----------------------------------------------------------------------------------------------
// @desc Before the Planning splash asks the user to import tasks, tag todo and include in the domain every note that
//   holds tasks but is not yet part of it: notes with open tasks, of any age and whatever their tags, and notes with a
//   task completed in the past three months. Archived notes, starter notes, and the notes the dashboard writes are
//   left alone. The domain is then read fresh until the host lists an included note's tasks, so the splash's recount
//   sees them. Failures are logged, and the splash counts whatever the domain then holds.
// @param {object} app - Amplenote app interface with task-domain, note-filter, note-task, and tagging methods.
// @param {object} options - { domainUuid, isActive, referenceDate, wait }; isActive cancels pending writes when the
//   splash is closed or its domain changes, and wait(milliseconds) pauses between domain reads.
// @returns {Promise<number>} Number of notes tagged and included; 0 when there is no domain or no note qualified.
export async function includeTaskNotesOutsideDomain(app, { domainUuid = null, isActive = () => true, referenceDate = new Date(),
    wait = waitMilliseconds } = {}) {
  if (!domainUuid || !isActive()) return 0;
  if (typeof app.addNoteTag !== "function" || typeof app.addTaskDomainNote !== "function" || typeof app.getTaskDomains !== "function") return 0;
  const domainNoteUuids = await taskDomainNoteUuids(app, domainUuid);
  if (!domainNoteUuids || !isActive()) return 0;
  const openTaskNotes = await arrayFromFilterNotesResult(app.filterNotes({ group: "taskLists" }, "changed"));
  const completedTaskNotes = await recentlyCompletedTaskNotes(app, referenceDate);
  const candidateNotes = uniqueNotes(openTaskNotes.concat(completedTaskNotes));
  const outsideNotes = candidateNotes.filter(note => !domainNoteUuids.has(note.uuid) && !note.archived && !tagsOf(note).some(isExcludedOutsideTag));
  const notes = outsideNotes.slice(0, MAX_OUTSIDE_NOTES_TO_INCLUDE);
  logIfEnabled("[plan-task-domain-fallback] notes with tasks outside the domain", { candidateNoteCount: candidateNotes.length,
    domainNoteCount: domainNoteUuids.size, domainUuid, includingNoteCount: notes.length, outsideNoteCount: outsideNotes.length });
  if (!isActive() || !notes.length) return 0;
  const { failedNoteCount, includedNoteUuids } = await includeTaskNotes(app, { domainUuid, isActive, notes });
  logIfEnabled("[plan-task-domain-fallback] tagged notes outside the domain todo", { failedNoteCount, includedNoteCount: includedNoteUuids.size });
  forgetSharedTaskReads(app);
  if (!includedNoteUuids.size) return 0;
  const listed = await awaitIncludedNoteTasks(app, { domainUuid, includedNoteUuids, isActive, wait });
  if (!listed) await logIncludedNoteDiagnostics(app, { domainUuid, includedNoteUuids });
  forgetSharedTaskReads(app);
  return includedNoteUuids.size;
}

// ----------------------------------------------------------------------------------------------
// @desc The notes a task domain lists, including those it holds by tag.
// @param {object} app - Amplenote app interface.
// @param {string} domainUuid - Task domain UUID.
// @returns {Promise<Set<string>|null>} Note UUIDs, or null when the domain could not be read or is not listed.
async function taskDomainNoteUuids(app, domainUuid) {
  try {
    const taskDomains = await app.getTaskDomains();
    const taskDomain = (Array.isArray(taskDomains) ? taskDomains : []).find(domain => domain?.uuid === domainUuid);
    if (!taskDomain) {
      logIfEnabled("[plan-task-domain-fallback] the host does not list the domain", { domainUuid });
      return null;
    }
    const noteUuids = (Array.isArray(taskDomain.notes) ? taskDomain.notes : []).map(note => note?.uuid).filter(Boolean);
    return new Set(noteUuids);
  } catch (error) {
    logIfEnabled("[plan-task-domain-fallback] could not read task domains", error?.message);
    return null;
  }
}

// ----------------------------------------------------------------------------------------------
// @desc The notes holding a task completed in the past three months, across every domain. Each note is looked up for
//   its tags and archived state when the host can find notes; otherwise only its UUID is known.
// @param {object} app - Amplenote app interface; without getCompletedTasks no note is found.
// @param {Date} referenceDate - End of the three-month window.
// @returns {Promise<Array<object>>} Note handles, or { uuid } stand-ins when a lookup is unavailable or fails.
async function recentlyCompletedTaskNotes(app, referenceDate) {
  if (typeof app.getCompletedTasks !== "function") return [];
  const fromSeconds = Math.floor((referenceDate.getTime() - ELIGIBLE_NOTE_WINDOW_MILLISECONDS) / 1000);
  const toSeconds = Math.floor(referenceDate.getTime() / 1000);
  let completedTasks = [];
  try {
    const result = await app.getCompletedTasks(fromSeconds, toSeconds);
    completedTasks = Array.isArray(result) ? result : [];
  } catch (error) {
    logIfEnabled("[plan-task-domain-fallback] could not read completed tasks", error?.message);
    return [];
  }
  const noteUuidList = completedTasks.map(task => task?.noteUUID).filter(Boolean);
  const noteUuids = [...new Set(noteUuidList)].slice(0, MAX_OUTSIDE_NOTES_TO_INCLUDE);
  if (typeof app.findNote !== "function") return noteUuids.map(uuid => ({ uuid }));
  // Pair each settled result with its UUID by index: the app bridge's thenable does not chain .then() reliably.
  const settled = await Promise.allSettled(noteUuids.map(uuid => app.findNote({ uuid })));
  const notes = noteUuids.map((uuid, index) => (settled[index].status === "fulfilled" && settled[index].value?.uuid ? settled[index].value : { uuid }));
  return notes;
}

// ----------------------------------------------------------------------------------------------
// @desc Note handles without repeats, keeping the first handle seen for each UUID.
// @param {Array<object>} notes - Note handles, possibly repeated.
// @returns {Array<object>} Unique handles that carry a UUID, in their first-seen order.
function uniqueNotes(notes) {
  const notesByUuid = new Map();
  for (const note of notes) if (note?.uuid && !notesByUuid.has(note.uuid)) notesByUuid.set(note.uuid, note);
  return [...notesByUuid.values()];
}

// ----------------------------------------------------------------------------------------------
// @desc Whether a tag marks a note the splash fallback must leave out: starter notes and the notes the dashboard writes.
// @param {string} tag - Tag name.
// @returns {boolean} True when the tag is one of EXCLUDED_OUTSIDE_NOTE_TAGS or a child of one.
function isExcludedOutsideTag(tag) {
  return EXCLUDED_OUTSIDE_NOTE_TAGS.some(excludedTag => tag === excludedTag || String(tag).startsWith(`${ excludedTag }/`));
}

// ----------------------------------------------------------------------------------------------
// @desc Whether the notebook's recent task notes show that the user does not organize with tags.
// @param {Array<object>} openTaskNotes - Note handles from the taskLists filter, which holds notes with open tasks.
// @param {Date} referenceDate - End of the thirty-day window.
// @returns {boolean} True when at least one note with open tasks changed in the past 30 days, and none of those notes
//   carries a tag other than daily-jots or starter-notes. A daily-jots or starter-notes note is left out entirely.
function notebookSkipsTags(openTaskNotes, referenceDate) {
  let recentNoteCount = 0;
  for (const note of openTaskNotes) {
    if (!note?.uuid || note.archived || !changedWithin(note, referenceDate, TAG_USAGE_WINDOW_MILLISECONDS)) continue;
    const tags = tagsOf(note);
    if (tags.some(isIgnoredTag)) continue;
    if (tags.length) return false;
    recentNoteCount += 1;
  }
  return recentNoteCount > 0;
}

// ----------------------------------------------------------------------------------------------
// @desc Collect the untagged notes changed in the past three months that hold open tasks, followed by untagged notes
//   whose tasks are all done but include one completed in those three months. Each note's own tags are checked, so a
//   host that ignores the untagged group only widens the notes considered, and one that rejects it finds none of them.
// @param {object} app - Amplenote app interface; without getNoteTasks only notes with open tasks are found.
// @param {Array<object>} openTaskNotes - Note handles from the taskLists filter.
// @param {Date} referenceDate - End of the three-month window.
// @returns {Promise<Array<object>>} Unique eligible note handles, notes with open tasks first in the filter's order.
async function untaggedTaskNotes(app, openTaskNotes, referenceDate) {
  const notesByUuid = new Map();
  const openTaskNoteUuids = new Set();
  for (const note of openTaskNotes) {
    if (!note?.uuid) continue;
    openTaskNoteUuids.add(note.uuid);
    if (isEligibleUntaggedNote(note, referenceDate)) notesByUuid.set(note.uuid, note);
  }
  if (typeof app.getNoteTasks !== "function") return [...notesByUuid.values()];
  let untaggedNotes = [];
  try {
    untaggedNotes = await arrayFromFilterNotesResult(app.filterNotes({ group: "untagged" }, "changed"));
  } catch (error) {
    logIfEnabled("[plan-task-domain-fallback] could not list untagged notes", error?.message);
  }
  const unscannedNotes = untaggedNotes.filter(note => note?.uuid && !openTaskNoteUuids.has(note.uuid) && !notesByUuid.has(note.uuid));
  const candidateNotes = unscannedNotes.filter(note => isEligibleUntaggedNote(note, referenceDate));
  const scannedNotes = candidateNotes.slice(0, MAX_COMPLETED_TASK_NOTES_TO_SCAN);
  // Pair each settled result with its handle by index: the app bridge's thenable does not chain .then() reliably.
  const settled = await Promise.allSettled(scannedNotes.map(note => app.getNoteTasks({ uuid: note.uuid }, { includeDone: true })));
  const windowStartSeconds = (referenceDate.getTime() - ELIGIBLE_NOTE_WINDOW_MILLISECONDS) / 1000;
  for (let index = 0; index < settled.length; index += 1) {
    const outcome = settled[index];
    if (outcome.status === "rejected") {
      logIfEnabled("[plan-task-domain-fallback] could not read note tasks", outcome.reason?.message);
      continue;
    }
    const tasks = Array.isArray(outcome.value) ? outcome.value : [];
    const hasRecentCompletion = tasks.some(task => Number(task?.completedAt) >= windowStartSeconds);
    if (hasRecentCompletion) notesByUuid.set(scannedNotes[index].uuid, scannedNotes[index]);
  }
  return [...notesByUuid.values()];
}

// ----------------------------------------------------------------------------------------------
// @desc Whether a note may be offered the todo tag: unarchived, carrying no tag, and changed in the past three months.
// @param {object} note - Note handle.
// @param {Date} referenceDate - End of the three-month window.
// @returns {boolean} True when the note is eligible.
function isEligibleUntaggedNote(note, referenceDate) {
  if (note.archived || tagsOf(note).length) return false;
  return changedWithin(note, referenceDate, ELIGIBLE_NOTE_WINDOW_MILLISECONDS);
}

// ----------------------------------------------------------------------------------------------
// @desc Whether a note changed within a window ending at the reference date. A note changed after the reference date,
//   or without a readable date, is outside it.
// @param {object} note - Note handle with changed or updated.
// @param {Date} referenceDate - End of the window.
// @param {number} windowMilliseconds - Length of the window.
// @returns {boolean} True when the note changed inside the window.
function changedWithin(note, referenceDate, windowMilliseconds) {
  const windowEnd = referenceDate.getTime();
  const changedAt = Date.parse(note.changed ?? note.updated);
  return changedAt >= windowEnd - windowMilliseconds && changedAt <= windowEnd;
}

// ----------------------------------------------------------------------------------------------
// @desc The tags on a note handle, or an empty list when the handle has none.
// @param {object} note - Note handle.
// @returns {Array<string>} Tag names.
function tagsOf(note) {
  return Array.isArray(note.tags) ? note.tags : [];
}

// ----------------------------------------------------------------------------------------------
// @desc Whether a tag is daily-jots, starter-notes, or a child of either.
// @param {string} tag - Tag name.
// @returns {boolean} True when the tag is ignored when judging whether the notebook uses tags.
function isIgnoredTag(tag) {
  return IGNORED_TAGS.some(ignoredTag => tag === ignoredTag || String(tag).startsWith(`${ ignoredTag }/`));
}
