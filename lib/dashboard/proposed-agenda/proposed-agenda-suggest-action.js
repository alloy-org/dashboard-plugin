// Answer Amplenote's suggestScheduledTasks calendar action from the Dashboard's Proposed Agenda. For each visible day,
// up to MAX_SUGGESTION_DAYS, it generates or reuses that day's agenda, leaves out what the user already scheduled,
// dismissed, or completed, refills dismissed hours from the day's ranked reserves, and never offers one task on two
// days. What remains becomes Amplenote's existing-task or new-task suggestion shape, published as each day completes.
// Each pass records when it ran, so a pass soon after re-checks only the suggestions whose notes changed since.
// A freshly generated day is published as soon as its tasks are placed, with a placeholder where the benefit sentence
// will go, and published again once the provider has written those sentences. When the Debug Console is in the user's
// layout, the pass also writes an archived note recording how each day's tasks were selected and what each day's
// DecisionsEndpoint requests asked. Clicking Suggest again
// soon after a pass finishes asks the user how to re-roll: the re-roll discards what that pass offered and ranks the
// days again under the chosen focus and projects, without storing them as the days' agendas. Later passes on the date
// of the re-roll show its suggestions again; the first ordinary pass after that date plans those days afresh, offering
// neither the discarded nor the re-rolled suggestions.
import { debugConsoleInLayout, writeCalendarGenerationReport } from "dashboard/suggestions/calendar-generation-report";
import PassDecisionRequests from "dashboard/suggestions/calendar-report-decision-requests";
import { calendarSuggestionExplanation } from "dashboard/suggestions/calendar-suggestion-explanation";
import { SETTING_KEYS } from "constants/settings";
import { setPluginData } from "plugin-data";
import { proposedTaskKey } from "dashboard/proposed-agenda/proposed-agenda-archive";
import { obligationsFromTasksAndEvents } from "dashboard/proposed-agenda/proposed-agenda-obligations";
import { DEFAULT_PRIORITY_KEY, priorityOptionFromKey } from "dashboard/proposed-agenda/proposed-agenda-priority";
import { activitiesWithReceivedBenefits, generateProposedAgendaRange, proposedAgendaDaysInRange } from "dashboard/proposed-agenda/proposed-agenda-range";
import { resolveProposedAgendaDate, startAtSecondsFromMinutesToday } from "dashboard/proposed-agenda/proposed-agenda-service";
import { suggestionCandidateId } from "dashboard/quarter-project-task-candidates";
import { refillAndRecordSuggestion } from "dashboard/suggestions/ranked-task-suggestions";
import { changedNoteUuidsSinceLastGeneration, recordSuggestionGeneration, suggestionIdentityKey } from "dashboard/suggestions/suggestion-staleness";
import { promptedRerollChoice } from "dashboard/suggestions/suggestion-reroll-prompt";
import { generateRerolledRange, replayRerolledRange } from "dashboard/suggestions/suggestion-reroll-range";
import { discardedKeysByDay, markFreshlyPlannedDays, readRerolledDays, recordRerolledPass, replayableRerolledDay,
  rerollablePreviousPass, rerollTaskDomain } from "dashboard/suggestions/suggestion-reroll-store";
import { suggestionHourAvailability } from "dashboard/suggestions/suggestion-task-slots";
import { externalCalendarEventsForTargetDate, normalizeExternalCalendarEvents } from "util/calendar-utility";
import { logIfEnabled } from "util/log";

// Keep the host wait bounded while progressive publishing exposes each completed day.
export const MAX_SUGGESTION_DAYS = 3;

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
// @desc Render a Date as the runtime's local hours and minutes, for logs read beside the calendar.
// @param {Date} date - The time to render.
// @returns {string} "HH:MM" in local time.
function _localClock(date) {
  const clock = date.toTimeString().slice(0, 5);
  return clock;
}

