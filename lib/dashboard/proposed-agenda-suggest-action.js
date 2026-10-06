// Answer Amplenote's suggestScheduledTasks calendar action from the Dashboard's Proposed Agenda. For each visible day,
// up to MAX_SUGGESTION_DAYS, it generates or reuses that day's agenda, leaves out what the user already scheduled,
// dismissed, or completed, refills dismissed hours from the day's ranked reserves, and never offers one task on two
// days. What remains becomes Amplenote's existing-task or new-task suggestion shape, published as each day completes.
// Each pass records when it ran, so a pass soon after re-checks only the suggestions whose notes changed since.
// A freshly generated day is published as soon as its tasks are placed, with a placeholder where the benefit sentence
// will go, and published again once the provider has written those sentences.
import { calendarSuggestionExplanation } from "calendar-suggestion-explanation";
import { SETTING_KEYS } from "constants/settings";
import { setPluginData } from "plugin-data";
import { proposedTaskKey } from "proposed-agenda-archive";
import { obligationsFromTasksAndEvents } from "proposed-agenda-obligations";
import { DEFAULT_PRIORITY_KEY, priorityOptionFromKey } from "proposed-agenda-priority";
import { generateProposedAgendaRange, proposedAgendaDaysInRange } from "proposed-agenda-range";
import { resolveProposedAgendaDate, startAtSecondsFromMinutesToday } from "proposed-agenda-service";
import { suggestionCandidateId } from "quarter-project-task-candidates";
import { refillAndRecordSuggestion } from "ranked-task-suggestions";
import { changedNoteUuidsSinceLastGeneration, recordSuggestionGeneration, suggestionIdentityKey } from "suggestion-staleness";
import { suggestionHourAvailability } from "suggestion-task-slots";
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
// @desc Convert a validated activity into Amplenote's existing-task or new-task suggestion shape. Amplenote requires a
//   new task to name the note it will be created in, so a new-task activity carries its noteUuid as task.noteUUID, and
//   one without a note yields null rather than a suggestion the calendar would reject.
// @param {object} activity - Validated proposed activity ({ benefit, durationMinutes, noteUuid, projectSummary,
//   reason, startMinutes, ... }).
// @param {object} [options] - { rationalePending }: true while the provider is still writing this activity's benefit.
// @returns {object|null} { endAt, explanation, startAt } plus either taskUUID or task ({ content, noteUUID }), or null
//   for a new-task activity with no note to create it in. explanation names the project when one is known, then the
//   benefit of finishing the task, or a placeholder while that benefit is pending.
export function calendarSuggestionFromActivity(activity, { rationalePending = false } = {}) {
  if (!activity.taskUuid && !activity.noteUuid) return null;
  const startAt = startAtSecondsFromMinutesToday(activity.startMinutes, activity.targetMidnightSeconds ?? null);
  const endAt = startAt + activity.durationMinutes * SECONDS_PER_MINUTE;
  const newTask = { content: activity.title, noteUUID: activity.noteUuid };
  const identity = activity.taskUuid ? { taskUUID: activity.taskUuid } : { task: newTask };
  const explanation = calendarSuggestionExplanation(activity, { rationalePending });
  return { endAt, explanation, startAt, ...identity };
}

// ----------------------------------------------------------------------------------------------
// @desc Every day's calendar suggestions so far, in day order. A day still waiting on its rationale shows the
//   placeholder on each activity that will receive a benefit sentence: all of a ranked day's activities, or those an
//   LLM-written day flagged needsBenefitRationale.
// @param {Array<object>} dayEntries - { activities, fromRanking, rationalePending } per published day.
// @returns {Array<object>} Suggestions as calendarSuggestionFromActivity builds them.
function _suggestionsFromDayEntries(dayEntries) {
  const daySuggestionLists = dayEntries.map(dayEntry => dayEntry.activities.map(activity => {
    const awaitsBenefit = !activity.benefit && (dayEntry.fromRanking || activity.needsBenefitRationale);
    return calendarSuggestionFromActivity(activity, { rationalePending: dayEntry.rationalePending && awaitsBenefit });
  }));
  const suggestions = daySuggestionLists.flat();
  return suggestions;
}

