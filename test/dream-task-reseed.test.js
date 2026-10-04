// Verify that Reseed replaces the cards on today's Dream Task note with a new batch, even when the note already holds
// enough cards to be served from cache, keeping only cards the user asked to preserve.
import { jest } from "@jest/globals";
import { SETTING_KEYS } from "constants/settings";
import { setPluginData } from "plugin-data";
import { mockFetchAiProvider } from "./mock-fetch-ai-provider.js";

const llmMock = jest.fn();
await mockFetchAiProvider({ llmPromptWithPluginFallback: (...args) => llmMock(...args) });
const { analyzeDreamTasks } = await import("dream-task-service");

const TODAY_NOTE = `Dashboard proposed tasks for ${ new Date().toLocaleString([], { day: "numeric", month: "long", year: "numeric" }) }`;
const OPEN_TASKS = [
  { content: "Draft launch email", noteUUID: "project-note", score: 9, uuid: "task-1" },
  { content: "Book venue", noteUUID: "project-note", score: 8, uuid: "task-2" },
  { content: "Write follow-up", noteUUID: "project-note", score: 7, uuid: "task-3" },
];

// ----------------------------------------------------------------------------------------------
// @desc A cached note holding two open cards, the second marked to be preserved through tomorrow.
// @returns {string} Note markdown.
function cachedNote() {
  return "## DreamTask suggestions generated 09:00:00\n\n### 1. Draft launch email (Rating: 8/10)\n<!-- task:task-1 -->\n" +
    "<!-- suggestion:sug-1 -->\nMatches the plan.\n\n### 2. Book venue (Rating: 7/10)\n<!-- task:task-2 -->\n<!-- suggestion:sug-2 -->\n" +
    "<!-- dream-preserve:through-tomorrow -->\nNeeded soon.\n\n---\n";
}

// ----------------------------------------------------------------------------------------------
// @desc Stub app with today's cached note and three open tasks under the Work domain.
// @returns {object} App stub.
function cachedApp() {
  setPluginData({ context: {}, settings: { [SETTING_KEYS.LLM_API_KEY_OPENAI]: "test-key", [SETTING_KEYS.LLM_PROVIDER_MODEL]: "openai",
    [SETTING_KEYS.TASK_DOMAINS]: JSON.stringify({ domains: [{ name: "Work", uuid: "dom-work" }], selectedDomainUuid: "dom-work" }) } });
  return {
    createNote: jest.fn(async () => "dream-note-uuid"),
    filterNotes: jest.fn(async ({ query } = {}) => query?.includes("Plan") ? [{ name: query, uuid: "plan-note-uuid" }] : []),
    findNote: jest.fn(async ({ name } = {}) => name?.startsWith("Dashboard proposed tasks") ? { name, uuid: "dream-note-uuid" } : null),
    getNoteContent: jest.fn(async ({ uuid }) => uuid === "dream-note-uuid" ? cachedNote() : uuid === "plan-note-uuid" ? "# Plan\n- Launch" : ""),
    getTask: jest.fn(async uuid => OPEN_TASKS.find(task => task.uuid === uuid) || null),
    getTaskDomains: jest.fn(async () => [{ name: "Work", uuid: "dom-work" }]),
    getTaskDomainTasks: jest.fn(async () => OPEN_TASKS),
    replaceNoteContent: jest.fn(async () => true),
    setNoteName: jest.fn(async () => true),
  };
}

beforeEach(() => {
  llmMock.mockReset();
  llmMock.mockResolvedValue({ goalsSummary: "Ship the launch.", tasks: [{ explanation: "Still open.", rating: 8, title: "Write follow-up",
    uuid: "task-3" }] });
});

afterEach(() => setPluginData({ context: {}, settings: {} }));

describe("Dream Task reseed", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Without a forced refresh, a note holding enough cards is served as it is.
  it("serves the cached note when it holds enough cards", async () => {
    const result = await analyzeDreamTasks(cachedApp(), { minimumTaskCount: 2, noteName: TODAY_NOTE });
    expect(result.cached).toBe(true);
    expect(result.tasks.map(task => task.uuid)).toEqual(["task-1", "task-2"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A forced refresh generates a new batch excluding the cards on the note, and keeps only the preserved card.
  it("replaces unpreserved cards with a new batch when forced", async () => {
    const app = cachedApp();
    const result = await analyzeDreamTasks(app, { forceRefresh: true, minimumTaskCount: 2, noteName: TODAY_NOTE });
    expect(result.cached).toBe(false);
    expect(result.tasks.map(task => task.uuid)).toEqual(["task-3", "task-2"]);
    const prompt = llmMock.mock.calls[0][1];
    expect(prompt).not.toContain("\"uuid\":\"task-1\"");
    expect(app.replaceNoteContent).toHaveBeenCalled();
  });
});
