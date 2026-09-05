import { jest } from "@jest/globals";
import { PROPOSED_TASK_STATUS, storeProposedAgenda } from "proposed-agenda-archive";
import { AGENDA_DECISION, agendaDecisionsFromRows, decisionLogNoteName, recentAgendaDecisionsMarkdown, recordAgendaDecisions } from "proposed-agenda-decision-log";
import { recordProposedRowStatuses } from "proposed-agenda-llm-generator";
import { setLoggingEnabled } from "util/log";

const DOMAIN_NAME = "Work";
const DOMAIN_UUID = "dom-work";
const PRIORITY = "goal-progress";
const PROVIDER = "anthropic";
const SEPTEMBER_DAY = new Date(2026, 8, 4, 14, 32);
const AUGUST_DAY = new Date(2026, 7, 18, 9, 5);
const JULY_DAY = new Date(2026, 6, 2, 16, 45);

const APPROVED_DECISION = { decidedAt: SEPTEMBER_DAY, decisionLabel: AGENDA_DECISION.APPROVED,
  taskTitle: "Draft the Q4 roadmap", themeLabel: "Goal progress" };
const REJECTED_DECISION = { decidedAt: AUGUST_DAY, decisionLabel: AGENDA_DECISION.REJECTED,
  taskTitle: "Reorganize the bookmarks", themeLabel: "Barnacle cleanup" };

afterEach(() => {
  setLoggingEnabled(false);
  jest.restoreAllMocks();
});

