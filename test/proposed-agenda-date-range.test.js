/**
 * Task: Unit tests for the suggestScheduledTasks integration — expanding a calendar window into plannable
 *   days, honoring the Dashboard's last-specified priority theme, guaranteeing a start time + duration +
 *   one-sentence explanation on every suggestion, and publishing each day progressively through
 *   app.context.setScheduledTasks.
 */
import { jest } from "@jest/globals";
import { SETTING_KEYS } from "constants/settings";
import { SAMPLE_TASKS } from "./fixtures/tasks.js";

const PLAN_NOTE_UUID = "plan-note-uuid";
const SECONDS_PER_DAY = 24 * 60 * 60;
const SECONDS_PER_MINUTE = 60;

// The LLM is mocked so every day's schedule is deterministic; each captured prompt lets us assert which theme
// and which obligations the day was planned against.
let promptsSent = [];
const llmMock = jest.fn();

await jest.unstable_mockModule("providers/fetch-ai-provider", async () => ({
  llmPromptWithPluginFallback: (...args) => llmMock(...args),
}));

const { activityKey, mergedAgendaRows } = await import("proposed-agenda-llm-generator");
const { proposedTaskKey } = await import("proposed-agenda-archive");
const { agendaRowsGroupedByDay, proposedAgendaDaysInRange } = await import("proposed-agenda-range");
const { suggestScheduledTasksFromDashboard } = await import("proposed-agenda-suggest-action");

// ----------------------------------------------------------------------------------------------
// @desc Build a plugin-side Amplenote app stub: fixture tasks, a quarterly plan note, and the note-writing
//   surface the proposed-agenda archive needs. `app.context.setScheduledTasks` records every progressive
//   publish so the test can assert the calendar filled in day by day.
// @param {object} [settings={}] - Extra plugin settings merged over the LLM provider defaults.
// @returns {object} { app, publishes } where publishes is an array of the arrays handed to setScheduledTasks.
// [Claude claude-opus-5[1m]] Task: stub the plugin-side app surface suggestScheduledTasks runs against
function buildApp(settings = {}) {
  const publishes = [];
  const openTasks = SAMPLE_TASKS.filter(task => !task.completedAt && !task.dismissedAt);
  const app = {
    alert: jest.fn(),
    context: { setScheduledTasks: jest.fn(async tasks => { publishes.push([...tasks]); }) },
    createNote: jest.fn().mockResolvedValue({ uuid: "archive-note" }),
    filterNotes: jest.fn().mockResolvedValue([{ name: "Q3 2026 Work Plan", uuid: PLAN_NOTE_UUID }]),
    findNote: jest.fn().mockResolvedValue(null),
    getNoteContent: jest.fn().mockResolvedValue("# Plan\n- Ship things"),
    getTaskDomains: jest.fn().mockResolvedValue([{ name: "Work", uuid: "dom-work" }]),
    getTaskDomainTasks: jest.fn().mockResolvedValue(openTasks),
    replaceNoteContent: jest.fn().mockResolvedValue(true),
    settings: { [SETTING_KEYS.LLM_API_KEY_OPENAI]: "test-key", [SETTING_KEYS.LLM_PROVIDER_MODEL]: "openai",
      ...settings },
    updateTask: jest.fn().mockResolvedValue(true),
  };
  return { app, publishes };
}

// ----------------------------------------------------------------------------------------------
// @desc Local-midnight Unix seconds for a Date (matches the service's day-bucketing).
// @param {Date} date
// @returns {number}
function midnightSeconds(date) {
  return Math.floor(new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0).getTime() / 1000);
}

// ----------------------------------------------------------------------------------------------
// @desc A { endAt, startAt } window (unix seconds) covering `dayCount` days starting today, which is the shape
//   Amplenote hands suggestScheduledTasks for the visible calendar.
// @param {number} dayCount - How many days the window spans, today included.
// @returns {object} { endAt, startAt }
function windowFromToday(dayCount) {
  const startAt = midnightSeconds(new Date()) + 8 * 60 * SECONDS_PER_MINUTE;
  return { endAt: startAt + (dayCount - 1) * SECONDS_PER_DAY, startAt };
}

beforeEach(() => {
  promptsSent = [];
  llmMock.mockReset();
  llmMock.mockImplementation(async (_app, prompt) => {
    promptsSent.push(prompt);
    return { activities: [
      { durationMinutes: 60, reason: "Clears the highest-leverage item while the morning is still quiet.",
        startTime: "09:00", taskUuid: "task-7", title: "💼 Update budget" },
      { durationMinutes: 45, reason: "Keeps the afternoon anchored to a concrete deliverable.",
        startTime: "13:00", taskUuid: "task-2", title: "💼 Review the deck" }] };
  });
});

