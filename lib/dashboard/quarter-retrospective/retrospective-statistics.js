// Summarize one past quarter's completed tasks into the facts the Quarter Retrospective shows: Victory Value in total
// and per project, the projects that took the most tasks and scheduled time, the important tasks finished, the work
// that sat outside every project, how much of the quarter served the intents chosen for it, each project's done and
// still-open tasks, the quarter's rhythm by month and streak, its meeting time when the calendar was recorded, the
// blocks of the progress heap, one per completion, and how its totals changed from the quarter before.
import { ledgerEntryKey } from "dashboard/projects/completed-task-project-ledger";
import { meetingMinutesByCategory } from "dashboard/quarter-retrospective/retrospective-calendar-categories";
import { isGenuinelyCompleted, millisecondsFromTaskTimestamp } from "plan-wizard/intent-evidence";
import { dateKeyFromDateInput } from "util/date-utility";

// The length a task with no span or duration is counted as, so time rankings reflect tasks nobody sized.
export const DEFAULT_TASK_MINUTES = 60;
export const LEADING_PROJECT_COUNT = 3;
export const LISTED_IMPORTANT_TASK_COUNT = 5;
// The heap colors its five busiest projects apart, and every other project shares the sixth color.
export const HEAP_PROJECT_SLOT_COUNT = 6;
export const HEAP_OTHER_PROJECTS_LABEL = "Other projects";
// Blocks above these shares of the quarter's Victory Values are drawn larger.
const HEAP_MEDIUM_QUANTILE = 0.5;
const HEAP_LARGE_QUANTILE = 0.85;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const TASK_TEXT_CHARACTERS = 90;

