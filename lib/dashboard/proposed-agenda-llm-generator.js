// [Claude claude-opus-4-8 (1M context)-authored file]
// Prompt summary: "collect the detail needed for the proposed-agenda LLM prompt (today's obligations + chosen
//   provider/priority), initiate generation, and apply a generated agenda (schedule / approve / dismiss),
//   broadcasting a task-update so the Agenda widget refreshes with newly scheduled tasks"
import { DASHBOARD_TASKS_UPDATED_EVENT } from "hooks/use-dashboard-task-updates";
import { PROPOSED_AGENDA_PROVIDER_OPTIONS } from "proposed-agenda-priority";
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
// @desc Approve every still-pending proposed activity, mark them all scheduled, broadcast a task-update so
//   the Agenda widget refreshes, and summarize the outcome.
// @param {object} app - Amplenote app bridge.
// @param {object} options - { defaultNoteUuid, dismissedKeys, proposed, scheduledKeys, setApproving,
//   setScheduledKeys }.
// @returns {Promise<void>}
// [Claude claude-opus-4-8 (1M context)] Task: approve all pending proposed activities at once
export async function approveAllProposed(app, { defaultNoteUuid, dismissedKeys, proposed, scheduledKeys,
    setApproving, setScheduledKeys }) {
  const pending = proposed.filter(a => !scheduledKeys.has(activityKey(a)) && !dismissedKeys.has(activityKey(a)));
  if (pending.length === 0) return;
  setApproving(true);
  try {
    const { failed, scheduled } = await approveProposedAgenda(app, pending, defaultNoteUuid);
    setScheduledKeys(previous => _withKeys(previous, pending.map(activityKey)));
    if (scheduled > 0) _broadcastTaskUpdate();
    await app.alert(failed > 0
      ? `Scheduled ${ scheduled } activities; ${ failed } could not be scheduled.`
      : `Scheduled all ${ scheduled } activities.`);
  } finally {
    setApproving(false);
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Prompt the user to pick the AI provider that should generate the agenda, describing what each is
//   known to excel at. Returns the chosen provider enum, or null when canceled / unchanged.
// @param {object} app - Amplenote app bridge with prompt.
// @param {string|null} currentProviderEm - Currently selected provider enum (becomes the default).
// @returns {Promise<string|null>}
export async function changeModelProviderEm(app, currentProviderEm) {
  const defaultValue = PROPOSED_AGENDA_PROVIDER_OPTIONS.some(o => o.providerEm === currentProviderEm)
    ? currentProviderEm : PROPOSED_AGENDA_PROVIDER_OPTIONS[0].providerEm;
  const result = await app.prompt("Generate the agenda with which AI provider?", {
    inputs: [{ label: "AI provider", type: "radio", value: defaultValue,
      options: PROPOSED_AGENDA_PROVIDER_OPTIONS.map(o => ({ label: `${ o.label } — ${ o.description }`,
        value: o.providerEm })) }],
  });
  const selected = _promptValue(result);
  return selected && selected !== currentProviderEm ? selected : null;
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
//   LLM is never called until obligations have been resolved.
// @param {object} app - Amplenote app bridge.
// @param {object} options - { currentDate, domainUuid, priorityKey, providerEm } plus setters.
// @returns {Promise<void>}
// [Claude claude-opus-4-8 (1M context)] Task: obligations-first generation flow for the widget
// Prompt: "LLM should not be called until we have finished deriving existing obligations"
export async function runProposedAgendaGeneration(app, { currentDate, domainUuid, priorityKey, providerEm,
    setApproving, setAttribution, setDateLabel, setDismissedKeys, setError, setLoading, setObligations,
    setProposed, setScheduledKeys }) {
  setLoading(true);
  setError(null);
  setApproving(false);
  setScheduledKeys(new Set());
  setDismissedKeys(new Set());
  try {
    const obligations = await requestTodayObligations(app, { currentDate, domainUuid });
    setObligations(obligations);
    const result = await generateProposedAgenda(app, { obligations, priorityKey,
      providerEmOverride: providerEm || null });
    if (result.error) {
      setError(result.error);
      setProposed([]);
    } else {
      setProposed(result.activities);
      setDateLabel(result.dateLabel);
      setAttribution(result.llmAttributionFooter);
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
// @returns {Promise<void>}
// [Claude claude-opus-4-8 (1M context)] Task: schedule a single proposed activity + notify Agenda
export async function scheduleProposedRow(app, activity, defaultNoteUuid, setScheduledKeys) {
  const result = await scheduleProposedActivity(app, activity, defaultNoteUuid);
  if (!result.taskUuid) {
    await app.alert("Could not schedule this activity. Please try again or schedule it manually.");
    return;
  }
  setScheduledKeys(previous => _withKeys(previous, [activityKey(activity)]));
  _broadcastTaskUpdate({ content: activity.title, noteUUID: result.noteUuid || activity.noteUuid || null,
    startAt: result.startAt, taskUuid: result.taskUuid });
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

// ----------------------------------------------------------------------------------------------
// @desc Normalize an app.prompt response (string | array | object) into a single selected value.
// @param {string|Array|object|null} promptResult
// @returns {string|null}
function _promptValue(promptResult) {
  if (typeof promptResult === "string") return promptResult;
  if (Array.isArray(promptResult)) return typeof promptResult[0] === "string" ? promptResult[0] : null;
  if (promptResult && typeof promptResult === "object") {
    const values = Object.values(promptResult);
    return values.length > 0 && typeof values[0] === "string" ? values[0] : null;
  }
  return null;
}
