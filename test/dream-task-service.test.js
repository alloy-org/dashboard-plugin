/**
 * [Claude-authored file]
 * Created: 2026-03-24 | Model: claude-4.6-opus-high-thinking
 * Task: DreamTask round-trip integration test — real LLM call, verify cached read-back
 * Prompt summary: "use OPEN_AI_ACCESS_TOKEN for real LLM calls; mock only the app interface, not the AI"
 */
import { jest } from "@jest/globals";
import dotenv from "dotenv";
import fetch from "isomorphic-fetch";
import { analyzeDreamTasks } from "../lib/dream-task-service.js";
import { SETTING_KEYS } from "../lib/constants/settings.js";
import { SAMPLE_TASKS } from "./fixtures/tasks.js";

dotenv.config();
global.fetch = fetch;

const OPEN_AI_KEY = process.env.OPEN_AI_ACCESS_TOKEN;
const itIfKey = OPEN_AI_KEY ? it : it.skip;

const MOCK_QUARTERLY_PLAN = `# Q1 2026 Plan

## Focus areas
1. Launch Task Agent Pro product
2. Build daily outreach habit — reach out to one meaningful person each day
3. Complete one GitKraken ticket per day

### March
- Focus: Reliability patches and dashboard polish
- Key move: Complete DreamTask widget integration

### Week of March 23
- Primary focus: Dashboard testing and polish
- Key tasks: Write integration tests, fix edge cases`;

// [Claude] Task: derive today's note name identically to the DreamTask component
// Date: 2026-03-24 | Model: claude-4.6-opus-high-thinking
function todayNoteName() {
  const label = new Date().toLocaleString([], { year: "numeric", month: "long", day: "numeric" });
  return `Dashboard proposed tasks for ${label}`;
}

// [Claude] Task: build mock app backed by SAMPLE_TASKS and a quarterly plan note, with mutable dream note storage
// Prompt: "use OPEN_AI_ACCESS_TOKEN for real LLM calls; mock only the app interface"
// Date: 2026-03-24 | Model: claude-4.6-opus-high-thinking
function buildMockApp() {
  let dreamNoteContent = "";

  const app = {
    settings: {
      [SETTING_KEYS.TASK_DOMAINS]: JSON.stringify({ selectedDomainUuid: "dom-work" }),
      [SETTING_KEYS.LLM_PROVIDER_MODEL]: "openai",
      [SETTING_KEYS.LLM_API_KEY_OPENAI]: OPEN_AI_KEY,
    },
    alert: jest.fn(),
    findNote: jest.fn().mockResolvedValue({ uuid: "dream-note-uuid" }),
    createNote: jest.fn().mockResolvedValue("new-note-uuid"),
    getNoteContent: jest.fn().mockImplementation(({ uuid }) => {
      if (uuid === "plan-note-uuid") return Promise.resolve(MOCK_QUARTERLY_PLAN);
      if (uuid === "dream-note-uuid") return Promise.resolve(dreamNoteContent);
      return Promise.resolve("");
    }),
    getTaskDomains: jest.fn().mockResolvedValue([{ uuid: "dom-work", name: "Work" }]),
    getTaskDomainTasks: jest.fn().mockResolvedValue(SAMPLE_TASKS),
    filterNotes: jest.fn().mockImplementation(({ query }) => {
      if (query && query.includes("Plan")) {
        return Promise.resolve([{ name: query, uuid: "plan-note-uuid" }]);
      }
      return Promise.resolve([]);
    }),
    replaceNoteContent: jest.fn().mockImplementation((_handle, content) => {
      dreamNoteContent = content;
      return Promise.resolve(true);
    }),
  };

  return app;
}

// [Claude] Generated tests for: DreamTask write→read round-trip via real OpenAI LLM
// Date: 2026-03-24 | Model: claude-4.6-opus-high-thinking
describe("analyzeDreamTasks (requires OPEN_AI_ACCESS_TOKEN)", () => {
  itIfKey("generates suggestions via real LLM and reads them back from cache", async () => {
    const app = buildMockApp();
    const noteName = todayNoteName();

    const freshResult = await analyzeDreamTasks(app, {
      noteName,
      minimumTaskCount: 1,
      forceRefresh: false,
    });

    expect(freshResult.cached).toBe(false);
    expect(freshResult.tasks.length).toBeGreaterThanOrEqual(3);
    expect(freshResult.noteUUID).toBe("dream-note-uuid");
    expect(typeof freshResult.goalsSummary).toBe("string");
    expect(freshResult.goalsSummary.length).toBeGreaterThan(0);

    for (const task of freshResult.tasks) {
      expect(typeof task.title).toBe("string");
      expect(task.title.length).toBeGreaterThan(0);
      expect(typeof task.rating).toBe("number");
      expect(task.rating).toBeGreaterThanOrEqual(1);
      expect(task.rating).toBeLessThanOrEqual(10);
      expect(typeof task.explanation).toBe("string");
      expect(task.explanation.length).toBeGreaterThan(0);
    }

    const existingCount = freshResult.tasks.filter(t => t.isExisting).length;
    expect(existingCount).toBeGreaterThanOrEqual(Math.ceil(freshResult.tasks.length / 2));

    const validUuids = new Set(SAMPLE_TASKS.map(t => t.uuid));
    for (const task of freshResult.tasks.filter(t => t.isExisting)) {
      expect(validUuids.has(task.uuid)).toBe(true);
      expect(task.noteUUID).toBeTruthy();
    }

    expect(app.replaceNoteContent).toHaveBeenCalledTimes(1);

    const cachedResult = await analyzeDreamTasks(app, {
      noteName,
      minimumTaskCount: 1,
      forceRefresh: false,
    });

    expect(cachedResult.cached).toBe(true);
    expect(cachedResult.tasks.length).toBe(freshResult.tasks.length);

    for (let i = 0; i < freshResult.tasks.length; i++) {
      const fresh = freshResult.tasks[i];
      const cached = cachedResult.tasks[i];
      expect(cached.title).toBe(fresh.title);
      expect(cached.rating).toBe(fresh.rating);
      expect(cached.uuid).toBe(fresh.uuid);
      expect(cached.isExisting).toBe(fresh.isExisting);
      expect(cached.noteUUID).toBe(fresh.noteUUID);
      expect(cached.explanation).toBe(fresh.explanation);
    }

    expect(cachedResult.goalsSummary).toBe(freshResult.goalsSummary);

    expect(app.replaceNoteContent).toHaveBeenCalledTimes(1);
  }, 90_000);

  itIfKey("loads the quarterly plan note to build context for the LLM prompt", async () => {
    const app = buildMockApp();
    const noteName = todayNoteName();

    await analyzeDreamTasks(app, { noteName, minimumTaskCount: 1, forceRefresh: false });

    expect(app.filterNotes).toHaveBeenCalled();
    const filterCall = app.filterNotes.mock.calls[0][0];
    expect(filterCall.query).toMatch(/Q\d \d{4} Plan/);

    expect(app.getNoteContent).toHaveBeenCalledWith({ uuid: "plan-note-uuid" });
  }, 90_000);
});
