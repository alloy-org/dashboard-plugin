// Summarizes a Task Domain's tasks into what the dashboard's task widgets render: today's scheduled tasks, this week's
// completions, and the week's Victory Value in total and per weekday.
import { millisFromDateInput, weekStartFromDateInput } from "util/date-utility";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ----------------------------------------------------------------------------------------------
// @desc Shape tasks into the dashboard's task payload. The dashboard load, a Task Domain switch, and the dev app
//   all return this shape, so the Agenda, Calendar, and Victory Value widgets can take any of them.
// @param {Date} now - The moment "today" and "this week" are measured from
// @param {Array<Object>} tasks - Tasks with startAt/completedAt timestamps in seconds or milliseconds
// @returns {Object} An object with the following properties:
//   - {Array<Object>} completedThisWeek - Tasks completed between Monday's midnight and the next Monday's
//   - {Array<Object>} dailyVictoryValues - One { date, day, taskCount, value } per weekday, Monday first
//   - {Array<Object>} tasks - The tasks passed in
//   - {Array<Object>} todayTasks - Open, undismissed tasks starting today, earliest first
//   - {number} weeklyVictoryValue - Victory Value summed over completedThisWeek
export function taskSummaryFromTasks(now, tasks) {
  const weekStart = weekStartFromDateInput(now);
  const dayStarts = Array.from({ length: WEEKDAY_LABELS.length + 1 }, (_, dayIndex) => _dayStartFromWeekStart(dayIndex, weekStart));
  const completedThisWeek = _tasksCompletedBetween(dayStarts[WEEKDAY_LABELS.length], dayStarts[0], tasks);
  const dailyVictoryValues = WEEKDAY_LABELS.map((day, dayIndex) => {
    const dayTasks = _tasksCompletedBetween(dayStarts[dayIndex + 1], dayStarts[dayIndex], completedThisWeek);
    return { date: dayStarts[dayIndex].toISOString(), day, taskCount: dayTasks.length, value: _victoryValueSum(dayTasks) };
  });
  return { completedThisWeek, dailyVictoryValues, tasks, todayTasks: _todayTasks(now, tasks),
    weeklyVictoryValue: _victoryValueSum(completedThisWeek) };
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Local midnight `dayIndex` days after weekStart. Stepping by calendar day rather than by 24 hours keeps
//   each boundary on midnight across a daylight-saving change.
// @returns {Date}
function _dayStartFromWeekStart(dayIndex, weekStart) {
  const dayStart = new Date(weekStart);
  dayStart.setDate(dayStart.getDate() + dayIndex);
  return dayStart;
}

// ----------------------------------------------------------------------------------------------
// @desc Tasks completed in [rangeStart, rangeEnd).
// @param {Date} rangeEnd - Exclusive end
// @param {Date} rangeStart - Inclusive start
// @param {Array<Object>} tasks
// @returns {Array<Object>}
function _tasksCompletedBetween(rangeEnd, rangeStart, tasks) {
  return tasks.filter(task => {
    const completedMillis = millisFromDateInput(task.completedAt);
    return !!completedMillis && completedMillis >= rangeStart.getTime() && completedMillis < rangeEnd.getTime();
  });
}

// ----------------------------------------------------------------------------------------------
// @desc Open, undismissed tasks whose start falls on now's local calendar day, earliest first.
// @returns {Array<Object>}
function _todayTasks(now, tasks) {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = _dayStartFromWeekStart(1, dayStart);
  const startingToday = tasks.filter(task => {
    const startMillis = millisFromDateInput(task.startAt);
    return !task.completedAt && !task.dismissedAt && !!startMillis && startMillis >= dayStart.getTime() && startMillis < dayEnd.getTime();
  });
  const sortedByStart = startingToday.sort((taskA, taskB) => millisFromDateInput(taskA.startAt) - millisFromDateInput(taskB.startAt));
  return sortedByStart;
}

// ----------------------------------------------------------------------------------------------
function _victoryValueSum(tasks) {
  return tasks.reduce((sum, task) => sum + (task.victoryValue || 0), 0);
}
