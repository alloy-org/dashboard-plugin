// Build today's project-nested task list and rank it with Jev, or with the generative model when Jev is
// unavailable. Dream task keeps two tasks that have not been suggested in the past three days. The agenda and
// the calendar suggestion action keep the best fifteen and slot them onto free hours. Showing a task records
// its UUID on that project's section of the project task store. A null result means neither ranker could
// answer, and the caller keeps its existing generator.
import { dayProjectGroups } from "day-project-candidates";
import { resolvePlanScope } from "plan-wizard/plan-models";
import { readVisionGuide } from "plan-wizard/vision-guide-repository";
import { quarterlyProgressProjects } from "project-progress-model";
import { readCollectedProjectTasks, recordProjectTaskSuggestions } from "project-task-store";
import QuarterProject from "quarter-project";
import { rankDayTasks } from "suggestion-task-rank";
import { DREAM_SUGGESTION_COUNT, refillRejectedSuggestion, slotRankedTasks,
  tasksNotRecentlySuggested } from "suggestion-task-slots";
import { logIfEnabled } from "util/log";

const SUGGESTION_LOG_LABEL = "[ranked-task-suggestions]";

// ----------------------------------------------------------------------------------------------
// @desc Rank tasks for the proposed agenda and place the best fits on free hours.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { domainName, domainUuid, nowMinutes, obligations, openTasks, projects, targetDate }.
// @returns {Promise<object|null>} { activities, rankerEm, reserveTasks } or null when no ranker is available.
export async function agendaSuggestionsFromProjects(app, { domainName, domainUuid, nowMinutes = null, obligations = [],
    openTasks = null, projects = null, targetDate }) {
  const ranking = await _rankingForDay(app, { domainName, domainUuid, now: targetDate, openTasks, projects, targetDate });
  if (!ranking) return null;
  const targetMidnightSeconds = Math.floor(targetDate.getTime() / 1000);
  const slotted = slotRankedTasks(ranking.rankedTasks, { nowMinutes, obligations, targetMidnightSeconds });
  const reserveTasks = slotted.reserveTasks.map(task => ({ ...task, targetMidnightSeconds }));
  await _recordShown(app, ranking.scope, slotted.activities, targetDate);
  logIfEnabled(`${ SUGGESTION_LOG_LABEL } agenda`, { placed: slotted.activities.length, rankerEm: ranking.rankerEm,
    reserves: reserveTasks.length });
  return { activities: slotted.activities, rankerEm: ranking.rankerEm, reserveTasks };
}

// ----------------------------------------------------------------------------------------------
// @desc Rank tasks for Goal Coach. Two tasks that were not suggested in the past three days are returned, and
//   the rest of that fresh list is held so a rejection can show the next one.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { domainName, domainUuid, excludeUuids, now, openTasks }.
// @returns {Promise<object|null>} { rankerEm, reserveTasks, scope, tasks } or null.
export async function dreamSuggestionsFromProjects(app, { domainName, domainUuid, excludeUuids = null, now, openTasks }) {
  const ranking = await _rankingForDay(app, { domainName, domainUuid, excludeUuids, now, openTasks, targetDate: now });
  if (!ranking) return null;
  const fresh = tasksNotRecentlySuggested(ranking.rankedTasks);
  const tasks = fresh.slice(0, DREAM_SUGGESTION_COUNT).map((task, index) => _dreamTask(task, 10 - index));
  if (!tasks.length) return null;
  const reserveTasks = fresh.slice(DREAM_SUGGESTION_COUNT).map((task, index) => _dreamTask(task, Math.max(1, 8 - index)));
  logIfEnabled(`${ SUGGESTION_LOG_LABEL } dream tasks`, { rankerEm: ranking.rankerEm, reserves: reserveTasks.length,
    shown: tasks.length });
  return { rankerEm: ranking.rankerEm, reserveTasks, scope: ranking.scope, tasks };
}

// ----------------------------------------------------------------------------------------------
// @desc Record tasks that were just shown, including one promoted after a rejection.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { domainName, domainUuid, suggestions, targetDate }. suggestions carry projectUuid
//   and taskUuid or uuid.
// @returns {Promise<void>}
export async function recordShownTaskSuggestions(app, { domainName, domainUuid, suggestions, targetDate }) {
  const shownAt = targetDate || new Date();
  await _recordShown(app, _scopeFor(domainName, domainUuid, shownAt), suggestions, shownAt);
}

