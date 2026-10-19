// Plan the days of a user-requested re-roll, one at a time, in the shape generateProposedAgendaRange gives each day, so
// the calendar suggest action publishes them the same way. Each day is ranked afresh under the focus and projects the
// user chose, leaving out the suggestions the re-roll discards, the tasks already on the calendar, and those an earlier
// day of the range holds; the best fits are slotted onto the day's free hours. Nothing is stored as the day's agenda,
// since the ranking answers a preference held only for the moment; what the user is shown is still recorded as shown.
import { agendaRankingProjects } from "dashboard/proposed-agenda/proposed-agenda-service";
import { rankingSelectionTrace } from "dashboard/suggestions/calendar-generation-report";
import { agendaWithBenefitRationales } from "dashboard/suggestions/calendar-suggestion-explanation";
import { recordShownTaskSuggestions, rerolledDayRanking } from "dashboard/suggestions/ranked-task-suggestions";
import { suggestionIdentityKey } from "dashboard/suggestions/suggestion-staleness";
import { slotRankedTasks } from "dashboard/suggestions/suggestion-task-slots";
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
//   - {boolean} [traceSelection=false] - Give each day a selectionTrace for the calendar generation report
// @returns {Promise<Array<object>>} One result per day: { activities, benefitRationales, day, discardedKeys,
//   domainName, domainUuid, fromRanking, isFutureDay, obligations, reserveTasks, selectionTrace?,
//   targetMidnightSeconds }, or { day, error, errorCode, obligations, targetMidnightSeconds } for a day with nothing to
//   offer. benefitRationales resolves to the day with benefit sentences and never rejects.
export async function generateRerolledRange(app, { calendarEvents = null, claimedSuggestionKeys, days, discardedKeysByDay,
    domainName, domainUuid, focus, obligationsForDay, onDayComplete = null, projectUuids, traceSelection = false }) {
  const openTasks = await _openTasks(app, domainUuid);
  const dayResults = [];
  for (const day of days) {
    const dayResult = await _rerolledDay(app, { calendarEvents, claimedSuggestionKeys, day,
      discardedKeys: new Set(discardedKeysByDay[day.toDateString()] || []), domainName, domainUuid, focus, obligationsForDay,
      openTasks, projectUuids, traceSelection });
    const daySuggestionKeys = (dayResult.activities || []).map(suggestionIdentityKey).filter(Boolean);
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
// @desc Rank and slot one re-rolled day, record what it offers as shown, and start writing its benefit sentences.
// @param {object} app - Amplenote app bridge.
// @param {object} options - generateRerolledRange's options for one day: { calendarEvents, claimedSuggestionKeys, day,
//   discardedKeys, domainName, domainUuid, focus, obligationsForDay, openTasks, projectUuids, traceSelection }.
// @returns {Promise<object>} The day's result, as generateRerolledRange describes it.
async function _rerolledDay(app, { calendarEvents, claimedSuggestionKeys, day, discardedKeys, domainName, domainUuid, focus,
    obligationsForDay, openTasks, projectUuids, traceSelection }) {
  const targetMidnightSeconds = Math.floor(day.getTime() / 1000);
  const rawObligations = await obligationsForDay(day);
  const obligations = (rawObligations || []).map(obligation => ({ ...obligation, targetMidnightSeconds }));
  const projects = await agendaRankingProjects(app, { domainName, domainUuid, targetDate: day }).catch(() => null);
  const excludeIds = _excludedCandidateIds({ claimedSuggestionKeys, discardedKeys, obligations });
  const { outcome, ranking } = await rerolledDayRanking(app, { calendarEvents, domainName, domainUuid, excludeIds,
    focusInstruction: focus.instruction, openTasks: _openTasksForDay(openTasks, day), priorityProjectUuids: projectUuids,
    projects, targetDate: day });
  const selectionTrace = traceSelection ? { discardedCount: discardedKeys.size, generator: "ranking", source: "reroll" } : null;
  if (!ranking) {
    if (selectionTrace) Object.assign(selectionTrace, rankingSelectionTrace({ outcome, ranking }));
    return { day, discardedKeys, error: "The re-roll found nothing new to suggest.", errorCode: outcome, obligations,
      selectionTrace, targetMidnightSeconds };
  }
  const isFutureDay = day.getTime() > localMidnightFromDateInput(new Date()).getTime();
  const clock = new Date();
  const nowMinutes = isFutureDay ? null : clock.getHours() * MINUTES_PER_HOUR + clock.getMinutes();
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
