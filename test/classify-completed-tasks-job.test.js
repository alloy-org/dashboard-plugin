// Verify the queued job that records which project each task completed in the past week advanced: linked tasks are
// recorded without a model and the rest asked in batches, tasks the ledger holds are never asked again, a week spanning
// two quarters writes both ledgers, a user with no decision model still gets linked tasks recorded, and a failed batch
// keeps what earlier batches recorded for the retry to build on. A quarter holding project tasks not yet rated for
// potential is handed to the potential scoring job.
import { jest } from "@jest/globals";
import { readCompletedTaskLedger } from "dashboard/projects/completed-task-project-ledger";
import { NO_PROJECT_CHOICE } from "dashboard/projects/completed-task-project-classification";
import { createClassifyCompletedTasksHandler } from "dashboard/work-queue/jobs/classify-completed-tasks";
import { completedTaskClassificationRequest, completedTaskPotentialRequest } from "dashboard/work-queue/jobs/project-job-requests";
import { DecisionsEndpoint } from "providers/decisions-endpoint";
import { jobContext, maintenanceApp, QUARTERLY_CONTENT, SCOPE_INPUT } from "./project-maintenance-test-app";

const LAUNCH_CHOICE = "1. Launch dashboard";
const SEPTEMBER_NOW = new Date(2026, 8, 19, 12, 0);

// ----------------------------------------------------------------------------------------------
// @desc A completed task.
// @param {string} uuid - Task UUID.
// @param {string} content - Task text.
// @param {Date} completedDate - When it was completed.
// @returns {object} Task.
function completedTask(uuid, content, completedDate) {
  return { completedAt: Math.floor(completedDate.getTime() / 1000), content, noteUUID: "inbox", uuid };
}

// ----------------------------------------------------------------------------------------------
// @desc The maintenance app with completed tasks, filtered by the window it is asked for.
// @param {Array<object>} completedTasks - Tasks getCompletedTasks may return.
// @returns {object} App mock whose getCompletedTasks is a jest mock.
function completionApp(completedTasks) {
  const app = maintenanceApp({ tasks: [] });
  app.getCompletedTasks = jest.fn(async (fromSeconds, toSeconds) => completedTasks.filter(task => task.completedAt >= fromSeconds
    && task.completedAt < toSeconds));
  return app;
}

// ----------------------------------------------------------------------------------------------
// @desc A decisions model choosing the launch project for widget tasks and no project otherwise.
// @param {object} [options] - { failingText }: a batch holding a task with this text is rejected.
// @returns {function} A requestAnswers mock.
function choiceRequest({ failingText = null } = {}) {
  return jest.fn(async ({ questions, state }) => {
    if (failingText && state.completedTasks.includes(failingText)) throw new Error("Decisions rejected the batch");
    const answerEntries = Object.keys(questions).map((questionName, index) => [questionName, { choice: state.completedTasks[index]
      .includes("widget") ? LAUNCH_CHOICE : NO_PROJECT_CHOICE, confidence: 0.9, type: "choice" }]);
    return { answers: Object.fromEntries(answerEntries) };
  });
}

// ----------------------------------------------------------------------------------------------
// @desc The handler under test, reading the same plan for every quarter and asking the given request.
// @param {function|null} requestAnswers - The decisions model, or null when none is configured.
// @returns {object} The handler.
function classificationHandler(requestAnswers) {
  return createClassifyCompletedTasksHandler({ dictionaryReader: async () => ({ widget: "A tile on the Dashboard." }),
    endpointFactory: async () => (requestAnswers ? DecisionsEndpoint.fromRequester(requestAnswers) : null),
    quarterlyContentReader: async () => QUARTERLY_CONTENT });
}

// ----------------------------------------------------------------------------------------------
// @desc Run the handler once as the queue would.
// @param {object} handler - The handler.
// @param {object} app - The app.
// @param {Date} [now=SEPTEMBER_NOW] - The job's clock.
// @returns {Promise<object>} The result.
function runClassification(handler, app, now = SEPTEMBER_NOW) {
  const request = completedTaskClassificationRequest(SCOPE_INPUT, { requestedAt: now.getTime() });
  const job = { attempt: 1, category: request.category, desiredRevision: request.desiredRevision, input: request.input,
    key: request.key, scopeKey: "work-domain:Q3 2026", type: request.type };
  return handler.run({ context: { ...jobContext(app), clock: () => now.getTime() }, job, signal: null });
}

// ----------------------------------------------------------------------------------------------
// @desc A result's counts, without the follow-up requests it carries.
// @param {object} result - The handler's result.
// @returns {object} { classifiedCount, linkedCount, waitingCount }.
function resultCounts({ classifiedCount, linkedCount, waitingCount }) {
  return { classifiedCount, linkedCount, waitingCount };
}

// ----------------------------------------------------------------------------------------------
// @desc Each recorded task's project name, by day.
// @param {object} app - The app.
// @param {number} quarter - The ledger's quarter.
// @returns {Promise<object>} { dateKey: [[taskUuid, projectName, classifiedBy], ...] }.
async function ledgerSummary(app, quarter) {
  const { entriesByDate } = await readCompletedTaskLedger(app, { ...SCOPE_INPUT, quarter, quarterKey: `2026-Q${ quarter }` });
  const summaryEntries = [...entriesByDate.entries()].map(([dateKey, entries]) => [dateKey, entries.map(entry => [entry.taskUuid,
    entry.projectName, entry.classifiedBy])]);
  return Object.fromEntries(summaryEntries);
}

