// Summarize one past quarter's completed tasks into the facts the Quarter Retrospective shows: Victory Value in total
// and per project, the projects that took the most tasks and scheduled time, the important tasks finished, the work
// that sat outside every project, and how much of the quarter served the intents chosen for it.
import { ledgerEntryKey } from "dashboard/projects/completed-task-project-ledger";
import { isGenuinelyCompleted, millisecondsFromTaskTimestamp } from "plan-wizard/intent-evidence";
import { dateKeyFromDateInput } from "util/date-utility";

export const LEADING_PROJECT_COUNT = 3;
export const LISTED_IMPORTANT_TASK_COUNT = 5;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const TASK_TEXT_CHARACTERS = 90;

// ----------------------------------------------------------------------------------------------
// @desc Compute every retrospective fact for one quarter. A completion is matched to the project the completed task
//   ledger recorded for it on its day; a task the ledger holds with no project counts as outside every project, and
//   one the ledger never classified is counted apart, so it neither helps nor hurts intent alignment.
// @param {object} options - An object with the following properties:
//   - {Array<object>} completedTasks - Tasks from getCompletedTasks for the quarter
//   - {Map<string, Array<object>>} entriesByDate - Completed task ledger entries by date key
//   - {Array<string>} intentTexts - The quarter's chosen intents, highest ranked first
//   - {number} quarter - 1 through 4
//   - {string|null} quarterName - The name the user gave the quarter, if any
//   - {number} year - Calendar year
// @returns {object} An object with the following properties:
//   - {object|null} busiestDay - { dateKey, taskCount, victoryValue } of the day with the most Victory Value
//   - {number} classifiedTaskCount - Completions the ledger sorted into a project or into none
//   - {object} importantTasks - { averageElapsedDays, count, listed }, listed being { elapsedDays, text, victoryValue }
//   - {number|null} intentAlignmentPercent - Share of classified completions that advanced a project, or null
//   - {Array<string>} intentTexts - As given
//   - {object} leaders - { byMinutes, byTaskCount, byVictoryValue }, each the top projects { minutes, name, taskCount,
//     victoryValue }
//   - {number} outsideProjectTaskCount - Completions the ledger recorded as advancing no project
//   - {number} projectTaskCount - Completions that advanced a project
//   - {number} totalMinutes - Scheduled minutes across every completion
//   - {number} totalTaskCount - Completions in the quarter
//   - {number} totalVictoryValue - Victory Value across every completion
//   - {number} unclassifiedTaskCount - Completions the ledger never recorded
export function retrospectiveStatistics({ completedTasks, entriesByDate, intentTexts = [], quarter, quarterName = null, year }) {
  const completions = quarterCompletions({ completedTasks, entriesByDate, quarter, year });
  const projectCompletions = completions.filter(completion => completion.projectUuid);
  const outsideProjectTaskCount = completions.filter(completion => completion.classified && !completion.projectUuid).length;
  const classifiedTaskCount = projectCompletions.length + outsideProjectTaskCount;
  const intentAlignmentPercent = classifiedTaskCount ? Math.round((projectCompletions.length / classifiedTaskCount) * 100) : null;
  return { busiestDay: _busiestDay(completions), classifiedTaskCount, importantTasks: _importantTaskSummary(completions),
    intentAlignmentPercent, intentTexts, leaders: _projectLeaders(projectCompletions), outsideProjectTaskCount,
    projectTaskCount: projectCompletions.length, quarter, quarterName, totalMinutes: _sum(completions, "minutes"),
    totalTaskCount: completions.length, totalVictoryValue: _sum(completions, "victoryValue"),
    unclassifiedTaskCount: completions.length - classifiedTaskCount, year };
}

// ----------------------------------------------------------------------------------------------
// @desc The quarter's genuine completions, each joined to its ledger entry.
// @param {object} options - { completedTasks, entriesByDate, quarter, year }, as retrospectiveStatistics takes them.
// @returns {Array<object>} { classified, completedMillis, createdMillis, dateKey, important, minutes, projectName,
//   projectUuid, text, victoryValue }, one per completion.
export function quarterCompletions({ completedTasks, entriesByDate, quarter, year }) {
  const quarterStart = new Date(year, (quarter - 1) * 3, 1).getTime();
  const quarterEnd = new Date(year, quarter * 3, 1).getTime();
  const entryByCompletion = _entryByCompletion(entriesByDate);
  const genuineTasks = (completedTasks || []).filter(isGenuinelyCompleted);
  const quarterTasks = genuineTasks.filter(task => {
    const completedMillis = millisecondsFromTaskTimestamp(task.completedAt);
    return completedMillis >= quarterStart && completedMillis < quarterEnd;
  });
  const completions = quarterTasks.map(task => {
    const completedMillis = millisecondsFromTaskTimestamp(task.completedAt);
    const dateKey = dateKeyFromDateInput(new Date(completedMillis));
    const entry = task.uuid ? entryByCompletion.get(ledgerEntryKey({ dateKey, taskUuid: task.uuid })) : null;
    const appliedValue = Number.isFinite(entry?.appliedVictoryValue) ? entry.appliedVictoryValue : 0;
    return { classified: !!entry, completedMillis, createdMillis: millisecondsFromTaskTimestamp(task.createdAt), dateKey,
      important: !!task.important, minutes: scheduledMinutes(task), projectName: entry?.projectName || null,
      projectUuid: entry?.projectUuid || null, text: retrospectiveTaskText(task.content || entry?.taskText),
      victoryValue: Math.max(Number(task.victoryValue) || 0, appliedValue) };
  });
  return completions;
}

