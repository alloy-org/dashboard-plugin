// Tests for the dev Calendar Suggestions session: the window a view length requests, the payload built from a Task
// Domain's tasks, how published suggestions group by date, and that a pass reports each setScheduledTasks publish.
import { jest } from "@jest/globals";

// The action itself is covered by its own tests; here it only has to publish once through the app it receives.
const publishedSuggestion = { endAt: 2, explanation: "Because.", startAt: 1, taskUUID: "task-1" };
const suggestScheduledTasksFromDashboard = jest.fn(async (app, request) => {
  await app.context.setScheduledTasks([publishedSuggestion]);
  return [publishedSuggestion];
});
jest.unstable_mockModule("dashboard/proposed-agenda/proposed-agenda-suggest-action", () => ({ MAX_SUGGESTION_DAYS: 3,
  suggestScheduledTasksFromDashboard }));
const { calendarSuggestionRequest, calendarSuggestionWindow, runCalendarSuggestionPass, suggestionDaysFromPublication } =
  await import("dashboard/calendar-suggestions-dev-session");

// A Monday, so a week view holds five weekdays and a weekend.
const MONDAY_MORNING = new Date(2026, 9, 19, 9, 30);

// ----------------------------------------------------------------------------------------------
// @desc Unix seconds for a local time on the given day offset from MONDAY_MORNING.
// @param {number} dayOffset - Days after Monday.
// @param {number} hour - Local hour.
// @returns {number} Unix seconds.
function secondsAt(dayOffset, hour) {
  const date = new Date(2026, 9, 19 + dayOffset, hour, 0);
  return Math.floor(date.getTime() / 1000);
}

describe("calendarSuggestionWindow", () => {
  it("spans from today's midnight to the last second of the final day", () => {
    const window = calendarSuggestionWindow(3, MONDAY_MORNING);
    expect(window.startAt).toBe(secondsAt(0, 0));
    expect(window.endAt).toBe(secondsAt(3, 0) - 1);
  });
});

describe("calendarSuggestionRequest", () => {
  it("splits open tasks into schedulable and in-window scheduled tasks", () => {
    const window = calendarSuggestionWindow(1, MONDAY_MORNING);
    const tasks = [{ content: "Unscheduled", uuid: "a" }, { content: "Today", startAt: secondsAt(0, 14), uuid: "b" },
      { content: "Next week", startAt: secondsAt(7, 14), uuid: "c" }, { completedAt: 1, content: "Done", uuid: "d" }];
    const request = calendarSuggestionRequest(tasks, window, { name: "Work", uuid: "work" });
    expect(request.schedulableTasks.map(task => task.uuid)).toEqual(["a"]);
    expect(request.scheduledTasks.map(task => task.uuid)).toEqual(["b"]);
    expect(request.taskDomain).toEqual({ name: "Work", uuid: "work" });
  });
});

describe("suggestionDaysFromPublication", () => {
  it("lists every date of the window, titles each suggestion, and marks unplanned dates", () => {
    const window = calendarSuggestionWindow(7, MONDAY_MORNING);
    const taskByUuid = new Map([["task-1", { content: "Write report", noteUUID: "note-1", uuid: "task-1" }]]);
    const suggestions = [
      { endAt: secondsAt(1, 11), explanation: "Unblocks the launch.", startAt: secondsAt(1, 10), task: { content: "Draft outline", noteUUID: "note-2" } },
      { endAt: secondsAt(0, 15), explanation: "Clears the deadline.", startAt: secondsAt(0, 14), taskUUID: "task-1" },
    ];
    const days = suggestionDaysFromPublication(suggestions, window, taskByUuid, MONDAY_MORNING);
    expect(days).toHaveLength(7);
    expect(days[0].rows.map(row => [row.title, row.isNewTask, row.explanation, row.durationMinutes]))
      .toEqual([["Write report", false, "Clears the deadline.", 60]]);
    expect(days[1].rows[0]).toMatchObject({ isNewTask: true, noteUuid: "note-2", title: "Draft outline" });
    expect(days.map(day => day.isPlanned)).toEqual([true, true, true, false, false, false, false]);
  });

  it("gathers suggestions outside the window under a trailing entry", () => {
    const window = calendarSuggestionWindow(1, MONDAY_MORNING);
    const suggestions = [{ endAt: secondsAt(2, 11), explanation: "", startAt: secondsAt(2, 10), taskUUID: "x" }];
    const days = suggestionDaysFromPublication(suggestions, window, new Map(), MONDAY_MORNING);
    expect(days.map(day => day.dayKey)).toEqual([new Date(2026, 9, 19).toDateString(), "outside-window"]);
  });
});

describe("runCalendarSuggestionPass", () => {
  it("routes setScheduledTasks publishes to onPublish without altering the dev app's context", async () => {
    const tasks = [{ content: "Write report", uuid: "task-1" }];
    const devApp = { context: { lightDarkMode: "light" }, getTaskDomainTasks: jest.fn(async () => tasks), settings: { a: 1 } };
    const onPublish = jest.fn();
    const result = await runCalendarSuggestionPass(devApp, { dayCount: 1, onPublish, taskDomain: { name: "Work", uuid: "work" } });
    const [actionApp, request] = suggestScheduledTasksFromDashboard.mock.calls[0];
    expect(devApp.getTaskDomainTasks).toHaveBeenCalledWith("work");
    expect(actionApp.settings).toBe(devApp.settings);
    expect(actionApp.context.lightDarkMode).toBe("light");
    expect(devApp.context.setScheduledTasks).toBeUndefined();
    expect(request.schedulableTasks).toEqual(tasks);
    expect(onPublish).toHaveBeenCalledWith([publishedSuggestion], expect.objectContaining({ request }));
    expect(onPublish.mock.calls[0][1].taskByUuid.get("task-1")).toBe(tasks[0]);
    expect(result.suggestions).toEqual([publishedSuggestion]);
  });
});