// ----------------------------------------------------------------------------------------------
// @desc In-memory Amplenote app exposing the note surface the decision log uses, keyed by note name so writes
//   survive across calls within one test.
// @returns {object} App stub with a `_notes` array for inspection.
function buildNoteApp() {
  const notes = [];
  let counter = 0;
  return {
    findNote: jest.fn(async ({ name }) => notes.find(note => note.name === name) || null),
    createNote: jest.fn(async (name, tags, options) => { const uuid = `note-${ ++counter }`;
      notes.push({ content: "", name, options, tags, uuid }); return uuid; }),
    getNoteContent: jest.fn(async ({ uuid }) => notes.find(note => note.uuid === uuid)?.content ?? ""),
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

// [Claude claude-opus-5[1m]] Generated tests for: the archived Proposed Agenda approve/reject record
describe("proposed-agenda-decision-log", () => {
  it("names the note after the Task Domain", () => {
    expect(decisionLogNoteName(DOMAIN_NAME)).toBe("Work Dashboard Proposed Agenda Decisions");
    expect(decisionLogNoteName(null)).toBe("All Notes Dashboard Proposed Agenda Decisions");
  });

  it("creates the note archived and writes a month heading plus the four-column table", async () => {
    const app = buildNoteApp();
    await recordAgendaDecisions(app, { decisions: [APPROVED_DECISION], domainName: DOMAIN_NAME });

    expect(app.createNote).toHaveBeenCalledWith("Work Dashboard Proposed Agenda Decisions", expect.any(Array),
      { archive: true });
    const content = decisionNoteContent(app);
    expect(content).toContain("## September 2026");
    expect(content).toContain("| DateTime | Approved/rejected | Task suggested | Proposed agenda theme or prompt |");
    expect(content).toContain("| 2026-09-04 14:32 | Approved | Draft the Q4 roadmap | Goal progress |");
  });

  it("gives each month its own heading and table, newest month first", async () => {
    const app = buildNoteApp();
    await recordAgendaDecisions(app, { decisions: [REJECTED_DECISION], domainName: DOMAIN_NAME });
    await recordAgendaDecisions(app, { decisions: [APPROVED_DECISION], domainName: DOMAIN_NAME });

    const content = decisionNoteContent(app);
    expect(content.indexOf("## September 2026")).toBeLessThan(content.indexOf("## August 2026"));
    expect(content).toContain("| 2026-08-18 09:05 | Rejected | Reorganize the bookmarks | Barnacle cleanup |");
    expect(content.match(/^\| DateTime \|/gm)).toHaveLength(2);
  });

  it("does not append the same decision twice", async () => {
    const app = buildNoteApp();
    await recordAgendaDecisions(app, { decisions: [APPROVED_DECISION], domainName: DOMAIN_NAME });
    const appended = await recordAgendaDecisions(app, { decisions: [APPROVED_DECISION], domainName: DOMAIN_NAME });

    expect(appended).toBe(0);
    expect(decisionNoteContent(app).match(/Draft the Q4 roadmap/g)).toHaveLength(1);
  });

  it("round-trips titles containing pipe characters", async () => {
    const app = buildNoteApp();
    await recordAgendaDecisions(app, { decisions: [{ ...APPROVED_DECISION, taskTitle: "Ship A | B test" }],
      domainName: DOMAIN_NAME });
    await recordAgendaDecisions(app, { decisions: [REJECTED_DECISION], domainName: DOMAIN_NAME });

    const markdown = await recentAgendaDecisionsMarkdown(app, { date: SEPTEMBER_DAY, domainName: DOMAIN_NAME });
    expect(markdown).toContain("Ship A \\| B test");
    expect(decisionNoteContent(app).match(/Ship A \\\| B test/g)).toHaveLength(1);
  });

  it("replays only the trailing two months of decisions", async () => {
    const app = buildNoteApp();
    await recordAgendaDecisions(app, { decisions: [APPROVED_DECISION, REJECTED_DECISION,
      { decidedAt: JULY_DAY, decisionLabel: AGENDA_DECISION.APPROVED, taskTitle: "Old July suggestion",
        themeLabel: "Low energy" }], domainName: DOMAIN_NAME });

    const markdown = await recentAgendaDecisionsMarkdown(app, { date: SEPTEMBER_DAY, domainName: DOMAIN_NAME });
    expect(markdown).toContain("## September 2026");
    expect(markdown).toContain("## August 2026");
    expect(markdown).not.toContain("Old July suggestion");
    expect(decisionNoteContent(app)).toContain("Old July suggestion");
  });

  it("returns no markdown when nothing has been decided", async () => {
    const app = buildNoteApp();
    expect(await recentAgendaDecisionsMarkdown(app, { date: SEPTEMBER_DAY, domainName: DOMAIN_NAME })).toBe("");
    expect(app.createNote).not.toHaveBeenCalled();
  });

  it("maps scheduled rows to approvals, dismissed rows to rejections, and pending rows to nothing", () => {
    const rows = [{ title: "Draft the Q4 roadmap" }];
    expect(agendaDecisionsFromRows(rows, { priorityKey: PRIORITY,
      scheduledEm: PROPOSED_TASK_STATUS.SCHEDULED })[0]).toMatchObject({ decisionLabel: AGENDA_DECISION.APPROVED,
      taskTitle: "Draft the Q4 roadmap", themeLabel: "Goal progress" });
    expect(agendaDecisionsFromRows(rows, { priorityKey: "barnacle-cleanup",
      scheduledEm: PROPOSED_TASK_STATUS.DISMISSED })[0]).toMatchObject({ decisionLabel: AGENDA_DECISION.REJECTED,
      themeLabel: "Barnacle cleanup" });
    expect(agendaDecisionsFromRows(rows, { priorityKey: PRIORITY, scheduledEm: PROPOSED_TASK_STATUS.PENDING }))
      .toEqual([]);
  });
});

// [Claude claude-opus-5[1m]] Generated tests for: widget decisions reaching the archived record
describe("recordProposedRowStatuses decision logging", () => {
  const ACTIVITY = { durationMinutes: 60, isExisting: true, noteUuid: "note-1", reason: "advances the plan",
    startMinutes: 540, startTime: "09:00", taskUuid: "task-1", title: "Draft the Q4 roadmap" };
  const llmDateRecord = { date: SEPTEMBER_DAY, domainName: DOMAIN_NAME, domainUuid: DOMAIN_UUID,
    priorityKey: PRIORITY, providerEm: PROVIDER };

  it("logs an approval when a suggestion is scheduled, and only once", async () => {
    const app = buildNoteApp();
    await storeProposedAgenda(app, { activities: [ACTIVITY], date: SEPTEMBER_DAY, domainName: DOMAIN_NAME,
      domainUuid: DOMAIN_UUID, priorityKey: PRIORITY, providerEm: PROVIDER });

    await recordProposedRowStatuses(app, llmDateRecord, [ACTIVITY], PROPOSED_TASK_STATUS.SCHEDULED);
    await recordProposedRowStatuses(app, llmDateRecord, [ACTIVITY], PROPOSED_TASK_STATUS.SCHEDULED);

    const content = decisionNoteContent(app);
    expect(content).toContain("| Approved | Draft the Q4 roadmap | Goal progress |");
    expect(content.match(/Draft the Q4 roadmap/g)).toHaveLength(1);
  });

  it("logs a rejection when a suggestion is dismissed", async () => {
    const app = buildNoteApp();
    await storeProposedAgenda(app, { activities: [ACTIVITY], date: SEPTEMBER_DAY, domainName: DOMAIN_NAME,
      domainUuid: DOMAIN_UUID, priorityKey: PRIORITY, providerEm: PROVIDER });

    await recordProposedRowStatuses(app, llmDateRecord, [ACTIVITY], PROPOSED_TASK_STATUS.DISMISSED);

    expect(decisionNoteContent(app)).toContain("| Rejected | Draft the Q4 roadmap | Goal progress |");
  });
});