// [Claude claude-opus-5[1m]] Generated tests for: proposedAgendaDaysInRange
describe("proposedAgendaDaysInRange", () => {
  // A Monday-through-Friday window planned from that Monday yields all five weekdays (within the default cap).
  it("expands a weekday window into one local-midnight day per day", () => {
    const monday = new Date(2026, 8, 7, 9, 0, 0); // 2026-09-07 is a Monday
    expect(monday.getDay()).toBe(1);
    const range = { endAt: Math.floor(new Date(2026, 8, 11, 17, 0, 0).getTime() / 1000),
      startAt: Math.floor(monday.getTime() / 1000) };
    const days = proposedAgendaDaysInRange(range, { now: monday });
    expect(days).toHaveLength(5);
    expect(days.map(day => day.getDate())).toEqual([7, 8, 9, 10, 11]);
    expect(days.every(day => day.getHours() === 0 && day.getMinutes() === 0)).toBe(true);
  });

  // A window that straddles a weekend plans only the weekdays inside it — nobody wants the Saturday slot
  // filled with quarterly-plan work by default.
  it("skips weekend days when the window also contains weekdays", () => {
    const friday = new Date(2026, 8, 11, 9, 0, 0); // 2026-09-11 is a Friday
    expect(friday.getDay()).toBe(5);
    const range = { endAt: Math.floor(new Date(2026, 8, 14, 17, 0, 0).getTime() / 1000),
      startAt: Math.floor(friday.getTime() / 1000) };
    const days = proposedAgendaDaysInRange(range, { now: friday });
    expect(days.map(day => day.getDate())).toEqual([11, 14]);
  });

  // A pure weekend window still gets planned; refusing to suggest anything would be worse than suggesting
  // weekend-appropriate work.
  it("keeps weekend days when the window holds nothing else", () => {
    const saturday = new Date(2026, 8, 12, 9, 0, 0); // 2026-09-12 is a Saturday
    expect(saturday.getDay()).toBe(6);
    const range = { endAt: Math.floor(new Date(2026, 8, 13, 17, 0, 0).getTime() / 1000),
      startAt: Math.floor(saturday.getTime() / 1000) };
    const days = proposedAgendaDaysInRange(range, { now: saturday });
    expect(days.map(day => day.getDate())).toEqual([12, 13]);
  });

  // Nothing can be scheduled into a day that has already gone by, so a calendar scrolled back in time starts
  // the plan at today.
  it("drops days that are already in the past and honors the day cap", () => {
    const wednesday = new Date(2026, 8, 9, 9, 0, 0); // 2026-09-09 is a Wednesday
    const range = { endAt: Math.floor(new Date(2026, 8, 30, 17, 0, 0).getTime() / 1000),
      startAt: Math.floor(new Date(2026, 8, 1, 9, 0, 0).getTime() / 1000) };
    const days = proposedAgendaDaysInRange(range, { maxDays: 2, now: wednesday });
    expect(days.map(day => day.getDate())).toEqual([9, 10]);
  });

  // [OpenAI GPT-5.6] Task: verify weekend filtering occurs before the plannable-day cap
  it("applies the day cap after skipping weekends", () => {
    const friday = new Date(2026, 8, 11, 9, 0, 0);
    const range = { endAt: Math.floor(new Date(2026, 8, 15, 17, 0, 0).getTime() / 1000),
      startAt: Math.floor(friday.getTime() / 1000) };
    const days = proposedAgendaDaysInRange(range, { maxDays: 3, now: friday });
    expect(days.map(day => day.getDate())).toEqual([11, 14, 15]);
  });

  // An absent or inverted range is how callers say "no range supplied"; the widget then plans its single
  // auto-resolved day instead.
  it("returns no days for an absent, partial, or inverted range", () => {
    const now = new Date(2026, 8, 9, 9, 0, 0);
    expect(proposedAgendaDaysInRange(null, { now })).toEqual([]);
    expect(proposedAgendaDaysInRange({ startAt: Math.floor(now.getTime() / 1000) }, { now })).toEqual([]);
    expect(proposedAgendaDaysInRange({ endAt: Math.floor(now.getTime() / 1000) - SECONDS_PER_DAY,
      startAt: Math.floor(now.getTime() / 1000) }, { now })).toEqual([]);
  });
});

