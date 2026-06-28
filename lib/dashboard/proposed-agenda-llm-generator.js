// [Claude claude-opus-4-8 (1M context)-authored file]
// Prompt summary: "collect the detail needed for the proposed-agenda LLM prompt (today's obligations + chosen
//   provider/priority), initiate generation, and apply a generated agenda (schedule / approve / dismiss),
//   broadcasting a task-update so the Agenda widget refreshes with newly scheduled tasks"
import { DASHBOARD_TASKS_UPDATED_EVENT } from "hooks/use-dashboard-task-updates";
import { PROPOSED_TASK_STATUS, updateProposedTaskStatuses } from "proposed-agenda-archive";
import { requestTodayObligations } from "proposed-agenda-obligations";
import { approveProposedAgenda, generateProposedAgenda, scheduleProposedActivity } from "proposed-agenda-service";
import { logIfEnabled } from "util/log";

// ----------------------------------------------------------------------------------------------
// @desc Stable key for a row (start time + task uuid or title are unique enough within one day).
// @param {object} row - Obligation or proposed-activity record.
// @returns {string}
export function activityKey(row) {
  return `${ row.startMinutes }::${ row.taskUuid || row.title }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Persist a lifecycle-status change for one or more proposed tasks back onto the stored monthly record,
//   best-effort (a failed write never blocks the UI). No-op until the llmDateRecord identity is fully known.
// @param {object} app - Amplenote app bridge.
// @param {object|null} llmDateRecord - { date, priorityKey, providerEm } identifying the stored line.
// @param {Array<string>} activityKeys - activityKey() values whose status should change.
// @param {string} scheduledEm - One of PROPOSED_TASK_STATUS.
// @returns {Promise<void>}
// [Claude claude-opus-4-8 (1M context)] Task: mirror schedule/dismiss decisions into the archived record
// Prompt: "a per-date, per-priority, per-LLM record of what tasks were recommended ... scheduledEm"
export async function recordProposedTaskStatus(app, llmDateRecord, activityKeys, scheduledEm) {
  if (!llmDateRecord?.providerEm || !llmDateRecord?.date || !(activityKeys?.length)) return;
  await updateProposedTaskStatuses(app, { activityKeys, date: llmDateRecord.date,
    priorityKey: llmDateRecord.priorityKey, providerEm: llmDateRecord.providerEm, scheduledEm }).catch(
    error => logIfEnabled("[proposed-agenda] failed to persist task status", error?.message));
}

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
    await recordProposedTaskStatus(app, llmDateRecord, pending.map(activityKey), PROPOSED_TASK_STATUS.SCHEDULED);
    await app.alert(failed > 0
      ? `Scheduled ${ scheduled } activities; ${ failed } could not be scheduled.`
      : `Scheduled all ${ scheduled } activities.`);
  } finally {
    setApproving(false);
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Merge immovable obligations with non-dismissed proposed activities into one time-ordered row list.
// @param {Array<object>} obligations - Today's already-scheduled tasks/events.
// @param {Array<object>} proposed - LLM-proposed activities.
// @param {Set<string>} dismissedKeys - Keys of proposed activities the user dismissed.
// @returns {Array<object>} Rows ({ ...record, isObligation }) sorted ascending by startMinutes.
export function mergedAgendaRows(obligations, proposed, dismissedKeys) {
  const obligationRows = (obligations || []).map(o => ({ ...o, isObligation: true }));
  const proposedRows = (proposed || []).filter(a => !dismissedKeys.has(activityKey(a)))
    .map(a => ({ ...a, isObligation: false }));
  return [...obligationRows, ...proposedRows].sort((a, b) => a.startMinutes - b.startMinutes);
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
// @desc Derive today's obligations FIRST (Agenda broadcast or self-derived), then ask the LLM to build a
//   schedule around them for the chosen priority and provider, routing results into the widget's setters. The
//   LLM is never called until obligations have been resolved. A cached date+priority+LLM record (when present
//   and not force-regenerating) is served instead of the LLM, restoring the scheduled/dismissed decisions that
//   were saved with it.
// @param {object} app - Amplenote app bridge.
// @param {object} options - { currentDate, domainUuid, forceRegenerate, priorityKey, providerEm } plus setters
//   (setRecordProviderEm captures the resolved LLM key so later status writes target the same record).
// @returns {Promise<void>}
// [Claude claude-opus-4-8 (1M context)] Task: obligations-first generation flow for the widget
// Prompt: "LLM should not be called until we have finished deriving existing obligations"
// [Claude claude-opus-4-8 (1M context)] Task: route cached records (and reseed force-regeneration) through the flow
// Prompt: "use the stored data from that if so. If the user chooses 'Reseed' with the same LLM, replace the entry"
export async function runProposedAgendaGeneration(app, { currentDate, domainUuid, forceRegenerate = false, priorityKey,
    providerEm, setApproving, setAttribution, setDateLabel, setDismissedKeys, setError, setLoading, setObligations,
    setProposed, setRecordProviderEm, setScheduledKeys }) {
  setLoading(true);
  setError(null);
  setApproving(false);
  setScheduledKeys(new Set());
  setDismissedKeys(new Set());
  try {
    const obligations = await requestTodayObligations(app, { currentDate, domainUuid });
    setObligations(obligations);
    const result = await generateProposedAgenda(app, { forceRegenerate, obligations, priorityKey,
      providerEmOverride: providerEm || null });
    if (result.error) {
      setError(result.error);
      setProposed([]);
    } else {
      setProposed(result.activities);
      setDateLabel(result.dateLabel);
      setAttribution(result.llmAttributionFooter);
      if (setRecordProviderEm) setRecordProviderEm(result.providerEm || null);
      if (result.scheduledKeys?.length) setScheduledKeys(new Set(result.scheduledKeys));
      if (result.dismissedKeys?.length) setDismissedKeys(new Set(result.dismissedKeys));
    }
  } catch (err) {
    logIfEnabled("[proposed-agenda] runProposedAgendaGeneration caught", err);
    setError(err.message || "Failed to build a schedule.");
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
  await recordProposedTaskStatus(app, llmDateRecord, [activityKey(activity)], PROPOSED_TASK_STATUS.SCHEDULED);
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
