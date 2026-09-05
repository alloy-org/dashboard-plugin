// [Claude claude-opus-5[1m]-authored file]
// Prompt summary: "when we are prompting the LLM, include the tables of what was approved/rejected historically
//   over the last 2 months — and record an approval when a suggestion the widget never scheduled turns up
//   committed to the day (the calendar accepted it)"
import { jest } from "@jest/globals";
import { SETTING_KEYS } from "constants/settings";
import { setPluginData } from "plugin-data";
import { localMidnightFromDateInput } from "util/date-utility";

// The LLM call is mocked so the composed prompt can be captured and no network is touched.
let lastPromptSent = null;
const llmMock = jest.fn();

await jest.unstable_mockModule("providers/fetch-ai-provider", async () => ({
  llmPromptWithPluginFallback: (...args) => llmMock(...args),
}));

const { AGENDA_DECISION, decisionLogNoteName, recordAgendaDecisions } = await import("proposed-agenda-decision-log");
const { generateProposedAgenda } = await import("proposed-agenda-service");

const DOMAIN_NAME = "Work";
const DOMAIN_UUID = "dom-work";
const PRIORITY = "goal-progress";
const TARGET_DATE = localMidnightFromDateInput(new Date());

// An obligation shaped as obligationsFromTasksAndEvents produces it, standing in for the task the user accepted
// from the calendar's suggestion list.
const ACCEPTED_OBLIGATION = { durationMinutes: 60, source: "task", startMinutes: 9 * 60, taskUuid: "task-1",
  title: "Ship the thing" };

// ----------------------------------------------------------------------------------------------
// @desc In-memory Amplenote app with the note, task-domain, and task surface generation needs, so archive and
//   decision-log writes persist across calls within one test.
// @returns {object} App stub with a `_notes` array for inspection.
// [Claude claude-opus-5[1m]] Task: note-persisting generation stub for decision-history tests
function buildGenerationApp() {
  setPluginData({ context: {},
    settings: { [SETTING_KEYS.LLM_API_KEY_OPENAI]: "test-key", [SETTING_KEYS.LLM_PROVIDER_MODEL]: "openai" } });
  const notes = [];
  let counter = 0;
  const tasks = [{ content: "Ship the thing", noteUUID: "note-1", uuid: "task-1" },
    { content: "Follow up with partner", noteUUID: "note-2", uuid: "task-2" }];
  return {
    alert: jest.fn(),
    createNote: jest.fn(async (name, tags, options) => { const uuid = `note-stub-${ ++counter }`;
      notes.push({ content: "", name, options, tags, uuid }); return uuid; }),
    filterNotes: jest.fn(async () => []),
    findNote: jest.fn(async ({ name }) => notes.find(note => note.name === name) || null),
    getNoteContent: jest.fn(async ({ uuid }) => notes.find(note => note.uuid === uuid)?.content ?? ""),
    getTask: jest.fn(async uuid => tasks.find(task => task.uuid === uuid) || null),
    getTaskDomains: jest.fn(async () => [{ name: DOMAIN_NAME, uuid: DOMAIN_UUID }]),
    getTaskDomainTasks: jest.fn(async () => tasks),
    replaceNoteContent: jest.fn(async (handle, content) => { const note = notes.find(n => n.uuid === handle.uuid);
      if (note) note.content = content; }),
    _notes: notes,
  };
}

// ----------------------------------------------------------------------------------------------
// @desc Read the decision-log note's markdown back out of the app stub.
// @param {object} app - The in-memory app stub.
// @returns {string} Note content ("" when the note was never created).
function decisionNoteContent(app) {
  return app._notes.find(note => note.name === decisionLogNoteName(DOMAIN_NAME))?.content ?? "";
}

// ----------------------------------------------------------------------------------------------
// @desc Generate an agenda for today's date against the stub, with the supplied obligations.
// @param {object} app - The in-memory app stub.
// @param {Array<object>} [obligations] - The day's committed tasks/events.
// @returns {Promise<object>} generateProposedAgenda's payload.
function generateForToday(app, obligations = []) {
  return generateProposedAgenda(app, { domainName: DOMAIN_NAME, domainUuid: DOMAIN_UUID, obligations,
    priorityKey: PRIORITY, targetDate: TARGET_DATE });
}

beforeEach(() => {
  lastPromptSent = null;
  llmMock.mockReset();
  llmMock.mockImplementation(async (_app, prompt) => {
    lastPromptSent = prompt;
    return { activities: [{ durationMinutes: 60, reason: "Top priority", startTime: "09:00", taskUuid: "task-1",
      title: "Ship the thing" }] };
  });
});

// [Claude claude-opus-5[1m]] Generated tests for: approve/reject history in the prompt and calendar-side approvals
describe("proposed agenda decision history", () => {
  it("sends the last two months of approve/reject tables to the LLM", async () => {
    const app = buildGenerationApp();
    await recordAgendaDecisions(app, { domainName: DOMAIN_NAME, decisions: [
      { decidedAt: new Date(), decisionLabel: AGENDA_DECISION.APPROVED, taskTitle: "Draft the Q4 roadmap",
        themeLabel: "Goal progress" },
      { decidedAt: new Date(), decisionLabel: AGENDA_DECISION.REJECTED, taskTitle: "Reorganize the bookmarks",
        themeLabel: "Barnacle cleanup" }] });

    await generateForToday(app);

    expect(lastPromptSent).toContain("How the user responded to your past suggestions (last 2 months)");
    expect(lastPromptSent).toContain("| Approved | Draft the Q4 roadmap | Goal progress |");
    expect(lastPromptSent).toContain("| Rejected | Reorganize the bookmarks | Barnacle cleanup |");
    expect(lastPromptSent).toContain("do not re-propose a task they have repeatedly rejected");
  });

  it("omits the history section entirely before any decision has been made", async () => {
    const app = buildGenerationApp();
    await generateForToday(app);

    expect(lastPromptSent).not.toContain("How the user responded to your past suggestions");
  });

  it("records an approval for a cached suggestion the user accepted outside the widget", async () => {
    const app = buildGenerationApp();
    const generated = await generateForToday(app);
    expect(generated.fromCache).toBe(false);
    expect(decisionNoteContent(app)).toBe("");

    // The same day, now with the suggested task committed to it — the calendar accepted the suggestion, which the
    // plugin API never reports back, so the agenda's next cache hit is where the approval is detected.
    const cached = await generateForToday(app, [ACCEPTED_OBLIGATION]);

    expect(cached.fromCache).toBe(true);
    expect(cached.scheduledKeys).toHaveLength(1);
    expect(llmMock).toHaveBeenCalledTimes(1);
    expect(decisionNoteContent(app)).toContain("| Approved | Ship the thing | Goal progress |");
  });

  it("does not re-log an approval that was already recorded", async () => {
    const app = buildGenerationApp();
    await generateForToday(app);
    await generateForToday(app, [ACCEPTED_OBLIGATION]);
    await generateForToday(app, [ACCEPTED_OBLIGATION]);

    expect(decisionNoteContent(app).match(/Ship the thing/g)).toHaveLength(1);
  });
});
