import { jest } from "@jest/globals";
import { SETTING_KEYS } from "constants/settings";
import { setPluginData } from "plugin-data";
import { SAMPLE_TASKS } from "./fixtures/tasks.js";

const PLAN_NOTE_UUID = "plan-note-uuid";

// The LLM call is mocked so we can capture the exact prompt string the service composes.
let lastPromptSent = null;
const llmMock = jest.fn();

await jest.unstable_mockModule("providers/fetch-ai-provider", async () => ({
  llmPromptWithPluginFallback: (...args) => llmMock(...args),
}));

const { generateProposedAgenda } = await import("proposed-agenda-service");

// ----------------------------------------------------------------------------------------------
// @desc Resolve the plan-note name the service looks up ("QN YYYY Plan") so the filterNotes stub matches it.
// @returns {string}
function currentQuarterPlanName() {
  const now = new Date();
  return `Q${ Math.floor(now.getMonth() / 3) + 1 } ${ now.getFullYear() } Plan`;
}

// ----------------------------------------------------------------------------------------------
// @desc Build an Amplenote app stub returning fixture tasks + plan content so generation reaches the LLM call.
// @returns {object} App stub.
function buildApp() {
  setPluginData({
    settings: { [SETTING_KEYS.LLM_PROVIDER_MODEL]: "openai", [SETTING_KEYS.LLM_API_KEY_OPENAI]: "test-key" },
    context: {},
  });
  const planName = currentQuarterPlanName();
  const openTasks = SAMPLE_TASKS.filter(task => !task.completedAt && !task.dismissedAt);
  return {
    alert: jest.fn(),
    callPlugin: jest.fn().mockResolvedValue(undefined),
    filterNotes: jest.fn().mockResolvedValue([{ name: planName, uuid: PLAN_NOTE_UUID }]),
    findNote: jest.fn().mockResolvedValue(null),
    getNoteContent: jest.fn().mockResolvedValue("# Plan\n- Ship things"),
    getTaskDomains: jest.fn().mockResolvedValue([{ name: "Work", uuid: "dom-work" }]),
    getTaskDomainTasks: jest.fn().mockResolvedValue(openTasks),
    updateTask: jest.fn().mockResolvedValue(true),
  };
}

// Two events and one task already committed to the day — the shape obligationsFromTasksAndEvents produces,
// mixing sources so the occupied-times array must reflect BOTH tasks and events.
const TASK_OBLIGATION = { durationMinutes: 60, source: "task", startMinutes: 8 * 60 + 15, taskUuid: "committed-task",
  title: "Standup prep" };
const MORNING_EVENT = { durationMinutes: 120, source: "event", startMinutes: 11 * 60, taskUuid: null,
  title: "Design review" };
const LATE_EVENT = { durationMinutes: 15, source: "event", startMinutes: 16 * 60, taskUuid: null,
  title: "Sync with Pat" };
const OBLIGATIONS = [TASK_OBLIGATION, MORNING_EVENT, LATE_EVENT];

beforeEach(() => {
  lastPromptSent = null;
  llmMock.mockReset();
  llmMock.mockImplementation(async (_app, prompt) => {
    lastPromptSent = prompt;
    return { activities: [{ startTime: "13:30", durationMinutes: 60, title: "💼 Update budget",
      taskUuid: "task-7", reason: "Top priority" }] };
  });
});

