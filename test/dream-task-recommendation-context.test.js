// [OpenAI GPT-5.5-authored file]
// Created: 2026-08-02 | Model: GPT-5.5
// Task: Verify Goal Coach prompt includes shared day recommendation context.
// Prompt summary: "Assert source-note completion patterns and all-day travel guidance reach the DreamTask LLM."
import { jest } from "@jest/globals";
import { SETTING_KEYS } from "constants/settings";
import { setPluginData } from "plugin-data";

let lastPromptSent = null;
const llmMock = jest.fn();

await jest.unstable_mockModule("providers/fetch-ai-provider", async () => ({
  llmPromptWithPluginFallback: (...args) => llmMock(...args),
}));

const { analyzeDreamTasks } = await import("dream-task-service");

// ----------------------------------------------------------------------------------------------
// @desc Build an app stub that reaches DreamTask's fresh LLM path with shared recommendation context available.
// @returns {object} Amplenote-app-shaped stub.
// [OpenAI GPT-5.5] Task: stub DreamTask context surfaces for prompt assertions
function buildDreamTaskContextApp() {
  setPluginData({
    context: {},
    settings: { [SETTING_KEYS.LLM_API_KEY_OPENAI]: "test-key",
      [SETTING_KEYS.LLM_PROVIDER_MODEL]: "openai", [SETTING_KEYS.TASK_DOMAINS]: JSON.stringify({
      domains: [{ name: "Work", uuid: "dom-work" }], selectedDomainUuid: "dom-work" }) },
  });
  return {
    createNote: jest.fn(async () => "dream-note-uuid"),
    filterNotes: jest.fn(async ({ query }) => query?.includes("Plan") ? [{ name: query, uuid: "plan-note-uuid" }] : []),
    findNote: jest.fn(async ({ name, uuid }) => {
      if (uuid === "project-note") return { name: "GitClear marketing", uuid };
      if (name?.startsWith("Dashboard proposed tasks")) return { name, uuid: "dream-note-uuid" };
      return null;
    }),
    getCompletedTasks: jest.fn(async () => [{ completedAt: Math.floor(Date.now() / 1000), content: "Ship campaign",
      noteName: "GitClear marketing", noteUUID: "project-note", uuid: "done-1" }]),
    getExternalCalendarEvents: jest.fn(async () => [{ allDay: true, end: new Date(Date.now() + 86400000),
      start: new Date(), title: "Conference travel to Portland" }]),
    getNoteContent: jest.fn(async ({ uuid }) => uuid === "plan-note-uuid" ? "# Plan\n- Launch dashboard polish" : ""),
    getTask: jest.fn(async uuid => uuid === "task-1"
      ? { content: "Draft launch email", noteUUID: "project-note", score: 10, uuid: "task-1" }
      : null),
    getTaskDomains: jest.fn(async () => [{ name: "Work", uuid: "dom-work" }]),
    getTaskDomainTasks: jest.fn(async () => [
      { content: "Draft launch email", noteUUID: "project-note", score: 10, uuid: "task-1" },
      { completedAt: Math.floor(Date.now() / 1000), content: "Ship campaign", noteUUID: "project-note",
        uuid: "done-1" },
    ]),
    replaceNoteContent: jest.fn(async () => true),
    setNoteName: jest.fn(async () => true),
  };
}

beforeEach(() => {
  lastPromptSent = null;
  llmMock.mockReset();
  llmMock.mockImplementation(async (_app, prompt) => {
    lastPromptSent = prompt;
    return { goalsSummary: "Launch dashboard polish.", tasks: [{ explanation: "Matches the plan.", rating: 8,
      title: "Draft launch email", uuid: "task-1" }] };
  });
});

// [OpenAI GPT-5.5] Generated tests for: DreamTask shared recommendation context prompt
describe("DreamTask recommendation context prompt", () => {
  it("passes same-weekday source-note completions and all-day travel overrides to the LLM", async () => {
    const app = buildDreamTaskContextApp();
    const result = await analyzeDreamTasks(app, { minimumTaskCount: 1,
      noteName: `Dashboard proposed tasks for ${ new Date().toLocaleString([], { year: "numeric", month: "long",
        day: "numeric" }) }` });

    expect(result.error).toBeUndefined();
    expect(lastPromptSent).toContain("Day-specific recommendation context");
    expect(lastPromptSent).toContain("GitClear marketing");
    expect(lastPromptSent).toContain("All-day event override");
    expect(lastPromptSent).toContain("Conference travel to Portland");
    expect(lastPromptSent).toContain("\"noteUuid\":\"project-note\"");
  });
});
