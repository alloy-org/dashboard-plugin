import { FULL_MONTH_NAMES } from "constants/quarters";
import { DASHBOARD_NOTE_TAG } from "constants/settings";
import { NOTE_WRITE_BACKSTOP_CHARACTERS } from "constants/units";
import { suggestionIdentityKey } from "dashboard/suggestions/suggestion-staleness";
import { dateKeyFromDateInput } from "util/date-utility";
import { jsonFenceContent, stableJson } from "util/json-utility";
import { logIfEnabled } from "util/log";

// Lifecycle status persisted per proposed task (the "scheduledEm" dimension of each record entry).
export const PROPOSED_TASK_STATUS = { DISMISSED: "dismissed", PENDING: "pending", SCHEDULED: "scheduled" };

const NOTE_NAME_SUFFIX = "Dashboard Proposed Tasks";

// Version of the generation logic a stored record was produced by. Bump it whenever a change alters what fresh
// generation would propose (destination notes, ranking weights, entry fields), so records cached by older logic
// are regenerated instead of replayed. Records stored before versioning carry no version and always miss.
// Version 2: new-task ideas carry a destination noteUuid, and existing tasks are ranked against ideas by importance.
// Version 3: each suggestion names its project and can carry the benefit sentence the calendar tooltip shows.
// Version 4: each suggestion names the weekday the user chose for its project, when that weekday is its day.
export const PROPOSED_AGENDA_RECORD_VERSION = 4;

// How many prior days of proposal history the recency de-duplication rules consult (a "previous week"). The
// two rules enforced from it (no repeat two days running; no more than twice in any 5-day window) both fit
// inside this window, so a 7-day look-back is sufficient. See recentProposedTaskHistory.
const HISTORY_WINDOW_DAYS = 7;

// Past days are pared on every write, so a month's note normally stays far below Amplenote's write limit; the shared
// backstop keeps a write under it regardless.
const NOTE_CHARACTER_BUDGET = NOTE_WRITE_BACKSTOP_CHARACTERS;

// Every write reads the monthly note, edits one record, and replaces the whole note, so two writes in flight at once
// would each drop the other's record. A calendar pass stores one day's rationale while the next day is generating,
// so writes queue behind this promise and each starts only after the previous one settles.
let _archiveWriteQueue = Promise.resolve();