// [Claude claude-opus-5[1m]] Generated tests for: suggestScheduledTasks integration
describe("suggestScheduledTasksFromDashboard", () => {
  // The core API contract: every entry Amplenote receives must carry a start time and an end derived from the
  // activity's duration, an existing task's UUID, and a one-sentence explanation of why to affirm it.
  it("returns suggestions carrying a start time, a duration-derived end, a task, and an explanation", async () => {
    const { app } = buildApp();
    const suggestions = await suggestScheduledTasksFromDashboard(app, { ...windowFromToday(1),
      scheduledTasks: [], taskDomain: { name: "Work", uuid: "dom-work" } });

    expect(suggestions.length).toBeGreaterThan(0);
    for (const suggestion of suggestions) {
      expect(Number.isInteger(suggestion.startAt)).toBe(true);
      expect(suggestion.endAt).toBeGreaterThan(suggestion.startAt);
      expect(typeof suggestion.taskUUID).toBe("string");
      expect(suggestion.explanation.length).toBeGreaterThan(0);
    }
    // The 60-minute proposal keeps its length, and lands on today at 09:00 — or at the current time when the
    // suite runs later than that, since today's agenda is never allowed to start in the past.
    const todayMidnight = midnightSeconds(new Date());
    const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
    const nineAmSuggestion = suggestions.find(s => s.endAt - s.startAt === 60 * SECONDS_PER_MINUTE);
    expect(nineAmSuggestion.startAt).toBe(todayMidnight + Math.max(9 * 60, nowMinutes) * SECONDS_PER_MINUTE);
  });

  // Requirement: the suggestions are shaped by whichever "Today's priority" theme the user last chose on the
  // Dashboard, so the calendar and the widget agree on what today is for.
  it("plans with the priority theme last specified on the Dashboard", async () => {
    const { app } = buildApp({ [SETTING_KEYS.PROPOSED_AGENDA_PRIORITY]: "barnacle-cleanup" });
    await suggestScheduledTasksFromDashboard(app, { ...windowFromToday(1), scheduledTasks: [] });

    expect(promptsSent).toHaveLength(1);
    expect(promptsSent[0]).toContain("barnacle");
    expect(promptsSent[0]).not.toContain("quarterly plan and stated goals");
  });

  // With no stored theme the widget's own default (goal progress) applies, rather than no instruction at all.
  it("falls back to the default theme when the Dashboard has never set one", async () => {
    const { app } = buildApp();
    await suggestScheduledTasksFromDashboard(app, { ...windowFromToday(1), scheduledTasks: [] });
    expect(promptsSent[0]).toContain("quarterly plan and stated goals");
  });

  // Progressive publishing: each planned day is pushed to the calendar as it lands, so a slow multi-day
  // generation is useful before it finishes rather than only at the end.
  it("publishes each day through app.context.setScheduledTasks as it is drafted", async () => {
    const { app, publishes } = buildApp();
    // A Monday→Tuesday window, pinned so the days are weekdays regardless of when the suite runs.
    const startAt = midnightSeconds(new Date()) + 8 * 60 * SECONDS_PER_MINUTE;
    const suggestions = await suggestScheduledTasksFromDashboard(app, { endAt: startAt + SECONDS_PER_DAY,
      scheduledTasks: [], startAt });

    // Every publish carries everything drafted so far, so the counts grow and the last one matches the return.
    expect(publishes.length).toBe(promptsSent.length);
    const publishedCounts = publishes.map(published => published.length);
    const sortedCounts = [...publishedCounts].sort((a, b) => a - b);
    expect(publishedCounts).toEqual(sortedCounts);
    expect(publishes[publishes.length - 1]).toHaveLength(suggestions.length);
    expect(app.context.setScheduledTasks).toHaveBeenCalled();
  });

  // The calendar's already-scheduled tasks are the immovable obligations the plan is built around, and they
  // reach the prompt as occupied clock ranges.
  it("treats the calendar's already-scheduled tasks as immovable obligations", async () => {
    const { app } = buildApp();
    const committedStart = midnightSeconds(new Date()) + 9 * 60 * SECONDS_PER_MINUTE;
    const scheduledTasks = [{ content: "Standup with the team", duration: 30 * SECONDS_PER_MINUTE,
      startAt: committedStart, uuid: "task-committed" }];
    const suggestions = await suggestScheduledTasksFromDashboard(app, { ...windowFromToday(1), scheduledTasks });

    expect(promptsSent[0]).toContain("9:00am-9:30am");
    expect(promptsSent[0]).toContain("Standup with the team");
    // The 09:00 proposal cannot survive on top of the 09:00–09:30 commitment.
    const overlapping = suggestions.filter(suggestion => suggestion.startAt < committedStart + 30 * SECONDS_PER_MINUTE
      && committedStart < suggestion.endAt);
    expect(overlapping).toEqual([]);
  });

  // A model that forgets durationMinutes or reason must not produce a zero-length block or an empty
  // explanation, since both are part of what the user is being asked to affirm.
  it("substitutes a duration and an explanation when the model omits them", async () => {
    llmMock.mockImplementation(async (_app, prompt) => {
      promptsSent.push(prompt);
      return { activities: [{ startTime: "10:00", taskUuid: "task-7", title: "💼 Update budget" }] };
    });
    const { app } = buildApp();
    const suggestions = await suggestScheduledTasksFromDashboard(app, { ...windowFromToday(1), scheduledTasks: [] });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].endAt - suggestions[0].startAt).toBe(30 * SECONDS_PER_MINUTE);
    expect(suggestions[0].explanation).toMatch(/10:00am/);
  });

  // A host without setScheduledTasks (or one that rejects the call) still gets the full set back from the
  // action's return value.
  it("still returns suggestions when progressive publishing is unavailable", async () => {
    const { app } = buildApp();
    app.context = {};
    const suggestions = await suggestScheduledTasksFromDashboard(app, { ...windowFromToday(1), scheduledTasks: [] });
    expect(suggestions.length).toBeGreaterThan(0);
  });

  // [OpenAI GPT-5.6] Task: keep suggestions inside the calendar window supplied by Amplenote
  it("does not fall back to today when the supplied range is entirely past", async () => {
    const { app } = buildApp();
    const startAt = Math.floor(new Date(2020, 0, 1, 8, 0, 0).getTime() / 1000);
    const suggestions = await suggestScheduledTasksFromDashboard(app,
      { endAt: startAt + SECONDS_PER_DAY, scheduledTasks: [], startAt });
    expect(suggestions).toEqual([]);
    expect(llmMock).not.toHaveBeenCalled();
    expect(app.context.setScheduledTasks).not.toHaveBeenCalled();
  });
});

