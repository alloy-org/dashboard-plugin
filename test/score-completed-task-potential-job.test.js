// Verify the potential rating of completed project tasks: two 1–10 questions per task, a raise only when the sum of the
// ratings exceeds the task's current victory value, the raise written with updateTask and confirmed by reading the task
// again, every rating recorded on its ledger entry so a retry neither asks nor raises twice, a refused update recorded
// without stopping the run, a vanished completion marked so it is not looked for again, and the chart showing an
// applied value Amplenote did not keep.
import { jest } from "@jest/globals";
import { completedTasksWithAppliedValues, LONG_TERM_UPSIDE_CRITERIA, POTENTIAL_SKIPPED_COMPLETION_MISSING, potentialQuestions,
  potentialState, raisedVictoryValue } from "dashboard/projects/completed-task-potential";
import { CLASSIFIED_BY, completedTaskEntry } from "dashboard/projects/completed-task-project-classification";
import { readCompletedTaskLedger } from "dashboard/projects/completed-task-project-ledger";
import { recordLedgerEntries } from "dashboard/work-queue/jobs/completed-task-job-steps";
import { completedTaskPotentialRequest } from "dashboard/work-queue/jobs/project-job-requests";
import { createScoreCompletedTaskPotentialHandler } from "dashboard/work-queue/jobs/score-completed-task-potential";
import { DecisionsEndpoint } from "providers/decisions-endpoint";
import { jobContext, maintenanceApp, QUARTERLY_CONTENT, SCOPE_INPUT } from "./project-maintenance-test-app";

const LAUNCH_PROJECT = { summary: "Launch dashboard", uuid: "launch-project" };
const SEPTEMBER_NOW = new Date(2026, 8, 19, 12, 0);
const LEDGER_SCOPE = { ...SCOPE_INPUT, quarterKey: "2026-Q3" };

// ----------------------------------------------------------------------------------------------
// @desc A completed task.
// @param {string} uuid - Task UUID.
// @param {string} content - Task text.
// @param {number} victoryValue - Its victory value.
// @returns {object} Task.
function completedTask(uuid, content, victoryValue) {
  return { completedAt: Math.floor(new Date(2026, 8, 18, 10, 0).getTime() / 1000), content, noteUUID: "inbox", uuid, victoryValue };
}

// ----------------------------------------------------------------------------------------------
// @desc The maintenance app holding completed tasks whose victory value updateTask changes, and a ledger recording
//   each task under the launch project except the errand.
// @param {Array<object>} tasks - Completed tasks.
// @param {object} [options] - { acceptsUpdates = true }: false makes updateTask report failure and change nothing.
// @returns {Promise<object>} App mock whose getCompletedTasks and updateTask are jest mocks.
async function potentialApp(tasks, { acceptsUpdates = true } = {}) {
  const app = maintenanceApp({ tasks: [] });
  app.getCompletedTasks = jest.fn(async () => tasks.map(task => ({ ...task })));
  app.updateTask = jest.fn(async (uuid, { victoryValue }) => {
    if (!acceptsUpdates) return false;
    tasks.find(task => task.uuid === uuid).victoryValue = victoryValue;
    return true;
  });
  const entries = tasks.map(task => completedTaskEntry(task, { classifiedAt: "2026-09-18T12:00:00.000Z", classifiedBy: CLASSIFIED_BY.link,
    project: task.uuid === "errand" ? null : LAUNCH_PROJECT }));
  await recordLedgerEntries(jobContext(app), LEDGER_SCOPE, entries, null);
  return app;
}