// ----------------------------------------------------------------------------------------------
// @desc One row per suggestion handed to Amplenote, naming the day the plugin planned it for beside the local day and
//   time its startAt lands on. When the calendar shows a suggestion on the wrong day, a row whose landsOnPlannedDay is
//   false places the fault in the plugin, and a row whose day matches yet still appears elsewhere places it in the host.
// @param {Array<object>} dayEntries - { activities, dayKey } per published day.
// @returns {Array<object>} { endAt, endAtLocal, landsOnPlannedDay, plannedDayKey, startAt, startAtLocal, startMinutes,
//   targetMidnightLocal, taskUuid, title } per suggestion, in the order they are handed over.
function _handOffRows(dayEntries) {
  const rows = [];
  for (const dayEntry of dayEntries) {
    for (const activity of dayEntry.activities) {
      const suggestion = calendarSuggestionFromActivity(activity);
      if (!suggestion) continue;
      const startDate = new Date(suggestion.startAt * 1000);
      const startDayKey = startDate.toDateString();
      const targetMidnightSeconds = activity.targetMidnightSeconds ?? null;
      const targetMidnightLocal = targetMidnightSeconds == null ? null : new Date(targetMidnightSeconds * 1000).toString();
      rows.push({ endAt: suggestion.endAt, endAtLocal: _localClock(new Date(suggestion.endAt * 1000)),
        landsOnPlannedDay: startDayKey === dayEntry.dayKey, plannedDayKey: dayEntry.dayKey, startAt: suggestion.startAt,
        startAtLocal: `${ startDayKey } ${ _localClock(startDate) }`, startMinutes: activity.startMinutes, targetMidnightLocal,
        taskUuid: suggestion.taskUUID || null, title: activity.title || suggestion.task?.content || null });
    }
  }
  return rows;
}

// ----------------------------------------------------------------------------------------------
// @desc Log every suggestion handed to Amplenote with the day it was planned for, so a suggestion shown on the wrong
//   day can be traced to what the plugin sent.
// @param {string} handOff - Which hand-off this is: "progressive publish" or "returned to host".
// @param {Array<object>} dayEntries - { activities, dayKey } per published day.
function _logHandOff(handOff, dayEntries) {
  const rows = _handOffRows(dayEntries);
  const offDayRows = rows.filter(row => !row.landsOnPlannedDay);
  logIfEnabled(`[proposed-agenda-suggest] suggestions by day (${ handOff })`, { count: rows.length, offDayCount: offDayRows.length, rows });
}