// [Claude claude-opus-5[1m]] Generated tests for: day-aware row keys, ordering, and grouping
describe("day-aware agenda rows", () => {
  const mondayMidnight = midnightSeconds(new Date(2026, 8, 7));
  const tuesdayMidnight = midnightSeconds(new Date(2026, 8, 8));
  const mondayRow = { durationMinutes: 60, startMinutes: 9 * 60, targetMidnightSeconds: mondayMidnight,
    taskUuid: "task-7", title: "Monday budget" };
  const tuesdayRow = { durationMinutes: 60, startMinutes: 9 * 60, targetMidnightSeconds: tuesdayMidnight,
    taskUuid: "task-7", title: "Tuesday budget" };

  // Without the day prefix these two rows would share a key, so dismissing Monday's would silently dismiss
  // Tuesday's as well.
  it("keys the same task at the same time on two days distinctly", () => {
    expect(activityKey(mondayRow)).not.toEqual(activityKey(tuesdayRow));
    expect(activityKey(mondayRow)).toContain(String(mondayMidnight));
  });

  // The widget's key and the archived record's key must stay identical or restored scheduled/dismissed
  // decisions stop matching the rows on screen.
  it("keys rows identically to the archived record", () => {
    expect(activityKey(mondayRow)).toEqual(proposedTaskKey(mondayRow));
    expect(activityKey({ startMinutes: 540, taskUuid: "task-7" }))
      .toEqual(proposedTaskKey({ startMinutes: 540, taskUuid: "task-7" }));
  });

  // Rows sort by day first, so a range renders Monday's afternoon above Tuesday's morning.
  it("orders rows by day before time and groups them per day", () => {
    const proposed = [tuesdayRow, { ...mondayRow, startMinutes: 15 * 60, title: "Monday afternoon" }, mondayRow];
    const rows = mergedAgendaRows([], proposed, new Set());
    expect(rows.map(row => row.title)).toEqual(["Monday budget", "Monday afternoon", "Tuesday budget"]);

    const groups = agendaRowsGroupedByDay(rows);
    expect(groups).toHaveLength(2);
    expect(groups[0].rows).toHaveLength(2);
    expect(groups[0].dayHeading).toEqual("Monday, September 7");
    expect(groups[1].dayHeading).toContain("Tuesday");
  });

  // The "already elapsed" cutoff belongs to today alone: at 2pm today, tomorrow's 9am row must still show.
  it("applies the elapsed-time cutoff only to the day it names", () => {
    const rows = mergedAgendaRows([], [mondayRow, tuesdayRow], new Set(),
      { hidePastBeforeMinutes: 14 * 60, hidePastOnMidnightSeconds: mondayMidnight });
    expect(rows.map(row => row.title)).toEqual(["Tuesday budget"]);
  });
});
