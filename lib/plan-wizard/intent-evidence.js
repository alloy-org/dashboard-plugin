// Gather the bounded, referenced evidence that intent inference reasons over: genuinely completed work in the
// selected domain, notes tagged as personal, and — when personal evidence is absent — upcoming calendar events
// suggesting hobbies and pursuits. Everything here stays host-compatible so the plugin can collect evidence
// without the React client. The planning notes this subsystem writes are excluded from their own inputs, which
// would otherwise let last quarter's generated intents masquerade as fresh evidence.

import { VISION_GUIDE_TAG } from "plan-wizard/vision-guide-notes";
import { fetchDomainOrAllNotesTasks } from "util/all-notes-tasks";
import { parsedRichFootnotes, passageWithResolvedFootnotes } from "util/amplenote-rich-footnotes";
import { externalCalendarEventsForTargetDate, normalizeExternalCalendarEvents } from "util/calendar-utility";
import { logIfEnabled } from "util/log";
import { arrayFromFilterNotesResult } from "util/note-handles";

// A month of completed work is the preferred window; widen to three before falling back to recent creations.
export const COMPLETION_WINDOW_MONTHS = [1, 2, 3];
export const MINIMUM_COMPLETED_TASKS = 50;
export const MAXIMUM_RECENT_TASKS = 100;
export const MAXIMUM_FOOTNOTE_NOTES = 12;
// `me` or `personal` at any level of a tag hierarchy, so `projects/personal/health` counts as personal.
export const PERSONAL_TAG_PATTERN = /(^|\/)(me|personal)(\/|$)/i;

// ----------------------------------------------------------------------------------------------
// @desc Convert an Amplenote task timestamp into epoch milliseconds. The API reports seconds, while stored and
//   hand-written fixtures sometimes carry ISO strings, so both are normalized before any date comparison.
// @param {number|string|null} value - Task timestamp.
// @returns {number|null} Epoch milliseconds, or null when the value cannot be interpreted.
export function millisecondsFromTaskTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value > 1e11 ? value : value * 1000;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

// ----------------------------------------------------------------------------------------------
// @desc Decide whether a task represents work the user actually finished. Completed-task retrieval also returns
//   dismissed and crossed-out items, so a task carrying a dismissal is excluded even when it also reports a
//   completion time.
// @param {object} task - Amplenote task.
// @returns {boolean} True when the task counts as genuine completion evidence.
export function isGenuinelyCompleted(task) {
  if (!task || task.dismissedAt || task.crossedOutAt) return false;
  return millisecondsFromTaskTimestamp(task.completedAt) !== null;
}