// ----------------------------------------------------------------------------------------------
// @desc Publish every day's suggestions so far without allowing a progressive-update failure to fail the action,
//   logging each suggestion with its planned day first.
// @param {object} app - Amplenote app bridge.
// @param {Array<object>} dayEntries - { activities, dayKey, fromRanking, rationalePending } per published day.
// @returns {Promise<void>}
async function _publishProgressively(app, dayEntries) {
  const scheduledTasks = _suggestionsFromDayEntries(dayEntries);
  if (scheduledTasks.length === 0) return;
  _logHandOff("progressive publish", dayEntries);
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
// @desc Wait for one day's deferred rationale, then fill its suggestions' explanations and publish the whole set again.
// @param {object} dayEntry - { activities, dayKey, fromRanking, rationalePending }, updated in place.
// @param {Promise<object>} benefitRationales - The day's generateProposedAgenda benefitRationales promise.
// @param {Function} republish - async () => void, publishing every day's current suggestions.
// @returns {Promise<void>}
async function _completeDayRationale(dayEntry, benefitRationales, republish) {
  const startedAt = Date.now();
  const explainedDay = await benefitRationales;
  dayEntry.activities = activitiesWithReceivedBenefits(dayEntry.activities, explainedDay);
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
// @returns {Promise<object>} { activities, refilledCount, reserveTasks }: the activities still worth offering, how many
//   dismissed hours a reserve filled, and the reserves left after those refills.
async function _activitiesAfterRejections(app, claimedSuggestionKeys, dayResult) {
  const dismissed = new Set(dayResult.dismissedKeys || []);
  const scheduled = new Set(dayResult.scheduledKeys || []);
  let visible = (dayResult.activities || []).filter(activity => !dismissed.has(proposedTaskKey(activity))
    && !scheduled.has(proposedTaskKey(activity)));
  const covered = new Set(visible.map(activity => `${ activity.targetMidnightSeconds }:${ activity.startMinutes }`));
  const uncovered = (dayResult.activities || []).filter(activity => dismissed.has(proposedTaskKey(activity))
    && !covered.has(`${ activity.targetMidnightSeconds }:${ activity.startMinutes }`));
  let reserves = dayResult.reserveTasks || [];
  let refilledCount = 0;
  for (const rejected of uncovered) {
    const sameDay = row => row.targetMidnightSeconds === rejected.targetMidnightSeconds;
    const refill = await refillAndRecordSuggestion(app, { activities: visible.filter(sameDay),
      domainName: dayResult.domainName, domainUuid: dayResult.domainUuid,
      obligations: (dayResult.obligations || []).filter(sameDay), preferredStartMinutes: rejected.startMinutes,
      reserveTasks: reserves.filter(sameDay), targetDate: dayResult.day,
      targetMidnightSeconds: rejected.targetMidnightSeconds });
    if (!refill.placed) continue;
    refilledCount += 1;
    const placedKey = suggestionIdentityKey(refill.placed);
    if (placedKey) claimedSuggestionKeys.add(placedKey);
    visible = [...visible.filter(activity => !sameDay(activity)), ...refill.activities];
    reserves = reserves.filter(task => suggestionCandidateId(task) !== suggestionCandidateId(refill.placed));
  }
  return { activities: visible, refilledCount, reserveTasks: reserves };
}

// ----------------------------------------------------------------------------------------------
// @desc Turn one day's agenda into calendar suggestions: leave out what the user already scheduled or dismissed, refill
//   dismissed hours from the reserves, and convert the rest, logging any new-task activity that has no note to hold it.
// @param {object} app - Amplenote app bridge.
// @param {Set<string>} claimedSuggestionKeys - The range's claimed suggestionIdentityKey values, added to in place.
// @param {object} dayResult - One day's generateProposedAgendaRange result.
// @returns {Promise<object|null>} { activities, droppedTitles, refilledCount, reserveTasks, suggestionHours }, where
//   activities are those that convert to a suggestion and reserveTasks are those left after refilling dismissed hours,
//   or null when the day produced no agenda.
async function _calendarActivitiesForDay(app, claimedSuggestionKeys, dayResult) {
  const dayKey = dayResult.day?.toDateString?.() || null;
  if (dayResult.error || !Array.isArray(dayResult.activities)) {
    logIfEnabled("[proposed-agenda-suggest] day produced no activities", { dayKey, error: dayResult.error || null,
      errorCode: dayResult.errorCode || null });
    return null;
  }
  const { activities: undecidedActivities, refilledCount, reserveTasks } = await _activitiesAfterRejections(app,
    claimedSuggestionKeys, dayResult);
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
  return { activities: offerableActivities, droppedTitles, refilledCount, reserveTasks, suggestionHours };
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
//   the notes changed since this pass started, and what it offered on each, so a Suggest click soon after it finished
//   can re-roll them.
// @param {object} app - Amplenote app bridge.
// @param {object} pass - { dayEntries, dayResults, passStartedAtSeconds, suggestionCount }: dayEntries as published.
// @returns {Promise<Array<string>>} The Date#toDateString values of the days planned.
async function _recordPlannedDays(app, { dayEntries, dayResults, passStartedAtSeconds, suggestionCount }) {
  const plannedDayResults = dayResults.filter(dayResult => !dayResult.error && Array.isArray(dayResult.activities));
  const plannedDayKeys = plannedDayResults.map(dayResult => dayResult.day.toDateString());
  const offeredKeysByDay = Object.fromEntries(dayEntries.map(dayEntry => [dayEntry.dayKey,
    dayEntry.activities.map(suggestionIdentityKey).filter(Boolean)]));
  if (plannedDayKeys.length) await recordSuggestionGeneration(app, { dayKeys: plannedDayKeys,
    finishedAtSeconds: Math.floor(Date.now() / 1000), generatedAtSeconds: passStartedAtSeconds, offeredKeysByDay, suggestionCount });
  return plannedDayKeys;
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
// @desc The external calendar events (Google, Outlook) covering every planned day, fetched once for the pass so
//   suggestions avoid meetings as well as scheduled tasks. The fetch reaches forward from today to the last day.
// @param {object} app - Amplenote app bridge.
// @param {Array<Date>} days - The pass's local midnights, ascending.
// @param {string|null} domainUuid - Task domain whose calendars to read, or null for all.
// @returns {Promise<Array<object>>} Normalized events, or [] when the host offers none.
async function _externalCalendarEventsForDays(app, days, domainUuid) {
  const lastDay = days[days.length - 1];
  if (!lastDay) return [];
  const rawEvents = await externalCalendarEventsForTargetDate(app, lastDay, domainUuid, { logPrefix: "[proposed-agenda-suggest]" });
  const calendarEvents = normalizeExternalCalendarEvents(rawEvents);
  logIfEnabled("[proposed-agenda-suggest] external calendar events", { eventCount: calendarEvents.length });
  return calendarEvents;
}

// ----------------------------------------------------------------------------------------------
// @desc Generate and progressively publish suggestions for the visible calendar window using Dashboard settings.
//   A pass for the same days within a few hours of the previous one re-checks only the suggestions whose notes
//   changed since, and every pass records when it ran so the next one can do the same. A freshly generated day is
//   published once its tasks are placed and again once its benefit sentences arrive; the pass returns after every
//   day's sentences have arrived, so the returned suggestions carry the final explanations. With the Debug Console in
//   the user's layout, each day's selection is traced and written to an archived report note before returning.
//   A request within REROLL_WINDOW_SECONDS of the previous pass finishing, for days it covered, first asks the user how
//   to re-roll; a re-roll replaces that pass's suggestions, and keeping them runs the ordinary pass.
// @param {object} app - Amplenote app bridge (plugin-side, so app.settings/app.context are the real ones).
// @param {object} [params={}] - The action's payload: { endAt, schedulableTasks, scheduledTasks, startAt,
//   taskDomain }, all as documented for suggestScheduledTasks; `endAt`/`startAt` are unix seconds.
// @returns {Promise<Array<object>>} Suggestions as { endAt, explanation, startAt, taskUUID|task }.
export async function suggestScheduledTasksFromDashboard(app, { endAt = null, schedulableTasks = [],
    scheduledTasks = [], startAt = null, taskDomain = null } = {}) {
  // Seed the shared settings singleton, normally initialized by the embed.
  setPluginData({ context: app.context || {}, settings: app.settings || {} });
  const passStartedAt = new Date();
  const passStartedAtSeconds = Math.floor(passStartedAt.getTime() / 1000);
  const passOptions = _suggestionPassOptions(app, { endAt, startAt });
  const request = { endAt, schedulableTasks, scheduledTasks, startAt, taskDomain };
  const rerollDomain = await rerollTaskDomain(app, taskDomain);
  const previousPass = rerollablePreviousPass(app, { dayKeys: passOptions.dayKeys, nowSeconds: passStartedAtSeconds });
  const rerollChoice = previousPass ? await promptedRerollChoice(app, { days: passOptions.days, ...rerollDomain }) : null;
  const rerolledDays = await readRerolledDays(app, { domainUuid: rerollDomain.domainUuid, now: passStartedAt });
  const changedNoteUuids = await changedNoteUuidsSinceLastGeneration(app, { dayKeys: passOptions.dayKeys, nowSeconds: passStartedAtSeconds });
  logIfEnabled("[proposed-agenda-suggest] suggestScheduledTasks", { ..._requestDiagnostics(request),
    changedNoteCount: changedNoteUuids?.size ?? null, dayCount: passOptions.days.length, dayKeys: passOptions.dayKeys,
    priorityKey: passOptions.priorityKey, providerEm: passOptions.providerEm, rerolledDayCount: rerolledDays.size,
    rerollFocusKey: rerollChoice?.focus.key || null, rerollSourceKey: rerollChoice?.source.key || null });
  const calendarEvents = await _externalCalendarEventsForDays(app, passOptions.days, taskDomain?.uuid || null);
  const pass = { calendarEvents, changedNoteUuids, passOptions, passStartedAt, previousPass, request, rerollChoice,
    rerollDomain, rerolledDays };
  return _runSuggestionPass(app, pass);
}

// ----------------------------------------------------------------------------------------------
// @desc Plan the pass's days, ordinarily or as a re-roll, publish each as it completes, then record the pass and, with
//   the Debug Console in the layout, write its report, which lists the DecisionsEndpoint requests made while each day
//   was planned and handled, and any made outside the days for the whole pass. An ordinary pass shows a day re-rolled earlier the same date
//   again, ahead of planning the other days, so they do not offer its suggestions twice.
// @param {object} app - Amplenote app bridge.
// @param {object} pass - { calendarEvents, changedNoteUuids, passOptions, passStartedAt, previousPass, request,
//   rerollChoice, rerollDomain, rerolledDays }, as suggestScheduledTasksFromDashboard gathers them.
// @returns {Promise<Array<object>>} Suggestions as { endAt, explanation, startAt, taskUUID|task }.
async function _runSuggestionPass(app, { calendarEvents, changedNoteUuids, passOptions, passStartedAt, previousPass, request,
    rerollChoice, rerollDomain, rerolledDays }) {
  const { days, priorityKey, providerEm } = passOptions;
  const { scheduledTasks, taskDomain } = request;
  const passStartedAtSeconds = Math.floor(passStartedAt.getTime() / 1000);
  const reportEnabled = debugConsoleInLayout(app.settings);
  const decisionRequests = reportEnabled ? new PassDecisionRequests() : null;
  const domainUuid = taskDomain?.uuid || null;
  const dayEntries = [];
  const droppedTitles = [];
  const claimedSuggestionKeys = new Set();
  const pendingRationales = [];
  const dayOutcomes = new Map();
  const republish = () => _publishProgressively(app, dayEntries);
  const onDayComplete = async dayResult => {
    const dayKey = dayResult.day?.toDateString?.() || null;
    decisionRequests?.fileUnderDay(dayKey);
    const dayOutcome = await _calendarActivitiesForDay(app, claimedSuggestionKeys, dayResult);
    decisionRequests?.fileUnderDay(dayKey);
    dayOutcomes.set(dayResult, dayOutcome);
    // A day that offers nothing still stores its explained agenda when the rationale resolves, so the pass waits on it.
    if (!dayOutcome) {
      if (dayResult.benefitRationales) pendingRationales.push(dayResult.benefitRationales);
      return;
    }
    droppedTitles.push(...dayOutcome.droppedTitles);
    const dayEntry = { activities: dayOutcome.activities, dayKey, fromRanking: Boolean(dayResult.fromRanking),
      rationalePending: Boolean(dayResult.benefitRationales) };
    dayEntries.push(dayEntry);
    await republish();
    logIfEnabled("[proposed-agenda-suggest] day published", { dayKey: dayEntry.dayKey,
      elapsedSeconds: Math.floor(Date.now() / 1000) - passStartedAtSeconds, rationalePending: dayEntry.rationalePending });
    if (dayResult.benefitRationales) pendingRationales.push(_completeDayRationale(dayEntry, dayResult.benefitRationales, republish));
  };
  const obligationsForDay = day => obligationsFromTasksAndEvents(scheduledTasks, calendarEvents, day);
  let dayResults;
  let replayedDayKeys = new Set();
  decisionRequests?.fileUnderPass();

  if (rerollChoice) {
    dayResults = await generateRerolledRange(app, { calendarEvents, claimedSuggestionKeys, days,
      discardedKeysByDay: discardedKeysByDay(days, { previousPass, rerolledDays }),
      ...rerollDomain, focus: rerollChoice.focus, obligationsForDay, onDayComplete, projectUuids: rerollChoice.projectUuids,
      source: rerollChoice.source, traceSelection: reportEnabled });
  } else {
    const replayDays = days.filter(day => replayableRerolledDay(rerolledDays.get(day.toDateString()), { now: passStartedAt }));
    const plannedDays = days.filter(day => !replayDays.includes(day));
    const replayedResults = replayDays.length ? await replayRerolledRange(app, { claimedSuggestionKeys, days: replayDays,
      ...rerollDomain, obligationsForDay, onDayComplete, rerolledDays, traceSelection: reportEnabled }) : [];
    const plannedResults = plannedDays.length ? await generateProposedAgendaRange(app, { changedNoteUuids, claimedSuggestionKeys,
      days: plannedDays, deferBenefitRationales: true, domainName: taskDomain?.name || null, domainUuid, obligationsForDay,
      onDayComplete, priorityKey, providerEmOverride: providerEm, rerolledDays, traceSelection: reportEnabled }) : [];
    replayedDayKeys = new Set(replayDays.map(day => day.toDateString()));
    dayResults = [...replayedResults, ...plannedResults].sort((first, second) => first.day.getTime() - second.day.getTime());
  }
  await Promise.all(pendingRationales);

  // Ends the observing so later requests in this bundle are not collected.
  decisionRequests?.finish();

  const suggestions = _suggestionsFromDayEntries(dayEntries);
  const plannedDayKeys = await _recordPlannedDays(app, { dayEntries, dayResults, passStartedAtSeconds,
    suggestionCount: suggestions.length });
  if (rerollChoice) {
    await recordRerolledPass(app, { dayEntries, dayResults, domainUuid: rerollDomain.domainUuid, rerollChoice });
  } else {
    const freshDayKeys = plannedDayKeys.filter(dayKey => !replayedDayKeys.has(dayKey));
    await markFreshlyPlannedDays(app, { domainUuid: rerollDomain.domainUuid, plannedDayKeys: freshDayKeys, rerolledDays });
  }
  _logPassOutcome(suggestions, request, { dayResults, droppedNotelessCount: droppedTitles.length,
    plannedDayCount: plannedDayKeys.length });
  _logHandOff("returned to host", dayEntries);
  if (reportEnabled) {
    const reportDays = dayResults.map(dayResult => ({ dayOutcome: dayOutcomes.get(dayResult) || null, dayResult,
      decisionRequests: decisionRequests.requestsForDay(dayResult.day.toDateString()) }));
    const reroll = rerollChoice ? { focusLabel: rerollChoice.focus.label, projectNames: rerollChoice.projectNames,
      sourceLabel: rerollChoice.source.label } : null;
    await writeCalendarGenerationReport(app, { days: reportDays, domainName: taskDomain?.name || rerollDomain.domainName,
      domainUuid, passDecisionRequests: decisionRequests.passRequests, reroll, startedAt: passStartedAt });
  }
  return suggestions;
}
