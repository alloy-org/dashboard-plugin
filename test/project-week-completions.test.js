// Verify that a project's completions for the planned week follow the completed task ledger: a completion the ledger
// credits elsewhere or to no project is dropped, one it credits to the project is added though nothing links it, and a
// completion the ledger has not recorded yet falls back to the project's own matching.
import { jest } from "@jest/globals";
import { openCompletedTaskLedger, writeLedgerDateSection } from "dashboard/projects/completed-task-project-ledger";
import { projectCompletionsWithLedger, quartersSpanningDays, readWeekCompletionEvidence } from "dashboard/projects/project-week-completions";
import QuarterProject from "dashboard/quarter-project";
import { maintenanceApp, SCOPE_INPUT } from "./project-maintenance-test-app";

const COMPLETED_DATE = new Date(2026, 8, 17, 10);
const TARGET_DATE = new Date(2026, 8, 18, 9);

// ----------------------------------------------------------------------------------------------
// @desc A native completed task finished on COMPLETED_DATE.
// @param {string} uuid - The task's UUID.
// @param {string} content - The task's text.
// @returns {object} Task.
function completedTask(uuid, content) {
  return { completedAt: Math.floor(COMPLETED_DATE.getTime() / 1000), content, uuid };
}

// ----------------------------------------------------------------------------------------------
// @desc A ledger entry for a task completed on COMPLETED_DATE.
// @param {string} taskUuid - The task's UUID.
// @param {string|null} projectUuid - The project the ledger credits, or null for none.
// @param {string} taskText - The task's text.
// @returns {object} Entry.
function ledgerEntry(taskUuid, projectUuid, taskText) {
  return { classifiedAt: TARGET_DATE.toISOString(), classifiedBy: "model", completedAt: COMPLETED_DATE.toISOString(),
    confidence: 0.8, projectName: projectUuid ? "Some project" : null, projectUuid, taskText, taskUuid };
}

const LEDGER_ENTRIES = [ledgerEntry("credited-elsewhere", "other-project", "Launch dashboard copy review"),
  ledgerEntry("credited-to-none", null, "Launch dashboard lunch"), ledgerEntry("credited-here", "project-uuid", "Fix the chart tooltip")];
const COMPLETED_TASKS = [completedTask("credited-elsewhere", "Launch dashboard copy review"),
  completedTask("credited-to-none", "Launch dashboard lunch"), completedTask("credited-here", "Fix the chart tooltip"),
  completedTask("linked-unrecorded", "Launch dashboard release"), completedTask("unrelated-unrecorded", "Water the plants")];

describe("project week completions", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc The ledger decides the completions it records; the project's matching decides the rest, and its older
  //   completions outside the ledger's days are kept.
  it("credits each completion to the project the ledger names", () => {
    const olderCompletion = { completedAt: "2026-08-01T12:00:00.000Z", taskUuid: "older-task" };
    const project = new QuarterProject({ completedTasks: [olderCompletion, { completedAt: COMPLETED_DATE.toISOString(),
      taskUuid: "credited-elsewhere" }], summary: "Launch dashboard", uuid: "project-uuid" });
    const ledgerEntriesByDate = new Map([["2026-09-17", LEDGER_ENTRIES]]);
    const completions = projectCompletionsWithLedger(project, { completedTasks: COMPLETED_TASKS, ledgerEntriesByDate });
    expect(completions.map(completion => completion.taskUuid)).toEqual(["older-task", "credited-here", "linked-unrecorded"]);
    expect(completions[1]).toMatchObject({ taskText: "Fix the chart tooltip", completedAt: COMPLETED_DATE.toISOString() });
    project.setCompletedTasks(completions);
    expect(project.progressEvidence(TARGET_DATE).completedThisWeek).toBe(2);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The week's ledger and completions are read from the domain; a completed task read that fails leaves the
  //   ledger's entries to decide alone.
  it("reads the week's ledger entries and completed tasks", async () => {
    const app = maintenanceApp({ tasks: [] });
    const scope = { ...SCOPE_INPUT, quarterKey: "2026-Q3" };
    const { content, noteHandle } = await openCompletedTaskLedger(app, scope);
    await writeLedgerDateSection(app, { content, dateKey: "2026-09-17", entries: LEDGER_ENTRIES, noteHandle });
    app.getCompletedTasks = jest.fn(async () => COMPLETED_TASKS);
    const evidence = await readWeekCompletionEvidence(app, { domainName: scope.domainName, domainUuid: scope.domainUuid,
      now: new Date(2026, 8, 18, 12), targetDate: TARGET_DATE });
    expect(evidence.ledgerEntriesByDate.get("2026-09-17").map(entry => entry.taskUuid)).toEqual(LEDGER_ENTRIES.map(entry => entry.taskUuid));
    expect(evidence.completedTasks).toHaveLength(COMPLETED_TASKS.length);
    const [fromSeconds, toSeconds] = app.getCompletedTasks.mock.calls[0];
    expect(new Date(fromSeconds * 1000)).toEqual(new Date(2026, 8, 12));
    expect(new Date(toSeconds * 1000)).toEqual(new Date(2026, 8, 18, 12));

    app.getCompletedTasks = jest.fn(async () => { throw new Error("offline"); });
    const fallback = await readWeekCompletionEvidence(app, { domainName: scope.domainName, domainUuid: scope.domainUuid,
      now: new Date(2026, 8, 18, 12), targetDate: TARGET_DATE });
    expect(fallback.completedTasks).toEqual([]);
    expect(fallback.ledgerEntriesByDate.size).toBe(1);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A week crossing a quarter boundary reads both quarters' ledgers.
  it("spans both quarters when the week crosses one", () => {
    expect(quartersSpanningDays(new Date(2026, 9, 3))).toEqual([{ quarter: 3, year: 2026 }, { quarter: 4, year: 2026 }]);
    expect(quartersSpanningDays(new Date(2026, 9, 10))).toEqual([{ quarter: 4, year: 2026 }]);
  });
});
