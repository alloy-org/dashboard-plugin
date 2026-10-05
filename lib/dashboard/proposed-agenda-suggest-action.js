// Plugin-side adapter between Amplenote calendar suggestions and the shared Proposed Agenda generator.
import { SETTING_KEYS } from "constants/settings";
import { setPluginData } from "plugin-data";
import { proposedTaskKey } from "proposed-agenda-archive";
import { obligationsFromTasksAndEvents } from "proposed-agenda-obligations";
import { DEFAULT_PRIORITY_KEY, priorityOptionFromKey } from "proposed-agenda-priority";
import { generateProposedAgendaRange, proposedAgendaDaysInRange } from "proposed-agenda-range";
import { resolveProposedAgendaDate, startAtSecondsFromMinutesToday } from "proposed-agenda-service";
import { suggestionCandidateId } from "quarter-project-task-candidates";
import { refillAndRecordSuggestion } from "ranked-task-suggestions";
import { logIfEnabled } from "util/log";

// Keep the host wait bounded while progressive publishing exposes each completed day.
const MAX_SUGGESTION_DAYS = 3;

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_DAY = 86400;

// Unix-second timestamps stay below this until the year 5138; anything larger was almost certainly milliseconds.
const MAX_PLAUSIBLE_UNIX_SECONDS = 1e11;

// Per-suggestion rows logged in the hand-off digest, enough to cover the three-day cap without flooding the console.
const MAX_DIGEST_ROWS = 30;

// ----------------------------------------------------------------------------------------------
// @desc Render a unix-seconds value as an ISO string for logs, passing through values that are not valid times.
// @param {*} seconds - Candidate unix-seconds timestamp.
// @returns {string|*} ISO string in UTC, or the original value when it cannot be converted.
function _isoFromSeconds(seconds) {
  if (!Number.isFinite(seconds)) return seconds;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? seconds : date.toISOString();
}

// ----------------------------------------------------------------------------------------------
// @desc Describe the host's calendar request with readable times and the host runtime's timezone, since every
//   suggestion's startAt is derived from local midnights computed in this runtime.
// @param {object} request - { endAt, schedulableTasks, scheduledTasks, startAt, taskDomain } from the host.
// @returns {object} Log-ready summary of the request window, task lists, and runtime timezone.
function _requestDiagnostics({ endAt, schedulableTasks, scheduledTasks, startAt, taskDomain }) {
  const timezoneName = Intl.DateTimeFormat?.().resolvedOptions?.().timeZone || null;
  const schedulableSample = (schedulableTasks || []).slice(0, 3);
  const schedulableTaskKeys = schedulableSample.map(task => Object.keys(task || {}).sort().join(","));
  return { endAt, endAtIso: _isoFromSeconds(endAt), schedulableTaskCount: schedulableTasks?.length || 0,
    schedulableTaskKeys, scheduledTaskCount: scheduledTasks?.length || 0, startAt, startAtIso: _isoFromSeconds(startAt),
    taskDomainName: taskDomain?.name || null, taskDomainUuid: taskDomain?.uuid || null, timezoneName,
    timezoneOffsetMinutes: new Date().getTimezoneOffset() };
}

// ----------------------------------------------------------------------------------------------
// @desc Summarize the suggestions about to reach Amplenote, flagging each property the host could plausibly use
//   to drop a suggestion silently: a taskUUID outside the schedulable list, a time outside the visible window or in
//   the past, a millisecond-scale timestamp, or a non-positive duration.
// @param {Array<object>} suggestions - Suggestions as { endAt, explanation, startAt, taskUUID|task }.
// @param {object} request - { endAt, schedulableTasks, scheduledTasks, startAt } from the host.
// @returns {object} { counts, rows }: counts tally each flag across all suggestions; rows describe the first
//   MAX_DIGEST_ROWS suggestions individually.
function _suggestionDiagnostics(suggestions, { endAt, schedulableTasks, scheduledTasks, startAt }) {
  const schedulableUuids = new Set((schedulableTasks || []).map(task => task?.uuid).filter(Boolean));
  const scheduledUuids = new Set((scheduledTasks || []).map(task => task?.uuid).filter(Boolean));
  const nowSeconds = Math.floor(Date.now() / 1000);
  const windowEndSeconds = Number.isFinite(endAt) ? endAt + SECONDS_PER_DAY : null;
  const rows = suggestions.map(suggestion => {
    const taskUuid = suggestion.taskUUID || null;
    return { afterWindow: windowEndSeconds != null && suggestion.startAt >= windowEndSeconds,
      beforeWindow: Number.isFinite(startAt) && suggestion.startAt < startAt,
      durationMinutes: (suggestion.endAt - suggestion.startAt) / SECONDS_PER_MINUTE,
      hasExplanation: Boolean(suggestion.explanation), inPast: suggestion.startAt < nowSeconds,
      isNewTask: !taskUuid, isScheduledTask: Boolean(taskUuid) && scheduledUuids.has(taskUuid),
      looksLikeMilliseconds: suggestion.startAt > MAX_PLAUSIBLE_UNIX_SECONDS,
      notSchedulable: Boolean(taskUuid) && !schedulableUuids.has(taskUuid), startAtIso: _isoFromSeconds(suggestion.startAt),
      startAtIsInteger: Number.isInteger(suggestion.startAt), taskUuid };
  });
  const countWhere = flag => rows.filter(row => row[flag]).length;
  const counts = { afterWindow: countWhere("afterWindow"), beforeWindow: countWhere("beforeWindow"),
    inPast: countWhere("inPast"), looksLikeMilliseconds: countWhere("looksLikeMilliseconds"),
    missingExplanation: rows.length - countWhere("hasExplanation"), newTask: countWhere("isNewTask"),
    nonIntegerStartAt: rows.length - countWhere("startAtIsInteger"),
    nonPositiveDuration: rows.filter(row => !(row.durationMinutes > 0)).length,
    notSchedulable: countWhere("notSchedulable"), scheduledTask: countWhere("isScheduledTask"), total: rows.length };
  return { counts, rows: rows.slice(0, MAX_DIGEST_ROWS) };
}

