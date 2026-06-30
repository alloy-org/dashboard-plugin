/**
 * [Claude claude-opus-4-8 (1M context)-authored file]
 * Created: 2026-06-29 | Model: claude-opus-4-8[1m]
 * Task: Unit tests for proposed-agenda next-day + weekend targeting. Confirms that when the agenda is built
 *   for the day AFTER today (e.g. an after-4pm/5pm run), the prompt and the scheduled startAt land on that
 *   next day rather than today, and that weekend resolution rolls forward to Monday.
 * Prompt summary: "add a proposed-agenda test where the time of day is 5pm, confirming we schedule tasks
 *   differently for the following day; on the weekend schedule for Monday; add a target-date parameter"
 */
import { jest } from "@jest/globals";
import { SETTING_KEYS } from "constants/settings";
import { setPluginData } from "plugin-data";
import { SAMPLE_TASKS } from "./fixtures/tasks.js";

const PLAN_NOTE_UUID = "plan-note-uuid";
const FIVE_PM = 17;
const SECONDS_PER_DAY = 24 * 60 * 60;

// The LLM call is mocked so the schedule is deterministic; the captured prompt + returned activity let us
// assert how the service treats the target day. The mock echoes a single activity bound to a real fixture task.
let lastPromptSent = null;
const llmMock = jest.fn();

await jest.unstable_mockModule("providers/fetch-ai-provider", async () => ({
  llmPromptWithPluginFallback: (...args) => llmMock(...args),
}));

const { generateProposedAgenda, resolveProposedAgendaDate, scheduleProposedActivity } =
  await import("proposed-agenda-service");

// ----------------------------------------------------------------------------------------------
// @desc Resolve the plan-note name the service looks up ("QN YYYY Plan") so the filterNotes stub matches it.
// @returns {string}
// [Claude claude-opus-4-8 (1M context)] Task: derive the current quarter's plan note name for the stub
function currentQuarterPlanName() {
  const now = new Date();
  return `Q${ Math.floor(now.getMonth() / 3) + 1 } ${ now.getFullYear() } Plan`;
}

// ----------------------------------------------------------------------------------------------
// @desc Build an Amplenote app stub returning fixture tasks + plan content, with spies on the task-mutation
//   methods so scheduling can be asserted. updateTask records the startAt it was handed.
// @returns {object} App stub plus the updateTask spy.
// [Claude claude-opus-4-8 (1M context)] Task: stub the note/task surface for deterministic agenda tests
function buildApp() {
  setPluginData({
    settings: { [SETTING_KEYS.LLM_PROVIDER_MODEL]: "openai", [SETTING_KEYS.LLM_API_KEY_OPENAI]: "test-key" },
    context: {},
  });
  const planName = currentQuarterPlanName();
  const openTasks = SAMPLE_TASKS.filter(task => !task.completedAt && !task.dismissedAt);
  const updateTask = jest.fn().mockResolvedValue(true);
  const app = {
    alert: jest.fn(),
    callPlugin: jest.fn().mockResolvedValue(undefined),
    filterNotes: jest.fn().mockResolvedValue([{ name: planName, uuid: PLAN_NOTE_UUID }]),
    findNote: jest.fn().mockResolvedValue(null),
    getNoteContent: jest.fn().mockResolvedValue("# Plan\n- Ship things"),
    getTaskDomains: jest.fn().mockResolvedValue([{ name: "Work", uuid: "dom-work" }]),
    getTaskDomainTasks: jest.fn().mockResolvedValue(openTasks),
    updateTask,
  };
  return { app, updateTask };
}

// ----------------------------------------------------------------------------------------------
// @desc Local-midnight Unix seconds for a Date (matches the service's day-bucketing).
// @param {Date} date
// @returns {number}
function midnightSeconds(date) {
  return Math.floor(new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0).getTime() / 1000);
}

beforeEach(() => {
  lastPromptSent = null;
  llmMock.mockReset();
  // Echo one activity bound to a real fixture task ("task-7", an open Work task) at 09:00 for 60 minutes.
  llmMock.mockImplementation(async (_app, prompt) => {
    lastPromptSent = prompt;
    return { activities: [{ startTime: "09:00", durationMinutes: 60, title: "💼 Update budget",
      taskUuid: "task-7", reason: "Top priority for the day" }] };
  });
});

