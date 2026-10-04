// Verify that Dream Task and the Proposed Agenda let the Dashboard's work queue prepare the day's shared ranking before
// ranking a day on a cold cache, and that a Dream Task generation excluding cards, which asks a different question
// than the queue prepares, ranks the day itself.
import { jest } from "@jest/globals";
import { SETTING_KEYS } from "constants/settings";
import { setPluginData } from "plugin-data";
import { SAMPLE_TASKS } from "./fixtures/tasks.js";
import { mockFetchAiProvider } from "./mock-fetch-ai-provider.js";

const llmMock = jest.fn();
await mockFetchAiProvider({ llmPromptWithPluginFallback: (...args) => llmMock(...args) });
const { analyzeDreamTasks } = await import("dream-task-service");
const { generateProposedAgenda } = await import("proposed-agenda-service");

const TODAY_NOTE = `Dashboard proposed tasks for ${ new Date().toLocaleString([], { day: "numeric", month: "long", year: "numeric" }) }`;

// ----------------------------------------------------------------------------------------------
// @desc A notebook with a quarterly plan, open tasks, and an empty Dream Task note, under the Work domain with an
//   OpenAI key and no Jev, so ranking falls back to the mocked generative model.
// @returns {object} App stub.
function coldApp() {
  setPluginData({ context: {}, settings: { [SETTING_KEYS.LLM_API_KEY_OPENAI]: "test-key", [SETTING_KEYS.LLM_PROVIDER_MODEL]: "openai",
    [SETTING_KEYS.TASK_DOMAINS]: JSON.stringify({ domains: [{ name: "Work", uuid: "dom-work" }], selectedDomainUuid: "dom-work" }) } });
  const openTasks = SAMPLE_TASKS.filter(task => !task.completedAt && !task.dismissedAt);
  return {
    alert: jest.fn(),
    callPlugin: jest.fn(async () => undefined),
    createNote: jest.fn(async () => "dream-note-uuid"),
    filterNotes: jest.fn(async ({ query } = {}) => query?.includes("Plan") ? [{ name: query, uuid: "plan-note-uuid" }] : []),
    findNote: jest.fn(async ({ name } = {}) => name?.startsWith("Dashboard proposed tasks") ? { name, uuid: "dream-note-uuid" } : null),
    getNoteContent: jest.fn(async ({ uuid }) => uuid === "plan-note-uuid" ? "# Plan\n- Ship things" : ""),
    getTask: jest.fn(async uuid => openTasks.find(task => task.uuid === uuid) || null),
    getTaskDomains: jest.fn(async () => [{ name: "Work", uuid: "dom-work" }]),
    getTaskDomainTasks: jest.fn(async () => openTasks),
    replaceNoteContent: jest.fn(async () => true),
    setNoteName: jest.fn(async () => true),
    updateTask: jest.fn(async () => true),
  };
}

beforeEach(() => {
  llmMock.mockReset();
  llmMock.mockResolvedValue({ activities: [{ durationMinutes: 60, reason: "Top priority", startTime: "09:00", taskUuid: "task-7",
    title: "Update budget" }], goalsSummary: "Ship things.", tasks: [{ explanation: "Open.", rating: 8, title: "Update budget",
    uuid: "task-7" }] });
});

afterEach(() => setPluginData({ context: {}, settings: {} }));

describe("Dream Task's ranking preparation", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A cold note excluding nothing asks the queue to prepare today before ranking it.
  it("asks the queue to prepare today's ranking before a cold generation", async () => {
    const rankingPreparer = jest.fn(async () => ({ status: "completed" }));
    const result = await analyzeDreamTasks(coldApp(), { minimumTaskCount: 1, noteName: TODAY_NOTE, rankingPreparer });
    expect(rankingPreparer).toHaveBeenCalledTimes(1);
    expect(rankingPreparer).toHaveBeenCalledWith({ domainName: "Work", domainUuid: "dom-work", targetDate: expect.any(Date) });
    expect(result.tasks.length).toBeGreaterThan(0);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A reseed excluding recently seen cards asks a question the queue does not prepare.
  it("ranks the day itself when the generation excludes cards", async () => {
    const rankingPreparer = jest.fn(async () => ({ status: "completed" }));
    await analyzeDreamTasks(coldApp(), { excludeUuids: new Set(["task-3"]), minimumTaskCount: 1, noteName: TODAY_NOTE, rankingPreparer });
    expect(rankingPreparer).not.toHaveBeenCalled();
  });
});

describe("the agenda's ranking preparation", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A fresh schedule asks the queue to prepare the day it plans before ranking it.
  it("asks the queue to prepare the planned day before ranking it", async () => {
    const rankingPreparer = jest.fn(async () => ({ status: "completed" }));
    const targetDate = new Date(2026, 8, 21);
    const result = await generateProposedAgenda(coldApp(), { domainName: "Work", domainUuid: "dom-work", rankingPreparer, targetDate });
    expect(rankingPreparer).toHaveBeenCalledWith({ domainName: "Work", domainUuid: "dom-work", targetDate });
    expect(result.activities).toEqual(expect.arrayContaining([expect.objectContaining({ taskUuid: "task-7" })]));
  });
});