// ----------------------------------------------------------------------------------------------
// @desc Run one archive write after every write queued before it has settled, whether it succeeded or failed.
// @param {Function} write - async () => result, performing one read-modify-replace of a monthly note.
// @returns {Promise<*>} The write's own result or rejection.
function _serializedArchiveWrite(write) {
  const queuedWrite = _archiveWriteQueue.then(write, write);
  _archiveWriteQueue = queuedWrite.catch(() => null);
  return queuedWrite;
}

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
// @desc Stable day-aware key shared by persisted entries and rendered agenda rows.
// @param {object} entry - Persisted proposed-task entry or a live activity (needs startMinutes + taskUuid/title).
// @returns {string}
export function proposedTaskKey(entry) {
  const dayPrefix = entry.targetMidnightSeconds ? `${ entry.targetMidnightSeconds }::` : "";
  return `${ dayPrefix }${ entry.startMinutes }::${ entry.taskUuid || entry.title }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Whether a stored line matches a Task Domain, date, and priority. The AI provider is recorded on each line but is
//   not part of its identity: each device resolves its provider from the API keys it holds, so keying on it let a
//   second device miss the agenda the first had already stored for the day, and generate another. A day therefore
//   holds one line per priority, whichever provider wrote it.
// @param {object} storedRecord - Persisted line from the note.
// @param {object} llmDateRecord - { dateKey, domainUuid, priorityKey } identity to match; other fields are ignored.
// @returns {boolean}
function storedRecordMatches(storedRecord, { dateKey, domainUuid, priorityKey }) {
  return storedRecord.dateKey === dateKey && storedRecord.priorityKey === priorityKey
    && storedRecord.domainUuid === domainUuid;
}

// ----------------------------------------------------------------------------------------------
// @desc Summarize every line stored for a day, whatever its domain or priority, so a cache miss shows how close the
//   stored lines came to the identity requested.
// @param {Array<object>} records - The month's stored lines.
// @param {string} dateKey - YYYY-MM-DD of the requested day.
// @returns {Array<object>} { contextFingerprint, domainUuid, priorityKey, providerEm, rationalePending, recordVersion,
//   taskCount } per line stored for the day.
function _sameDayRecordSummaries(records, dateKey) {
  const sameDayRecords = records.filter(record => record.dateKey === dateKey);
  const summaries = sameDayRecords.map(record => ({ contextFingerprint: record.contextFingerprint ?? null,
    domainUuid: record.domainUuid ?? null, priorityKey: record.priorityKey ?? null, providerEm: record.providerEm ?? null,
    rationalePending: !!record.rationalePending, recordVersion: record.recordVersion ?? null,
    taskCount: record.proposedTasks?.length || 0 }));
  return summaries;
}

// ----------------------------------------------------------------------------------------------
// @desc Whether a stored record was produced by the current generation logic, so its proposals can be reused.
//   Records from older logic still match for replacement and status updates, but never serve as a cache hit.
// @param {object} storedRecord - Persisted line from the note.
// @returns {boolean}
function storedRecordIsCurrentVersion(storedRecord) {
  return storedRecord.recordVersion === PROPOSED_AGENDA_RECORD_VERSION;
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
//   decisions) and defaulting to "pending" for freshly-generated activities. Preserve project UUIDs for scheduling, and
//   a generated idea's ID so accepting or dismissing it is recorded on the idea.
// @param {object} activity - Validated proposed activity (scheduledEm?/startMinutes/startTime/taskUuid/title/etc.).
// @returns {object} Persisted entry carrying taskUuid, scheduledEm, time + the fields needed to re-render it.
function persistedEntryFromActivity(activity) {
  return { benefit: activity.benefit || "", durationMinutes: activity.durationMinutes || 0,
    emphasizedWeekday: activity.emphasizedWeekday, ideaId: activity.ideaId || null,
    isExisting: !!activity.isExisting, noteUuid: activity.noteUuid || null, projectSummary: activity.projectSummary || "",
    projectUuid: activity.projectUuid || null, reason: activity.reason || "",
    scheduledEm: activity.scheduledEm || PROPOSED_TASK_STATUS.PENDING,
    startMinutes: activity.startMinutes, targetMidnightSeconds: activity.targetMidnightSeconds ?? null,
    taskUuid: activity.taskUuid || null, time: activity.startTime, title: activity.title };
}

// ----------------------------------------------------------------------------------------------
// @desc Re-hydrate a persisted entry back into the activity shape the widget renders/schedules from cache.
//   Carries scheduledEm through so the service can tell which cached suggestions are still pending (and thus
//   worth re-verifying against their live task) versus already scheduled/dismissed, retaining project associations
//   and idea identity.
// @param {object} entry - Persisted proposed-task entry.
// @returns {object} Activity record (matches proposed-agenda-service._validateActivities output, plus scheduledEm).
function activityFromPersistedEntry(entry) {
  return { benefit: entry.benefit || "", durationMinutes: entry.durationMinutes || 0,
    emphasizedWeekday: entry.emphasizedWeekday, ideaId: entry.ideaId || null,
    isExisting: !!entry.isExisting, noteUuid: entry.noteUuid || null, projectSummary: entry.projectSummary || "",
    projectUuid: entry.projectUuid || null, reason: entry.reason || "",
    scheduledEm: entry.scheduledEm || PROPOSED_TASK_STATUS.PENDING, source: "proposed",
    startMinutes: entry.startMinutes, startTime: entry.time, targetMidnightSeconds: entry.targetMidnightSeconds ?? null,
    taskUuid: entry.taskUuid || null, title: entry.title };
}

// ----------------------------------------------------------------------------------------------
// @desc Parse the fenced-JSON state out of a proposed-tasks note's content, tolerating empty/corrupt notes.
// @param {string|null} content - Raw note markdown.
// @returns {{records: Array<object>}} Normalized state with a records array.
function stateFromNoteContent(content) {
  if (!content || typeof content !== "string") return { records: [] };
  const jsonText = jsonFenceContent(content) ?? content;
  try {
    const parsed = JSON.parse(jsonText);
    return { records: Array.isArray(parsed?.records) ? parsed.records : [] };
  } catch {
    return { records: [] };
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Serialize the month's records into readable note content with a fenced JSON block as the source of truth.
//   Each record sits on its own line rather than being indented field by field, which keeps a month of records about
//   half the size it would be pretty-printed.
// @param {string} domainName - Task Domain represented by the note.
// @param {string} monthLabel - "[Month] [Year]" label for the human-readable header.
// @param {{records: Array<object>}} state - State to serialize.
// @returns {string}
function noteContentFromState(domainName, monthLabel, state) {
  const recordLines = state.records.map(record => JSON.stringify(record));
  const recordsJson = recordLines.length ? `{"records":[\n${ recordLines.join(",\n") }\n]}` : `{"records":[]}`;
  return [`# Proposed agenda records for ${ domainName } — ${ monthLabel }`, "",
    "This archived note is maintained by the dashboard plugin. Each record below captures which tasks the "
      + "Proposed Agenda widget recommended for a given date, priority, and AI provider — and what became of each.",
    "", "```json", recordsJson, "```", ""].join("\n");
}