// ----------------------------------------------------------------------------------------------
// @desc Copy the benefit sentences a deferred day received onto the activities that day offered. Those activities
//   may include reserves placed into dismissed hours after the agenda was generated, so benefits are matched by
//   suggestion identity across the explained activities and reserves rather than by position.
// @param {Array<object>} activities - The day's offered activities, without benefits.
// @param {object} explainedDay - generateProposedAgenda's resolved benefitRationales payload.
// @returns {Array<object>} The activities, with benefit set wherever the provider wrote one.
function _activitiesWithReceivedBenefits(activities, explainedDay) {
  const explainedRecords = [...(explainedDay?.activities || []), ...(explainedDay?.reserveTasks || [])];
  const benefitedRecords = explainedRecords.filter(record => record.benefit && suggestionIdentityKey(record));
  const benefitByKey = new Map(benefitedRecords.map(record => [suggestionIdentityKey(record), record.benefit]));
  const benefitedActivities = activities.map(activity => {
    const benefit = activity.benefit || benefitByKey.get(suggestionIdentityKey(activity));
    return benefit ? { ...activity, benefit } : activity;
  });
  return benefitedActivities;
}

// ----------------------------------------------------------------------------------------------
// @desc Wait for one day's deferred rationale, then fill its suggestions' explanations and publish the whole set again.
// @param {object} dayEntry - { activities, dayKey, fromRanking, rationalePending }, updated in place.
// @param {Promise<object>} benefitRationales - The day's generateProposedAgenda benefitRationales promise.
// @param {Function} republish - async () => void, publishing every day's current suggestions.
// @returns {Promise<void>}
async function _completeDayRationale(dayEntry, benefitRationales, republish) {
  const startedAt = Date.now();
  const explainedDay = await benefitRationales;
  dayEntry.activities = _activitiesWithReceivedBenefits(dayEntry.activities, explainedDay);
  dayEntry.rationalePending = false;
  const benefitedActivities = dayEntry.activities.filter(activity => activity.benefit);
  logIfEnabled("[proposed-agenda-suggest] day rationale received", { benefitCount: benefitedActivities.length,
    dayKey: dayEntry.dayKey, offeredCount: dayEntry.activities.length, waitedMs: Date.now() - startedAt });
  await republish();
}

// ----------------------------------------------------------------------------------------------
// @desc Drop scheduled and dismissed suggestions, and fill a dismissed hour from the ranked reserves. A reserve placed
//   here is claimed, so a later day of the range does not offer it again.
// @param {object} app - Amplenote app bridge.
// @param {Set<string>} claimedSuggestionKeys - The range's claimed suggestionIdentityKey values, added to in place.
// @param {object} dayResult - One day's generateProposedAgenda result, including obligations and reserves.
// @returns {Promise<Array<object>>} Activities still worth offering.
async function _activitiesAfterRejections(app, claimedSuggestionKeys, dayResult) {
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
    const placedKey = suggestionIdentityKey(refill.placed);
    if (placedKey) claimedSuggestionKeys.add(placedKey);
    visible = [...visible.filter(activity => !sameDay(activity)), ...refill.activities];
    reserves = reserves.filter(task => suggestionCandidateId(task) !== suggestionCandidateId(refill.placed));
  }
  return visible;
}

// ----------------------------------------------------------------------------------------------
// @desc Turn one day's agenda into calendar suggestions: leave out what the user already scheduled or dismissed, refill
//   dismissed hours from the reserves, and convert the rest, logging any new-task activity that has no note to hold it.
// @param {object} app - Amplenote app bridge.
// @param {Set<string>} claimedSuggestionKeys - The range's claimed suggestionIdentityKey values, added to in place.
// @param {object} dayResult - One day's generateProposedAgendaRange result.
// @returns {Promise<object|null>} { activities, droppedTitles }, where activities are those that convert to a
//   suggestion, or null when the day produced no agenda.
async function _calendarActivitiesForDay(app, claimedSuggestionKeys, dayResult) {
  const dayKey = dayResult.day?.toDateString?.() || null;
  if (dayResult.error || !Array.isArray(dayResult.activities)) {
    logIfEnabled("[proposed-agenda-suggest] day produced no activities", { dayKey, error: dayResult.error || null,
      errorCode: dayResult.errorCode || null });
    return null;
  }
  const undecidedActivities = await _activitiesAfterRejections(app, claimedSuggestionKeys, dayResult);
  const offerableActivities = undecidedActivities.filter(activity => calendarSuggestionFromActivity(activity));
  const notelessActivities = undecidedActivities.filter(activity => !calendarSuggestionFromActivity(activity));
  const droppedTitles = notelessActivities.map(activity => activity.title);
  if (droppedTitles.length) {
    logIfEnabled("[proposed-agenda-suggest] dropped new-task suggestions without a destination note", { dayKey, titles: droppedTitles });
  }
  logIfEnabled("[proposed-agenda-suggest] day suggestions", { activityCount: dayResult.activities.length, dayKey,
    dismissedCount: dayResult.dismissedKeys?.length || 0, offeredCount: offerableActivities.length,
    scheduledCount: dayResult.scheduledKeys?.length || 0, targetMidnightIso: _isoFromSeconds(dayResult.targetMidnightSeconds) });
  const clock = dayResult.isFutureDay ? null : new Date();
  const nowMinutes = clock ? clock.getHours() * 60 + clock.getMinutes() : null;
  const suggestionHours = suggestionHourAvailability({ activities: dayResult.activities, nowMinutes, obligations: dayResult.obligations });
  logIfEnabled("[proposed-agenda-suggest] suggestion hours", { dayKey, ...suggestionHours });
  return { activities: offerableActivities, droppedTitles };
}