// ----------------------------------------------------------------------------------------------
// @desc A task's text as one short line: markdown links reduced to their label, emphasis marks dropped, whitespace
//   collapsed, and long text cut short.
// @param {string} content - Task markdown.
// @returns {string} Display text.
export function retrospectiveTaskText(content) {
  const linkless = String(content || "Untitled task").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  const plain = linkless.replace(/[*_`~]+/g, "").replace(/\s+/g, " ").trim() || "Untitled task";
  if (plain.length <= TASK_TEXT_CHARACTERS) return plain;
  return `${ plain.slice(0, TASK_TEXT_CHARACTERS - 1).trimEnd() }…`;
}

// ----------------------------------------------------------------------------------------------
// @desc Minutes a task was scheduled for: its start-to-end span when it has both, otherwise its duration in seconds.
// @param {object} task - Amplenote task.
// @returns {number} Whole minutes, 0 when the task was never given a length.
export function scheduledMinutes(task) {
  const startMillis = millisecondsFromTaskTimestamp(task?.startAt);
  const endMillis = millisecondsFromTaskTimestamp(task?.endAt);
  if (startMillis !== null && endMillis !== null && endMillis > startMillis) return Math.round((endMillis - startMillis) / 60000);
  const durationSeconds = Number(task?.duration);
  return Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.round(durationSeconds / 60) : 0;
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc The day whose completions summed to the most Victory Value.
// @param {Array<object>} completions - From quarterCompletions.
// @returns {object|null} { dateKey, taskCount, victoryValue }, or null without completions.
function _busiestDay(completions) {
  const dayByKey = new Map();
  for (const completion of completions) {
    const day = dayByKey.get(completion.dateKey) || { dateKey: completion.dateKey, taskCount: 0, victoryValue: 0 };
    day.taskCount += 1;
    day.victoryValue += completion.victoryValue;
    dayByKey.set(completion.dateKey, day);
  }
  const days = [...dayByKey.values()];
  const rankedDays = days.sort((first, second) => second.victoryValue - first.victoryValue || second.taskCount - first.taskCount);
  return rankedDays[0] || null;
}

// ----------------------------------------------------------------------------------------------
// @desc Index ledger entries by the completion each records.
// @param {Map<string, Array<object>>|null} entriesByDate - Ledger entries by date key.
// @returns {Map<string, object>} Entry by ledgerEntryKey.
function _entryByCompletion(entriesByDate) {
  const entryByCompletion = new Map();
  for (const [dateKey, entries] of entriesByDate || []) {
    for (const entry of entries || []) {
      if (entry?.taskUuid) entryByCompletion.set(ledgerEntryKey({ dateKey: entry.dateKey || dateKey, taskUuid: entry.taskUuid }), entry);
    }
  }
  return entryByCompletion;
}

// ----------------------------------------------------------------------------------------------
// @desc The important tasks completed, most valuable first, with how long each took from creation to completion.
// @param {Array<object>} completions - From quarterCompletions.
// @returns {object} { averageElapsedDays, count, listed }; averageElapsedDays is null when no task has a creation time.
function _importantTaskSummary(completions) {
  const importantCompletions = completions.filter(completion => completion.important);
  const importantTasks = importantCompletions.map(completion => {
    const elapsedMillis = completion.createdMillis === null ? null : Math.max(0, completion.completedMillis - completion.createdMillis);
    return { elapsedDays: elapsedMillis === null ? null : Math.round(elapsedMillis / MILLISECONDS_PER_DAY), text: completion.text,
      victoryValue: completion.victoryValue };
  });
  const datedTasks = importantTasks.filter(task => task.elapsedDays !== null);
  const averageElapsedDays = datedTasks.length ? Math.round(_sum(datedTasks, "elapsedDays") / datedTasks.length) : null;
  const rankedTasks = [...importantTasks].sort((first, second) => second.victoryValue - first.victoryValue
    || (second.elapsedDays ?? -1) - (first.elapsedDays ?? -1));
  return { averageElapsedDays, count: importantTasks.length, listed: rankedTasks.slice(0, LISTED_IMPORTANT_TASK_COUNT) };
}

// ----------------------------------------------------------------------------------------------
// @desc Total each project's completions, then rank them three ways. A project with no scheduled time is left out
//   of the time ranking, so a quarter without scheduled tasks has none.
// @param {Array<object>} projectCompletions - Completions carrying a projectUuid.
// @returns {object} { byMinutes, byTaskCount, byVictoryValue }, each at most LEADING_PROJECT_COUNT projects.
function _projectLeaders(projectCompletions) {
  const projectByUuid = new Map();
  for (const completion of projectCompletions) {
    const project = projectByUuid.get(completion.projectUuid)
      || { minutes: 0, name: completion.projectName || "Unnamed project", taskCount: 0, victoryValue: 0 };
    project.minutes += completion.minutes;
    project.taskCount += 1;
    project.victoryValue += completion.victoryValue;
    projectByUuid.set(completion.projectUuid, project);
  }
  const projects = [...projectByUuid.values()];
  const rankedBy = field => {
    const countedProjects = projects.filter(project => project[field] > 0);
    const rankedProjects = countedProjects.sort((first, second) => second[field] - first[field]);
    return rankedProjects.slice(0, LEADING_PROJECT_COUNT);
  };
  return { byMinutes: rankedBy("minutes"), byTaskCount: rankedBy("taskCount"), byVictoryValue: rankedBy("victoryValue") };
}

// ----------------------------------------------------------------------------------------------
function _sum(records, field) {
  return records.reduce((total, record) => total + (Number(record[field]) || 0), 0);
}
