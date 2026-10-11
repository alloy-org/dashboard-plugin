// Verify how completed tasks are matched to projects: the example tasks each project is described by, the link pass
// that records a task without a model, the choice questions and shared state a batch is asked with, and how answers
// become ledger entries, an unsure, unknown, or "none" choice advancing no project. When JEV_ACCESS_TOKEN is set, a live
// Jev call answers a batch of these questions, confirming the choice answer's shape and whether it carries a confidence.
import dotenv from "dotenv";
import fetch from "isomorphic-fetch";
import { classificationBatches, classificationQuestions, classificationState, classifiedEntries, completedTaskEntry, linkedProject,
  NO_PROJECT_CHOICE, projectChoices, projectExampleTasks } from "dashboard/projects/completed-task-project-classification";
import QuarterProject from "dashboard/quarter-project";
import { DecisionsEndpoint, forgetJevFailure, jevKeyRoute } from "providers/decisions-endpoint";
import DecisionsResponse from "providers/decisions-response";

dotenv.config();

const JEV_ACCESS_TOKEN = (process.env.JEV_ACCESS_TOKEN || "").trim();
const itIfJevToken = JEV_ACCESS_TOKEN ? it : it.skip;
const LIVE_TIMEOUT_MILLISECONDS = 60000;

const CLASSIFIED_AT = "2026-09-19T12:00:00.000Z";
const COMPLETED_AT = new Date(2026, 8, 18, 15, 0).getTime() / 1000;

// ----------------------------------------------------------------------------------------------
// @desc The two projects every scenario classifies against.
// @returns {Array<QuarterProject>} A dashboard launch with associated tasks, and a hiring project with a primary note.
function quarterProjects() {
  const launch = new QuarterProject({ relatedTaskRecords: [
    { matchScore: 6, taskText: "Write release notes", taskUuid: "notes" },
    { linkedBy: "projectName", taskText: "Launch dashboard beta", taskUuid: "beta" },
    { taskText: "Tune widget layout", taskUuid: "widget" },
    { matchScore: 9, taskText: "Fix date picker", taskUuid: "picker" },
    { matchScore: 2, taskText: "Rename settings", taskUuid: "settings" },
  ], summary: "Launch dashboard", taskSimilarityScores: { "checksum:widget": 7 }, uuid: "launch" });
  const hiring = new QuarterProject({ primaryNoteUuid: "hiring-note", summary: "Hire a designer", uuid: "hiring" });
  return [launch, hiring];
}

// ----------------------------------------------------------------------------------------------
// @desc A completed task.
// @param {string} uuid - Task UUID.
// @param {string} content - Task text.
// @param {object} [fields] - Other fields.
// @returns {object} Task.
function completedTask(uuid, content, fields = {}) {
  return { completedAt: COMPLETED_AT, content, noteUUID: "inbox", uuid, ...fields };
}