// ----------------------------------------------------------------------------------------------
// @desc Publish accumulated suggestions without allowing a progressive-update failure to fail the action.
// @param {object} app - Amplenote app bridge.
// @param {Array<object>} scheduledTasks - Suggestions accumulated so far.
// @returns {Promise<void>}
async function _publishProgressively(app, scheduledTasks) {
  if (scheduledTasks.length === 0) return;
  if (typeof app.context?.setScheduledTasks !== "function") {
    logIfEnabled("[proposed-agenda-suggest] setScheduledTasks unavailable; suggestions reach the host only on return",
      { contextKeys: Object.keys(app.context || {}).sort(), count: scheduledTasks.length });
    return;
  }
  try {
    const hostResponse = await app.context.setScheduledTasks(scheduledTasks);
    logIfEnabled("[proposed-agenda-suggest] published progressive suggestions", { count: scheduledTasks.length,
      hostResponse });
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
    reserves = reserves.filter(task => suggestionCandidateId(task) !== suggestionCandidateId(refill.placed));
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
  const request = { endAt, schedulableTasks, scheduledTasks, startAt, taskDomain };
  const dayKeys = days.map(day => day.toDateString());
  logIfEnabled("[proposed-agenda-suggest] suggestScheduledTasks", { ..._requestDiagnostics(request), dayCount: days.length,
    dayKeys, priorityKey, providerEm });

  const suggestions = [];
  const obligationsForDay = day => obligationsFromTasksAndEvents(scheduledTasks, [], day);
  const onDayComplete = async dayResult => {
    const dayKey = dayResult.day?.toDateString?.() || null;
    if (dayResult.error || !Array.isArray(dayResult.activities)) {
      logIfEnabled("[proposed-agenda-suggest] day produced no activities", { dayKey, error: dayResult.error || null,
        errorCode: dayResult.errorCode || null });
      return;
    }
    const undecidedActivities = await _activitiesAfterRejections(app, dayResult);
    const daySuggestions = undecidedActivities.map(_suggestionFromActivity);
    logIfEnabled("[proposed-agenda-suggest] day suggestions", { activityCount: dayResult.activities.length, dayKey,
      dismissedCount: dayResult.dismissedKeys?.length || 0, offeredCount: daySuggestions.length,
      scheduledCount: dayResult.scheduledKeys?.length || 0, targetMidnightIso: _isoFromSeconds(dayResult.targetMidnightSeconds) });
    suggestions.push(...daySuggestions);
    await _publishProgressively(app, suggestions);
  };
  const dayResults = await generateProposedAgendaRange(app, { days, domainName: taskDomain?.name || null,
    domainUuid: taskDomain?.uuid || null, obligationsForDay, onDayComplete, priorityKey,
    providerEmOverride: providerEm });
  if (suggestions.length === 0) {
    const firstError = dayResults.find(dayResult => dayResult.error)?.error || "No plannable days in range";
    logIfEnabled("[proposed-agenda-suggest] no suggestions produced", { error: firstError });
  }
  const diagnostics = _suggestionDiagnostics(suggestions, request);
  logIfEnabled("[proposed-agenda-suggest] returning suggestions to host", diagnostics.counts);
  logIfEnabled("[proposed-agenda-suggest] suggestion digest", diagnostics.rows);
  return suggestions;
}
