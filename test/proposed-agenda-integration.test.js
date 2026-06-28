/**
 * [Claude claude-opus-4-8 (1M context)-authored file]
 * Created: 2026-06-27 | Model: claude-opus-4-8[1m]
 * Task: Integration test for generateProposedAgenda — calls the real OpenAI API through the actual service
 *   path and asserts the proposed hour-by-hour schedule is usable (valid times, >=1hr gaps, real task UUIDs).
 * Prompt summary: "needs tests that actually call LLM to confirm usable response"
 */
import { jest } from "@jest/globals";
import dotenv from "dotenv";
import fetch from "isomorphic-fetch";
import { generateProposedAgenda } from "proposed-agenda-service";
import { SETTING_KEYS } from "constants/settings";
import { setPluginData } from "plugin-data";
import { SAMPLE_TASKS } from "./fixtures/tasks.js";

dotenv.config();
global.fetch = fetch;

const OPEN_AI_KEY = process.env.OPEN_AI_ACCESS_TOKEN;
const itIfKey = OPEN_AI_KEY ? it : it.skip;

const PLAN_NOTE_UUID = "plan-note-uuid";
const TEST_QUARTERLY_CONTENT = `# Q2 2026 Plan

## Focus areas
1. Launch Task Agent Pro product
2. Build a daily outreach habit — reach out to one meaningful person each day
3. Complete one GitKraken ticket per day

## June
- Focus:
    1. Reach out to meaningful people daily
    1. GitKraken ticket per day
    1. Launch Task Agent Pro`;

// ----------------------------------------------------------------------------------------------
// @desc Resolve the plan-note name the service looks up ("QN YYYY Plan") so filterNotes/getNoteContent
//   stubs can match it without duplicating the quarter-label logic.
// [Claude claude-opus-4-8 (1M context)] Task: derive the current quarter's plan note name for the stub
function currentQuarterPlanName() {
  const now = new Date();
  const quarter = Math.floor(now.getMonth() / 3) + 1;
  return `Q${ quarter } ${ now.getFullYear() } Plan`;
}

// ----------------------------------------------------------------------------------------------
// @desc Build an app stub that returns real fixture tasks + quarterly plan content but forces the LLM call
//   to bypass the Ample Agent Pro callPlugin fallback so the real OpenAI request is exercised.
// @returns {object} Amplenote-app-shaped stub.
// [Claude claude-opus-4-8 (1M context)] Task: stub the note/task surface while keeping the LLM call real
function buildProposedAgendaApp() {
  setPluginData({
    settings: { [SETTING_KEYS.LLM_PROVIDER_MODEL]: "openai", [SETTING_KEYS.LLM_API_KEY_OPENAI]: OPEN_AI_KEY },
    context: {},
  });
  const planName = currentQuarterPlanName();
  const openTasks = SAMPLE_TASKS.filter(task => !task.completedAt && !task.dismissedAt);
  return {
    alert: jest.fn(),
    callPlugin: jest.fn().mockResolvedValue(undefined),
    filterNotes: jest.fn().mockResolvedValue([{ name: planName, uuid: PLAN_NOTE_UUID }]),
    findNote: jest.fn().mockResolvedValue(null),
    getNoteContent: jest.fn().mockResolvedValue(TEST_QUARTERLY_CONTENT),
    getTaskDomains: jest.fn().mockResolvedValue([{ name: "Work", uuid: "dom-work" }]),
    getTaskDomainTasks: jest.fn().mockResolvedValue(openTasks),
  };
}

// [Claude claude-opus-4-8 (1M context)] Generated tests for: generateProposedAgenda real-LLM schedule
describe("generateProposedAgenda integration (requires OPEN_AI_ACCESS_TOKEN)", () => {
  itIfKey("returns a usable hour-by-hour schedule with valid times and a >=1hr gap between activities", async () => {
    const app = buildProposedAgendaApp();
    const result = await generateProposedAgenda(app, { aiModelOverride: "gpt-4o-mini" });

    // No structured error — the service parsed a usable response.
    expect(result.error).toBeUndefined();
    expect(Array.isArray(result.activities)).toBe(true);
    expect(result.activities.length).toBeGreaterThanOrEqual(1);
    expect(typeof result.dateLabel).toBe("string");

    const fixtureUuids = new Set(SAMPLE_TASKS.map(task => task.uuid));
    let previousEndMinutes = null;
    for (const activity of result.activities) {
      // Each activity carries a parseable HH:MM start and matching startMinutes.
      expect(activity.startTime).toMatch(/^\d{2}:\d{2}$/);
      expect(typeof activity.startMinutes).toBe("number");
      expect(activity.startMinutes).toBeGreaterThanOrEqual(0);
      expect(activity.startMinutes).toBeLessThan(24 * 60);
      expect(typeof activity.title).toBe("string");
      expect(activity.title.length).toBeGreaterThan(0);
      expect(activity.durationMinutes).toBeGreaterThanOrEqual(0);

      // taskUuid is either null (invented) or a real fixture UUID — the service drops hallucinated ids.
      if (activity.taskUuid !== null) {
        expect(fixtureUuids.has(activity.taskUuid)).toBe(true);
        expect(activity.isExisting).toBe(true);
      }

      // Activities are chronologically ordered and leave at least one hour between them.
      if (previousEndMinutes !== null) {
        expect(activity.startMinutes - previousEndMinutes).toBeGreaterThanOrEqual(60);
      }
      previousEndMinutes = activity.startMinutes + activity.durationMinutes;
    }

    // At least one proposed activity should map back to a real candidate task.
    const existingCount = result.activities.filter(activity => activity.isExisting).length;
    expect(existingCount).toBeGreaterThanOrEqual(1);
  }, 60_000);

  itIfKey("re-derives note UUIDs from candidate tasks so approved existing activities can be scheduled", async () => {
    const app = buildProposedAgendaApp();
    const result = await generateProposedAgenda(app, { aiModelOverride: "gpt-4o-mini" });

    const noteUuidByTaskUuid = new Map(SAMPLE_TASKS.map(task => [task.uuid, task.noteUUID]));
    for (const activity of result.activities) {
      if (!activity.isExisting) continue;
      // Existing activities expose the owning note UUID drawn from the candidate task, not the LLM.
      expect(activity.noteUuid).toBe(noteUuidByTaskUuid.get(activity.taskUuid));
    }
  }, 60_000);
});