// ----------------------------------------------------------------------------------------------
// @desc Log what a calendar pass hands back to Amplenote: why it produced nothing, when it did (the first day's error,
//   or that planned days yielded nothing the calendar could accept), then the diagnostic counts and digest rows.
// @param {Array<object>} suggestions - Suggestions about to be returned.
// @param {object} request - { endAt, schedulableTasks, scheduledTasks, startAt } from the host.
// @param {object} pass - { dayResults, droppedNotelessCount, plannedDayCount }.
function _logPassOutcome(suggestions, request, { dayResults, droppedNotelessCount, plannedDayCount }) {
  if (suggestions.length === 0) {
    const fallbackReason = plannedDayCount ? `${ plannedDayCount } day(s) planned, but no activity could become a suggestion`
      : "No plannable days in range";
    const firstError = dayResults.find(dayResult => dayResult.error)?.error || fallbackReason;
    logIfEnabled("[proposed-agenda-suggest] no suggestions produced", { dayCount: dayResults.length, droppedNotelessCount,
      error: firstError, plannedDayCount });
  }
  const diagnostics = _suggestionDiagnostics(suggestions, request);
  logIfEnabled("[proposed-agenda-suggest] returning suggestions to host", diagnostics.counts);
  logIfEnabled("[proposed-agenda-suggest] suggestion digest", diagnostics.rows);
}

// ----------------------------------------------------------------------------------------------
// @desc Record the days this pass planned, so the next pass over them within a few hours can confine its checks to
//   the notes changed since this pass started.
// @param {object} app - Amplenote app bridge.
// @param {Array<object>} dayResults - Every day's generateProposedAgendaRange result.
// @param {number} passStartedAtSeconds - Unix seconds when the pass began.
// @returns {Promise<number>} How many days were planned.
async function _recordPlannedDays(app, dayResults, passStartedAtSeconds) {
  const plannedDayResults = dayResults.filter(dayResult => !dayResult.error && Array.isArray(dayResult.activities));
  const plannedDayKeys = plannedDayResults.map(dayResult => dayResult.day.toDateString());
  if (plannedDayKeys.length) await recordSuggestionGeneration(app, { dayKeys: plannedDayKeys, generatedAtSeconds: passStartedAtSeconds });
  return plannedDayKeys.length;
}

// ----------------------------------------------------------------------------------------------
// @desc The Dashboard settings and days that shape a calendar pass. A request without a date range plans one day.
// @param {object} app - Amplenote app bridge.
// @param {object} window - { endAt, startAt } in unix seconds, either of which may be null.
// @returns {object} { dayKeys, days, priorityKey, providerEm }: dayKeys are the days' Date#toDateString values.
function _suggestionPassOptions(app, { endAt, startAt }) {
  const storedPriorityKey = app.settings?.[SETTING_KEYS.PROPOSED_AGENDA_PRIORITY] || null;
  const priorityKey = priorityOptionFromKey(storedPriorityKey || DEFAULT_PRIORITY_KEY).key;
  const providerEm = app.settings?.[SETTING_KEYS.PROPOSED_AGENDA_LLM] || null;
  const hasDateRange = startAt != null || endAt != null;
  const days = hasDateRange ? proposedAgendaDaysInRange({ endAt, startAt }, { maxDays: MAX_SUGGESTION_DAYS }) : [resolveProposedAgendaDate()];
  const dayKeys = days.map(day => day.toDateString());
  return { dayKeys, days, priorityKey, providerEm };
}

