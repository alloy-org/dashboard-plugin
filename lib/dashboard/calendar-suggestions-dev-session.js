// Run Amplenote's suggestScheduledTasks calendar action against the browser dev app, the way the host calls it in
// production, and shape what the action publishes through context.setScheduledTasks into one list per date. The dev
// Calendar Suggestions page renders these lists, along with the report note the pass writes on how it chose them;
// nothing here touches React or the DOM.
import { MAX_SUGGESTION_DAYS, suggestScheduledTasksFromDashboard } from "dashboard/proposed-agenda/proposed-agenda-suggest-action";
import { proposedAgendaDaysInRange } from "dashboard/proposed-agenda/proposed-agenda-range";
import { isCalendarGenerationReportName } from "dashboard/suggestions/calendar-generation-report";

// The calendar views the page can request suggestions for, each starting today.
export const CALENDAR_SUGGESTION_RANGES = Object.freeze([
  Object.freeze({ dayCount: 1, key: "oneDay", label: "One day" }),
  Object.freeze({ dayCount: 3, key: "threeDay", label: "3 day" }),
  Object.freeze({ dayCount: 7, key: "oneWeek", label: "One week" }),
]);

const SECONDS_PER_DAY = 86400;

// ----------------------------------------------------------------------------------------------
// @desc Local midnight of the given time, as a Date.
// @param {Date} date - Any time on the wanted day.
// @returns {Date} That day's local midnight.
function _localMidnight(date) {
  const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return midnight;
}

// ----------------------------------------------------------------------------------------------
// @desc Render a unix-seconds time as local hours and minutes.
// @param {number} seconds - Unix seconds.
// @returns {string} e.g. "09:30".
function _localClockFromSeconds(seconds) {
  const clock = new Date(seconds * 1000).toTimeString().slice(0, 5);
  return clock;
}

// ----------------------------------------------------------------------------------------------
// @desc Turn one published suggestion into the row the dev page shows: its time, title, whether it would create a new
//   task, and the explanation Amplenote would show as its rationale.
// @param {object} suggestion - { endAt, explanation, startAt, taskUUID|task } as the action publishes it.
// @param {Map<string, object>} taskByUuid - Task Domain tasks by UUID, to title existing-task suggestions.
// @returns {object} { durationMinutes, endClock, explanation, isNewTask, noteUuid, startAt, startClock, taskUuid, title }.
function _suggestionRow(suggestion, taskByUuid) {
  const taskUuid = suggestion.taskUUID || null;
  const existingTask = taskUuid ? taskByUuid.get(taskUuid) : null;
  const title = taskUuid ? existingTask?.content || `(task ${ taskUuid })` : suggestion.task?.content || "(untitled new task)";
  const noteUuid = taskUuid ? existingTask?.noteUUID || null : suggestion.task?.noteUUID || null;
  return { durationMinutes: Math.round((suggestion.endAt - suggestion.startAt) / 60), endClock: _localClockFromSeconds(suggestion.endAt),
    explanation: suggestion.explanation || "", isNewTask: !taskUuid, noteUuid, startAt: suggestion.startAt,
    startClock: _localClockFromSeconds(suggestion.startAt), taskUuid, title };
}

// ----------------------------------------------------------------------------------------------
// @desc The { endAt, startAt } window a calendar view of dayCount days starting today asks for: from today's local
//   midnight to the last second of its final day.
// @param {number} dayCount - Days the view shows.
// @param {Date} [now] - Injectable clock for tests.
// @returns {object} { endAt, startAt } in unix seconds.
export function calendarSuggestionWindow(dayCount, now = new Date()) {
  const startAt = Math.floor(_localMidnight(now).getTime() / 1000);
  const lastMidnight = _localMidnight(now);
  lastMidnight.setDate(lastMidnight.getDate() + dayCount - 1);
  const endAt = Math.floor(lastMidnight.getTime() / 1000) + SECONDS_PER_DAY - 1;
  return { endAt, startAt };
}

// ----------------------------------------------------------------------------------------------
// @desc Build the payload Amplenote passes to suggestScheduledTasks from the Task Domain's tasks: open tasks with no
//   start time are schedulable, and open tasks starting inside the window are already scheduled.
// @param {Array<object>} tasks - The Task Domain's tasks.
// @param {object} window - { endAt, startAt } in unix seconds.
// @param {object|null} taskDomain - { name, uuid } of the domain the calendar shows.
// @returns {object} { endAt, schedulableTasks, scheduledTasks, startAt, taskDomain }.
export function calendarSuggestionRequest(tasks, { endAt, startAt }, taskDomain) {
  const openTasks = (tasks || []).filter(task => !task.completedAt && !task.dismissedAt);
  const schedulableTasks = openTasks.filter(task => !task.startAt);
  const scheduledTasks = openTasks.filter(task => task.startAt >= startAt && task.startAt <= endAt);
  return { endAt, schedulableTasks, scheduledTasks, startAt, taskDomain };
}