// ----------------------------------------------------------------------------------------------
// @desc Compute every retrospective fact for one quarter. A completion is matched to the project the completed task
//   ledger recorded for it on its day; a task the ledger holds with no project counts as outside every project, and
//   one the ledger never classified is counted apart, so it neither helps nor hurts intent alignment. A task with no
//   length is counted as DEFAULT_TASK_MINUTES.
// @param {object} options - An object with the following properties:
//   - {object|null} [calendarCoverage] - { coveredDays, totalDays } of the calendar journal over the quarter
//   - {Map<string, object>|null} [calendarDays] - Calendar journal days for the quarter, or null when not included
//   - {Array<object>} completedTasks - Tasks from getCompletedTasks for the quarter
//   - {Map<string, Array<object>>} entriesByDate - Completed task ledger entries by date key
//   - {Array<object>|null} [inferredProjects] - Projects inferred from the months' themes, each { name, taskUuids,
//     uuid }; when given, completions the ledger put in no project are credited to them for the project rankings
//   - {Array<string>} intentTexts - The quarter's chosen intents, highest ranked first
//   - {Map<string, number>|null} [openCountByProject] - Tasks still open at quarter end by project UUID, when known
//   - {object|null} [previousQuarterTotals] - The quarter before's totals, as quarterTotals returns them, when read
//   - {Array<object>} [projects] - The quarter's projects as { name, uuid }, so a project with open tasks but no
//     completions is still listed
//   - {number} quarter - 1 through 4
//   - {string|null} quarterName - The name the user gave the quarter, if any
//   - {number} year - Calendar year
// @returns {object} An object with the following properties:
//   - {object|null} busiestDay - { dateKey, taskCount, victoryValue } of the day with the most Victory Value
//   - {object|null} calendarCoverage - As given
//   - {number} classifiedTaskCount - Completions the ledger sorted into a project or into none
//   - {number} defaultedDurationCount - Completions with no length, counted as DEFAULT_TASK_MINUTES
//   - {Array<object>} doneAndOpenByProject - { doneCount, name, openCount, projectUuid } per project, most done first;
//     openCount is null when open tasks weren't counted
//   - {object|null} firstAndLastCompletion - { first, last }, each { dateKey, text }, or null without completions
//   - {object} importantTasks - { averageElapsedDays, count, listed }, listed being { elapsedDays, text, victoryValue }
//   - {number|null} intentAlignmentPercent - Share of classified completions that advanced a project, or null
//   - {Array<string>} intentTexts - As given
//   - {object} leaders - { byMinutes, byTaskCount, byVictoryValue }, each the top projects { minutes, name, taskCount,
//     victoryValue }
//   - {object|null} longestStreak - { days, endDateKey, startDateKey } of the most consecutive days with a completion
//   - {Array<object>|null} meetingMinutesByCategory - { category, eventCount, minutes }, or null without calendar days
//   - {Array<number>} monthlyTaskCounts - Completions in each of the quarter's three months
//   - {object} progressHeap - { blocks, legend }: blocks are [slot, size] per completion, oldest first, slot being the
//     project's color (1–6, or 0 for no project) and size 1–3 by Victory Value; legend is { label, slot, taskCount }
//     per color drawn, most tasks first
//   - {number} outsideProjectTaskCount - Completions the ledger recorded as advancing no project
//   - {number} projectTaskCount - Completions that advanced a project
//   - {boolean} projectsInferred - Whether the project rankings come from projects inferred from the months' themes
//   - {object|null} quarterOverQuarter - How the totals changed from the quarter before, as _quarterOverQuarter
//     describes, or null when that quarter wasn't read or completed nothing
//   - {number} totalMinutes - Scheduled minutes across every completion
//   - {number} totalTaskCount - Completions in the quarter
//   - {number} totalVictoryValue - Victory Value across every completion
//   - {number} unclassifiedTaskCount - Completions the ledger never recorded
export function retrospectiveStatistics({ calendarCoverage = null, calendarDays = null, completedTasks, entriesByDate, inferredProjects = null,
    intentTexts = [], openCountByProject = null, previousQuarterTotals = null, projects = [], quarter, quarterName = null, year }) {
  const completions = quarterCompletions({ completedTasks, entriesByDate, quarter, year });
  const projectCompletions = completions.filter(completion => completion.projectUuid);
  const outsideProjectTaskCount = completions.filter(completion => completion.classified && !completion.projectUuid).length;
  const classifiedTaskCount = projectCompletions.length + outsideProjectTaskCount;
  const intentAlignmentPercent = classifiedTaskCount ? Math.round((projectCompletions.length / classifiedTaskCount) * 100) : null;
  const projectsInferred = !!inferredProjects?.length;
  const creditedCompletions = projectsInferred ? _completionsWithInferredProjects(completions, inferredProjects) : completions;
  const rankedCompletions = creditedCompletions.filter(completion => completion.projectUuid);
  const rankedProjects = projectsInferred ? inferredProjects : projects;
  const doneAndOpenByProject = _doneAndOpenByProject(rankedCompletions, { openCountByProject, projects: rankedProjects });
  const totalTaskCount = completions.length;
  const totalVictoryValue = _sum(completions, "victoryValue");
  const quarterOverQuarter = _quarterOverQuarter(previousQuarterTotals, { totalTaskCount, totalVictoryValue });
  return { busiestDay: _busiestDay(completions), calendarCoverage, classifiedTaskCount,
    defaultedDurationCount: completions.filter(completion => completion.durationDefaulted).length, doneAndOpenByProject,
    firstAndLastCompletion: _firstAndLastCompletion(completions), importantTasks: _importantTaskSummary(completions),
    intentAlignmentPercent, intentTexts, leaders: _projectLeaders(rankedCompletions), longestStreak: _longestStreak(completions),
    meetingMinutesByCategory: calendarDays ? meetingMinutesByCategory(calendarDays) : null,
    monthlyTaskCounts: _monthlyTaskCounts(completions, quarter), outsideProjectTaskCount, progressHeap: _progressHeap(creditedCompletions),
    projectTaskCount: projectCompletions.length, projectsInferred, quarter, quarterName, quarterOverQuarter, totalMinutes: _sum(completions, "minutes"),
    totalTaskCount, totalVictoryValue, unclassifiedTaskCount: completions.length - classifiedTaskCount, year };
}

// ----------------------------------------------------------------------------------------------
// @desc The quarter's genuine completions, each joined to its ledger entry.
// @param {object} options - { completedTasks, entriesByDate, quarter, year }, as retrospectiveStatistics takes them.
// @returns {Array<object>} { classified, completedMillis, createdMillis, dateKey, durationDefaulted, important, minutes,
//   noteUuid, projectName, projectUuid, taskUuid, text, victoryValue }, one per completion; minutes is
//   DEFAULT_TASK_MINUTES when durationDefaulted.
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
    const minutes = scheduledMinutes(task);
    return { classified: !!entry, completedMillis, createdMillis: millisecondsFromTaskTimestamp(task.createdAt), dateKey,
      durationDefaulted: !minutes, important: !!task.important, minutes: minutes || DEFAULT_TASK_MINUTES, noteUuid: task.noteUUID || null,
      projectName: entry?.projectName || null, projectUuid: entry?.projectUuid || null, taskUuid: task.uuid || null,
      text: retrospectiveTaskText(task.content || entry?.taskText), victoryValue: Math.max(Number(task.victoryValue) || 0, appliedValue) };
  });
  return completions;
}

