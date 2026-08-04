import { FULL_MONTH_NAMES } from "constants/quarters";
import { DASHBOARD_NOTE_TAG } from "constants/settings";
import { dateKeyFromDateInput } from "util/date-utility";
import { stableJson } from "util/json-utility";
import { logIfEnabled } from "util/log";

// Lifecycle status persisted per proposed task (the "scheduledEm" dimension of each record entry).
export const PROPOSED_TASK_STATUS = { DISMISSED: "dismissed", PENDING: "pending", SCHEDULED: "scheduled" };

const NOTE_NAME_SUFFIX = "Dashboard Proposed Tasks";

// How many prior days of proposal history the recency de-duplication rules consult (a "previous week"). The
// two rules enforced from it (no repeat two days running; no more than twice in any 5-day window) both fit
// inside this window, so a 7-day look-back is sufficient. See recentProposedTaskHistory.
const HISTORY_WINDOW_DAYS = 7;

// ----------------------------------------------------------------------------------------------
// @desc Monthly archived-note name holding one Task Domain's proposed-agenda records, e.g.
//   "June 2026 Work Dashboard Proposed Tasks".
// @param {Date|string|number} date - Any date within the target month.
// @param {string} domainName - Task Domain display name, or "All Notes".
// @returns {string}
export function proposedAgendaNoteNameFromDate(date, domainName) {
  const d = date instanceof Date ? date : new Date(date);
  return `${ FULL_MONTH_NAMES[d.getMonth()] } ${ d.getFullYear() } ${ domainName } ${ NOTE_NAME_SUFFIX }`;
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
// @desc Whether a stored line matches a Task Domain, date, priority, and LLM identity.
// @param {object} storedRecord - Persisted line from the note.
// @param {object} llmDateRecord - { dateKey, domainUuid, priorityKey, providerEm } identity to match.
// @returns {boolean}
function storedRecordMatches(storedRecord, { dateKey, domainUuid, priorityKey, providerEm }) {
  return storedRecord.dateKey === dateKey && storedRecord.priorityKey === priorityKey
    && storedRecord.providerEm === providerEm && storedRecord.domainUuid === domainUuid;
}

// ----------------------------------------------------------------------------------------------
// @desc Whether a stored record was produced from the same day-specific context now being requested.
// @param {object} storedRecord - Persisted line from the note.
// @param {object|null} recommendationContextKey - Context identity with targetDateKey, allDayEvents,
//   completionPatterns, eventCategories, and researchNotes; null ignores this dimension for legacy callers.
// @returns {boolean}
function storedRecordContextMatches(storedRecord, recommendationContextKey = null) {
  if (!recommendationContextKey) return true;
  return storedRecord.contextFingerprint === stableJson(recommendationContextKey);
}

// ----------------------------------------------------------------------------------------------
// @desc Reduce a validated/live agenda activity to the compact entry persisted in a record, honoring any
//   lifecycle status already on the activity (so a reconciled re-store preserves prior scheduled/dismissed
//   decisions) and defaulting to "pending" for freshly-generated activities.
// @param {object} activity - Validated proposed activity (scheduledEm?/startMinutes/startTime/taskUuid/title/etc.).
// @returns {object} Persisted entry carrying taskUuid, scheduledEm, time + the fields needed to re-render it.
function persistedEntryFromActivity(activity) {
  return { durationMinutes: activity.durationMinutes || 0, isExisting: !!activity.isExisting,
    noteUuid: activity.noteUuid || null, reason: activity.reason || "",
    scheduledEm: activity.scheduledEm || PROPOSED_TASK_STATUS.PENDING,
    startMinutes: activity.startMinutes, targetMidnightSeconds: activity.targetMidnightSeconds ?? null,
    taskUuid: activity.taskUuid || null, time: activity.startTime, title: activity.title };
}

// ----------------------------------------------------------------------------------------------
// @desc Re-hydrate a persisted entry back into the activity shape the widget renders/schedules from cache.
//   Carries scheduledEm through so the service can tell which cached suggestions are still pending (and thus
//   worth re-verifying against their live task) versus already scheduled/dismissed.
// @param {object} entry - Persisted proposed-task entry.
// @returns {object} Activity record (matches proposed-agenda-service._validateActivities output, plus scheduledEm).
function activityFromPersistedEntry(entry) {
  return { durationMinutes: entry.durationMinutes || 0, isExisting: !!entry.isExisting, noteUuid: entry.noteUuid || null,
    reason: entry.reason || "", scheduledEm: entry.scheduledEm || PROPOSED_TASK_STATUS.PENDING, source: "proposed",
    startMinutes: entry.startMinutes, startTime: entry.time, targetMidnightSeconds: entry.targetMidnightSeconds ?? null,
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
// @param {string} domainName - Task Domain represented by the note.
// @param {string} monthLabel - "[Month] [Year]" label for the human-readable header.
// @param {{records: Array<object>}} state - State to serialize.
// @returns {string}
function noteContentFromState(domainName, monthLabel, state) {
  return [`# Proposed agenda records for ${ domainName } — ${ monthLabel }`, "",
    "This archived note is maintained by the dashboard plugin. Each record below captures which tasks the "
      + "Proposed Agenda widget recommended for a given date, priority, and AI provider — and what became of each.",
    "", "```json", JSON.stringify(state, null, 2), "```", ""].join("\n");
}

// ----------------------------------------------------------------------------------------------
// @desc Find or create the monthly proposed-tasks data note and parse its current state.
// @param {object} app - Amplenote app bridge.
// @param {Date} date - Date within the target month.
// @param {string} domainName - Task Domain display name.
// @returns {Promise<{monthLabel: string, noteHandle: object, state: {records: Array<object>}}>}
async function resolveNoteContext(app, date, domainName) {
  const noteName = proposedAgendaNoteNameFromDate(date, domainName);
  const monthLabel = `${ FULL_MONTH_NAMES[date.getMonth()] } ${ date.getFullYear() }`;
  let noteHandle = await app.findNote({ name: noteName, tags: [DASHBOARD_NOTE_TAG] }).catch(() => null);
  if (noteHandle?.uuid) {
    const content = await app.getNoteContent({ uuid: noteHandle.uuid }).catch(() => "");
    return { monthLabel, noteHandle, state: stateFromNoteContent(content) };
  }
  const uuid = await app.createNote(noteName, [DASHBOARD_NOTE_TAG], { archive: true });
  noteHandle = { name: noteName, uuid: typeof uuid === "object" ? uuid.uuid : uuid };
  const state = { records: [] };
  await app.replaceNoteContent(noteHandle, noteContentFromState(domainName, monthLabel, state)).catch(
    err => logIfEnabled("[proposed-agenda-archive] failed to initialize note:", err));
  logIfEnabled(`[proposed-agenda-archive] created monthly note "${ noteName }" uuid ${ noteHandle.uuid }`);
  return { monthLabel, noteHandle, state };
}

// ----------------------------------------------------------------------------------------------
// @desc Read (without creating) the records stored in one month's proposed-tasks note. Unlike resolveNoteContext
//   this never creates the note, so consulting history for a month that was never written stays side-effect free.
// @param {object} app - Amplenote app bridge.
// @param {Date} date - Any date within the target month.
// @param {string} domainName - Task Domain display name.
// @returns {Promise<Array<object>>} The month's stored records (empty when the note is absent/empty/corrupt).
// [Claude claude-opus-4-8 (1M context)] Task: side-effect-free read of a month's proposed-agenda records
async function readMonthRecords(app, date, domainName) {
  const noteName = proposedAgendaNoteNameFromDate(date, domainName);
  const noteHandle = await app.findNote({ name: noteName, tags: [DASHBOARD_NOTE_TAG] }).catch(() => null);
  if (!noteHandle?.uuid) return [];
  const content = await app.getNoteContent({ uuid: noteHandle.uuid }).catch(() => "");
  return stateFromNoteContent(content).records;
}

// ----------------------------------------------------------------------------------------------
// @desc List one representative Date per distinct calendar month spanned by [startDate, endDate], so the history
//   look-back can read every monthly note the window touches (a week-long window crosses at most one month bound).
// @param {Date} startDate - Earliest day in the window.
// @param {Date} endDate - Latest day in the window.
// @returns {Array<Date>} One Date (first of the month) per distinct month, ascending.
// [Claude claude-opus-4-8 (1M context)] Task: enumerate the month notes a look-back window spans
function distinctMonthDates(startDate, endDate) {
  const monthDates = [];
  const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const lastMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
  while (cursor <= lastMonth) {
    monthDates.push(new Date(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return monthDates;
}

// ----------------------------------------------------------------------------------------------
// @desc Build the prior-proposal log the recency de-duplication rules read: for every task suggested on a day
//   strictly before `date` and within the trailing look-back window, the set of distinct day-keys it was
//   suggested on. Counts distinct DAYS (a task proposed under two priorities/LLMs on one day counts once) and
//   spans month-note boundaries. `date` itself is excluded so an in-progress regeneration never sees its own
//   record. Returns an empty map on any read failure so history never blocks generation.
// @param {object} app - Amplenote app bridge.
// @param {object} params - { date, domainName, domainUuid, windowDays? }.
//   - {Date} date - The day being generated for (its own proposals are excluded).
//   - {string} domainName - Task Domain display name selecting the monthly note.
//   - {string|null} domainUuid - Task Domain UUID selecting records inside the note.
//   - {number} [windowDays=HISTORY_WINDOW_DAYS] - How many prior days to include.
// @returns {Promise<Map<string, Set<string>>>} taskUuid -> set of prior YYYY-MM-DD day-keys it was proposed on.
export async function recentProposedTaskHistory(app, { date, domainName, domainUuid,
    windowDays = HISTORY_WINDOW_DAYS }) {
  const targetKey = dateKeyFromDateInput(date);
  const windowStart = new Date(date.getFullYear(), date.getMonth(), date.getDate() - windowDays, 0, 0, 0);
  const windowStartKey = dateKeyFromDateInput(windowStart);
  const recordArrays = await Promise.all(distinctMonthDates(windowStart, date).map(monthDate =>
    readMonthRecords(app, monthDate, domainName).catch(() => [])));
  const history = new Map();
  for (const record of recordArrays.flat()) {
    const recordKey = record?.dateKey;
    // Keep only days in [windowStart, date) — day-keys are YYYY-MM-DD, so string comparison is chronological.
    const recordIsOutsideWindow = !recordKey || recordKey >= targetKey || recordKey < windowStartKey;
    if (recordIsOutsideWindow || record.domainUuid !== domainUuid) continue;
    for (const entry of Array.isArray(record.proposedTasks) ? record.proposedTasks : []) {
      if (!entry?.taskUuid) continue;
      if (!history.has(entry.taskUuid)) history.set(entry.taskUuid, new Set());
      history.get(entry.taskUuid).add(recordKey);
    }
  }
  return history;
}

// ----------------------------------------------------------------------------------------------
// @desc Look up a previously-stored proposed agenda for an exact date+priority+LLM identity, returning the
//   re-hydrated activities and the scheduled/dismissed keys recorded for them. Returns null on a cache miss so
//   the caller falls through to a fresh LLM generation.
// @param {object} app - Amplenote app bridge.
// @param {object} params - { date, domainName, domainUuid, priorityKey, providerEm, recommendationContextKey }.
//   `recommendationContextKey` contains the target date key, all-day event keys, same-weekday completion-pattern
//   keys, event categories, and research-note keys that made the cached recommendation valid.
// @returns {Promise<{activities: Array<object>, dismissedKeys: Array<string>, llmAttributionFooter: string|null, scheduledKeys: Array<string>}|null>}
export async function loadCachedProposedAgenda(app, { date, domainName, domainUuid, priorityKey, providerEm,
    recommendationContextKey = null }) {
  const llmDateRecord = { dateKey: dateKeyFromDateInput(date), domainUuid, priorityKey, providerEm };
  const { state } = await resolveNoteContext(app, date, domainName);
  const storedRecord = state.records.find(line => storedRecordMatches(line, llmDateRecord)
    && storedRecordContextMatches(line, recommendationContextKey));
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
// @param {object} params - { activities, date, domainName, domainUuid, llmAttributionFooter, priorityKey,
//   providerEm, recommendationContextKey }.
//   `recommendationContextKey` contains the target date key, all-day event keys, same-weekday completion-pattern
//   keys, event categories, and research-note keys that should be matched before this cache entry can be reused.
// @returns {Promise<void>}
export async function storeProposedAgenda(app, { activities, date, domainName, domainUuid,
    llmAttributionFooter = null, priorityKey, providerEm, recommendationContextKey = null }) {
  const llmDateRecord = { dateKey: dateKeyFromDateInput(date), domainUuid, priorityKey, providerEm };
  const { monthLabel, noteHandle, state } = await resolveNoteContext(app, date, domainName);
  const contextFingerprint = recommendationContextKey ? stableJson(recommendationContextKey) : null;
  const storedRecord = { ...llmDateRecord, contextFingerprint, llmAttributionFooter,
    proposedTasks: (activities || []).map(persistedEntryFromActivity) };
  const records = [storedRecord, ...state.records.filter(line => !storedRecordMatches(line, llmDateRecord))];
  await app.replaceNoteContent(noteHandle, noteContentFromState(domainName, monthLabel, { records }));
  logIfEnabled("[proposed-agenda-archive] stored record",
    { ...llmDateRecord, taskCount: storedRecord.proposedTasks.length });
}

// ----------------------------------------------------------------------------------------------
// @desc Update the lifecycle status ("scheduled"/"dismissed"/"pending") of specific proposed tasks within the
//   line for a date+priority+LLM identity, so the note reflects what the user did with each recommendation.
//   No-op (without error) when no matching line exists.
// @param {object} app - Amplenote app bridge.
// @param {object} params - { activityKeys, date, domainName, domainUuid, priorityKey, providerEm, scheduledEm }.
//   - {Array<string>} activityKeys - proposedTaskKey() values whose status should change.
//   - {string} scheduledEm - One of PROPOSED_TASK_STATUS.
// @returns {Promise<void>}
export async function updateProposedTaskStatuses(app, { activityKeys, date, domainName, domainUuid, priorityKey,
    providerEm, scheduledEm }) {
  const keys = new Set(activityKeys || []);
  if (keys.size === 0) return;
  const llmDateRecord = { dateKey: dateKeyFromDateInput(date), domainUuid, priorityKey, providerEm };
  const { monthLabel, noteHandle, state } = await resolveNoteContext(app, date, domainName);
  const storedRecord = state.records.find(line => storedRecordMatches(line, llmDateRecord));
  if (!storedRecord || !Array.isArray(storedRecord.proposedTasks)) return;
  let changed = false;
  storedRecord.proposedTasks = storedRecord.proposedTasks.map(entry => {
    if (!keys.has(proposedTaskKey(entry)) || entry.scheduledEm === scheduledEm) return entry;
    changed = true;
    return { ...entry, scheduledEm };
  });
  if (!changed) return;
  await app.replaceNoteContent(noteHandle, noteContentFromState(domainName, monthLabel, state));
  logIfEnabled("[proposed-agenda-archive] updated statuses", { ...llmDateRecord, scheduledEm, count: keys.size });
}
