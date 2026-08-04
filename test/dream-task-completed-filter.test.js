// [Cursor Grok 4.5-authored file]
// Created: 2026-08-04 | Model: Cursor Grok 4.5
// Task: Goal Coach must not re-suggest Amplenote tasks that are already completed
// Prompt summary: "confirm the task has not already been completed before it is suggested"
import { jest } from "@jest/globals";
import { SETTING_KEYS } from "constants/settings";
import { setPluginData } from "plugin-data";

const llmMock = jest.fn();
await jest.unstable_mockModule("providers/fetch-ai-provider", async () => ({
  llmPromptWithPluginFallback: (...args) => llmMock(...args),
}));
const { analyzeDreamTasks } = await import("dream-task-service");

const TODAY_NOTE = `Dashboard proposed tasks for ${ new Date().toLocaleString([], {
  year: "numeric", month: "long", day: "numeric",
}) }`;

const CACHED_NOTE = `**Your goals this quarter/month/week:**
Ship the launch.

### 1. Draft launch email (Rating: 8/10)
<!-- task:task-1 -->
<!-- suggestion:sug-1 -->
Matches the plan.

---
`;

// ----------------------------------------------------------------------------------------------
// @desc Stub app with a cached Goal Coach note whose linked Amplenote task is already completed.
// @returns {object}
function buildCachedCompletedApp() {
  setPluginData({
    context: {},
    settings: {
      [SETTING_KEYS.LLM_API_KEY_OPENAI]: "test-key",
      [SETTING_KEYS.LLM_PROVIDER_MODEL]: "openai",
      [SETTING_KEYS.TASK_DOMAINS]: JSON.stringify({
        domains: [{ name: "Work", uuid: "dom-work" }], selectedDomainUuid: "dom-work",
      }),
    },
  });
  return {
    createNote: jest.fn(async () => "dream-note-uuid"),
    filterNotes: jest.fn(async ({ query }) => query?.includes("Plan") ? [{ name: query, uuid: "plan-note-uuid" }] : []),
    findNote: jest.fn(async ({ name }) => name?.startsWith("Dashboard proposed tasks")
      ? { name, uuid: "dream-note-uuid" } : null),
    getNoteContent: jest.fn(async ({ uuid }) => {
      if (uuid === "dream-note-uuid") return CACHED_NOTE;
      if (uuid === "plan-note-uuid") return "# Plan\n- Launch";
      return "";
    }),
    getTask: jest.fn(async uuid => uuid === "task-1"
      ? { completedAt: Math.floor(Date.now() / 1000), content: "Draft launch email", noteUUID: "project-note",
        uuid: "task-1" }
      : null),
    getTaskDomains: jest.fn(async () => [{ name: "Work", uuid: "dom-work" }]),
    getTaskDomainTasks: jest.fn(async () => [
      { content: "Write follow-up", noteUUID: "project-note", score: 9, uuid: "task-2" },
    ]),
    replaceNoteContent: jest.fn(async () => true),
    setNoteName: jest.fn(async () => true),
  };
}

beforeEach(() => {
  llmMock.mockReset();
  llmMock.mockResolvedValue({
    goalsSummary: "Ship the launch.",
    tasks: [{ explanation: "Still open.", rating: 8, title: "Write follow-up", uuid: "task-2" }],
  });
});

describe("Goal Coach completed-task filtering", () => {
  it("skips a cached suggestion when its Amplenote task is already completed and regenerates", async () => {
    const app = buildCachedCompletedApp();
    const result = await analyzeDreamTasks(app, { minimumTaskCount: 1, noteName: TODAY_NOTE });

    expect(result.error).toBeUndefined();
    const suggestedUuids = (result.tasks || []).map(task => task.uuid).filter(Boolean);
    expect(suggestedUuids).not.toContain("task-1");
    expect(suggestedUuids).toContain("task-2");
    expect(llmMock).toHaveBeenCalled();
    expect(result.cached).toBe(false);
  });

  it("serves cache when the linked Amplenote task is still open", async () => {
    const app = buildCachedCompletedApp();
    app.getTask.mockImplementation(async uuid => uuid === "task-1"
      ? { content: "Draft launch email", noteUUID: "project-note", uuid: "task-1" }
      : null);
    const result = await analyzeDreamTasks(app, { minimumTaskCount: 1, noteName: TODAY_NOTE });

    expect(result.cached).toBe(true);
    expect(result.tasks.map(task => task.uuid)).toContain("task-1");
    expect(llmMock).not.toHaveBeenCalled();
  });

  it("does not show the same Amplenote task twice when a top-up regenerates after completion", async () => {
    const duplicateCacheNote = `**Your goals this quarter/month/week:**
Ship the launch.

### 1. Write follow-up (Rating: 8/10)
<!-- task:task-2 -->
<!-- suggestion:sug-old -->
Earlier explanation.

---
`;
    const app = buildCachedCompletedApp();
    app.getNoteContent.mockImplementation(async ({ uuid }) => {
      if (uuid === "dream-note-uuid") return duplicateCacheNote;
      if (uuid === "plan-note-uuid") return "# Plan\n- Launch";
      return "";
    });
    app.getTask.mockImplementation(async uuid => uuid === "task-2"
      ? { content: "Write follow-up", noteUUID: "project-note", uuid: "task-2" }
      : null);
    app.getTaskDomainTasks.mockResolvedValue([
      { content: "Write follow-up", noteUUID: "project-note", score: 9, uuid: "task-2" },
      { content: "Draft launch email", noteUUID: "project-note", score: 8, uuid: "task-1" },
    ]);
    llmMock.mockResolvedValue({
      goalsSummary: "Ship the launch.",
      tasks: [
        { explanation: "Fresh explanation.", rating: 10, title: "Write follow-up", uuid: "task-2" },
        { explanation: "Another open task.", rating: 8, title: "Draft launch email", uuid: "task-1" },
      ],
    });

    const result = await analyzeDreamTasks(app, { minimumTaskCount: 2, noteName: TODAY_NOTE });
    const followUpCards = (result.tasks || []).filter(task => task.uuid === "task-2"
      || (task.title || "").toLowerCase() === "write follow-up");
    expect(followUpCards).toHaveLength(1);
    expect(result.tasks.filter(task => task.uuid === "task-1")).toHaveLength(1);
  });
});