// ----------------------------------------------------------------------------------------------
// @desc A decisions model rating each task by its text: "keystone" tasks 9 and 8, the rest 2 and 3.
// @returns {function} A requestAnswers mock; scores are sent zero-based, as the providers send them.
function ratingRequest() {
  return jest.fn(async ({ questions, state }) => {
    const answerEntries = Object.keys(questions).map(questionName => {
      const position = Number(questionName.split("_")[1]) - 1;
      const keystone = state.completedTasks[position].task.includes("keystone");
      const rating = questionName.startsWith("upside") ? (keystone ? 9 : 2) : (keystone ? 8 : 3);
      return [questionName, { confidence: 0.8, score: rating - 1, type: "score" }];
    });
    return { answers: Object.fromEntries(answerEntries) };
  });
}

// ----------------------------------------------------------------------------------------------
// @desc Run the handler once as the queue would.
// @param {object} app - The app.
// @param {function|null} requestAnswers - The decisions model, or null when none is configured.
// @returns {Promise<object>} The result.
function runPotential(app, requestAnswers) {
  const handler = createScoreCompletedTaskPotentialHandler({ dictionaryReader: async () => ({ keystone: "A task others depend on." }),
    endpointFactory: async () => (requestAnswers ? DecisionsEndpoint.fromRequester(requestAnswers) : null),
    quarterlyContentReader: async () => QUARTERLY_CONTENT });
  const request = completedTaskPotentialRequest(SCOPE_INPUT, { requestedAt: SEPTEMBER_NOW.getTime() });
  const job = { attempt: 1, category: request.category, desiredRevision: request.desiredRevision, input: request.input,
    key: request.key, scopeKey: "work-domain:Q3 2026", type: request.type };
  return handler.run({ context: { ...jobContext(app), clock: () => SEPTEMBER_NOW.getTime() }, job, signal: null });
}

// ----------------------------------------------------------------------------------------------
// @desc The ledger's entries for the scenario's day, by task UUID.
// @param {object} app - The app.
// @returns {Promise<object>} Entries keyed by task UUID.
async function ledgerEntriesByTask(app) {
  const { entriesByDate } = await readCompletedTaskLedger(app, LEDGER_SCOPE);
  const dayEntries = entriesByDate.get("2026-09-18") || [];
  return Object.fromEntries(dayEntries.map(entry => [entry.taskUuid, entry]));
}

