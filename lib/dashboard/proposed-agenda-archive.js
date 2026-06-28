// [Claude claude-opus-4-8 (1M context)-authored file]
// Prompt summary: "keep a per-date, per-priority, per-LLM record of which tasks the proposed-agenda widget
//   recommended at what time of day, persisted in a monthly archived note ('[Month] [Year] Dashboard Proposed
//   Tasks'). Used as a cache so an identical date+priority+LLM request is served from the note instead of
//   re-calling the LLM, and updated in place when the user reseeds, schedules, or dismisses a proposal."
import { FULL_MONTH_NAMES } from "constants/quarters";
import { DASHBOARD_NOTE_TAG } from "constants/settings";
import { dateKeyFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";

// Lifecycle status persisted per proposed task (the "scheduledEm" dimension of each record entry).
export const PROPOSED_TASK_STATUS = { DISMISSED: "dismissed", PENDING: "pending", SCHEDULED: "scheduled" };

const NOTE_NAME_SUFFIX = "Dashboard Proposed Tasks";

// ----------------------------------------------------------------------------------------------
// @desc Monthly archived-note name holding every proposed-agenda record for a month, e.g.
//   "June 2026 Dashboard Proposed Tasks".
// @param {Date|string|number} date - Any date within the target month.
// @returns {string}
export function proposedAgendaNoteNameFromDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${ FULL_MONTH_NAMES[d.getMonth()] } ${ d.getFullYear() } ${ NOTE_NAME_SUFFIX }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Stable key for one proposed task within a record, mirroring the widget's activityKey so the widget's
//   scheduled/dismissed sets line up with persisted entries (start time + task uuid, or title when uuid-less).
// @param {object} entry - Persisted proposed-task entry or a live activity (needs startMinutes + taskUuid/title).
// @returns {string}
export function proposedTaskKey(entry) {
  return `${ entry.startMinutes }::${ entry.taskUuid || entry.title }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Whether a stored line is the one for a given date+priority+LLM (an llmDateRecord identity: the
//   individual line capturing whether we have already generated an agenda for that date, priority, and LLM).
// @param {object} storedRecord - Persisted line from the note.
// @param {object} llmDateRecord - { dateKey, priorityKey, providerEm } identity to match against.
// @returns {boolean}
function storedRecordMatches(storedRecord, { dateKey, priorityKey, providerEm }) {
  return storedRecord.dateKey === dateKey && storedRecord.priorityKey === priorityKey
    && storedRecord.providerEm === providerEm;
}

// ----------------------------------------------------------------------------------------------
// @desc Reduce a validated/live agenda activity to the compact entry persisted in a record, defaulting its
//   lifecycle status to "pending".
// @param {object} activity - Validated proposed activity (startMinutes/startTime/taskUuid/title/etc.).
// @returns {object} Persisted entry carrying taskUuid, scheduledEm, time + the fields needed to re-render it.
function persistedEntryFromActivity(activity) {
  return { durationMinutes: activity.durationMinutes || 0, isExisting: !!activity.isExisting,
    noteUuid: activity.noteUuid || null, reason: activity.reason || "", scheduledEm: PROPOSED_TASK_STATUS.PENDING,
    startMinutes: activity.startMinutes, taskUuid: activity.taskUuid || null, time: activity.startTime,
    title: activity.title };
}

// ----------------------------------------------------------------------------------------------
// @desc Re-hydrate a persisted entry back into the activity shape the widget renders/schedules from cache.
// @param {object} entry - Persisted proposed-task entry.
// @returns {object} Activity record (matches proposed-agenda-service._validateActivities output).
function activityFromPersistedEntry(entry) {
  return { durationMinutes: entry.durationMinutes || 0, isExisting: !!entry.isExisting, noteUuid: entry.noteUuid || null,
    reason: entry.reason || "", source: "proposed", startMinutes: entry.startMinutes, startTime: entry.time,
    taskUuid: entry.taskUuid || null, title: entry.title };
}

// ----------------------------------------------------------------------------------------------
// @desc Parse the fenced-JSON state out of a proposed-tasks note's content, tolerating empty/corrupt notes.
// @param {string|null} content - Raw note markdown.
// @returns {{records: Array<object>}} Normalized state with a records array.
function stateFromNoteContent(content) {
  if (!content || typeof content !== "string") return { records: [] };
  const match = content.match(/```json\s*([\s\S]*?)```/i);
  const jsonText = match ? match[1] : content;
  try {
    const parsed = JSON.parse(jsonText);
    return { records: Array.isArray(parsed?.records) ? parsed.records : [] };
  } catch {
    return { records: [] };
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Serialize the month's records into readable note content with a fenced JSON block as the source of truth.
// @param {{records: Array<object>}} state - State to serialize.
// @param {string} monthLabel - "[Month] [Year]" label for the human-readable header.
// @returns {string}
function noteContentFromState(state, monthLabel) {
  return [`# Proposed agenda records for ${ monthLabel }`, "",
    "This archived note is maintained by the dashboard plugin. Each record below captures which tasks the "
      + "Proposed Agenda widget recommended for a given date, priority, and AI provider — and what became of each.",
    "", "```json", JSON.stringify(state, null, 2), "```", ""].join("\n");
}

