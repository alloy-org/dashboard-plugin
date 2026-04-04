/**
 * [Claude-authored file]
 * Created: 2026-04-04 | Model: claude-4.6-opus-high-thinking
 * Task: DreamTask retry-on-API-key-addition integration test
 * Prompt summary: "test that DreamTask retries when a new API key is added, using a real Anthropic call"
 */
import { jest } from "@jest/globals";
import dotenv from "dotenv";
import fetch from "isomorphic-fetch";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import DreamTaskWidget from "../lib/dashboard/dream-task.js";
import { DASHBOARD_NOTE_TAG, SETTING_KEYS } from "../lib/constants/settings.js";
import { SAMPLE_TASKS } from "./fixtures/tasks.js";

dotenv.config();
global.fetch = fetch;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ANTHROPIC_KEY = process.env.ANTHROPIC_AI_ACCESS_TOKEN;
const itIfKey = ANTHROPIC_KEY ? it : it.skip;

const MOCK_QUARTERLY_PLAN = `# Q2 2026 Plan

## Focus areas
1. Launch Task Agent Pro product
2. Build daily outreach habit
3. Complete one GitKraken ticket per day

### April
- Focus: Dashboard polish and API key onboarding
- Key move: Improve DreamTask retry behavior`;

// [Claude] Task: derive today's note name identically to the DreamTask component
// Date: 2026-04-04 | Model: claude-4.6-opus-high-thinking
function todayNoteName() {
  const label = new Date().toLocaleString([], { year: "numeric", month: "long", day: "numeric" });
  return `Dashboard proposed tasks for ${label}`;
}

// [Claude] Task: build mock app with mutable settings for simulating API key addition
// Prompt: "test that DreamTask retries when a new API key is added"
// Date: 2026-04-04 | Model: claude-4.6-opus-high-thinking
function buildMockApp(initialSettings = {}) {
  let dreamNoteContent = "";

  const app = {
    settings: { ...initialSettings },
    alert: jest.fn(),
    findNote: jest.fn().mockResolvedValue({ uuid: "dream-note-uuid" }),
    createNote: jest.fn().mockResolvedValue("new-note-uuid"),
    getNoteContent: jest.fn().mockImplementation(({ uuid }) => {
      if (uuid === "plan-note-uuid") return Promise.resolve(MOCK_QUARTERLY_PLAN);
      if (uuid === "dream-note-uuid") return Promise.resolve(dreamNoteContent);
      return Promise.resolve("");
    }),
    setSetting: jest.fn().mockResolvedValue(undefined),
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
    navigate: jest.fn().mockResolvedValue(undefined),
  };

  return app;
}

async function waitForSelector(container, selector, timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await act(async () => { await new Promise(r => setTimeout(r, 1000)); });
    if (container.querySelector(selector)) return container.querySelector(selector);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for "${selector}"`);
}

// [Claude] Generated tests for: DreamTask retry-on-API-key-addition behavior
// Date: 2026-04-04 | Model: claude-4.6-opus-high-thinking
describe("DreamTaskWidget API key retry", () => {
  let container;
  let root;
  let savedOpenAiKey;

  beforeEach(() => {
    savedOpenAiKey = process.env.OPEN_AI_ACCESS_TOKEN;
    delete process.env.OPEN_AI_ACCESS_TOKEN;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (savedOpenAiKey) process.env.OPEN_AI_ACCESS_TOKEN = savedOpenAiKey;
    if (root) {
      await act(async () => { root.unmount(); });
      root = null;
    }
    container.remove();
  });

  itIfKey("shows no-config state without an API key, then retries and populates suggestions after adding one", async () => {
    const app = buildMockApp({
      [SETTING_KEYS.TASK_DOMAINS]: JSON.stringify({ selectedDomainUuid: "dom-work" }),
    });
    const onOpenSettings = jest.fn();

    await act(async () => {
      root.render(createElement(DreamTaskWidget, {
        app,
        gridHeightSize: 1,
        gridWidthSize: 1,
        onOpenSettings,
      }));
    });
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    expect(container.querySelector(".dream-task-no-config")).toBeTruthy();
    expect(container.querySelector(".dream-task-card")).toBeFalsy();

    app.settings[SETTING_KEYS.LLM_PROVIDER] = "anthropic";
    app.settings[SETTING_KEYS.LLM_API_KEY_ANTHROPIC] = ANTHROPIC_KEY;

    await act(async () => {
      root.render(createElement(DreamTaskWidget, {
        app,
        gridHeightSize: 1,
        gridWidthSize: 1,
        providerApiKey: ANTHROPIC_KEY,
        onOpenSettings,
      }));
    });
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    expect(container.querySelector(".dream-task-no-config")).toBeFalsy();

    await waitForSelector(container, ".dream-task-card", 90_000);

    const cards = container.querySelectorAll(".dream-task-card");
    expect(cards.length).toBeGreaterThanOrEqual(1);

    const titles = Array.from(container.querySelectorAll(".dream-task-card-title"));
    for (const title of titles) {
      expect(title.textContent.trim().length).toBeGreaterThan(0);
    }

    const ratings = Array.from(container.querySelectorAll(".dream-task-rating"));
    for (const rating of ratings) {
      expect(rating.textContent).toMatch(/\d+\/10/);
    }

    expect(app.replaceNoteContent).toHaveBeenCalled();
  }, 120_000);
});