describe("completed task classification", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A project's examples are its three most similar open tasks, the hash standing in for a missing score and a
  //   linked task ranking first among equals.
  it("describes each project by its three most similar tasks", () => {
    const [launch] = quarterProjects();
    expect(projectExampleTasks(launch)).toEqual(["Fix date picker", "Tune widget layout", "Write release notes"]);
    const tied = new QuarterProject({ relatedTaskRecords: [{ matchScore: 5, taskText: "Similar", taskUuid: "similar" },
      { linkedBy: "assigned", matchScore: 5, taskText: "Assigned", taskUuid: "assigned" }], summary: "Tied", uuid: "tied" });
    expect(projectExampleTasks(tied)).toEqual(["Assigned", "Similar"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A task one project claims is linked to it; a task two projects claim, or none, is left for the model.
  it("links a task only when exactly one project claims it", () => {
    const projects = quarterProjects();
    expect(linkedProject(completedTask("one", "Launch dashboard polish"), projects).uuid).toBe("launch");
    expect(linkedProject(completedTask("two", "Portfolio review", { noteUUID: "hiring-note" }), projects).uuid).toBe("hiring");
    expect(linkedProject(completedTask("three", "Launch dashboard polish", { noteUUID: "hiring-note" }), projects)).toBeNull();
    expect(linkedProject(completedTask("four", "Buy groceries"), projects)).toBeNull();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Each task is one choice among the projects and "none", each project's choice described by its summary and
  //   example tasks; the state describes the projects and carries only the
  //   dictionary terms the batch's text uses.
  it("asks one choice question per task against a shared description of the projects", () => {
    const choices = projectChoices(quarterProjects());
    const tasks = [completedTask("one", "Tune widget spacing"), completedTask("two", "Buy groceries")];
    const questions = classificationQuestions(tasks, choices);
    expect(Object.keys(questions)).toEqual(["task_1", "task_2"]);
    expect(questions.task_1.type).toBe("choice");
    expect(Object.keys(questions.task_1.criteria)).toEqual(["1. Launch dashboard", "2. Hire a designer", NO_PROJECT_CHOICE]);
    expect(questions.task_1.criteria["1. Launch dashboard"]).toBe("The task advanced the project \"Launch dashboard\". Its work "
      + "includes tasks like: Fix date picker; Tune widget layout; Write release notes.");
    expect(questions.task_1.criteria["2. Hire a designer"]).toBe("The task advanced the project \"Hire a designer\".");
    expect(questions.task_1.instructions).toContain("\"Tune widget spacing\"");
    const state = classificationState({ choices, dictionary: { widget: "A Dashboard tile.", zeppelin: "Unused." },
      intentTextsByProjectUuid: new Map([["launch", ["Grow paid users"]]]), tasks });
    expect(state.completedTasks).toEqual(["Tune widget spacing", "Buy groceries"]);
    expect(state.projects[0]).toEqual({ choice: "1. Launch dashboard", exampleTasks: ["Fix date picker", "Tune widget layout",
      "Write release notes"], goals: ["Grow paid users"], summary: "Launch dashboard" });
    expect(state.projects[1]).toEqual({ choice: "2. Hire a designer", exampleTasks: [], summary: "Hire a designer" });
    expect(state.terms).toEqual({ widget: "A Dashboard tile." });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A confident choice names its project; an unsure, unknown, or "none" choice names none; an answer reporting no
  //   confidence is taken; a refused or missing answer is left for a later run.
  it("reads answers as ledger entries", () => {
    const choices = projectChoices(quarterProjects());
    const tasks = ["confident", "unsure", "unknown", "none", "unrated", "refused", "missing"].map(uuid => completedTask(uuid, uuid));
    const response = new DecisionsResponse({ answers: {
      task_1: { choice: "1. Launch dashboard", confidence: 0.9, type: "choice" },
      task_2: { choice: "2. Hire a designer", confidence: 0.3, type: "choice" },
      task_3: { choice: "3. Somewhere else", confidence: 0.9, type: "choice" },
      task_4: { choice: NO_PROJECT_CHOICE, confidence: 0.8, type: "choice" },
      task_5: { choice: "2. Hire a designer", type: "choice" },
      task_6: { type: "refusal" },
    }, providerEm: "jev" });
    const entries = classifiedEntries(response, tasks, { choices, classifiedAt: CLASSIFIED_AT });
    expect(entries.map(entry => [entry.taskUuid, entry.projectUuid])).toEqual([["confident", "launch"], ["unsure", null],
      ["unknown", null], ["none", null], ["unrated", "hiring"]]);
    expect(entries[0]).toEqual({ classifiedAt: CLASSIFIED_AT, classifiedBy: "decisions", completedAt: new Date(COMPLETED_AT * 1000).toISOString(),
      confidence: 0.9, dateKey: "2026-09-18", projectName: "Launch dashboard", projectUuid: "launch", taskText: "confident",
      taskUuid: "confident" });
    expect(entries[4].confidence).toBeNull();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A linked entry records its project without a confidence, and batches split at the batch size.
  it("builds linked entries and splits batches", () => {
    const [launch] = quarterProjects();
    const linked = completedTaskEntry(completedTask("one", "Launch dashboard polish"), { classifiedAt: CLASSIFIED_AT,
      classifiedBy: "link", project: launch });
    expect(linked).toMatchObject({ classifiedBy: "link", confidence: null, projectName: "Launch dashboard", projectUuid: "launch" });
    const batches = classificationBatches(Array.from({ length: 27 }, (unused, index) => index), 25);
    expect(batches.map(batch => batch.length)).toEqual([25, 2]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Jev answers each task with one of the offered choices, the widget task with the dashboard launch and the
  //   errand with no project, and reports how confident it was in each.
  itIfJevToken("classifies completed tasks against the projects (live Jev call)", async () => {
    forgetJevFailure();
    const choices = projectChoices(quarterProjects());
    const tasks = [completedTask("widget", "Tune the dashboard widget date picker spacing"), completedTask("errand", "Buy dog food")];
    const questions = classificationQuestions(tasks, choices);
    const state = classificationState({ choices, dictionary: {}, intentTextsByProjectUuid: new Map(), tasks });
    const decisionsEndpoint = new DecisionsEndpoint({ routes: [jevKeyRoute(JEV_ACCESS_TOKEN, { fetchImplementation: fetch,
      useProxy: false })] });
    const response = await decisionsEndpoint.rankedResponses({ questions, state });
    const offeredChoices = [...choices.keys(), NO_PROJECT_CHOICE];
    expect(response.answerFor("task_1")).toMatchObject({ choice: "1. Launch dashboard", type: "choice" });
    expect(response.answerFor("task_2")).toMatchObject({ choice: NO_PROJECT_CHOICE, type: "choice" });
    for (const questionName of ["task_1", "task_2"]) {
      expect(offeredChoices).toContain(response.answerFor(questionName).choice);
      expect(response.answerFor(questionName).confidence).toBeGreaterThanOrEqual(0);
      expect(response.answerFor(questionName).confidence).toBeLessThanOrEqual(1);
    }
  }, LIVE_TIMEOUT_MILLISECONDS);
});
