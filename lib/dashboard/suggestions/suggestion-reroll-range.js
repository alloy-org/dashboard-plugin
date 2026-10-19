// Plan the days of a user-requested re-roll, one at a time, in the shape generateProposedAgendaRange gives each day, so
// the calendar suggest action publishes them the same way. Each day is ranked afresh under the focus and projects the
// user chose, leaving out the suggestions the re-roll discards, the tasks already on the calendar, and those an earlier
// day of the range holds; the best fits are slotted onto the day's free hours. Nothing is stored as the day's agenda,
// since the ranking answers a preference held only for the moment; what the user is shown is still recorded as shown.
// For the rest of the date the user re-rolled on, later passes show the re-rolled suggestions again instead, less those
// the user has since scheduled, completed, or covered with something else.
import { agendaRankingProjects } from "dashboard/proposed-agenda/proposed-agenda-service";
import { rankingSelectionTrace } from "dashboard/suggestions/calendar-generation-report";
import { agendaWithBenefitRationales } from "dashboard/suggestions/calendar-suggestion-explanation";
import { recordShownTaskSuggestions, rerolledDayRanking } from "dashboard/suggestions/ranked-task-suggestions";
import { rerollFocusFromKey } from "dashboard/suggestions/suggestion-reroll-store";
import { suggestionIdentityKey } from "dashboard/suggestions/suggestion-staleness";
import { activitiesClearOfObligations, slotRankedTasks } from "dashboard/suggestions/suggestion-task-slots";
import { fetchDomainOrAllNotesTasks } from "util/all-notes-tasks";
import { localMidnightFromDateInput, millisFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";

const MINUTES_PER_HOUR = 60;
const REROLL_RANGE_LOG_LABEL = "[suggestion-reroll-range]";

// ----------------------------------------------------------------------------------------------
// @desc Re-roll each day in turn and hand it to onDayComplete before planning the next. A day whose ranking finds
//   nothing to offer carries an error, as a day generateProposedAgendaRange could not plan does.
// @param {object} app - Amplenote app bridge.
// @param {object} options - An object with the following properties:
//   - {Array<object>|null} [calendarEvents] - External calendar events covering the days
//   - {Set<string>} claimedSuggestionKeys - Suggestion identities already placed this pass, added to in place
//   - {Array<Date>} days - Local midnights to plan, ascending
//   - {object} discardedKeysByDay - Suggestion identities to leave out, by Date#toDateString
//   - {string|null} domainName - Resolved task domain name
//   - {string|null} domainUuid - Resolved task domain UUID
//   - {object} focus - The chosen REROLL_FOCUS_OPTIONS entry
//   - {Function} obligationsForDay - (day) => obligation records already committed on that day
//   - {Function|null} onDayComplete - async (dayResult) => void, awaited after each day
//   - {Array<string>} projectUuids - The projects the user boosted, or empty for the usual weekday groups
//   - {object} [source] - The chosen REROLL_SOURCE_OPTIONS entry; without one, new ideas and existing tasks both compete
//   - {boolean} [traceSelection=false] - Give each day a selectionTrace for the calendar generation report
// @returns {Promise<Array<object>>} One result per day: { activities, benefitRationales, day, discardedKeys,
//   domainName, domainUuid, fromRanking, isFutureDay, obligations, reserveTasks, selectionTrace?,
//   targetMidnightSeconds }, or { day, error, errorCode, obligations, targetMidnightSeconds } for a day with nothing to
//   offer. benefitRationales resolves to the day with benefit sentences and never rejects.
export async function generateRerolledRange(app, { calendarEvents = null, claimedSuggestionKeys, days, discardedKeysByDay,
    domainName, domainUuid, focus, obligationsForDay, onDayComplete = null, projectUuids, source = null, traceSelection = false }) {
  const openTasks = await _openTasks(app, domainUuid);
  const dayResults = [];
  for (const day of days) {
    const dayResult = await _rerolledDay(app, { calendarEvents, claimedSuggestionKeys, day,
      discardedKeys: new Set(discardedKeysByDay[day.toDateString()] || []), domainName, domainUuid, focus, obligationsForDay,
      openTasks, projectUuids, source, traceSelection });
    const daySuggestionKeys = (dayResult.activities || []).map(suggestionIdentityKey).filter(Boolean);
    daySuggestionKeys.forEach(key => claimedSuggestionKeys.add(key));
    dayResults.push(dayResult);
    if (onDayComplete) await onDayComplete(dayResult, dayResults);
  }
  return dayResults;
}

// ----------------------------------------------------------------------------------------------
// @desc Show each day's re-rolled suggestions again, in the shape generateRerolledRange gives each day, and hand it to
//   onDayComplete before the next. A suggestion is left out once its task is scheduled, completed, or dismissed, once an
//   idea taken from it sits at its hour, or when an earlier day of the range holds it; one that now overlaps a scheduled
//   task or event moves to the next free hour, or is left out when none remains.
// @param {object} app - Amplenote app bridge.
// @param {object} options - An object with the following properties:
//   - {Set<string>} claimedSuggestionKeys - Suggestion identities already placed this pass, added to in place
//   - {Array<Date>} days - Local midnights to show again, ascending, each with a replayable re-rolled record
//   - {string|null} domainName - Resolved task domain name
//   - {string|null} domainUuid - Resolved task domain UUID
//   - {Function} obligationsForDay - (day) => obligation records already committed on that day
//   - {Function|null} onDayComplete - async (dayResult) => void, awaited after each day
//   - {Map<string,object>} rerolledDays - Re-rolled days as readRerolledDays reads them
//   - {boolean} [traceSelection=false] - Give each day a selectionTrace for the calendar generation report
// @returns {Promise<Array<object>>} One result per day: { activities, day, domainName, domainUuid, fromRanking,
//   isFutureDay, obligations, reserveTasks, selectionTrace?, targetMidnightSeconds }.
export async function replayRerolledRange(app, { claimedSuggestionKeys, days, domainName, domainUuid, obligationsForDay,
    onDayComplete = null, rerolledDays, traceSelection = false }) {
  const openTasks = await _openTasks(app, domainUuid);
  const openTaskUuids = openTasks ? new Set(openTasks.map(task => task.uuid)) : null;
  const dayResults = [];
  for (const day of days) {
    const dayResult = await _replayedDay({ claimedSuggestionKeys, day, domainName, domainUuid, obligationsForDay, openTaskUuids,
      rerolledDay: rerolledDays.get(day.toDateString()), traceSelection });
    const daySuggestionKeys = dayResult.activities.map(suggestionIdentityKey).filter(Boolean);
    daySuggestionKeys.forEach(key => claimedSuggestionKeys.add(key));
    dayResults.push(dayResult);
    if (onDayComplete) await onDayComplete(dayResult, dayResults);
  }
  return dayResults;
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Whether the user has taken a re-rolled suggestion onto the calendar: its task is among the day's scheduled tasks,
//   or, for an idea, a scheduled task with its title starts at its hour.
// @param {object} activity - Re-rolled activity.
// @param {Array<object>} obligations - The day's { source, startMinutes, taskUuid, title } obligations.
// @returns {boolean}
function _acceptedOntoCalendar(activity, obligations) {
  const title = (activity.title || "").trim();
  return obligations.some(obligation => (activity.taskUuid && obligation.taskUuid === activity.taskUuid)
    || (obligation.source === "task" && obligation.startMinutes === activity.startMinutes && title
      && String(obligation.title || "").includes(title)));
}

// ----------------------------------------------------------------------------------------------
// @desc The minutes before which a suggestion may not be moved to on the day: now for today, none for a later day.
// @param {Date} day - Local midnight of the day.
// @returns {object} { isFutureDay, nowMinutes }.
function _dayClock(day) {
  const isFutureDay = day.getTime() > localMidnightFromDateInput(new Date()).getTime();
  const clock = new Date();
  const nowMinutes = isFutureDay ? null : clock.getHours() * MINUTES_PER_HOUR + clock.getMinutes();
  return { isFutureDay, nowMinutes };
}

// ----------------------------------------------------------------------------------------------
// @desc The tasks to leave out of a day's candidates: the discarded suggestions, those an earlier day holds, and the
//   tasks the calendar already has scheduled, named both by task UUID and by candidate ID.
// @param {object} options - { claimedSuggestionKeys, discardedKeys, obligations }.
// @returns {Set<string>} Excluded task UUIDs and candidate IDs.
function _excludedCandidateIds({ claimedSuggestionKeys, discardedKeys, obligations }) {
  const scheduledTaskUuids = obligations.map(obligation => obligation.taskUuid).filter(Boolean);
  return new Set([...discardedKeys, ...claimedSuggestionKeys, ...scheduledTaskUuids]);
}

// ----------------------------------------------------------------------------------------------
// @desc Open tasks of the task domain, read once for the range. A read failure leaves the ranking to the stored task
//   records alone.
// @param {object} app - Amplenote app bridge.
// @param {string|null} domainUuid - Task domain UUID.
// @returns {Promise<Array<object>|null>} Open native tasks, or null when they could not be read.
async function _openTasks(app, domainUuid) {
  try {
    const tasks = await fetchDomainOrAllNotesTasks(app, domainUuid);
    const openTasks = (Array.isArray(tasks) ? tasks : []).filter(task => task?.uuid && !task.completedAt && !task.dismissedAt);
    return openTasks;
  } catch (error) {
    logIfEnabled(`${ REROLL_RANGE_LOG_LABEL } open tasks unavailable`, error?.message);
    return null;
  }
}

// ----------------------------------------------------------------------------------------------
// @desc The open tasks as one day's candidates read them, each flagged when it is already scheduled on that day.
// @param {Array<object>|null} openTasks - Open native tasks.
// @param {Date} day - Local midnight of the day.
// @returns {Array<object>|null} The tasks with scheduledOnTarget set, or null without tasks.
function _openTasksForDay(openTasks, day) {
  if (!openTasks) return null;
  const dayMillis = day.getTime();
  return openTasks.map(task => {
    const startMillis = millisFromDateInput(task.startAt);
    const scheduledOnTarget = Boolean(startMillis) && localMidnightFromDateInput(new Date(startMillis)).getTime() === dayMillis;
    return { ...task, scheduledOnTarget };
  });
}

// ----------------------------------------------------------------------------------------------
// @desc Show one re-rolled day's suggestions again, less those that no longer stand, clear of the day's obligations.
// @param {object} options - { claimedSuggestionKeys, day, domainName, domainUuid, obligationsForDay, openTaskUuids,
//   rerolledDay, traceSelection }: openTaskUuids is null when the open tasks could not be read, so none is left out as
//   closed.
// @returns {Promise<object>} The day's result, as replayRerolledRange describes it.
async function _replayedDay({ claimedSuggestionKeys, day, domainName, domainUuid, obligationsForDay, openTaskUuids, rerolledDay,
    traceSelection }) {
  const targetMidnightSeconds = Math.floor(day.getTime() / 1000);
  const rawObligations = await obligationsForDay(day);
  const obligations = (rawObligations || []).map(obligation => ({ ...obligation, targetMidnightSeconds }));
  const storedActivities = rerolledDay.activities.map(activity => ({ ...activity, targetMidnightSeconds }));
  const standingActivities = storedActivities.filter(activity => !claimedSuggestionKeys.has(suggestionIdentityKey(activity))
    && !(activity.taskUuid && openTaskUuids && !openTaskUuids.has(activity.taskUuid)) && !_acceptedOntoCalendar(activity, obligations));
  const { isFutureDay, nowMinutes } = _dayClock(day);
  const placement = activitiesClearOfObligations(standingActivities, { nowMinutes, obligations });
  const selectionTrace = traceSelection ? { focusLabel: rerollFocusFromKey(rerolledDay.focusKey).label, generator: "ranking",
    movedCount: placement.movedCount,
    rerolledAt: rerolledDay.rerolledAt, shownCount: placement.activities.length, source: "rerollReplay",
    storedCount: storedActivities.length } : null;
  logIfEnabled(`${ REROLL_RANGE_LOG_LABEL } re-rolled day shown again`, { dayKey: day.toDateString(),
    droppedCount: placement.droppedCount, movedCount: placement.movedCount, shownCount: placement.activities.length,
    storedCount: storedActivities.length });
  return { activities: placement.activities, day, domainName, domainUuid, fromRanking: true, isFutureDay, obligations,
    reserveTasks: [], selectionTrace, targetMidnightSeconds };
}

// ----------------------------------------------------------------------------------------------
// @desc Rank and slot one re-rolled day, record what it offers as shown, and start writing its benefit sentences.
// @param {object} app - Amplenote app bridge.
// @param {object} options - generateRerolledRange's options for one day: { calendarEvents, claimedSuggestionKeys, day,
//   discardedKeys, domainName, domainUuid, focus, obligationsForDay, openTasks, projectUuids, source, traceSelection }.
// @returns {Promise<object>} The day's result, as generateRerolledRange describes it.
async function _rerolledDay(app, { calendarEvents, claimedSuggestionKeys, day, discardedKeys, domainName, domainUuid, focus,
    obligationsForDay, openTasks, projectUuids, source, traceSelection }) {
  const targetMidnightSeconds = Math.floor(day.getTime() / 1000);
  const rawObligations = await obligationsForDay(day);
  const obligations = (rawObligations || []).map(obligation => ({ ...obligation, targetMidnightSeconds }));
  const projects = await agendaRankingProjects(app, { domainName, domainUuid, targetDate: day }).catch(() => null);
  const excludeIds = _excludedCandidateIds({ claimedSuggestionKeys, discardedKeys, obligations });
  const { outcome, ranking } = await rerolledDayRanking(app, { calendarEvents, domainName, domainUuid, excludeIds,
    candidateSource: source, focusInstruction: focus.instruction, openTasks: _openTasksForDay(openTasks, day),
    priorityProjectUuids: projectUuids, projects, targetDate: day });
  const selectionTrace = traceSelection ? { discardedCount: discardedKeys.size, generator: "ranking", source: "reroll" } : null;
  if (!ranking) {
    if (selectionTrace) Object.assign(selectionTrace, rankingSelectionTrace({ outcome, ranking }));
    return { day, discardedKeys, error: "The re-roll found nothing new to suggest.", errorCode: outcome, obligations,
      selectionTrace, targetMidnightSeconds };
  }
  const { isFutureDay, nowMinutes } = _dayClock(day);
  const slotted = slotRankedTasks(ranking.rankedTasks, { nowMinutes, obligations, targetMidnightSeconds });
  if (selectionTrace) Object.assign(selectionTrace, rankingSelectionTrace({ outcome, ranking, slotted }));
  const reserveTasks = slotted.reserveTasks.map(task => ({ ...task, targetMidnightSeconds }));
  await recordShownTaskSuggestions(app, { domainName, domainUuid, suggestions: slotted.activities, targetDate: day });
  const unexplainedDay = { activities: slotted.activities, fromRanking: true, reserveTasks };
  const benefitRationales = agendaWithBenefitRationales(app, unexplainedDay).catch(error => {
    logIfEnabled(`${ REROLL_RANGE_LOG_LABEL } benefit rationales failed`, error?.message);
    return unexplainedDay;
  });
  logIfEnabled(`${ REROLL_RANGE_LOG_LABEL } day re-rolled`, { dayKey: day.toDateString(), discardedCount: discardedKeys.size,
    offeredCount: slotted.activities.length, reserveCount: reserveTasks.length });
  return { activities: slotted.activities, benefitRationales, day, discardedKeys, domainName, domainUuid, fromRanking: true,
    isFutureDay, obligations, reserveTasks, selectionTrace, targetMidnightSeconds };
}