describe("classify completed tasks job", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A task naming the project is recorded by its link; the others are asked in one batch with the project's
  //   description and the dictionary's terms; a second run finds nothing new to ask. Tasks older than the window are
  //   never read, and the domain is passed to the lookup. Both runs request a potential rating of the quarter, since
  //   its project tasks are still unrated.
  it("records linked tasks directly, asks about the rest, and never asks twice", async () => {
    const app = completionApp([completedTask("linked", "Launch dashboard polish", new Date(2026, 8, 17, 9, 0)),
      completedTask("widget", "Tune widget spacing", new Date(2026, 8, 18, 15, 0)),
      completedTask("errand", "Buy groceries", new Date(2026, 8, 18, 10, 0)),
      completedTask("old", "Tune widget size", new Date(2026, 8, 12, 10, 0))]);
    const requestAnswers = choiceRequest();
    const handler = classificationHandler(requestAnswers);
    const potentialRequest = completedTaskPotentialRequest(SCOPE_INPUT, { requestedAt: SEPTEMBER_NOW.getTime() });
    expect(await runClassification(handler, app)).toEqual({ classifiedCount: 2, followUps: [potentialRequest], linkedCount: 1,
      waitingCount: 0 });
    expect(app.getCompletedTasks.mock.calls[0][2]).toEqual({ taskDomainUUID: "work-domain" });
    expect(requestAnswers).toHaveBeenCalledTimes(1);
    const [{ questions, state }] = requestAnswers.mock.calls[0];
    expect(Object.keys(questions)).toEqual(["task_1", "task_2"]);
    expect(state.projects.map(project => project.choice)).toEqual([LAUNCH_CHOICE]);
    expect(state.terms).toEqual({ widget: "A tile on the Dashboard." });
    expect(await ledgerSummary(app, 3)).toEqual({ "2026-09-17": [["linked", "Launch dashboard", "link"]],
      "2026-09-18": [["errand", null, "decisions"], ["widget", "Launch dashboard", "decisions"]] });
    expect(app.noteContent("Completed Tasks by Project Q3 2026 Work")).toContain("- Tune widget spacing → **Launch dashboard**");
    expect(await runClassification(handler, app)).toEqual({ classifiedCount: 0, followUps: [potentialRequest], linkedCount: 0,
      waitingCount: 0 });
    expect(requestAnswers).toHaveBeenCalledTimes(1);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc More unlinked tasks than one batch holds are asked in batches of 25. Errands advance no project, so no
  //   potential rating is requested.
  it("asks in batches", async () => {
    const tasks = Array.from({ length: 30 }, (unused, index) => completedTask(`errand-${ index }`, `Errand ${ index }`,
      new Date(2026, 8, 18, 8, index)));
    const requestAnswers = choiceRequest();
    expect(await runClassification(classificationHandler(requestAnswers), completionApp(tasks)))
      .toEqual({ classifiedCount: 30, linkedCount: 0, waitingCount: 0 });
    expect(requestAnswers.mock.calls.map(([{ questions }]) => Object.keys(questions).length)).toEqual([25, 5]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A week spanning a quarter's end records each completion in the ledger of the quarter it fell in.
  it("writes each completion to its own quarter's ledger", async () => {
    const app = completionApp([completedTask("september", "Tune widget spacing", new Date(2026, 8, 29, 10, 0)),
      completedTask("october", "Launch dashboard polish", new Date(2026, 9, 1, 10, 0))]);
    const result = await runClassification(classificationHandler(choiceRequest()), app, new Date(2026, 9, 2, 12, 0));
    expect(resultCounts(result)).toEqual({ classifiedCount: 1, linkedCount: 1, waitingCount: 0 });
    expect(result.followUps.map(followUp => followUp.key)).toEqual(["scoreCompletedTaskPotential:2026-Q3",
      "scoreCompletedTaskPotential:2026-Q4"]);
    expect(await ledgerSummary(app, 3)).toEqual({ "2026-09-29": [["september", "Launch dashboard", "decisions"]] });
    expect(await ledgerSummary(app, 4)).toEqual({ "2026-10-01": [["october", "Launch dashboard", "link"]] });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc With no decision model configured, linked tasks are recorded and the rest wait.
  it("records linked tasks and leaves the rest waiting without a decision model", async () => {
    const app = completionApp([completedTask("linked", "Launch dashboard polish", new Date(2026, 8, 18, 9, 0)),
      completedTask("errand", "Buy groceries", new Date(2026, 8, 18, 10, 0))]);
    expect(resultCounts(await runClassification(classificationHandler(null), app))).toEqual({ classifiedCount: 0, linkedCount: 1,
      waitingCount: 1 });
    expect(await ledgerSummary(app, 3)).toEqual({ "2026-09-18": [["linked", "Launch dashboard", "link"]] });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A batch that fails fails the attempt after earlier batches were recorded; the retry asks only what is left.
  it("keeps earlier batches when a later one fails", async () => {
    const tasks = Array.from({ length: 30 }, (unused, index) => completedTask(`errand-${ index }`, `Errand ${ index }`,
      new Date(2026, 8, 18, 8, index)));
    const app = completionApp(tasks);
    await expect(runClassification(classificationHandler(choiceRequest({ failingText: "Errand 27" })), app))
      .rejects.toThrow("Decisions rejected the batch");
    expect((await ledgerSummary(app, 3))["2026-09-18"]).toHaveLength(25);
    const retryRequest = choiceRequest();
    expect(await runClassification(classificationHandler(retryRequest), app)).toEqual({ classifiedCount: 5, linkedCount: 0,
      waitingCount: 0 });
    expect(Object.keys(retryRequest.mock.calls[0][0].questions)).toHaveLength(5);
    expect((await ledgerSummary(app, 3))["2026-09-18"]).toHaveLength(30);
  });
});