// ----------------------------------------------------------------------------------------------
// @desc A quarter's completed task count and Victory Value, counted the way retrospectiveStatistics counts them, so a
//   later quarter can be compared with it.
// @param {object} options - { completedTasks, entriesByDate, quarter, year }, as quarterCompletions takes them.
// @returns {object} { quarter, totalTaskCount, totalVictoryValue, year }.
export function quarterTotals({ completedTasks, entriesByDate, quarter, year }) {
  const completions = quarterCompletions({ completedTasks, entriesByDate, quarter, year });
  return { quarter, totalTaskCount: completions.length, totalVictoryValue: _sum(completions, "victoryValue"), year };
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
// @desc Credit completions to inferred projects: one the ledger put in a project keeps it, and the rest take the
//   inferred project holding their task.
// @param {Array<object>} completions - From quarterCompletions.
// @param {Array<object>} inferredProjects - { name, taskUuids, uuid } per inferred project.
// @returns {Array<object>} Every completion, those credited to a project carrying its projectName and projectUuid.
function _completionsWithInferredProjects(completions, inferredProjects) {
  const projectByTaskUuid = new Map();
  for (const project of inferredProjects) {
    for (const taskUuid of project.taskUuids || []) projectByTaskUuid.set(taskUuid, project);
  }
  const credited = completions.map(completion => {
    if (completion.projectUuid) return completion;
    const project = projectByTaskUuid.get(completion.taskUuid);
    return project ? { ...completion, projectName: project.name, projectUuid: project.uuid } : completion;
  });
  return credited;
}

// ----------------------------------------------------------------------------------------------
// @desc Each project's completions beside the tasks it still had open when the quarter ended. Projects are those that
//   completed something, plus those given, so a project that stalled still appears with nothing done.
// @param {Array<object>} projectCompletions - Completions carrying a projectUuid.
// @param {object} options - { openCountByProject, projects }, as retrospectiveStatistics takes them.
// @returns {Array<object>} { doneCount, name, openCount, projectUuid }, most done first, then most open.
function _doneAndOpenByProject(projectCompletions, { openCountByProject, projects }) {
  const projectByUuid = new Map();
  for (const project of projects || []) {
    projectByUuid.set(project.uuid, { doneCount: 0, name: project.name, openCount: null, projectUuid: project.uuid });
  }
  for (const completion of projectCompletions) {
    const project = projectByUuid.get(completion.projectUuid)
      || { doneCount: 0, name: completion.projectName || "Unnamed project", openCount: null, projectUuid: completion.projectUuid };
    project.doneCount += 1;
    projectByUuid.set(completion.projectUuid, project);
  }
  for (const project of projectByUuid.values()) {
    if (openCountByProject?.has(project.projectUuid)) project.openCount = openCountByProject.get(project.projectUuid);
  }
  const projectsWithTasks = [...projectByUuid.values()].filter(project => project.doneCount || project.openCount);
  const rankedProjects = projectsWithTasks.sort((first, second) => second.doneCount - first.doneCount
    || (second.openCount || 0) - (first.openCount || 0));
  return rankedProjects;
}

// ----------------------------------------------------------------------------------------------
// @desc The quarter's first and last completions.
// @param {Array<object>} completions - From quarterCompletions.
// @returns {object|null} { first, last }, each { dateKey, text }, or null without completions.
function _firstAndLastCompletion(completions) {
  if (!completions.length) return null;
  const chronological = [...completions].sort((first, second) => first.completedMillis - second.completedMillis);
  const describe = completion => ({ dateKey: completion.dateKey, text: completion.text });
  return { first: describe(chronological[0]), last: describe(chronological[chronological.length - 1]) };
}

// ----------------------------------------------------------------------------------------------
// @desc The most consecutive days that each had at least one completion. A tie goes to the earlier run.
// @param {Array<object>} completions - From quarterCompletions.
// @returns {object|null} { days, endDateKey, startDateKey }, or null without completions.
function _longestStreak(completions) {
  const dateKeys = [...new Set(completions.map(completion => completion.dateKey))].sort();
  let longest = null;
  let runStart = null;
  let previousDay = null;
  for (const dateKey of dateKeys) {
    const day = new Date(`${ dateKey }T12:00:00`);
    const continues = previousDay && Math.round((day.getTime() - previousDay.getTime()) / MILLISECONDS_PER_DAY) === 1;
    if (!continues) runStart = dateKey;
    const days = Math.round((day.getTime() - new Date(`${ runStart }T12:00:00`).getTime()) / MILLISECONDS_PER_DAY) + 1;
    if (!longest || days > longest.days) longest = { days, endDateKey: dateKey, startDateKey: runStart };
    previousDay = day;
  }
  return longest;
}

// ----------------------------------------------------------------------------------------------
// @desc How many completions fell in each month of the quarter.
// @param {Array<object>} completions - From quarterCompletions.
// @param {number} quarter - 1 through 4.
// @returns {Array<number>} Three counts, the quarter's first month first.
function _monthlyTaskCounts(completions, quarter) {
  const counts = [0, 0, 0];
  for (const completion of completions) {
    const monthIndex = Number(completion.dateKey.slice(5, 7)) - 1 - (quarter - 1) * 3;
    if (monthIndex >= 0 && monthIndex < 3) counts[monthIndex] += 1;
  }
  return counts;
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
// @desc One heap block per completion, oldest first. The projects with the most completions take the first five colors
//   and the rest share the sixth, unless only six projects completed anything. A block's size comes from where its
//   Victory Value falls among the quarter's: above the median it is medium, above the 85th percentile large.
// @param {Array<object>} completions - Every completion, credited to its project where it has one.
// @returns {object} { blocks, legend }, as retrospectiveStatistics describes progressHeap.
function _progressHeap(completions) {
  const taskCountByProject = new Map();
  for (const completion of completions) {
    if (!completion.projectUuid) continue;
    const counted = taskCountByProject.get(completion.projectUuid) || { name: completion.projectName || "Unnamed project", taskCount: 0 };
    counted.taskCount += 1;
    taskCountByProject.set(completion.projectUuid, counted);
  }
  const rankedProjects = [...taskCountByProject].sort(([, first], [, second]) => second.taskCount - first.taskCount);
  const overflowing = rankedProjects.length > HEAP_PROJECT_SLOT_COUNT;
  const slotByProject = new Map(rankedProjects.map(([projectUuid], index) => [projectUuid, Math.min(index + 1, HEAP_PROJECT_SLOT_COUNT)]));
  const legendBySlot = new Map();
  for (const [projectUuid, counted] of rankedProjects) {
    const slot = slotByProject.get(projectUuid);
    const label = overflowing && slot === HEAP_PROJECT_SLOT_COUNT ? HEAP_OTHER_PROJECTS_LABEL : counted.name;
    const entry = legendBySlot.get(slot) || { label, slot, taskCount: 0 };
    entry.taskCount += counted.taskCount;
    legendBySlot.set(slot, entry);
  }
  const sortedValues = completions.map(completion => completion.victoryValue).sort((first, second) => first - second);
  const quantileValue = share => sortedValues[Math.floor((sortedValues.length - 1) * share)] || 0;
  const mediumAbove = quantileValue(HEAP_MEDIUM_QUANTILE);
  const largeAbove = quantileValue(HEAP_LARGE_QUANTILE);
  const chronological = [...completions].sort((first, second) => first.completedMillis - second.completedMillis);
  const blocks = chronological.map(completion => {
    const size = completion.victoryValue > largeAbove ? 3 : completion.victoryValue > mediumAbove ? 2 : 1;
    return [slotByProject.get(completion.projectUuid) || 0, size];
  });
  return { blocks, legend: [...legendBySlot.values()] };
}

// ----------------------------------------------------------------------------------------------
// @desc Total each project's completions, then rank them three ways. Every completion counts some time, at least
//   DEFAULT_TASK_MINUTES, so every project that completed something appears in the time ranking.
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
// @desc How the quarter's totals changed from the quarter before's. A total the quarter before had none of has no
//   change, since growth from nothing is no measure of anything.
// @param {object|null} previousQuarterTotals - From quarterTotals, for the quarter before.
// @param {object} currentTotals - { totalTaskCount, totalVictoryValue } of this quarter.
// @returns {object|null} { previousQuarter, previousTaskCount, previousVictoryValue, taskCountChangePercent,
//   victoryValueChangePercent }, previousQuarter being { quarter, year } and each change a whole percent, negative when
//   lower, or null when the quarter before had none of that total; null when neither total can be compared.
function _quarterOverQuarter(previousQuarterTotals, { totalTaskCount, totalVictoryValue }) {
  if (!previousQuarterTotals) return null;
  const changePercent = (current, previous) => (previous > 0 ? Math.round(((current - previous) / previous) * 100) : null);
  const taskCountChangePercent = changePercent(totalTaskCount, previousQuarterTotals.totalTaskCount);
  const victoryValueChangePercent = changePercent(totalVictoryValue, previousQuarterTotals.totalVictoryValue);
  if (taskCountChangePercent === null && victoryValueChangePercent === null) return null;
  return { previousQuarter: { quarter: previousQuarterTotals.quarter, year: previousQuarterTotals.year },
    previousTaskCount: previousQuarterTotals.totalTaskCount, previousVictoryValue: previousQuarterTotals.totalVictoryValue, taskCountChangePercent,
    victoryValueChangePercent };
}

// ----------------------------------------------------------------------------------------------
function _sum(records, field) {
  return records.reduce((total, record) => total + (Number(record[field]) || 0), 0);
}
