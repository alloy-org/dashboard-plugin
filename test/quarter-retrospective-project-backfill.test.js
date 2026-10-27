// Verify the Quarter Retrospective's project backfill: which completions are rated and in what order, the project a
// rated task is credited to, one request per project per batch, the ledger written for a quarter of the year before,
// and a generation that infers projects, saves them to the project task store, credits the rest of the quarter's
// tasks, and is read back by a later generation without asking again.
import { CLASSIFIED_BY } from "dashboard/projects/completed-task-project-classification";
import { ledgerEntriesFromContent } from "dashboard/projects/completed-task-project-ledger";
import { readCollectedProjectTasks } from "dashboard/project-tasks/project-task-store";
import { RETROSPECTIVE_SECTIONS, retrospectiveSectionsFromContent } from "dashboard/quarter-retrospective/retrospective-data-note";
import { generateRetrospective } from "dashboard/quarter-retrospective/retrospective-generation";
import { BACKFILL_BATCH_SIZE, backfillCandidates, backfilledEntries, backfillQuarterProjects,
  rateBackfillCandidates } from "dashboard/quarter-retrospective/retrospective-project-backfill";
import { resolvePlanScope } from "plan-wizard/plan-models";
import { DecisionsEndpoint } from "providers/decisions-endpoint";
import { maintenanceApp } from "./project-maintenance-test-app";

// ----------------------------------------------------------------------------------------------
// @desc A completion as gathering builds it, completed on a July 2026 day.
// @param {string} taskUuid - The task's UUID, also its text.
// @param {object} [options] - { day = 10, projectUuid = null }.
// @returns {object} { completedMillis, dateKey, projectName, projectUuid, taskUuid, text }.
function completion(taskUuid, { day = 10, projectUuid = null } = {}) {
  return { completedMillis: new Date(2026, 6, day, 12).getTime(), dateKey: `2026-07-${ String(day).padStart(2, "0") }`,
    projectName: projectUuid ? "Launch" : null, projectUuid, taskUuid, text: taskUuid };
}

// ----------------------------------------------------------------------------------------------
// @desc An endpoint that rates each task_N question by the rating its project and task text map to, and every other
//   question 1, recording each request.
// @param {object} ratingByProjectAndText - 1–10 rating keyed "project name|task text"; one not listed gets 1.
// @returns {object} { endpoint, requests }.
function matchEndpoint(ratingByProjectAndText) {
  const requests = [];
  const endpoint = DecisionsEndpoint.fromRequester(async ({ questions, state }) => {
    requests.push({ questions, state });
    const answers = Object.fromEntries(Object.keys(questions).map(name => {
      const text = state.completedTasks?.[name]?.text;
      const rating = name.startsWith("task_") ? ratingByProjectAndText[`${ state.project.name }|${ text }`] || 1 : 1;
      return [name, { score: rating - 1, type: "score" }];
    }));
    return { answers };
  });
  return { endpoint, requests };
}

