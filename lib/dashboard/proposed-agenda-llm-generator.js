// [Claude claude-opus-4-8 (1M context)-authored file]
// Prompt summary: "collect the detail needed for the proposed-agenda LLM prompt (today's obligations + chosen
//   provider/priority), initiate generation, and apply a generated agenda (schedule / approve / dismiss),
//   broadcasting a task-update so the Agenda widget refreshes with newly scheduled tasks"
import { DASHBOARD_TASKS_UPDATED_EVENT } from "hooks/use-dashboard-task-updates";
import { PROPOSED_TASK_STATUS, proposedTaskKey, updateProposedTaskStatuses } from "proposed-agenda-archive";
import { agendaDecisionsFromRows, recordAgendaDecisions } from "proposed-agenda-decision-log";
import { requestTodayObligations } from "proposed-agenda-obligations";
import { generateProposedAgendaRange, mergedRangeGeneration, proposedAgendaDaysInRange } from "proposed-agenda-range";
import { approveProposedAgenda, resolveProposedAgendaDate, scheduleProposedActivity } from "proposed-agenda-service";
import { dateFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";
import { snapDashboardAction } from "util/plausible";

// ----------------------------------------------------------------------------------------------
// @desc Shared activity-key implementation used by both rendered rows and persisted records.
// @type {Function}
export const activityKey = proposedTaskKey;

// ----------------------------------------------------------------------------------------------
// @desc Approve every still-pending proposed activity, mark them all scheduled, broadcast a task-update so
//   the Agenda widget refreshes, persist the "scheduled" status onto the archived record, and summarize.
// @param {object} app - Amplenote app bridge.
// @param {object} options - { defaultNoteUuid, dismissedKeys, llmDateRecord, proposed, scheduledKeys, setApproving,
//   setScheduledKeys }.
// @returns {Promise<void>}
// [Claude claude-opus-4-8 (1M context)] Task: approve all pending proposed activities at once
export async function approveAllProposed(app, { defaultNoteUuid, dismissedKeys, llmDateRecord, proposed, scheduledKeys,
    setApproving, setScheduledKeys }) {
  const pending = proposed.filter(a => !scheduledKeys.has(activityKey(a)) && !dismissedKeys.has(activityKey(a)));
  if (pending.length === 0) return;
  setApproving(true);
  try {
    const { failed, scheduled } = await approveProposedAgenda(app, pending, defaultNoteUuid);
    setScheduledKeys(previous => _withKeys(previous, pending.map(activityKey)));
    if (scheduled > 0) _broadcastTaskUpdate();
    await recordProposedRowStatuses(app, llmDateRecord, pending, PROPOSED_TASK_STATUS.SCHEDULED);
    await app.alert(failed > 0
      ? `Scheduled ${ scheduled } activities; ${ failed } could not be scheduled.`
      : `Scheduled all ${ scheduled } activities.`);
  } finally {
    setApproving(false);
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Merge obligations with visible proposals and sort the rows by day and start time.
// @param {Array<object>} obligations - Today's already-scheduled tasks/events.
// @param {Array<object>} proposed - LLM-proposed activities.
// @param {Set<string>} dismissedKeys - Keys of proposed activities the user dismissed.
// @param {object} [options] - { fallbackMidnightSeconds, hidePastBeforeMinutes, hidePastOnMidnightSeconds }.
//   - {number|null} fallbackMidnightSeconds - Day used to order rows that carry no targetMidnightSeconds (cached
//     records predating it), so they still sort against the range's other days rather than sinking to the front.
//   - {number|null} hidePastBeforeMinutes - Minutes-since-midnight before which proposed rows are hidden as "in
//     the past" (null for a future day, where nothing has elapsed yet).
//   - {number|null} hidePastOnMidnightSeconds - Restrict that hiding to a single day (today) when the agenda
//     spans a range; null applies it to every row, which is the single-day behavior.
// @returns {Array<object>} Rows ({ ...record, isObligation }) sorted ascending by day, then by startMinutes.
export function mergedAgendaRows(obligations, proposed, dismissedKeys, { fallbackMidnightSeconds = null,
    hidePastBeforeMinutes = null, hidePastOnMidnightSeconds = null } = {}) {
  const obligationRows = (obligations || []).map(o => ({ ...o, isObligation: true }));
  const visibleProposed = (proposed || []).filter(a => !dismissedKeys.has(activityKey(a)))
    .filter(a => !_isElapsedRow(a, hidePastBeforeMinutes, hidePastOnMidnightSeconds));
  const proposedRows = visibleProposed.map(a => ({ ...a, isObligation: false }));
  const sortSeconds = row => (row.targetMidnightSeconds ?? fallbackMidnightSeconds ?? 0) + row.startMinutes * 60;
  return [...obligationRows, ...proposedRows].sort((a, b) => sortSeconds(a) - sortSeconds(b));
}

// ----------------------------------------------------------------------------------------------
// @desc Whether a proposed row starts before the cutoff on the day to which that cutoff applies.
// @param {object} row - Proposed activity record.
// @param {number|null} hidePastBeforeMinutes - Minutes-since-midnight cutoff, or null for no cutoff.
// @param {number|null} hidePastOnMidnightSeconds - The single day the cutoff applies to, or null for all days.
// @returns {boolean}
function _isElapsedRow(row, hidePastBeforeMinutes, hidePastOnMidnightSeconds) {
  if (hidePastBeforeMinutes == null) return false;
  if (hidePastOnMidnightSeconds != null && row.targetMidnightSeconds !== hidePastOnMidnightSeconds) return false;
  return row.startMinutes < hidePastBeforeMinutes;
}

// ----------------------------------------------------------------------------------------------
// @desc Persist row statuses to the appropriate per-day archive records, best-effort.
// @param {object} app - Amplenote app bridge.
// @param {object|null} llmDateRecord - { date, domainName, domainUuid, priorityKey, providerEm } identity; its
//   `date` is the fallback day for rows carrying no targetMidnightSeconds.
// @param {Array<object>} rows - Obligation/proposed-activity records whose status should change.
// @param {string} scheduledEm - One of PROPOSED_TASK_STATUS.
// @returns {Promise<void>}
// [Claude claude-opus-5[1m]] Task: write schedule/dismiss decisions to the right day's record across a range
// [Claude claude-opus-5[1m]] Task: append every real status transition to the archived approve/reject log
// Prompt: "keep a record of the past suggestions that the user has approved and rejected"
// [OpenAI GPT-5.6] Task: inline the single-use low-level status writer
export async function recordProposedRowStatuses(app, llmDateRecord, rows, scheduledEm) {
  if (!llmDateRecord?.date || !llmDateRecord?.domainName || !llmDateRecord?.providerEm || !(rows?.length)) return;
  const keysByDayMillis = new Map();
  for (const row of rows) {
    const dayMillis = row.targetMidnightSeconds ? row.targetMidnightSeconds * 1000
      : dateFromDateInput(llmDateRecord.date).getTime();
    if (!keysByDayMillis.has(dayMillis)) keysByDayMillis.set(dayMillis, []);
    keysByDayMillis.get(dayMillis).push(activityKey(row));
  }
  const changedKeys = new Set();
  for (const [dayMillis, activityKeys] of keysByDayMillis) {
    const dayChangedKeys = await updateProposedTaskStatuses(app, { activityKeys, date: new Date(dayMillis),
      domainName: llmDateRecord.domainName, domainUuid: llmDateRecord.domainUuid,
      priorityKey: llmDateRecord.priorityKey, providerEm: llmDateRecord.providerEm, scheduledEm }).catch(
      error => logIfEnabled("[proposed-agenda] failed to persist task status", error?.message));
    (dayChangedKeys || []).forEach(key => changedKeys.add(key));
  }
  // Only rows whose stored status actually moved are logged, so re-affirming a decision cannot duplicate a row.
  const decidedRows = rows.filter(row => changedKeys.has(activityKey(row)));
  const decisions = agendaDecisionsFromRows(decidedRows, { priorityKey: llmDateRecord.priorityKey, scheduledEm });
  await recordAgendaDecisions(app, { decisions, domainName: llmDateRecord.domainName });
}

// ----------------------------------------------------------------------------------------------
// @desc Count proposed activities still awaiting a decision (neither scheduled nor dismissed).
// @param {Array<object>} proposed - LLM-proposed activities.
// @param {Set<string>} scheduledKeys - Keys already scheduled.
// @param {Set<string>} dismissedKeys - Keys dismissed.
// @returns {number}
export function pendingCount(proposed, scheduledKeys, dismissedKeys) {
  return (proposed || []).filter(a => !scheduledKeys.has(activityKey(a)) && !dismissedKeys.has(activityKey(a))).length;
}

// ----------------------------------------------------------------------------------------------
// @desc Resolve obligations, generate each requested day, merge the results, and update widget state.
// @param {object} app - Amplenote app bridge.
// @param {object} options - { calendarEvents, currentDate, dateRange, domainName, domainUuid, forceRegenerate,
//   priorityKey, providerEm } plus setters; record-identity setters capture the resolved domain/provider used
//   by persistence.
// @returns {Promise<void>}
export async function runProposedAgendaGeneration(app, { calendarEvents = null, currentDate, dateRange = null,
    domainName, domainUuid, forceRegenerate = false, priorityKey, providerEm, setApproving, setAttribution,
    setDateLabel, setDismissedKeys, setError, setIsFutureDay, setLoading, setObligations, setProposed,
    setRecordDomainName, setRecordDomainUuid, setRecordProviderEm, setScheduledKeys }) {
  setLoading(true);
  setError(null);
  setApproving(false);
  setScheduledKeys(new Set());
  setDismissedKeys(new Set());
  try {
    const referenceDate = currentDate ? dateFromDateInput(currentDate) : new Date();
    const now = new Date();
    const dateForResolution = currentDate ? new Date(referenceDate.getFullYear(), referenceDate.getMonth(),
      referenceDate.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()) : now;
    const rangeDays = proposedAgendaDaysInRange(dateRange, { now });
    const days = rangeDays.length > 0 ? rangeDays : [resolveProposedAgendaDate(dateForResolution)];
    const obligationsForDay = day => requestTodayObligations(app, { calendarEvents, currentDate: day, domainUuid });
    const dayResults = await generateProposedAgendaRange(app, { calendarEvents, days, domainName, domainUuid,
      forceRegenerate, obligationsForDay, priorityKey, providerEmOverride: providerEm || null });
    const result = mergedRangeGeneration(dayResults);
    setObligations(result.obligations);
    if (result.error) {
      setError({ error: result.error, errorCode: result.errorCode });
      setProposed([]);
    } else {
      setProposed(result.activities);
      setDateLabel(result.dateLabel);
      setAttribution(result.attribution);
      if (setIsFutureDay) setIsFutureDay(result.isFutureDay);
      if (setRecordDomainName) setRecordDomainName(result.domainName);
      if (setRecordDomainUuid) setRecordDomainUuid(result.domainUuid);
      if (setRecordProviderEm) setRecordProviderEm(result.providerEm || null);
      if (result.scheduledKeys?.length) setScheduledKeys(new Set(result.scheduledKeys));
      if (result.dismissedKeys?.length) setDismissedKeys(new Set(result.dismissedKeys));
      const generatedDays = dayResults.filter(dayResult => !dayResult.error && !dayResult.fromCache);
      if (generatedDays.length > 0) {
        snapDashboardAction("generateProposedAgenda", { count: result.activities?.length || 0, dayCount: days.length });
      }
    }
  } finally {
    setLoading(false);
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Schedule one proposed activity, mark its key scheduled on success, and broadcast a task-update so the
//   Agenda widget refreshes with the newly scheduled task; alerts on failure.
// @param {object} app - Amplenote app bridge.
// @param {object} activity - Proposed activity to schedule.
// @param {string|null} defaultNoteUuid - Fallback note for newly-created activities.
// @param {Function} setScheduledKeys - State setter for scheduled keys.
// @param {object|null} [llmDateRecord] - { date, priorityKey, providerEm } so the "scheduled" status is persisted.
// @returns {Promise<void>}
// [Claude claude-opus-4-8 (1M context)] Task: schedule a single proposed activity + notify Agenda
export async function scheduleProposedRow(app, activity, defaultNoteUuid, setScheduledKeys, llmDateRecord = null) {
  const result = await scheduleProposedActivity(app, activity, defaultNoteUuid);
  if (!result.taskUuid) {
    await app.alert("Could not schedule this activity. Please try again or schedule it manually.");
    return;
  }
  setScheduledKeys(previous => _withKeys(previous, [activityKey(activity)]));
  _broadcastTaskUpdate({ content: activity.title, noteUUID: result.noteUuid || activity.noteUuid || null,
    startAt: result.startAt, taskUuid: result.taskUuid });
  await recordProposedRowStatuses(app, llmDateRecord, [activity], PROPOSED_TASK_STATUS.SCHEDULED);
}

// ----------------------------------------------------------------------------------------------
// @desc Dispatch the shared dashboard task-update event so listeners (the Agenda widget via the dashboard's
//   useDashboardTaskUpdates hook) re-pull the task domain and show the newly scheduled task. No-op off-DOM.
// @param {object} [detail={}] - { content, noteUUID, startAt, taskUuid } for the scheduled task.
// [Claude claude-opus-4-8 (1M context)] Task: notify Agenda that the schedule changed
// Prompt: "send an event that agenda has changed ... updates it with the newly scheduled event/tasks"
function _broadcastTaskUpdate(detail = {}) {
  if (typeof window === "undefined" || !window.dispatchEvent) return;
  window.dispatchEvent(new CustomEvent(DASHBOARD_TASKS_UPDATED_EVENT, { detail }));
}

// ----------------------------------------------------------------------------------------------
// @desc Add keys to a set immutably (for setState updaters).
// @param {Set<string>} previous
// @param {Array<string>} keys
// @returns {Set<string>}
function _withKeys(previous, keys) {
  const next = new Set(previous);
  keys.forEach(key => next.add(key));
  return next;
}
