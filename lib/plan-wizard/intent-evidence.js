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
export async function collectIntentEvidence(app, scope, { referenceDate = new Date() } = {}) {
  const excludedNoteUuids = await planningNoteUuids(app);
  const allTasks = await domainTasks(app, scope.domainUuid);
  const candidateTasks = allTasks.filter(task => task?.noteUUID && !excludedNoteUuids.has(task.noteUUID));
  const { completedTasks, windowMonths, windowStart } = completedTasksWithinWindow(candidateTasks, referenceDate);
  const supplementalTasks = completedTasks.length < MINIMUM_COMPLETED_TASKS ? recentlyCreatedTasks(candidateTasks, completedTasks) : [];
  const personalNoteUuids = await personalNoteUuidsInScope(app, excludedNoteUuids);
  const personalTasks = completedTasks.filter(task => personalNoteUuids.has(task.noteUUID));
  const calendarSummaries = personalTasks.length ? [] : await upcomingCalendarSummaries(app, scope, referenceDate);
  const workReferences = completedTasks.map(taskEvidenceReference);
  const supplementalReferences = supplementalTasks.map(taskEvidenceReference);
  const personalReferences = personalTasks.map(taskEvidenceReference);
  const noteContext = await footnoteResolvedNoteContext(app, completedTasks, personalNoteUuids);
  const coverage = { collectedAt: new Date(referenceDate.getTime()).toISOString(), completedTaskCount: completedTasks.length,
    personalTaskCount: personalTasks.length, supplementalTaskCount: supplementalTasks.length,
    windowMonths, windowStart: windowStart.toISOString() };
  const work = { noteContext, references: workReferences, supplementalReferences };
  const personal = { hasPersonalTaggedEvidence: personalTasks.length > 0, references: personalReferences };
  return { calendarSummaries, coverage, personal, work };
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
// @param {Array<object>} completedTasks - Completion evidence, used to rank which notes matter most.
// @param {Set<string>} personalNoteUuids - Personally tagged notes, always worth sampling when present.
// @returns {Promise<Array<object>>} Up to MAXIMUM_FOOTNOTE_NOTES { noteUuid, text } entries.
async function footnoteResolvedNoteContext(app, completedTasks, personalNoteUuids) {
  const taskCountByNote = new Map();
  for (const task of completedTasks) taskCountByNote.set(task.noteUUID, (taskCountByNote.get(task.noteUUID) || 0) + 1);
  const rankedNoteUuids = [...taskCountByNote.entries()].sort((first, second) => second[1] - first[1]).map(entry => entry[0]);
  const prioritizedUuids = [...personalNoteUuids].filter(uuid => taskCountByNote.has(uuid));
  const sampledUuids = [...new Set(prioritizedUuids.concat(rankedNoteUuids))].slice(0, MAXIMUM_FOOTNOTE_NOTES);
  const noteContext = [];
  for (const noteUuid of sampledUuids) {
    const content = await Promise.resolve(app.getNoteContent({ uuid: noteUuid })).catch(() => null);
    if (typeof content !== "string" || !content.trim()) continue;
    const { body, definitions } = parsedRichFootnotes(content);
    noteContext.push({ noteUuid, text: passageWithResolvedFootnotes(body, definitions).slice(0, 4000) });
  }
  return noteContext;
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