// ----------------------------------------------------------------------------------------------
// @desc Pare the past days out of a month's records, since the calendar already records what was done. The trailing
//   HISTORY_WINDOW_DAYS days stay because recentProposedTaskHistory reads their proposals for the no-repeat rules, but
//   they lose their reserves, which are only read when refilling a day that is today or later. Older days are removed.
//   If the note would still exceed NOTE_CHARACTER_BUDGET, the oldest remaining past days are removed one at a time.
//   Days from today on, and the day being written, are kept whole.
// @param {string} domainName - Task Domain represented by the note.
// @param {string} monthLabel - "[Month] [Year]" label for the header.
// @param {Array<object>} records - Records to store, newest first.
// @param {string} writtenDateKey - YYYY-MM-DD of the day this write is for.
// @param {Date} [now=new Date()] - Current time, deciding which days are past.
// @returns {Array<object>} The records to store.
function _paredRecords(domainName, monthLabel, records, writtenDateKey, now = new Date()) {
  const todayKey = dateKeyFromDateInput(now);
  const historyStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - HISTORY_WINDOW_DAYS);
  const historyStartKey = dateKeyFromDateInput(historyStart);
  const isPastRecord = record => record.dateKey !== writtenDateKey && (!record.dateKey || record.dateKey < todayKey);
  const isHistoryRecord = record => !isPastRecord(record) || (record.dateKey && record.dateKey >= historyStartKey);
  const historyRecords = records.filter(isHistoryRecord);
  let keptRecords = historyRecords.map(record => (isPastRecord(record) && record.reserveTasks?.length
    ? { ...record, reserveTasks: [] } : record));
  const fitsBudget = candidateRecords => noteContentFromState(domainName, monthLabel, { records: candidateRecords })
    .length <= NOTE_CHARACTER_BUDGET;
  while (!fitsBudget(keptRecords)) {
    const pastRecords = keptRecords.filter(isPastRecord);
    if (!pastRecords.length) break;
    const oldestRecord = pastRecords.reduce((oldest, record) => (record.dateKey < oldest.dateKey ? record : oldest));
    keptRecords = keptRecords.filter(record => record !== oldestRecord);
  }
  const removedCount = records.length - keptRecords.length;
  if (removedCount) logIfEnabled("[proposed-agenda-archive] pared past days", { keptCount: keptRecords.length, monthLabel,
    removedCount });
  return keptRecords;
}

// ----------------------------------------------------------------------------------------------
// @desc Replace a month's note with the given records, after paring its past days, and fail loudly when the write did
//   not happen. A note whose read failed is never written, since its records would be replaced by only the ones this
//   call holds. The embed bridge reports a host-side throw as a resolved { embedCallFailed } envelope, so that is
//   checked as well as a rejection.
// @param {object} app - Amplenote app bridge.
// @param {object} noteContext - resolveNoteContext's result plus domainName: { domainName, monthLabel, noteHandle,
//   readFailed }.
// @param {Array<object>} records - Records the note should hold, newest first.
// @param {string} writtenDateKey - YYYY-MM-DD of the day this write is for, whose record is never pared.
// @returns {Promise<void>} Rejects when the note could not be read or written.
async function _replaceArchiveNote(app, { domainName, monthLabel, noteHandle, readFailed }, records, writtenDateKey) {
  if (readFailed) throw new Error(`could not read the ${ monthLabel } proposed agenda note, so it was not overwritten`);
  const keptRecords = _paredRecords(domainName, monthLabel, records, writtenDateKey);
  const result = await app.replaceNoteContent(noteHandle, noteContentFromState(domainName, monthLabel,
    { records: keptRecords }));
  if (result?.embedCallFailed) throw new Error(result.error || "replaceNoteContent failed");
}