// [Claude claude-opus-4-8 (1M context)] Generated tests for: proposed-agenda next-day + weekend targeting
describe("proposed-agenda next-day targeting", () => {
  // ----------------------------------------------------------------------------------------------
  // The 5pm scenario: the agenda is built for the day AFTER today. We pin that via the targetDate override
  // (the same value an after-4pm run resolves to) and confirm the prompt names the next day and the scheduled
  // startAt lands on the next day — provably different from a same-day run.
  it("schedules for the following day when run after the 4pm cutoff (5pm)", async () => {
    // A fixed Wednesday at 5pm — chosen so the next day (Thursday) is a weekday, isolating the cutoff behavior.
    const fivePmWednesday = new Date(2026, 5, 24, FIVE_PM, 0, 0); // 2026-06-24 is a Wednesday
    expect(fivePmWednesday.getDay()).toBe(3);
    const tomorrow = resolveProposedAgendaDate(fivePmWednesday);
    // After 4pm, resolution advances one day (and 2026-06-25 is a Thursday, so no weekend skip).
    expect(tomorrow.getDate()).toBe(25);
    expect(tomorrow.getDay()).toBe(4);

    const { app, updateTask } = buildApp();
    const result = await generateProposedAgenda(app, { targetDate: tomorrow });

    // The prompt describes the NEXT day (Thursday, June 25) and the result is labeled for that day.
    expect(lastPromptSent).toContain("Thursday");
    expect(lastPromptSent).toContain("June 25, 2026");
    expect(result.dateLabel).toContain("Thursday");
    expect(result.dateLabel).toContain("June 25, 2026");

    // The scheduled startAt lands on the next day at 09:00, NOT today.
    expect(result.activities).toHaveLength(1);
    await scheduleProposedActivity(app, result.activities[0], null);
    const [, patch] = updateTask.mock.calls[0];
    const expectedStartAt = midnightSeconds(tomorrow) + 9 * 60 * 60;
    expect(patch.startAt).toBe(expectedStartAt);
  });

  // ----------------------------------------------------------------------------------------------
  // The differential assertion the request asks for: a same-day run and a next-day run of the SAME activity
  // produce startAt values exactly one day apart, proving the day parameter changes scheduling.
  it("schedules the same activity one day apart for today vs the following day", async () => {
    const today = new Date(2026, 5, 24, 0, 0, 0);      // Wednesday
    const tomorrow = new Date(2026, 5, 25, 0, 0, 0);    // Thursday

    const { app: appToday } = buildApp();
    const todayResult = await generateProposedAgenda(appToday, { targetDate: today });
    const todayPrompt = lastPromptSent;

    const { app: appTomorrow } = buildApp();
    const tomorrowResult = await generateProposedAgenda(appTomorrow, { targetDate: tomorrow });

    // Different day-of-week framing in each prompt.
    expect(todayPrompt).toContain("Wednesday");
    expect(lastPromptSent).toContain("Thursday");

    // The same 09:00 activity resolves to startAt values exactly one calendar day apart.
    const startAtFor = (result, day) =>
      midnightSeconds(day) + result.activities[0].startMinutes * 60;
    expect(startAtFor(tomorrowResult, tomorrow) - startAtFor(todayResult, today)).toBe(SECONDS_PER_DAY);
  });

  // ----------------------------------------------------------------------------------------------
  // The LLM is asked to weigh the day of week and holidays regardless of which day is targeted.
  it("asks the LLM to consider the day of the week and holidays", async () => {
    const { app } = buildApp();
    await generateProposedAgenda(app, { targetDate: new Date(2026, 5, 24, 0, 0, 0) });
    expect(lastPromptSent.toLowerCase()).toContain("day of the week");
    expect(lastPromptSent.toLowerCase()).toContain("holiday");
  });

  // ----------------------------------------------------------------------------------------------
  // dayWord is relative to the actual current day: today → "today", +1 → "tomorrow", further out → the
  // weekday name (e.g. "on Monday"). Computed against the real clock, so we derive expectations from `now`
  // rather than hardcoding — this guards the bug where a Monday-from-Friday-evening run mislabeled as
  // "tomorrow".
  it("labels the scheduled day relative to today (today / tomorrow / weekday name)", async () => {
    const startOfToday = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
    const addDays = (date, n) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);

    const { app: a0 } = buildApp();
    expect((await generateProposedAgenda(a0, { targetDate: startOfToday() })).dayWord).toBe("today");

    const { app: a1 } = buildApp();
    expect((await generateProposedAgenda(a1, { targetDate: addDays(startOfToday(), 1) })).dayWord).toBe("tomorrow");

    // Three days out is never "tomorrow"; it is named by its weekday.
    const threeOut = addDays(startOfToday(), 3);
    const { app: a3 } = buildApp();
    const result = await generateProposedAgenda(a3, { targetDate: threeOut });
    expect(result.dayWord).toBe(`on ${ threeOut.toLocaleDateString([], { weekday: "long" }) }`);
    expect(result.dayWord).not.toBe("tomorrow");
  });
});

// [Claude claude-opus-4-8 (1M context)] Generated tests for: weekend → Monday agenda resolution
describe("resolveProposedAgendaDate weekend handling", () => {
  // ----------------------------------------------------------------------------------------------
  // A Saturday (any time) and a Sunday (any time) both resolve to the following Monday.
  it("rolls a Saturday forward to Monday", () => {
    const saturday = new Date(2026, 5, 27, 9, 0, 0); // 2026-06-27 is a Saturday
    expect(saturday.getDay()).toBe(6);
    const resolved = resolveProposedAgendaDate(saturday);
    expect(resolved.getDay()).toBe(1);       // Monday
    expect(resolved.getDate()).toBe(29);     // 2026-06-29
  });

  it("rolls a Sunday forward to Monday", () => {
    const sunday = new Date(2026, 5, 28, 9, 0, 0); // 2026-06-28 is a Sunday
    expect(sunday.getDay()).toBe(0);
    const resolved = resolveProposedAgendaDate(sunday);
    expect(resolved.getDay()).toBe(1);
    expect(resolved.getDate()).toBe(29);
  });

  // ----------------------------------------------------------------------------------------------
  // Friday after 4pm bumps to Saturday, which then skips forward to Monday — the cutoff and weekend rules
  // compose.
  it("rolls a Friday-after-cutoff run forward to Monday (cutoff + weekend skip compose)", () => {
    const fridayEvening = new Date(2026, 5, 26, FIVE_PM, 0, 0); // 2026-06-26 is a Friday
    expect(fridayEvening.getDay()).toBe(5);
    const resolved = resolveProposedAgendaDate(fridayEvening);
    expect(resolved.getDay()).toBe(1);       // Monday
    expect(resolved.getDate()).toBe(29);
  });

  // ----------------------------------------------------------------------------------------------
  // A plain weekday-morning run stays on today.
  it("keeps a weekday-morning run on the same day", () => {
    const wednesdayMorning = new Date(2026, 5, 24, 9, 0, 0);
    const resolved = resolveProposedAgendaDate(wednesdayMorning);
    expect(resolved.getDate()).toBe(24);
    expect(resolved.getDay()).toBe(3);
  });
});