// ----------------------------------------------------------------------------------------------
// @desc Reduce a task to the compact reference an inference prompt and a stored evidence record can share, so
//   suggestions can cite the work that produced them without carrying whole notes into the prompt budget.
// @param {object} task - Amplenote task.
// @returns {object} { completedAt, noteName, noteUuid, taskUuid, text }.
export function taskEvidenceReference(task) {
  const completedMilliseconds = millisecondsFromTaskTimestamp(task.completedAt);
  const completedAt = completedMilliseconds === null ? null : new Date(completedMilliseconds).toISOString();
  const text = String(task.content ?? task.text ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  return { completedAt, noteName: task.noteName ?? null, noteUuid: task.noteUUID ?? null, taskUuid: task.uuid ?? null, text };
}

// ----------------------------------------------------------------------------------------------
// @desc Select completed tasks inside the narrowest window that yields enough evidence, widening a month at a
//   time up to three. The chosen window is reported so a stored snapshot can state the coverage it was based on
//   rather than implying a fixed lookback.
// @param {Array<object>} tasks - Candidate tasks, already scoped to the domain.
// @param {Date} referenceDate - "Now" for window arithmetic; injectable so tests need no clock control.
// @returns {object} { completedTasks, windowMonths, windowStart }.
export function completedTasksWithinWindow(tasks, referenceDate) {
  const genuinelyCompleted = tasks.filter(isGenuinelyCompleted);
  let selection = { completedTasks: [], windowMonths: COMPLETION_WINDOW_MONTHS[0], windowStart: referenceDate };
  for (const windowMonths of COMPLETION_WINDOW_MONTHS) {
    const windowStart = new Date(referenceDate.getTime());
    windowStart.setMonth(windowStart.getMonth() - windowMonths);
    const startMilliseconds = windowStart.getTime();
    const completedTasks = genuinelyCompleted.filter(task => millisecondsFromTaskTimestamp(task.completedAt) >= startMilliseconds);
    selection = { completedTasks, windowMonths, windowStart };
    if (completedTasks.length >= MINIMUM_COMPLETED_TASKS) break;
  }
  const sortedTasks = selection.completedTasks.slice().sort((first, second) =>
    millisecondsFromTaskTimestamp(second.completedAt) - millisecondsFromTaskTimestamp(first.completedAt));
  return { ...selection, completedTasks: sortedTasks };
}

// ----------------------------------------------------------------------------------------------
// @desc Supplement sparse completion evidence with the most recently created tasks, deduplicated against the
//   completions already selected and sorted by actual creation time rather than by retrieval order.
// @param {Array<object>} tasks - All candidate tasks in the domain.
// @param {Array<object>} completedTasks - Tasks already selected as completion evidence.
// @returns {Array<object>} Up to MAXIMUM_RECENT_TASKS supplementary tasks, newest first.
export function recentlyCreatedTasks(tasks, completedTasks) {
  const selectedUuids = new Set(completedTasks.map(task => task.uuid));
  const remainingTasks = tasks.filter(task => task?.uuid && !selectedUuids.has(task.uuid));
  const datedTasks = remainingTasks.filter(task => millisecondsFromTaskTimestamp(task.createdAt) !== null);
  const sortedTasks = datedTasks.sort((first, second) =>
    millisecondsFromTaskTimestamp(second.createdAt) - millisecondsFromTaskTimestamp(first.createdAt));
  return sortedTasks.slice(0, MAXIMUM_RECENT_TASKS);
}

// ----------------------------------------------------------------------------------------------
// @desc Decide whether a note handle is tagged as personal at any level of its tag hierarchy.
// @param {object} noteHandle - Note handle carrying a `tags` array.
// @returns {boolean} True when any tag path segment is `me` or `personal`.
export function isPersonalNote(noteHandle) {
  const tags = Array.isArray(noteHandle?.tags) ? noteHandle.tags : [];
  return tags.some(tag => PERSONAL_TAG_PATTERN.test(String(tag)));
}

// ----------------------------------------------------------------------------------------------
// @desc Collect the evidence behind both categories of intent suggestion for one planning scope.
//   Work evidence is completed domain work, widened and then supplemented when sparse. Personal evidence comes
//   from personally tagged notes within the same domain; when the domain holds none, the collector falls back to
//   the full completion window and the calendar's available upcoming window rather than quietly reaching into
//   other domains. Notes belonging to this subsystem are always excluded so generated plans never feed themselves.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} scope - Resolved plan scope from resolvePlanScope; supplies domainUuid and the planning period.
// @param {object} [options] - { referenceDate } for deterministic windows in tests.
// @returns {Promise<object>} { calendarSummaries, coverage, personal, work } evidence bundle, JSON-serializable.
// Completed tasks are read from getCompletedTasks as well as the domain's task list, because the domain list
//   carries open tasks only; without the second source a domain yields no completion evidence and no notes to read.
//   Every count along the way is logged, so a sparse reading page can be traced to the step that emptied it.
export async function collectIntentEvidence(app, scope, { referenceDate = new Date() } = {}) {
  const collectionStart = Date.now();
  const excludedNoteUuids = await planningNoteUuids(app);
  const listedTasks = await domainTasks(app, scope.domainUuid);
  const completedLookupTasks = await completedTasksInLookback(app, scope.domainUuid, referenceDate);
  const allTasks = tasksMergedByUuid(listedTasks, completedLookupTasks);
  const candidateTasks = allTasks.filter(task => task?.noteUUID && !excludedNoteUuids.has(task.noteUUID));
  const { completedTasks, windowMonths, windowStart } = completedTasksWithinWindow(candidateTasks, referenceDate);
  const supplementalTasks = completedTasks.length < MINIMUM_COMPLETED_TASKS ? recentlyCreatedTasks(candidateTasks, completedTasks) : [];
  const personalNoteUuids = await personalNoteUuidsInScope(app, excludedNoteUuids);
  const personalTasks = completedTasks.filter(task => personalNoteUuids.has(task.noteUUID));
  const calendarSummaries = personalTasks.length ? [] : await upcomingCalendarSummaries(app, scope, referenceDate);
  const workReferences = completedTasks.map(taskEvidenceReference);
  const supplementalReferences = supplementalTasks.map(taskEvidenceReference);
  const personalReferences = personalTasks.map(taskEvidenceReference);
  // With no completion evidence, the notes behind the recent tasks the prompt lists are the ones worth reading.
  const noteSourceTasks = completedTasks.length ? completedTasks : supplementalTasks;
  const noteContext = await footnoteResolvedNoteContext(app, noteSourceTasks, personalNoteUuids);
  const coverage = { collectedAt: new Date(referenceDate.getTime()).toISOString(), completedTaskCount: completedTasks.length,
    personalTaskCount: personalTasks.length, supplementalTaskCount: supplementalTasks.length,
    windowMonths, windowStart: windowStart.toISOString() };
  const work = { noteContext, references: workReferences, supplementalReferences };
  const personal = { hasPersonalTaggedEvidence: personalTasks.length > 0, references: personalReferences };
  const taskCounts = evidenceTaskCounts({ allTasks, candidateTasks, completedLookupTasks, excludedNoteUuids, listedTasks });
  logIfEnabled("[intent-evidence] collected", { ...taskCounts, calendarSummaryCount: calendarSummaries.length,
    completedInWindowCount: completedTasks.length, domainUuid: scope.domainUuid ?? null, durationMs: Date.now() - collectionStart,
    noteContextCount: noteContext.length, noteSource: completedTasks.length ? "completed" : "recent",
    personalNoteCount: personalNoteUuids.size, personalTaskCount: personalTasks.length, supplementalTaskCount: supplementalTasks.length,
    windowMonths });
  if (!noteContext.length) {
    logIfEnabled("[intent-evidence] no note bodies were read; the reading page will list only tasks, or nothing when no task is listed",
      { completedInWindowCount: completedTasks.length, supplementalTaskCount: supplementalTasks.length });
  }
  return { calendarSummaries, coverage, personal, work };
}

// ----------------------------------------------------------------------------------------------
// @desc Read the tasks completed across the widest completion window. A task domain's task list omits completed
//   tasks, so this is the only source of completion evidence inside a domain.
// @param {object} app - Host-compatible Amplenote API.
// @param {string|null} domainUuid - Selected domain, or null to read completions from every note.
// @param {Date} referenceDate - End of the window.
// @returns {Promise<Array<object>>} Completed tasks, or [] when the API is missing or the lookup fails.
async function completedTasksInLookback(app, domainUuid, referenceDate) {
  if (typeof app.getCompletedTasks !== "function") {
    logIfEnabled("[intent-evidence] app.getCompletedTasks is unavailable; completion evidence comes from the task list alone");
    return [];
  }
  const windowStart = new Date(referenceDate.getTime());
  windowStart.setMonth(windowStart.getMonth() - COMPLETION_WINDOW_MONTHS[COMPLETION_WINDOW_MONTHS.length - 1]);
  const fromSeconds = Math.floor(windowStart.getTime() / 1000);
  const toSeconds = Math.floor(referenceDate.getTime() / 1000);
  const lookupOptions = domainUuid ? { taskDomainUUID: domainUuid } : {};
  try {
    const tasks = await app.getCompletedTasks(fromSeconds, toSeconds, lookupOptions);
    if (!Array.isArray(tasks)) {
      logIfEnabled("[intent-evidence] getCompletedTasks returned a non-array", { domainUuid, fromSeconds, resultType: typeof tasks, toSeconds });
      return [];
    }
    return tasks.filter(task => task && typeof task === "object");
  } catch (error) {
    logIfEnabled("[intent-evidence] getCompletedTasks failed", { domainUuid, fromSeconds, message: error?.message, toSeconds });
    return [];
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Combine the task list with the completed-task lookup, one entry per task UUID. Where both report a task,
//   the lookup's fields win, since it is the one that carries the completion.
// @param {Array<object>} listedTasks - Tasks from the domain's task list.
// @param {Array<object>} completedLookupTasks - Tasks from getCompletedTasks.
// @returns {Array<object>} Merged tasks; tasks without a UUID are kept as they are.
function tasksMergedByUuid(listedTasks, completedLookupTasks) {
  const taskByUuid = new Map();
  const tasksWithoutUuid = [];
  for (const task of listedTasks.concat(completedLookupTasks)) {
    if (!task.uuid) {
      tasksWithoutUuid.push(task);
      continue;
    }
    taskByUuid.set(task.uuid, { ...taskByUuid.get(task.uuid), ...task });
  }
  const mergedTasks = [...taskByUuid.values()].concat(tasksWithoutUuid);
  return mergedTasks;
}

// ----------------------------------------------------------------------------------------------
// @desc Count how many tasks survive each step between retrieval and the completion window, for the evidence log.
// @param {object} params - An object with the following properties:
//   - {Array<object>} allTasks - Merged tasks from both sources.
//   - {Array<object>} candidateTasks - Tasks left after dropping those without a note or in planning notes.
//   - {Array<object>} completedLookupTasks - Tasks from getCompletedTasks.
//   - {Set<string>} excludedNoteUuids - Planning notes excluded from evidence.
//   - {Array<object>} listedTasks - Tasks from the domain's task list.
// @returns {object} Counts named for the step each describes.
function evidenceTaskCounts({ allTasks, candidateTasks, completedLookupTasks, excludedNoteUuids, listedTasks }) {
  const hasCompletion = task => millisecondsFromTaskTimestamp(task.completedAt) !== null;
  return { candidateTaskCount: candidateTasks.length,
    candidatesDismissedOrCrossedOut: candidateTasks.filter(task => task.dismissedAt || task.crossedOutAt).length,
    candidatesGenuinelyCompleted: candidateTasks.filter(isGenuinelyCompleted).length,
    completedLookupCount: completedLookupTasks.length,
    completedLookupWithoutNoteUuid: completedLookupTasks.filter(task => !task.noteUUID).length,
    excludedPlanningNoteCount: excludedNoteUuids.size, listedTaskCount: listedTasks.length,
    listedTasksWithCompletion: listedTasks.filter(hasCompletion).length, mergedTaskCount: allTasks.length,
    tasksInPlanningNotes: allTasks.filter(task => task.noteUUID && excludedNoteUuids.has(task.noteUUID)).length,
    tasksWithoutNoteUuid: allTasks.filter(task => !task.noteUUID).length };
}

// ----------------------------------------------------------------------------------------------
// @desc Read the tasks belonging to the selected domain, falling back to the All Notes scan when no domain is
//   configured. Completed tasks are required here, so done items are explicitly included. Exported because
//   prospect evidence must scope tasks the same way intent evidence does; two definitions of "the tasks this
//   plan is about" would let the two pages of the wizard reason over different work.
// @param {object} app - Host-compatible Amplenote API.
// @param {string|null} domainUuid - Selected domain, or null for All Notes.
// @returns {Promise<Array<object>>} Tasks, or [] when retrieval fails.
export async function domainTasks(app, domainUuid) {
  const tasks = await Promise.resolve(fetchDomainOrAllNotesTasks(app, domainUuid, { includeDone: true })).catch(error => {
    logIfEnabled("[intent-evidence] task retrieval failed", error?.message);
    return [];
  });
  return Array.isArray(tasks) ? tasks.filter(task => task && typeof task === "object") : [];
}

// ----------------------------------------------------------------------------------------------
// @desc Resolve the Rich Footnote definitions behind a bounded sample of the notes that produced the evidence.
//   Bill stores specifications in footnotes, and a visible label omits the details, so each sampled note's
//   content is rendered with its referenced definitions inlined before it reaches a prompt.
// @param {object} app - Host-compatible Amplenote API.
// @param {Array<object>} completedTasks - Completion evidence, or recent tasks when there is none, used to rank which
//   notes matter most.
// @param {Set<string>} personalNoteUuids - Personally tagged notes, always worth sampling when present.
// @returns {Promise<Array<object>>} Up to MAXIMUM_FOOTNOTE_NOTES { noteName, noteUuid, text } entries. The name is
//   carried for the reading page, which lists the notes by title; the prompt identifies them by UUID alone.
async function footnoteResolvedNoteContext(app, completedTasks, personalNoteUuids) {
  const taskCountByNote = new Map();
  const noteNameByUuid = new Map();
  for (const task of completedTasks) {
    taskCountByNote.set(task.noteUUID, (taskCountByNote.get(task.noteUUID) || 0) + 1);
    if (task.noteName && !noteNameByUuid.has(task.noteUUID)) noteNameByUuid.set(task.noteUUID, task.noteName);
  }
  const rankedNoteUuids = [...taskCountByNote.entries()].sort((first, second) => second[1] - first[1]).map(entry => entry[0]);
  const prioritizedUuids = [...personalNoteUuids].filter(uuid => taskCountByNote.has(uuid));
  const sampledUuids = [...new Set(prioritizedUuids.concat(rankedNoteUuids))].slice(0, MAXIMUM_FOOTNOTE_NOTES);
  const noteContext = [];
  const skippedNoteUuids = [];
  for (const noteUuid of sampledUuids) {
    const content = await Promise.resolve(app.getNoteContent({ uuid: noteUuid })).catch(error => {
      logIfEnabled("[intent-evidence] getNoteContent failed", { message: error?.message, noteUuid });
      return null;
    });
    if (typeof content !== "string" || !content.trim()) {
      skippedNoteUuids.push(noteUuid);
      continue;
    }
    const { body, definitions } = parsedRichFootnotes(content);
    const noteName = noteNameByUuid.get(noteUuid) ?? await noteNameFromHandle(app, noteUuid);
    noteContext.push({ noteName, noteUuid, text: passageWithResolvedFootnotes(body, definitions).slice(0, 4000) });
  }
  logIfEnabled("[intent-evidence] note bodies read", { candidateNoteCount: taskCountByNote.size, readNoteCount: noteContext.length,
    sampledNoteCount: sampledUuids.length, skippedEmptyNoteUuids: skippedNoteUuids,
    unnamedNoteCount: noteContext.filter(note => !note.noteName).length });
  return noteContext;
}

// ----------------------------------------------------------------------------------------------
// @desc Look up a note's title when its tasks arrived without one. Task-domain retrieval reports only the owning
//   note's UUID, while the All Notes scan backfills the name from the handle it read.
// @param {object} app - Host-compatible Amplenote API.
// @param {string} noteUuid - Note to name.
// @returns {Promise<string|null>} The note's name, or null when the lookup fails or the note is untitled.
async function noteNameFromHandle(app, noteUuid) {
  if (typeof app.findNote !== "function") return null;
  const handle = await Promise.resolve(app.findNote({ uuid: noteUuid })).catch(() => null);
  return handle?.name || null;
}

// ----------------------------------------------------------------------------------------------
// @desc Read note handles for one filter, tolerating both the bridge's non-spec-compliant thenable and a
//   synchronous throw. Evidence collection degrades to fewer sources rather than failing the whole wizard when
//   one lookup is unavailable.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} filter - filterNotes query.
// @returns {Promise<Array<object>>} Note handles, or [] when the lookup fails.
async function noteHandlesFromFilter(app, filter) {
  try {
    return await arrayFromFilterNotesResult(app.filterNotes(filter));
  } catch (error) {
    logIfEnabled("[intent-evidence] note lookup failed", error?.message);
    return [];
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Identify the notes this subsystem itself writes, so a Vision Guide's stored intents never become the
//   evidence for regenerating those same intents. Exported for prospect discovery, which must exclude the same
//   notes: a stored project would otherwise reappear as the evidence for proposing itself.
// @param {object} app - Host-compatible Amplenote API.
// @returns {Promise<Set<string>>} Note UUIDs to exclude from every evidence source.
export async function planningNoteUuids(app) {
  const excluded = new Set();
  for (const filter of [{ tag: VISION_GUIDE_TAG }, { group: "archived", tag: VISION_GUIDE_TAG }]) {
    const handles = await noteHandlesFromFilter(app, filter);
    for (const handle of handles) if (handle?.uuid) excluded.add(handle.uuid);
  }
  return excluded;
}

// ----------------------------------------------------------------------------------------------
// @desc List the personally tagged notes available to this account, excluding the planning notes.
// @param {object} app - Host-compatible Amplenote API.
// @param {Set<string>} excludedNoteUuids - Planning notes that never count as evidence.
// @returns {Promise<Set<string>>} Note UUIDs whose tags mark them personal.
async function personalNoteUuidsInScope(app, excludedNoteUuids) {
  const handles = await noteHandlesFromFilter(app, {});
  const personalHandles = handles.filter(handle => handle?.uuid && !excludedNoteUuids.has(handle.uuid) && isPersonalNote(handle));
  return new Set(personalHandles.map(handle => handle.uuid));
}

// ----------------------------------------------------------------------------------------------
// @desc Summarize the calendar's available upcoming window as a hobby/pursuit signal. The API exposes upcoming
//   events, not a historical feed, so this deliberately looks forward instead of inventing three months of past
//   events that cannot be retrieved.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} scope - Resolved plan scope, supplying the domain filter.
// @param {Date} referenceDate - Start of the upcoming window.
// @returns {Promise<Array<object>>} { startsAt, title } summaries, or [] when the calendar is unavailable.
async function upcomingCalendarSummaries(app, scope, referenceDate) {
  const rawEvents = await externalCalendarEventsForTargetDate(app, referenceDate, scope.domainUuid, { logPrefix: "[intent-evidence]" });
  const events = normalizeExternalCalendarEvents(rawEvents);
  const titledEvents = events.filter(event => String(event.title ?? event.summary ?? "").trim());
  const summaries = titledEvents.map(event => ({ startsAt: event.start instanceof Date ? event.start.toISOString() : null,
    title: String(event.title ?? event.summary).replace(/\s+/g, " ").trim().slice(0, 120) }));
  return summaries.slice(0, MAXIMUM_RECENT_TASKS);
}