// ----------------------------------------------------------------------------------------------
// @desc Find or create the monthly proposed-tasks data note and parse its current state.
// @param {object} app - Amplenote app bridge.
// @param {Date} date - Date within the target month.
// @param {string} domainName - Task Domain display name.
// @returns {Promise<{monthLabel: string, noteHandle: object, readFailed: boolean, state: {records: Array<object>}}>}
//   readFailed is true when the existing note's content could not be read, so its state is empty but not known empty.
async function resolveNoteContext(app, date, domainName) {
  const noteName = proposedAgendaNoteNameFromDate(date, domainName);
  const monthLabel = `${ FULL_MONTH_NAMES[date.getMonth()] } ${ date.getFullYear() }`;
  let noteHandle = await app.findNote({ name: noteName, tags: [DASHBOARD_NOTE_TAG] }).catch(() => null);
  if (noteHandle?.uuid) {
    const content = await app.getNoteContent({ uuid: noteHandle.uuid }).catch(() => null);
    const readFailed = content === null || content === undefined || !!content?.embedCallFailed;
    // Rebuild as a bare { uuid }: a findNote handle does not survive the embed's postMessage bridge as a
    //   writable reference, and the host answers such a write with an unearned true. See doc/code_conventions.md.
    return { monthLabel, noteHandle: { uuid: noteHandle.uuid }, readFailed, state: stateFromNoteContent(content) };
  }
  const uuid = await app.createNote(noteName, [DASHBOARD_NOTE_TAG], { archive: true });
  noteHandle = { name: noteName, uuid: typeof uuid === "object" ? uuid.uuid : uuid };
  const state = { records: [] };
  await app.replaceNoteContent(noteHandle, noteContentFromState(domainName, monthLabel, state)).catch(
    err => logIfEnabled("[proposed-agenda-archive] failed to initialize note:", err));
  logIfEnabled(`[proposed-agenda-archive] created monthly note "${ noteName }" uuid ${ noteHandle.uuid }`);
  return { monthLabel, noteHandle, readFailed: false, state };
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
// @desc Look up a previously-stored proposed agenda for a date+priority in a Task Domain, returning the re-hydrated
//   activities and the scheduled/dismissed keys recorded for them. A line written by any provider is served, preferring
//   one from the requested provider when a note written before provider-independent identity holds several. Returns
//   null on a cache miss so the caller falls through to a fresh generation, logging every line stored for the day so
//   the miss can be explained. A record stored by an older PROPOSED_AGENDA_RECORD_VERSION is a miss, so its
//   regeneration replaces it.
// @param {object} app - Amplenote app bridge.
// @param {object} params - { date, domainName, domainUuid, priorityKey, providerEm, recommendationContextKey }.
//   `recommendationContextKey` contains the target date key, all-day event keys, same-weekday completion-pattern
//   keys, event categories, and research-note keys that made the cached recommendation valid.
// @returns {Promise<{activities: Array<object>, dismissedKeys: Array<string>, llmAttributionFooter: string|null,
//   meetingKeys: Array<string>|null, providerEm: string|null, rationalePending: boolean, reserveTasks: Array<object>,
//   scheduledKeys: Array<string>}|null>} meetingKeys names the meetings the agenda was planned for, and is null for a
//   record that does not know them. providerEm is the provider that wrote the record. rationalePending is true when the
//   record was stored before its benefit sentences arrived and nothing has written them since.
export async function loadCachedProposedAgenda(app, { date, domainName, domainUuid, priorityKey, providerEm,
    recommendationContextKey = null }) {
  const llmDateRecord = { dateKey: dateKeyFromDateInput(date), domainUuid, priorityKey, providerEm };
  const { readFailed, state } = await resolveNoteContext(app, date, domainName);
  const identityMatches = state.records.filter(line => storedRecordMatches(line, llmDateRecord));
  const contextMatches = identityMatches.filter(line => storedRecordContextMatches(line, recommendationContextKey));
  const storedRecord = contextMatches.find(line => line.providerEm === providerEm) || contextMatches[0];
  if (!storedRecord || !Array.isArray(storedRecord.proposedTasks) || storedRecord.proposedTasks.length === 0) {
    const missReason = !identityMatches.length ? "no record for this day" : !storedRecord
      ? "day context changed since the record was stored" : "record holds no proposed tasks";
    logIfEnabled("[proposed-agenda-archive] cache miss", { ...llmDateRecord, missReason, readFailed,
      sameDayRecords: _sameDayRecordSummaries(state.records, llmDateRecord.dateKey),
      storedFingerprints: identityMatches.map(line => line.contextFingerprint ?? null),
      storedRecordCount: state.records.length });
    return null;
  }
  if (!storedRecordIsCurrentVersion(storedRecord)) {
    logIfEnabled("[proposed-agenda-archive] cache miss: record from older generation logic", { ...llmDateRecord,
      currentVersion: PROPOSED_AGENDA_RECORD_VERSION, recordVersion: storedRecord.recordVersion ?? null });
    return null;
  }
  const activities = storedRecord.proposedTasks.map(activityFromPersistedEntry);
  const scheduledKeys = storedRecord.proposedTasks.filter(e => e.scheduledEm === PROPOSED_TASK_STATUS.SCHEDULED)
    .map(proposedTaskKey);
  const dismissedKeys = storedRecord.proposedTasks.filter(e => e.scheduledEm === PROPOSED_TASK_STATUS.DISMISSED)
    .map(proposedTaskKey);
  const rationalePending = !!storedRecord.rationalePending;
  logIfEnabled("[proposed-agenda-archive] cache hit", { ...llmDateRecord, rationalePending,
    storedProviderEm: storedRecord.providerEm ?? null, taskCount: activities.length });
  const meetingKeys = Array.isArray(storedRecord.meetingKeys) ? storedRecord.meetingKeys : null;
  return { activities, dismissedKeys, llmAttributionFooter: storedRecord.llmAttributionFooter || null, meetingKeys,
    providerEm: storedRecord.providerEm ?? null, rationalePending, reserveTasks: _rankedReserves(storedRecord.reserveTasks),
    scheduledKeys };
}

// ----------------------------------------------------------------------------------------------
// @desc Add a replacement activity and store the reserves still waiting, after the user rejects one suggestion.
// @param {object} app - Amplenote app bridge.
// @param {object} params - { activity, date, domainName, domainUuid, priorityKey, providerEm, reserveTasks }.
// @returns {Promise<void>}
export function saveAgendaReplacement(app, params) {
  return _serializedArchiveWrite(() => _saveAgendaReplacementNow(app, params));
}

// ----------------------------------------------------------------------------------------------
// @desc saveAgendaReplacement's read-modify-replace, run once the archive write queue reaches it.
// @param {object} app - Amplenote app bridge.
// @param {object} params - As documented on saveAgendaReplacement.
async function _saveAgendaReplacementNow(app, { activity, date, domainName, domainUuid, priorityKey, providerEm,
    reserveTasks }) {
  const llmDateRecord = { dateKey: dateKeyFromDateInput(date), domainUuid, priorityKey, providerEm };
  const noteContext = await resolveNoteContext(app, date, domainName);
  const { state } = noteContext;
  const storedRecord = state.records.find(line => storedRecordMatches(line, llmDateRecord));
  if (!storedRecord) return;
  storedRecord.proposedTasks = [...(storedRecord.proposedTasks || []), persistedEntryFromActivity(activity)];
  storedRecord.reserveTasks = _storedReserveTasks(reserveTasks);
  await _replaceArchiveNote(app, { ...noteContext, domainName }, state.records, llmDateRecord.dateKey);
}

// ----------------------------------------------------------------------------------------------
// @desc Compact ranked tasks the way the monthly record stores its unplaced reserves, an idea keeping its ID.
// @param {Array<object>|null} reserveTasks - Ranked tasks that were not placed.
// @returns {Array<object>} Stored reserve entries.
function _storedReserveTasks(reserveTasks) {
  return (reserveTasks || []).map(task => ({ benefit: task.benefit || "", durationMinutes: task.durationMinutes || 30,
    emphasizedWeekday: task.emphasizedWeekday, ideaId: task.ideaId || null, isExisting: task.isExisting !== false && !task.ideaId, noteUuid: task.noteUuid || null,
    projectSummary: task.projectSummary || "", projectUuid: task.projectUuid || null,
    rationale: task.rationale || task.reason || "", targetMidnightSeconds: task.targetMidnightSeconds ?? null,
    taskText: task.taskText || task.title, taskUuid: task.taskUuid }));
}

// ----------------------------------------------------------------------------------------------
// @desc Restore stored reserves to the ranked-task shape the slotter refills from; a reserve naming an idea is not an
//   existing task.
// @param {Array<object>|null} reserveTasks - Entries from the monthly record.
// @returns {Array<object>} Ranked tasks.
function _rankedReserves(reserveTasks) {
  return (reserveTasks || []).map(entry => ({ benefit: entry.benefit || "", durationMinutes: entry.durationMinutes || 30,
    emphasizedWeekday: entry.emphasizedWeekday, ideaId: entry.ideaId || null, isExisting: !entry.ideaId, noteUuid: entry.noteUuid || null,
    projectSummary: entry.projectSummary || "", projectUuid: entry.projectUuid || null, rationale: entry.rationale || "",
    targetMidnightSeconds: entry.targetMidnightSeconds ?? null, taskText: entry.taskText, taskUuid: entry.taskUuid }));
}

// ----------------------------------------------------------------------------------------------
// @desc Persist (or, when reseeding/regenerating, replace) the line for a date+priority in a Task Domain with a
//   freshly-generated set of proposed activities — all entries start "pending". The line replaced may have been
//   written by another provider.
// @param {object} app - Amplenote app bridge.
// @param {object} params - { activities, date, domainName, domainUuid, llmAttributionFooter, meetingKeys, priorityKey,
//   providerEm, rationalePending, recommendationContextKey, reserveTasks }. `meetingKeys` names the meetings the agenda
//   was planned for, or is null when they are not known. `rationalePending` marks an agenda stored before its benefit
//   sentences arrived, so a device that loads it asks for them; saveAgendaBenefits clears it.
//   `recommendationContextKey` contains the target date key, all-day event keys, same-weekday completion-pattern
//   keys, event categories, and research-note keys that should be matched before this cache entry can be reused.
// @returns {Promise<void>}
export function storeProposedAgenda(app, params) {
  return _serializedArchiveWrite(() => _storeProposedAgendaNow(app, params));
}


// ----------------------------------------------------------------------------------------------
// @desc storeProposedAgenda's read-modify-replace, run once the archive write queue reaches it.
// @param {object} app - Amplenote app bridge.
// @param {object} params - As documented on storeProposedAgenda.
async function _storeProposedAgendaNow(app, { activities, date, domainName, domainUuid,
    llmAttributionFooter = null, meetingKeys = null, priorityKey, providerEm, rationalePending = false,
    recommendationContextKey = null, reserveTasks = null }) {
  const llmDateRecord = { dateKey: dateKeyFromDateInput(date), domainUuid, priorityKey, providerEm };
  const noteContext = await resolveNoteContext(app, date, domainName);
  const contextFingerprint = recommendationContextKey ? stableJson(recommendationContextKey) : null;
  const pendingMarker = rationalePending ? { rationalePending: true } : {};
  const storedRecord = { ...llmDateRecord, contextFingerprint, llmAttributionFooter, meetingKeys: meetingKeys || null,
    proposedTasks: (activities || []).map(persistedEntryFromActivity), ...pendingMarker,
    recordVersion: PROPOSED_AGENDA_RECORD_VERSION, reserveTasks: _storedReserveTasks(reserveTasks) };
  const otherRecords = noteContext.state.records.filter(line => !storedRecordMatches(line, llmDateRecord));
  await _replaceArchiveNote(app, { ...noteContext, domainName }, [storedRecord, ...otherRecords],
    llmDateRecord.dateKey);
  logIfEnabled("[proposed-agenda-archive] stored record",
    { ...llmDateRecord, rationalePending, taskCount: storedRecord.proposedTasks.length });
}

// ----------------------------------------------------------------------------------------------
// @desc Write the benefit sentences an agenda received onto its stored line, and clear the line's rationalePending
//   marker. Entries are matched by suggestion identity and only their benefit changes, so a status the user recorded,
//   or a replacement placed, while the provider was writing survives. No-op when no line matches.
// @param {object} app - Amplenote app bridge.
// @param {object} params - { activities, date, domainName, domainUuid, priorityKey, reserveTasks }: activities and
//   reserveTasks are the explained agenda's items, those with a benefit supplying it.
// @returns {Promise<void>}
export function saveAgendaBenefits(app, params) {
  return _serializedArchiveWrite(() => _saveAgendaBenefitsNow(app, params));
}

// ----------------------------------------------------------------------------------------------
// @desc saveAgendaBenefits's read-modify-replace, run once the archive write queue reaches it.
// @param {object} app - Amplenote app bridge.
// @param {object} params - As documented on saveAgendaBenefits.
async function _saveAgendaBenefitsNow(app, { activities, date, domainName, domainUuid, priorityKey, reserveTasks = null }) {
  const llmDateRecord = { dateKey: dateKeyFromDateInput(date), domainUuid, priorityKey };
  const noteContext = await resolveNoteContext(app, date, domainName);
  const storedRecord = noteContext.state.records.find(line => storedRecordMatches(line, llmDateRecord));
  if (!storedRecord) return;
  const explainedItems = [...(activities || []), ...(reserveTasks || [])];
  const benefitedItems = explainedItems.filter(item => item?.benefit && suggestionIdentityKey(item));
  const benefitByKey = new Map(benefitedItems.map(item => [suggestionIdentityKey(item), item.benefit]));
  let benefitCount = 0;
  const withBenefit = entry => {
    const benefit = !entry.benefit && benefitByKey.get(suggestionIdentityKey(entry));
    if (!benefit) return entry;
    benefitCount += 1;
    return { ...entry, benefit };
  };
  storedRecord.proposedTasks = (storedRecord.proposedTasks || []).map(withBenefit);
  storedRecord.reserveTasks = (storedRecord.reserveTasks || []).map(withBenefit);
  const wasPending = !!storedRecord.rationalePending;
  delete storedRecord.rationalePending;
  if (!benefitCount && !wasPending) return;
  await _replaceArchiveNote(app, { ...noteContext, domainName }, noteContext.state.records, llmDateRecord.dateKey);
  logIfEnabled("[proposed-agenda-archive] stored benefits", { ...llmDateRecord, benefitCount });
}

// ----------------------------------------------------------------------------------------------
// @desc Update the lifecycle status ("scheduled"/"dismissed"/"pending") of specific proposed tasks within the
//   line for a date+priority identity, so the note reflects what the user did with each recommendation.
//   No-op (without error) when no matching line exists.
// @param {object} app - Amplenote app bridge.
// @param {object} params - { activityKeys, date, domainName, domainUuid, priorityKey, providerEm, scheduledEm }.
//   - {Array<string>} activityKeys - proposedTaskKey() values whose status should change.
//   - {string} scheduledEm - One of PROPOSED_TASK_STATUS.
// @returns {Promise<Array<string>>} The activity keys whose status actually changed, so callers can log a
//   decision exactly once per real transition (an unchanged re-write returns an empty array).
export function updateProposedTaskStatuses(app, params) {
  return _serializedArchiveWrite(() => _updateProposedTaskStatusesNow(app, params));
}

// ----------------------------------------------------------------------------------------------
// @desc updateProposedTaskStatuses's read-modify-replace, run once the archive write queue reaches it.
// @param {object} app - Amplenote app bridge.
// @param {object} params - As documented on updateProposedTaskStatuses.
async function _updateProposedTaskStatusesNow(app, { activityKeys, date, domainName, domainUuid, priorityKey,
    providerEm, scheduledEm }) {
  const keys = new Set(activityKeys || []);
  if (keys.size === 0) return [];
  const llmDateRecord = { dateKey: dateKeyFromDateInput(date), domainUuid, priorityKey, providerEm };
  const noteContext = await resolveNoteContext(app, date, domainName);
  const { state } = noteContext;
  const storedRecord = state.records.find(line => storedRecordMatches(line, llmDateRecord));
  if (!storedRecord || !Array.isArray(storedRecord.proposedTasks)) return [];
  const changedKeys = [];
  storedRecord.proposedTasks = storedRecord.proposedTasks.map(entry => {
    const entryKey = proposedTaskKey(entry);
    if (!keys.has(entryKey) || entry.scheduledEm === scheduledEm) return entry;
    changedKeys.push(entryKey);
    return { ...entry, scheduledEm };
  });
  if (changedKeys.length === 0) return [];
  await _replaceArchiveNote(app, { ...noteContext, domainName }, state.records, llmDateRecord.dateKey);
  logIfEnabled("[proposed-agenda-archive] updated statuses", { ...llmDateRecord, scheduledEm, count: keys.size });
  return changedKeys;
}
