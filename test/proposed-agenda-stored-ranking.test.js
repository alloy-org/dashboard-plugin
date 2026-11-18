// Verify that a fresh agenda consults the day's stored ranking before waiting on the Dashboard's work queue: a ranking
// stored for the current question places the day without waiting, one stored for an earlier question is shown as a
// provisional agenda while the queue prepares the current one, and the ranking is asked with the domain's native open
// tasks, as the queued preparation asks it.
import { jest } from "@jest/globals";
import { SETTING_KEYS } from "constants/settings";
import { setPluginData } from "plugin-data";
import { SAMPLE_TASKS } from "./fixtures/tasks.js";
import { mockFetchAiProvider } from "./mock-fetch-ai-provider.js";

const agendaSuggestionsMock = jest.fn();
const actualSuggestions = await import("dashboard/suggestions/ranked-task-suggestions");
await jest.unstable_mockModule("dashboard/suggestions/ranked-task-suggestions", async () => ({ ...actualSuggestions,
  agendaSuggestionsFromProjects: (...args) => agendaSuggestionsMock(...args), recordShownTaskSuggestions: jest.fn(async () => {}) }));
await mockFetchAiProvider({ llmPromptWithAmplenoteFallback: jest.fn(async () => ({ benefits: [] })) });
const { generateProposedAgenda } = await import("dashboard/proposed-agenda/proposed-agenda-service");

const TARGET_DATE = new Date(2026, 8, 21);
const PLACED_ACTIVITY = { candidateId: "task:task-7", durationMinutes: 30, isExisting: true, reason: "Top priority",
  source: "proposed", startMinutes: 600, startTime: "10:00", targetMidnightSeconds: Math.floor(TARGET_DATE.getTime() / 1000),
  taskUuid: "task-7", title: "Update budget" };

// ----------------------------------------------------------------------------------------------
// @desc A notebook with a quarterly plan and open tasks under the Work domain, with an OpenAI key.
// @returns {object} App stub.
function workApp() {
  setPluginData({ context: {}, settings: { [SETTING_KEYS.LLM_API_KEY_OPENAI]: "test-key", [SETTING_KEYS.LLM_PROVIDER_MODEL]: "openai",
    [SETTING_KEYS.TASK_DOMAINS]: JSON.stringify({ domains: [{ name: "Work", uuid: "dom-work" }], selectedDomainUuid: "dom-work" }) } });
  const openTasks = SAMPLE_TASKS.filter(task => !task.completedAt && !task.dismissedAt);
  return {
    alert: jest.fn(),
    createNote: jest.fn(async () => "agenda-note-uuid"),
    filterNotes: jest.fn(async ({ query } = {}) => query?.includes("Plan") ? [{ name: query, uuid: "plan-note-uuid" }] : []),
    findNote: jest.fn(async () => null),
    getNoteContent: jest.fn(async ({ uuid }) => uuid === "plan-note-uuid" ? "# Plan\n- Ship things" : ""),
    getTask: jest.fn(async uuid => openTasks.find(task => task.uuid === uuid) || null),
    getTaskDomains: jest.fn(async () => [{ name: "Work", uuid: "dom-work" }]),
    getTaskDomainTasks: jest.fn(async () => openTasks),
    replaceNoteContent: jest.fn(async () => true),
    setNoteName: jest.fn(async () => true),
    updateTask: jest.fn(async () => true),
  };
}

// ----------------------------------------------------------------------------------------------
// @desc An agendaSuggestionsFromProjects result.
// @param {object} options - { activities, current }.
// @returns {object} The result.
function rankedAgenda({ activities, current }) {
  return { activities, current, meetingKeys: [], rankerEm: "jev", reserveTasks: [] };
}

afterEach(() => {
  agendaSuggestionsMock.mockReset();
  setPluginData({ context: {}, settings: {} });
});

describe("a fresh agenda's stored ranking", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A ranking stored for the current question is the agenda, so the queue is never waited on, and the ranking
  //   is asked with the domain's native open tasks.
  it("places the day from a current stored ranking without waiting on the queue", async () => {
    agendaSuggestionsMock.mockResolvedValue(rankedAgenda({ activities: [PLACED_ACTIVITY], current: true }));
    const rankingPreparer = jest.fn(async () => ({ status: "completed" }));
    const result = await generateProposedAgenda(workApp(), { domainName: "Work", domainUuid: "dom-work", rankingPreparer,
      targetDate: TARGET_DATE });
    expect(rankingPreparer).not.toHaveBeenCalled();
    expect(agendaSuggestionsMock).toHaveBeenCalledTimes(1);
    const [, rankingOptions] = agendaSuggestionsMock.mock.calls[0];
    expect(rankingOptions.storedOnly).toBe(true);
    expect(rankingOptions.openTasks.length).toBeGreaterThan(0);
    expect(rankingOptions.openTasks.every(task => task.uuid && "content" in task)).toBe(true);
    expect(result.activities.map(activity => activity.taskUuid)).toEqual(["task-7"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A ranking stored for an earlier question is shown provisionally before the queue is waited on, and the
  //   day is then ranked again.
  it("shows an earlier stored ranking while the current one is prepared", async () => {
    const events = [];
    agendaSuggestionsMock.mockImplementation(async (app, { storedOnly }) => storedOnly
      ? rankedAgenda({ activities: [PLACED_ACTIVITY], current: false }) : rankedAgenda({ activities: [PLACED_ACTIVITY], current: true }));
    const rankingPreparer = jest.fn(async () => {
      events.push("prepared");
      return { status: "completed" };
    });
    const onProvisionalAgenda = jest.fn(() => events.push("provisional"));
    await generateProposedAgenda(workApp(), { domainName: "Work", domainUuid: "dom-work", onProvisionalAgenda, rankingPreparer,
      targetDate: TARGET_DATE });
    expect(events).toEqual(["provisional", "prepared"]);
    expect(onProvisionalAgenda.mock.calls[0][0]).toMatchObject({ activities: [PLACED_ACTIVITY], fromCache: false, scheduledKeys: [] });
    expect(rankingPreparer).toHaveBeenCalledWith({ domainName: "Work", domainUuid: "dom-work", surface: "agenda", targetDate: TARGET_DATE });
    expect(agendaSuggestionsMock).toHaveBeenCalledTimes(2);
    expect(agendaSuggestionsMock.mock.calls[1][1].storedOnly).toBeUndefined();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc An earlier ranking that places nothing is not shown, so the widget keeps its loading state rather than
  //   flashing an empty day.
  it("publishes nothing when the earlier ranking places no task", async () => {
    agendaSuggestionsMock.mockImplementation(async (app, { storedOnly }) => storedOnly
      ? rankedAgenda({ activities: [], current: false }) : rankedAgenda({ activities: [PLACED_ACTIVITY], current: true }));
    const onProvisionalAgenda = jest.fn();
    const rankingPreparer = jest.fn(async () => ({ status: "completed" }));
    await generateProposedAgenda(workApp(), { domainName: "Work", domainUuid: "dom-work", onProvisionalAgenda, rankingPreparer,
      targetDate: TARGET_DATE });
    expect(onProvisionalAgenda).not.toHaveBeenCalled();
    expect(rankingPreparer).toHaveBeenCalledTimes(1);
  });
});