// [Claude claude-opus-4-8 (1M context)] Generated tests for: occupied-times array + no-past scheduling rules
describe("proposed-agenda occupied-times prompt", () => {
  // ----------------------------------------------------------------------------------------------
  // The occupied-times array must exist and list BOTH the task-derived slot and the event-derived slots as
  // clock ranges, with the do-not-intrude instruction and the 30-minute buffer request.
  it("sends an 'Already occupied times' array combining tasks and events", async () => {
    const app = buildApp();
    await generateProposedAgenda(app, { now: new Date(2026, 5, 24, 9, 0, 0),
      targetDate: new Date(2026, 5, 24, 0, 0, 0), obligations: OBLIGATIONS });

    expect(lastPromptSent).toContain("Already occupied times:");
    // Task-derived range (8:15am + 60m) and event-derived ranges (11:00am + 120m, 4:00pm + 15m).
    expect(lastPromptSent).toContain("8:15am-9:15am");   // from the committed TASK
    expect(lastPromptSent).toContain("11:00am-1:00pm");  // from a calendar EVENT
    expect(lastPromptSent).toContain("4:00pm-4:15pm");   // from a calendar EVENT

    // The array is a single bracketed list carrying every occupied slot.
    const arrayMatch = lastPromptSent.match(/Already occupied times: \[([^\]]*)\]/);
    expect(arrayMatch).not.toBeNull();
    expect(arrayMatch[1]).toContain("8:15am-9:15am");
    expect(arrayMatch[1]).toContain("11:00am-1:00pm");
    expect(arrayMatch[1]).toContain("4:00pm-4:15pm");

    // The non-intrusion instruction and the 30-minute buffer request accompany the array.
    expect(lastPromptSent).toMatch(/do NOT include any task that would fall in these already-scheduled time slots/i);
    expect(lastPromptSent).toContain("30 minute buffer");
  });

  // ----------------------------------------------------------------------------------------------
  // A today-run tells the LLM the current time and the 6pm work-day end, so it schedules only the remaining day.
  it("tells the LLM the current time and 6pm work-day end when the agenda is for today", async () => {
    const app = buildApp();
    // Noon today: same calendar day as the target, so nowMinutes is populated.
    await generateProposedAgenda(app, { now: new Date(2026, 5, 24, 12, 0, 0),
      targetDate: new Date(2026, 5, 24, 0, 0, 0), obligations: OBLIGATIONS });

    expect(lastPromptSent).toContain("The current local time is 12:00");
    expect(lastPromptSent).toMatch(/Do NOT propose any activity that starts before this time/i);
    expect(lastPromptSent).toContain("The working day ends at 18:00");
  });

  // ----------------------------------------------------------------------------------------------
  // A future-day run has nothing elapsed, so the current-time clamp is absent (it plans a fresh whole day).
  it("omits the current-time clamp when the agenda is for a future day", async () => {
    const app = buildApp();
    // Run at 5pm today but target tomorrow → future day, no now-clamp.
    await generateProposedAgenda(app, { now: new Date(2026, 5, 24, 17, 0, 0),
      targetDate: new Date(2026, 5, 25, 0, 0, 0), obligations: OBLIGATIONS });

    expect(lastPromptSent).not.toContain("The current local time is");
    // The occupied-times array is still sent regardless of which day is targeted.
    expect(lastPromptSent).toContain("Already occupied times:");
  });

  // ----------------------------------------------------------------------------------------------
  // With no obligations the array degrades gracefully to an empty marker rather than a malformed "[ ]".
  it("emits an empty occupied-times marker when nothing is committed", async () => {
    const app = buildApp();
    await generateProposedAgenda(app, { now: new Date(2026, 5, 24, 9, 0, 0),
      targetDate: new Date(2026, 5, 24, 0, 0, 0), obligations: [] });
    expect(lastPromptSent).toContain("Already occupied times: [ none ]");
  });
});

// [Claude claude-opus-4-8 (1M context)] Generated tests for: server-side non-intrusion + past-clamp guarantees
describe("proposed-agenda validation guarantees the schedule around obligations and the current time", () => {
  // ----------------------------------------------------------------------------------------------
  // Even when the LLM returns an activity that overlaps a committed obligation, the service pushes it past the
  // obligation's end so no portion intrudes — the guarantee the real-LLM integration test relies on.
  it("pushes an LLM activity that overlaps an obligation past that obligation's end", async () => {
    const app = buildApp();
    // MORNING_EVENT occupies 11:00–13:00; the LLM (wrongly) proposes an activity starting at 12:00.
    llmMock.mockImplementation(async (_app, prompt) => {
      lastPromptSent = prompt;
      return { activities: [{ startTime: "12:00", durationMinutes: 60, title: "💼 Update budget",
        taskUuid: "task-7", reason: "Overlaps the design review" }] };
    });
    const result = await generateProposedAgenda(app, { now: new Date(2026, 5, 24, 6, 0, 0),
      targetDate: new Date(2026, 5, 24, 0, 0, 0), obligations: OBLIGATIONS });

    expect(result.activities).toHaveLength(1);
    const activity = result.activities[0];
    const start = activity.startMinutes;
    const end = activity.startMinutes + activity.durationMinutes;
    for (const obligation of OBLIGATIONS) {
      const blockStart = obligation.startMinutes;
      const blockEnd = obligation.startMinutes + obligation.durationMinutes;
      expect(start < blockEnd && blockStart < end).toBe(false);
    }
    // Specifically, it was moved to at or after the morning event's 13:00 end.
    expect(start).toBeGreaterThanOrEqual(13 * 60);
  });

  // ----------------------------------------------------------------------------------------------
  // A today-run never yields an activity that starts in the past: an LLM proposal before "now" is clamped up.
  it("clamps an LLM activity proposed before the current time up to now", async () => {
    const app = buildApp();
    llmMock.mockImplementation(async (_app, prompt) => {
      lastPromptSent = prompt;
      return { activities: [{ startTime: "08:00", durationMinutes: 30, title: "💼 Update budget",
        taskUuid: "task-7", reason: "Proposed in the past" }] };
    });
    // Noon today, no obligations to muddy the clamp.
    const result = await generateProposedAgenda(app, { now: new Date(2026, 5, 24, 12, 0, 0),
      targetDate: new Date(2026, 5, 24, 0, 0, 0), obligations: [] });

    expect(result.activities).toHaveLength(1);
    expect(result.activities[0].startMinutes).toBeGreaterThanOrEqual(12 * 60);
  });
});