// ----------------------------------------------------------------------------------------------
// @desc Record one task that replaced a rejected suggestion, and return the agenda rows with that task placed.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - Refill inputs plus { domainName, domainUuid, targetDate }.
// @returns {Promise<object>} The refillRejectedSuggestion result. The placement is recorded when one was made.
export async function refillAndRecordSuggestion(app, { activities, domainName, domainUuid, nowMinutes, obligations,
    preferredStartMinutes, reserveTasks, targetDate, targetMidnightSeconds }) {
  const refill = refillRejectedSuggestion({ activities, nowMinutes, obligations, preferredStartMinutes, reserveTasks,
    targetMidnightSeconds });
  if (refill.placed) await _recordShown(app, _scopeFor(domainName, domainUuid, targetDate), [refill.placed], targetDate);
  return refill;
}

// ----------------------------------------------------------------------------------------------
// @desc A Goal Coach card for one ranked task. Rating follows list order so the widget's sort keeps it.
// @param {object} task - Ranked task.
// @param {number} rating - Display rating from 1 to 10.
// @returns {object} Dream-task suggestion.
function _dreamTask(task, rating) {
  return { explanation: task.rationale, isExisting: true, projectUuid: task.projectUuid, rating,
    title: task.taskText, uuid: task.taskUuid };
}

// ----------------------------------------------------------------------------------------------
// @desc Load the quarter's projects and their stored tasks, then rank the ones that qualify today.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { domainName, domainUuid, excludeUuids, now, openTasks, projects, targetDate }.
// @returns {Promise<object|null>} { rankerEm, rankedTasks, scope } or null.
async function _rankingForDay(app, { domainName, domainUuid, excludeUuids = null, now, openTasks, projects, targetDate }) {
  const scope = _scopeFor(domainName, domainUuid, targetDate);
  const storedRecords = await readCollectedProjectTasks(app, scope).catch(error => {
    logIfEnabled(`${ SUGGESTION_LOG_LABEL } project task store unavailable`, error?.message);
    return [];
  });
  const sourceProjects = projects || await _projectsFromGuide(app, scope, storedRecords);
  const evidencedProjects = sourceProjects.map(project => QuarterProject.from(project));
  for (const project of evidencedProjects) project.setProgressEvidence(targetDate);
  const groups = dayProjectGroups({ excludeUuids, now: targetDate, openTasks, projects: evidencedProjects, storedRecords });
  if (!groups.length) return null;
  const ranking = await rankDayTasks(app, groups);
  if (!ranking?.rankedTasks?.length) return null;
  return { ...ranking, scope };
}

// ----------------------------------------------------------------------------------------------
// @desc Read live projects from the vision guide, tolerating a missing or unreadable guide.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} scope - Resolved plan scope.
// @param {Array<object>} storedRecords - Store records used as previous project state.
// @returns {Promise<Array<object>>} Projects quarterlyProgressProjects knows about.
async function _projectsFromGuide(app, scope, storedRecords) {
  let guide = null;
  try {
    guide = await readVisionGuide(app, scope);
  } catch (error) {
    logIfEnabled(`${ SUGGESTION_LOG_LABEL } vision guide unavailable`, error?.message);
  }
  return quarterlyProgressProjects({ guide, previousProjects: storedRecords, quarterlyContent: "", scope });
}

// ----------------------------------------------------------------------------------------------
// @desc Append the shown task UUIDs to each project's suggestion log. A write failure does not drop the suggestion.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} scope - Resolved plan scope.
// @param {Array<object>} shown - Tasks or activities just returned to the user.
// @param {Date} targetDate - When they were shown.
// @returns {Promise<void>}
async function _recordShown(app, scope, shown, targetDate) {
  const suggestions = (shown || []).filter(item => item.projectUuid && (item.taskUuid || item.uuid)).map(item => ({
    projectUuid: item.projectUuid, summary: item.summary || null, taskUuid: item.taskUuid || item.uuid }));
  if (!suggestions.length) return;
  try {
    await recordProjectTaskSuggestions(app, { scope, suggestedAt: targetDate.toISOString(), suggestions });
  } catch (error) {
    logIfEnabled(`${ SUGGESTION_LOG_LABEL } could not record suggestions`, error?.message);
  }
}

// ----------------------------------------------------------------------------------------------
// @desc The quarter that contains the day being planned, for the caller's task domain.
// @param {string|null} domainName - Task domain name.
// @param {string|null} domainUuid - Task domain UUID.
// @param {Date} targetDate - The day being planned.
// @returns {object} Resolved plan scope.
function _scopeFor(domainName, domainUuid, targetDate) {
  return resolvePlanScope({ date: targetDate, domainName: domainUuid ? domainName : (domainName || "All Notes"),
    domainUuid: domainUuid || null, quarter: Math.floor(targetDate.getMonth() / 3) + 1, year: targetDate.getFullYear() });
}