describe("completed task potential", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Each task is asked about twice on a ten-step rubric, against a state naming its project and that project's
  //   goals; a rating raises a value only when the sum exceeds it.
  it("builds two rating questions per task and never lowers a value", () => {
    const entries = [{ projectName: "Launch dashboard", projectUuid: "launch-project", taskText: "Ship keystone API" }];
    const questions = potentialQuestions(entries);
    expect(Object.keys(questions)).toEqual(["upside_1", "impact_1"]);
    expect(questions.upside_1.criteria).toEqual([...LONG_TERM_UPSIDE_CRITERIA]);
    expect(questions.impact_1.criteria).toHaveLength(10);
    expect(questions.impact_1.instructions).toContain("Short-term predicted impact");
    const state = potentialState({ dictionary: { keystone: "A task others depend on.", unrelated: "Unused." }, entries,
      intentTextsByProjectUuid: new Map([["launch-project", ["Ship the date picker"]]]) });
    expect(state).toEqual({ completedTasks: [{ project: "Launch dashboard", task: "Ship keystone API" }],
      projects: [{ goals: ["Ship the date picker"], summary: "Launch dashboard" }], terms: { keystone: "A task others depend on." } });
    expect(raisedVictoryValue({ longTermUpside: 4, shortTermImpact: 3.5 }, 8)).toBeNull();
    expect(raisedVictoryValue({ longTermUpside: 6, shortTermImpact: 5.5 }, 8)).toBe(11.5);
    expect(raisedVictoryValue({ longTermUpside: 2, shortTermImpact: 3 }, null)).toBe(5);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A task rated above its value is raised and confirmed; one rated below keeps its value; a task the ledger
  //   associated with no project is never asked about; a second run asks and raises nothing.
  it("raises tasks rated above their value, records each rating, and never repeats", async () => {
    const app = await potentialApp([completedTask("keystone", "Ship keystone API", 6), completedTask("polish", "Polish widget", 9),
      completedTask("errand", "Buy groceries", 2)]);
    const requestAnswers = ratingRequest();
    expect(await runPotential(app, requestAnswers)).toEqual({ raisedCount: 1, scoredCount: 2, skippedCount: 0, waitingCount: 0 });
    expect(requestAnswers).toHaveBeenCalledTimes(1);
    expect(requestAnswers.mock.calls[0][0].state.completedTasks.map(({ task }) => task)).toEqual(["Ship keystone API", "Polish widget"]);
    expect(app.updateTask.mock.calls).toEqual([["keystone", { victoryValue: 17 }]]);
    const entries = await ledgerEntriesByTask(app);
    expect(entries.keystone).toMatchObject({ appliedVictoryValue: 17, longTermUpside: 9, potentialScoredAt: SEPTEMBER_NOW.toISOString(),
      priorVictoryValue: 6, raiseConfirmed: true, shortTermImpact: 8 });
    expect(entries.polish).toMatchObject({ appliedVictoryValue: null, priorVictoryValue: 9, raiseConfirmed: null });
    expect(entries.errand.potentialScoredAt).toBeUndefined();
    expect(app.noteContent("Completed Tasks by Project Q3 2026 Work"))
      .toContain("Ship keystone API → **Launch dashboard** (victory value 6 → 17)");
    expect(await runPotential(app, requestAnswers)).toEqual({ raisedCount: 0, scoredCount: 0, skippedCount: 0, waitingCount: 0 });
    expect(requestAnswers).toHaveBeenCalledTimes(1);
    expect(app.updateTask).toHaveBeenCalledTimes(1);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc When Amplenote refuses the update, the rating and the value it earned are still recorded, unconfirmed, and
  //   the chart shows the earned value.
  it("records a refused raise and shows it on the chart", async () => {
    const tasks = [completedTask("keystone", "Ship keystone API", 6)];
    const app = await potentialApp(tasks, { acceptsUpdates: false });
    expect(await runPotential(app, ratingRequest())).toEqual({ raisedCount: 1, scoredCount: 1, skippedCount: 0, waitingCount: 0 });
    const entries = await ledgerEntriesByTask(app);
    expect(entries.keystone).toMatchObject({ appliedVictoryValue: 17, priorVictoryValue: 6, raiseConfirmed: false });
    expect(tasks[0].victoryValue).toBe(6);
    const completedTaskProjects = { appliedVictoryValuesByCompletion: new Map([["2026-09-18:keystone", 17]]) };
    const displayed = completedTasksWithAppliedValues({ "2026-09-18": tasks }, completedTaskProjects);
    expect(displayed["2026-09-18"][0].victoryValue).toBe(17);
    expect(completedTasksWithAppliedValues({ "2026-09-18": tasks }, null)["2026-09-18"][0].victoryValue).toBe(6);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A recorded task whose completion can no longer be found is marked rated without asking; without a decision
  //   model the rest wait.
  it("marks vanished completions and waits without a decision model", async () => {
    const app = await potentialApp([completedTask("keystone", "Ship keystone API", 6), completedTask("gone", "Uncompleted later", 3)]);
    app.getCompletedTasks.mockImplementation(async () => [completedTask("keystone", "Ship keystone API", 6)]);
    expect(await runPotential(app, null)).toEqual({ raisedCount: 0, scoredCount: 0, skippedCount: 1, waitingCount: 1 });
    const entries = await ledgerEntriesByTask(app);
    expect(entries.gone).toMatchObject({ potentialScoredAt: SEPTEMBER_NOW.toISOString(),
      potentialSkippedReason: POTENTIAL_SKIPPED_COMPLETION_MISSING });
    expect(entries.keystone.potentialScoredAt).toBeUndefined();
    expect(app.updateTask).not.toHaveBeenCalled();
  });
});