// ----------------------------------------------------------------------------------------------
// @desc Generate and progressively publish suggestions for the visible calendar window using Dashboard settings.
//   A pass for the same days within a few hours of the previous one re-checks only the suggestions whose notes
//   changed since, and every pass records when it ran so the next one can do the same. A freshly generated day is
//   published once its tasks are placed and again once its benefit sentences arrive; the pass returns after every
//   day's sentences have arrived, so the returned suggestions carry the final explanations.
// @param {object} app - Amplenote app bridge (plugin-side, so app.settings/app.context are the real ones).
// @param {object} [params={}] - The action's payload: { endAt, schedulableTasks, scheduledTasks, startAt,
//   taskDomain }, all as documented for suggestScheduledTasks; `endAt`/`startAt` are unix seconds.
// @returns {Promise<Array<object>>} Suggestions as { endAt, explanation, startAt, taskUUID|task }.
export async function suggestScheduledTasksFromDashboard(app, { endAt = null, schedulableTasks = [],
    scheduledTasks = [], startAt = null, taskDomain = null } = {}) {
  // Seed the shared settings singleton, normally initialized by the embed.
  setPluginData({ context: app.context || {}, settings: app.settings || {} });
  const { dayKeys, days, priorityKey, providerEm } = _suggestionPassOptions(app, { endAt, startAt });
  const request = { endAt, schedulableTasks, scheduledTasks, startAt, taskDomain };
  const passStartedAtSeconds = Math.floor(Date.now() / 1000);
  const changedNoteUuids = await changedNoteUuidsSinceLastGeneration(app, { dayKeys, nowSeconds: passStartedAtSeconds });
  logIfEnabled("[proposed-agenda-suggest] suggestScheduledTasks", { ..._requestDiagnostics(request),
    changedNoteCount: changedNoteUuids?.size ?? null, dayCount: days.length, dayKeys, priorityKey, providerEm });
  const dayEntries = [];
  const droppedTitles = [];
  const claimedSuggestionKeys = new Set();
  const pendingRationales = [];
  const republish = () => _publishProgressively(app, _suggestionsFromDayEntries(dayEntries));
  const onDayComplete = async dayResult => {
    const dayOutcome = await _calendarActivitiesForDay(app, claimedSuggestionKeys, dayResult);
    // A day that offers nothing still stores its explained agenda when the rationale resolves, so the pass waits on it.
    if (!dayOutcome) {
      if (dayResult.benefitRationales) pendingRationales.push(dayResult.benefitRationales);
      return;
    }
    droppedTitles.push(...dayOutcome.droppedTitles);
    const dayEntry = { activities: dayOutcome.activities, dayKey: dayResult.day?.toDateString?.() || null,
      fromRanking: Boolean(dayResult.fromRanking), rationalePending: Boolean(dayResult.benefitRationales) };
    dayEntries.push(dayEntry);
    await republish();
    logIfEnabled("[proposed-agenda-suggest] day published", { dayKey: dayEntry.dayKey,
      elapsedSeconds: Math.floor(Date.now() / 1000) - passStartedAtSeconds, rationalePending: dayEntry.rationalePending });
    if (dayResult.benefitRationales) pendingRationales.push(_completeDayRationale(dayEntry, dayResult.benefitRationales, republish));
  };
  const dayResults = await generateProposedAgendaRange(app, { changedNoteUuids, claimedSuggestionKeys, days,
    deferBenefitRationales: true, domainName: taskDomain?.name || null, domainUuid: taskDomain?.uuid || null,
    obligationsForDay: day => obligationsFromTasksAndEvents(scheduledTasks, [], day), onDayComplete, priorityKey,
    providerEmOverride: providerEm });
  await Promise.all(pendingRationales);
  const suggestions = _suggestionsFromDayEntries(dayEntries);
  const plannedDayCount = await _recordPlannedDays(app, dayResults, passStartedAtSeconds);
  _logPassOutcome(suggestions, request, { dayResults, droppedNotelessCount: droppedTitles.length, plannedDayCount });
  return suggestions;
}