// ----------------------------------------------------------------------------------------------
// @desc Group published suggestions by the local date they start on, listing every date of the window (even those
//   that received nothing) and noting whether the action plans that date at all: it skips weekends when the window
//   holds a weekday, and plans at most MAX_SUGGESTION_DAYS days.
// @param {Array<object>} suggestions - The latest set the action published or returned.
// @param {object} window - { endAt, startAt } in unix seconds.
// @param {Map<string, object>} taskByUuid - Task Domain tasks by UUID.
// @param {Date} [now] - Injectable clock for tests.
// @returns {Array<object>} { dayKey, isPlanned, label, rows } per date, ascending; rows are ordered by start time.
//   Suggestions starting outside the window are gathered under a trailing entry whose dayKey is "outside-window".
export function suggestionDaysFromPublication(suggestions, window, taskByUuid, now = new Date()) {
  const plannedDays = proposedAgendaDaysInRange(window, { maxDays: MAX_SUGGESTION_DAYS, now });
  const plannedDayKeys = new Set(plannedDays.map(day => day.toDateString()));
  const days = [];
  const cursor = _localMidnight(new Date(window.startAt * 1000));
  while (cursor.getTime() / 1000 <= window.endAt) {
    const label = cursor.toLocaleDateString(undefined, { day: "numeric", month: "short", weekday: "long" });
    days.push({ dayKey: cursor.toDateString(), isPlanned: plannedDayKeys.has(cursor.toDateString()), label, rows: [] });
    cursor.setDate(cursor.getDate() + 1);
  }
  const outsideWindow = { dayKey: "outside-window", isPlanned: false, label: "Outside the requested window", rows: [] };
  const dayByKey = new Map(days.map(day => [day.dayKey, day]));
  const sortedSuggestions = [...(suggestions || [])].sort((first, second) => first.startAt - second.startAt);
  for (const suggestion of sortedSuggestions) {
    const dayKey = new Date(suggestion.startAt * 1000).toDateString();
    (dayByKey.get(dayKey) || outsideWindow).rows.push(_suggestionRow(suggestion, taskByUuid));
  }
  if (outsideWindow.rows.length) days.push(outsideWindow);
  return days;
}

// ----------------------------------------------------------------------------------------------
// @desc Run one calendar suggestion pass against the dev app, as Amplenote does when the user clicks Suggest. The
//   action receives an app whose context.setScheduledTasks reports each progressive publish to onPublish, and whose
//   createNote notes the UUID of the report note the pass writes when the Debug Console is in the layout; every other
//   app call reaches the dev app unchanged, so re-roll prompts behave as in production. Once the action returns, the
//   report note is read back from the dev app.
// @param {object} devApp - The initialized browser dev app.
// @param {object} options - { dayCount, onPublish, taskDomain }: onPublish(suggestions, { request, taskByUuid }) receives
//   each published set with the payload sent and the domain's tasks by UUID for titling them.
// @returns {Promise<object>} { reportNote, request, suggestions, taskByUuid }: reportNote is { content, name, uuid } for
//   the report the pass wrote, or null when it wrote none; then the payload sent, the suggestions the action returned,
//   and the domain's tasks by UUID for titling them.
export async function runCalendarSuggestionPass(devApp, { dayCount, onPublish, taskDomain }) {
  const tasks = await devApp.getTaskDomainTasks(taskDomain?.uuid || null);
  const taskByUuid = new Map(tasks.map(task => [task.uuid, task]));
  const request = calendarSuggestionRequest(tasks, calendarSuggestionWindow(dayCount), taskDomain);
  const context = Object.create(devApp.context);
  context.setScheduledTasks = async scheduledTasks => {
    onPublish(scheduledTasks, { request, taskByUuid });
    return true;
  };
  let createdReport = null;
  const suggestionApp = Object.create(devApp);
  suggestionApp.context = context;
  suggestionApp.createNote = async (name, ...createArgs) => {
    const uuid = await devApp.createNote(name, ...createArgs);
    if (uuid && isCalendarGenerationReportName(name)) createdReport = { name, uuid };
    return uuid;
  };
  const suggestions = await suggestScheduledTasksFromDashboard(suggestionApp, request);
  const reportNote = createdReport ? { ...createdReport, content: await devApp.getNoteContent({ uuid: createdReport.uuid }) } : null;
  return { reportNote, request, suggestions: suggestions || [], taskByUuid };
}
