// Plugin-side adapter between Amplenote calendar suggestions and the shared Proposed Agenda generator.
import { SETTING_KEYS } from "constants/settings";
import { setPluginData } from "plugin-data";
import { proposedTaskKey } from "proposed-agenda-archive";
import { obligationsFromTasksAndEvents } from "proposed-agenda-obligations";
import { DEFAULT_PRIORITY_KEY, priorityOptionFromKey } from "proposed-agenda-priority";
import { generateProposedAgendaRange, proposedAgendaDaysInRange } from "proposed-agenda-range";
import { resolveProposedAgendaDate, startAtSecondsFromMinutesToday } from "proposed-agenda-service";
import { refillAndRecordSuggestion } from "ranked-task-suggestions";
import { logIfEnabled } from "util/log";

// Keep the host wait bounded while progressive publishing exposes each completed day.
const MAX_SUGGESTION_DAYS = 3;

const SECONDS_PER_MINUTE = 60;

// ----------------------------------------------------------------------------------------------
// @desc Publish accumulated suggestions without allowing a progressive-update failure to fail the action.
// @param {object} app - Amplenote app bridge.
// @param {Array<object>} scheduledTasks - Suggestions accumulated so far.
// @returns {Promise<void>}
async function _publishProgressively(app, scheduledTasks) {
  if (scheduledTasks.length === 0 || typeof app.context?.setScheduledTasks !== "function") return;
  try {
    await app.context.setScheduledTasks(scheduledTasks);
    logIfEnabled("[proposed-agenda-suggest] published progressive suggestions", { count: scheduledTasks.length });
  } catch (error) {
    logIfEnabled("[proposed-agenda-suggest] setScheduledTasks failed", error?.message);
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Convert a validated activity into Amplenote's existing-task or new-task suggestion shape.
// @param {object} activity - Validated proposed activity ({ durationMinutes, reason, startMinutes, ... }).
// @returns {object} { endAt, explanation, startAt } plus either taskUUID or task.
function _suggestionFromActivity(activity) {
  const startAt = startAtSecondsFromMinutesToday(activity.startMinutes, activity.targetMidnightSeconds ?? null);
  const endAt = startAt + activity.durationMinutes * SECONDS_PER_MINUTE;
  const identity = activity.taskUuid ? { taskUUID: activity.taskUuid } : { task: { content: activity.title } };
  return { endAt, explanation: activity.reason, startAt, ...identity };
}

// ----------------------------------------------------------------------------------------------
// @desc Drop scheduled and dismissed suggestions, and fill a dismissed hour from the ranked reserves.
// @param {object} app - Amplenote app bridge.
// @param {object} dayResult - One day's generateProposedAgenda result, including obligations and reserves.
// @returns {Promise<Array<object>>} Activities still worth offering.
async function _activitiesAfterRejections(app, dayResult) {
  const dismissed = new Set(dayResult.dismissedKeys || []);
  const scheduled = new Set(dayResult.scheduledKeys || []);
  let visible = (dayResult.activities || []).filter(activity => !dismissed.has(proposedTaskKey(activity))
    && !scheduled.has(proposedTaskKey(activity)));
  const covered = new Set(visible.map(activity => `${ activity.targetMidnightSeconds }:${ activity.startMinutes }`));
  const uncovered = (dayResult.activities || []).filter(activity => dismissed.has(proposedTaskKey(activity))
    && !covered.has(`${ activity.targetMidnightSeconds }:${ activity.startMinutes }`));
  let reserves = dayResult.reserveTasks || [];
  for (const rejected of uncovered) {
    const sameDay = row => row.targetMidnightSeconds === rejected.targetMidnightSeconds;
    const refill = await refillAndRecordSuggestion(app, { activities: visible.filter(sameDay),
      domainName: dayResult.domainName, domainUuid: dayResult.domainUuid,
      obligations: (dayResult.obligations || []).filter(sameDay), preferredStartMinutes: rejected.startMinutes,
      reserveTasks: reserves.filter(sameDay), targetDate: dayResult.day,
      targetMidnightSeconds: rejected.targetMidnightSeconds });
    if (!refill.placed) continue;
    visible = [...visible.filter(activity => !sameDay(activity)), ...refill.activities];
    reserves = reserves.filter(task => task.taskUuid !== refill.placed.taskUuid);
  }
  return visible;
}

// ----------------------------------------------------------------------------------------------
// @desc Generate and progressively publish suggestions for the visible calendar window using Dashboard settings.
// @param {object} app - Amplenote app bridge (plugin-side, so app.settings/app.context are the real ones).
// @param {object} [params={}] - The action's payload: { endAt, schedulableTasks, scheduledTasks, startAt,
//   taskDomain }, all as documented for suggestScheduledTasks; `endAt`/`startAt` are unix seconds.
// @returns {Promise<Array<object>>} Suggestions as { endAt, explanation, startAt, taskUUID|task }.
export async function suggestScheduledTasksFromDashboard(app, { endAt = null, schedulableTasks = [],
    scheduledTasks = [], startAt = null, taskDomain = null } = {}) {
  // Seed the shared settings singleton, normally initialized by the embed.
  setPluginData({ context: app.context || {}, settings: app.settings || {} });
  const storedPriorityKey = app.settings?.[SETTING_KEYS.PROPOSED_AGENDA_PRIORITY] || null;
  const priorityKey = priorityOptionFromKey(storedPriorityKey || DEFAULT_PRIORITY_KEY).key;
  const providerEm = app.settings?.[SETTING_KEYS.PROPOSED_AGENDA_LLM] || null;
  const rangeDays = proposedAgendaDaysInRange({ endAt, startAt }, { maxDays: MAX_SUGGESTION_DAYS });
  const hasDateRange = startAt != null || endAt != null;
  const days = hasDateRange ? rangeDays : [resolveProposedAgendaDate()];
  logIfEnabled("[proposed-agenda-suggest] suggestScheduledTasks", { dayCount: days.length, endAt, priorityKey,
    providerEm, schedulableTaskCount: schedulableTasks?.length || 0,
    scheduledTaskCount: scheduledTasks?.length || 0, startAt });

  const suggestions = [];
  const obligationsForDay = day => obligationsFromTasksAndEvents(scheduledTasks, [], day);
  const onDayComplete = async dayResult => {
    if (dayResult.error || !Array.isArray(dayResult.activities)) return;
    const undecidedActivities = await _activitiesAfterRejections(app, dayResult);
    suggestions.push(...undecidedActivities.map(_suggestionFromActivity));
    await _publishProgressively(app, suggestions);
  };
  const dayResults = await generateProposedAgendaRange(app, { days, domainName: taskDomain?.name || null,
    domainUuid: taskDomain?.uuid || null, obligationsForDay, onDayComplete, priorityKey,
    providerEmOverride: providerEm });
  if (suggestions.length === 0) {
    const firstError = dayResults.find(dayResult => dayResult.error)?.error || "No plannable days in range";
    logIfEnabled("[proposed-agenda-suggest] no suggestions produced", { error: firstError });
  }
  return suggestions;
}