// ----------------------------------------------------------------------------------------------
// @desc Find or create the monthly proposed-tasks data note and parse its current state.
// @param {object} app - Amplenote app bridge.
// @param {Date} date - Date within the target month.
// @returns {Promise<{monthLabel: string, noteHandle: object, state: {records: Array<object>}}>}
async function resolveNoteContext(app, date) {
  const noteName = proposedAgendaNoteNameFromDate(date);
  const monthLabel = `${ FULL_MONTH_NAMES[date.getMonth()] } ${ date.getFullYear() }`;
  let noteHandle = await app.findNote({ name: noteName, tags: [DASHBOARD_NOTE_TAG] }).catch(() => null);
  if (noteHandle?.uuid) {
    const content = await app.getNoteContent({ uuid: noteHandle.uuid }).catch(() => "");
    return { monthLabel, noteHandle, state: stateFromNoteContent(content) };
  }
  const uuid = await app.createNote(noteName, [DASHBOARD_NOTE_TAG], { archive: true });
  noteHandle = { name: noteName, uuid: typeof uuid === "object" ? uuid.uuid : uuid };
  const state = { records: [] };
  await app.replaceNoteContent(noteHandle, noteContentFromState(state, monthLabel)).catch(
    err => logIfEnabled("[proposed-agenda-archive] failed to initialize note:", err));
  logIfEnabled(`[proposed-agenda-archive] created monthly note "${ noteName }" uuid ${ noteHandle.uuid }`);
  return { monthLabel, noteHandle, state };
}

// ----------------------------------------------------------------------------------------------
// @desc Look up a previously-stored proposed agenda for an exact date+priority+LLM identity, returning the
//   re-hydrated activities and the scheduled/dismissed keys recorded for them. Returns null on a cache miss so
//   the caller falls through to a fresh LLM generation.
// @param {object} app - Amplenote app bridge.
// @param {object} params - { date, priorityKey, providerEm }.
// @returns {Promise<{activities: Array<object>, dismissedKeys: Array<string>, llmAttributionFooter: string|null, scheduledKeys: Array<string>}|null>}
export async function loadCachedProposedAgenda(app, { date, priorityKey, providerEm }) {
  const llmDateRecord = { dateKey: dateKeyFromDateInput(date), priorityKey, providerEm };
  const { state } = await resolveNoteContext(app, date);
  const storedRecord = state.records.find(line => storedRecordMatches(line, llmDateRecord));
  if (!storedRecord || !Array.isArray(storedRecord.proposedTasks) || storedRecord.proposedTasks.length === 0) {
    return null;
  }
  const activities = storedRecord.proposedTasks.map(activityFromPersistedEntry);
  const scheduledKeys = storedRecord.proposedTasks.filter(e => e.scheduledEm === PROPOSED_TASK_STATUS.SCHEDULED)
    .map(proposedTaskKey);
  const dismissedKeys = storedRecord.proposedTasks.filter(e => e.scheduledEm === PROPOSED_TASK_STATUS.DISMISSED)
    .map(proposedTaskKey);
  logIfEnabled("[proposed-agenda-archive] cache hit", { ...llmDateRecord, taskCount: activities.length });
  return { activities, dismissedKeys, llmAttributionFooter: storedRecord.llmAttributionFooter || null,
    scheduledKeys };
}

// ----------------------------------------------------------------------------------------------
// @desc Persist (or, when reseeding/regenerating, replace) the line for a date+priority+LLM identity with a
//   freshly-generated set of proposed activities — all entries start "pending".
// @param {object} app - Amplenote app bridge.
// @param {object} params - { activities, date, llmAttributionFooter, priorityKey, providerEm }.
// @returns {Promise<void>}
export async function storeProposedAgenda(app, { activities, date, llmAttributionFooter = null, priorityKey,
    providerEm }) {
  const llmDateRecord = { dateKey: dateKeyFromDateInput(date), priorityKey, providerEm };
  const { monthLabel, noteHandle, state } = await resolveNoteContext(app, date);
  const storedRecord = { ...llmDateRecord, llmAttributionFooter,
    proposedTasks: (activities || []).map(persistedEntryFromActivity) };
  const records = [storedRecord, ...state.records.filter(line => !storedRecordMatches(line, llmDateRecord))];
  await app.replaceNoteContent(noteHandle, noteContentFromState({ records }, monthLabel));
  logIfEnabled("[proposed-agenda-archive] stored record",
    { ...llmDateRecord, taskCount: storedRecord.proposedTasks.length });
}

// ----------------------------------------------------------------------------------------------
// @desc Update the lifecycle status ("scheduled"/"dismissed"/"pending") of specific proposed tasks within the
//   line for a date+priority+LLM identity, so the note reflects what the user did with each recommendation.
//   No-op (without error) when no matching line exists.
// @param {object} app - Amplenote app bridge.
// @param {object} params - { activityKeys, date, priorityKey, providerEm, scheduledEm }.
//   - {Array<string>} activityKeys - proposedTaskKey() values whose status should change.
//   - {string} scheduledEm - One of PROPOSED_TASK_STATUS.
// @returns {Promise<void>}
export async function updateProposedTaskStatuses(app, { activityKeys, date, priorityKey, providerEm, scheduledEm }) {
  const keys = new Set(activityKeys || []);
  if (keys.size === 0) return;
  const llmDateRecord = { dateKey: dateKeyFromDateInput(date), priorityKey, providerEm };
  const { monthLabel, noteHandle, state } = await resolveNoteContext(app, date);
  const storedRecord = state.records.find(line => storedRecordMatches(line, llmDateRecord));
  if (!storedRecord || !Array.isArray(storedRecord.proposedTasks)) return;
  let changed = false;
  storedRecord.proposedTasks = storedRecord.proposedTasks.map(entry => {
    if (!keys.has(proposedTaskKey(entry)) || entry.scheduledEm === scheduledEm) return entry;
    changed = true;
    return { ...entry, scheduledEm };
  });
  if (!changed) return;
  await app.replaceNoteContent(noteHandle, noteContentFromState(state, monthLabel));
  logIfEnabled("[proposed-agenda-archive] updated statuses", { ...llmDateRecord, scheduledEm, count: keys.size });
}