describe("backfill candidates", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Unclassified tasks come first, once per task however many days it was completed. Tasks credited to a
  //   project, held by a theme, or already rated by a retrospective are never asked about.
  it("asks about each unclassified task once", () => {
    const completions = [completion("Repeat", { day: 1 }), completion("Repeat", { day: 2 }), completion("Credited", { projectUuid: "launch" }),
      completion("Themed"), completion("Rated")];
    const entriesByDate = new Map([["2026-07-10", [{ classifiedBy: CLASSIFIED_BY.retrospective, projectUuid: null, taskUuid: "Rated" }]]]);
    const candidates = backfillCandidates(completions, entriesByDate, { excludedTaskUuids: new Set(["Themed"]) });
    expect(candidates.map(candidate => candidate.taskUuid)).toEqual(["Repeat"]);
    expect(candidates[0].completions).toHaveLength(2);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Tasks the live classifier recorded as advancing no project fill the last batch's open room, least confident
  //   first, and are left out when the unclassified tasks fill their batches exactly.
  it("fills the last batch with tasks judged to advance no project", () => {
    const noneEntries = [{ classifiedBy: CLASSIFIED_BY.decisions, confidence: 0.9, projectUuid: null, taskUuid: "Sure" },
      { classifiedBy: CLASSIFIED_BY.decisions, confidence: 0.55, projectUuid: null, taskUuid: "Unsure" }];
    const entriesByDate = new Map([["2026-07-10", noneEntries]]);
    const completions = [completion("Sure"), completion("Unsure"), completion("Fresh 1"), completion("Fresh 2")];
    const candidates = backfillCandidates(completions, entriesByDate, { batchSize: 3 });
    expect(candidates.map(candidate => candidate.taskUuid)).toEqual(["Fresh 1", "Fresh 2", "Unsure"]);
    expect(backfillCandidates(completions, entriesByDate, { batchSize: 2 }).map(candidate => candidate.taskUuid)).toEqual(["Fresh 1", "Fresh 2"]);
    expect(backfillCandidates(completions.slice(0, 2), entriesByDate)).toEqual([]);
  });
});

describe("backfilled entries", () => {
  const projects = [{ name: "Launch", uuid: "launch" }, { name: "Garden", uuid: "garden" }];
  const classifiedAt = "2026-10-27T12:00:00.000Z";

  // ----------------------------------------------------------------------------------------------
  // @desc A task goes to the project that rated it highest once that rating reaches 6; below it, to none. A task some
  //   project couldn't rate is left for a later retrospective.
  it("credits the highest rated project at or above the cutoff", () => {
    const groups = ["Both", "Low", "Partial"].map(taskUuid => ({ completions: [completion(taskUuid)], taskUuid, text: taskUuid }));
    const ratingsByTaskUuid = new Map([["Both", new Map([["launch", 7], ["garden", 9]])], ["Low", new Map([["launch", 5.9], ["garden", 2]])],
      ["Partial", new Map([["launch", 9]])]]);
    const entries = backfilledEntries(groups, ratingsByTaskUuid, { classifiedAt, projects });
    expect(entries.map(entry => [entry.taskUuid, entry.projectUuid, entry.matchScore])).toEqual([["Both", "garden", 9], ["Low", null, 5.9]]);
    expect(entries[0]).toMatchObject({ classifiedAt, classifiedBy: CLASSIFIED_BY.retrospective, dateKey: "2026-07-10", projectName: "Garden" });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Two projects rating a task alike leave it with the one listed first.
  it("breaks a tie toward the project listed first", () => {
    const groups = [{ completions: [completion("Tie")], taskUuid: "Tie", text: "Tie" }];
    const ratingsByTaskUuid = new Map([["Tie", new Map([["launch", 8], ["garden", 8]])]]);
    expect(backfilledEntries(groups, ratingsByTaskUuid, { classifiedAt, projects })[0].projectUuid).toBe("launch");
  });
});

describe("rating backfill candidates", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Every project rates every candidate, one request per project per batch, each naming the project and its
  //   example tasks.
  it("asks each project about every batch", async () => {
    const groups = Array.from({ length: BACKFILL_BATCH_SIZE + 1 }, (unused, index) => ({ completions: [completion(`Task ${ index }`)],
      taskUuid: `Task ${ index }`, text: `Task ${ index }` }));
    const projects = [{ examples: ["Ship the beta"], name: "Launch", summary: null, uuid: "launch" },
      { examples: [], name: "Garden", summary: "Grow tomatoes", uuid: "garden" }];
    const { endpoint, requests } = matchEndpoint({ "Garden|Task 20": 9, "Launch|Task 0": 7 });
    const ratingsByTaskUuid = await rateBackfillCandidates(groups, { dictionary: {}, endpoint, projects });
    expect(requests).toHaveLength(4);
    expect(requests[0].state.project).toEqual({ name: "Launch", summary: null, tasksInProject: ["Ship the beta"] });
    expect(requests[0].questions.task_1.instructions).toContain('("Task 0") to advancing the project "Launch"');
    expect([...ratingsByTaskUuid.get("Task 0")]).toEqual([["launch", 7], ["garden", 1]]);
    expect(ratingsByTaskUuid.get("Task 20").get("garden")).toBe(9);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The ledger is named by quarter and year, so a quarter of the year before is written to its own ledger.
  it("writes the verdicts to the ledger of a quarter in the year before", async () => {
    const app = maintenanceApp({ tasks: [] });
    const scope = resolvePlanScope({ domainName: "Work", domainUuid: "work-domain", quarter: 4, year: 2025 });
    const completions = [{ ...completion("Ship"), completedMillis: new Date(2025, 10, 3, 12).getTime(), dateKey: "2025-11-03" }];
    const { endpoint } = matchEndpoint({ "Launch|Ship": 8 });
    const backfill = await backfillQuarterProjects(app, { completions, endpoint, entriesByDate: new Map(), inferredProjects: null,
      projects: [{ name: "Launch", uuid: "launch" }], scope });
    const ledger = ledgerEntriesFromContent(app.noteContent("Completed Tasks by Project Q4 2025 Work"));
    expect(ledger.entriesByDate.get("2025-11-03")).toEqual([expect.objectContaining({ matchScore: 8, projectUuid: "launch", taskUuid: "Ship" })]);
    expect(backfill.entriesByDate.get("2025-11-03")[0].projectUuid).toBe("launch");
  });
});

describe("generation with project backfill", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A quarter without projects has them inferred from its themes; the tasks those themes missed are rated
  //   against them, and the projects and every verdict are saved. Another style reads them back without asking again.
  it("credits the tasks themes missed and saves the inferred projects", async () => {
    const app = maintenanceApp({ tasks: [] });
    const completedAt = day => Math.floor(new Date(2026, 6, day, 12).getTime() / 1000);
    const chapters = [1, 2, 3].map(day => ({ completedAt: completedAt(day), content: `Chapter ${ day }`, uuid: `task-${ day }`, victoryValue: 2 }));
    const tasks = [...chapters, { completedAt: completedAt(4), content: "Email the publisher", uuid: "publisher", victoryValue: 1 },
      { completedAt: completedAt(5), content: "Fix the garage door", uuid: "garage", victoryValue: 1 }];
    app.getCompletedTasks = async () => tasks;
    const requestPrompt = async prompt => {
      if (prompt.includes("Merge them into")) return { projects: [{ name: "Write the book", themeIds: ["th1"] }] };
      if (!prompt.startsWith("Summarize July")) return null;
      const chapterIds = chapters.map((task, index) => `t${ index + 1 }`);
      return { highlights: [{ summary: "Drafted", taskIds: chapterIds }], themes: [{ name: "Drafting", taskIds: chapterIds }] };
    };
    const { endpoint, requests } = matchEndpoint({ "Write the book|Email the publisher": 8 });
    const request = { domainName: "Work", domainUuid: "work-domain", options: {}, quarter: 3, year: 2026 };
    await generateRetrospective(app, { ...request, style: "data" }, { decisionsEndpointFactory: async () => endpoint, requestPrompt });

    const matchRequests = requests.filter(sent => sent.state.project?.tasksInProject);
    expect(matchRequests).toHaveLength(1);
    const ledger = ledgerEntriesFromContent(app.noteContent("Completed Tasks by Project Q3 2026 Work"));
    const entries = [...ledger.entriesByDate.values()].flat();
    const verdicts = entries.map(entry => [entry.taskUuid, entry.projectName, entry.classifiedBy]);
    expect(verdicts).toEqual([["task-1", "Write the book", "themes"], ["task-2", "Write the book", "themes"], ["task-3", "Write the book", "themes"],
      ["publisher", "Write the book", "retrospective"], ["garage", null, "retrospective"]]);
    const scope = resolvePlanScope({ domainName: "Work", domainUuid: "work-domain", quarter: 3, year: 2026 });
    const [storedProject] = await readCollectedProjectTasks(app, scope, { includeInactive: true });
    expect(storedProject).toMatchObject({ isActive: false, summary: "Write the book" });
    expect(storedProject.uuid).toMatch(/^theme-/);
    const { payloads } = retrospectiveSectionsFromContent(app.noteContent("Work Q3 2026 Data Retrospective Data"));
    expect(payloads.get(RETROSPECTIVE_SECTIONS.statistics).progressHeap.legend).toEqual([{ label: "Write the book", slot: 1, taskCount: 4 }]);

    const spotify = await generateRetrospective(app, { ...request, style: "spotify" }, { decisionsEndpointFactory: async () => endpoint,
      requestPrompt });
    expect(requests.filter(sent => sent.state.project?.tasksInProject)).toHaveLength(1);
    expect(spotify.projects).toEqual([{ derivedFrom: "themes", name: "Write the book", uuid: storedProject.uuid }]);
  });
});
