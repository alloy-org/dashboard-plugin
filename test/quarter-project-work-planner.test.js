// Verify how queued project maintenance is planned: which projects a visit refreshes and in what order, how many are
// in flight at once, when ideas are asked for alone, how rankings wait inside dictionary discovery while it has projects
// to examine, when a changed definition forces a ranking, how a reconciliation aligns the store with the live plan
// before any job names a project, and that one reconciliation submitted to a work runtime discovers terms, ranks a
// project, and then asks for its ideas, leaving a second reconciliation nothing to do, and still ranks when discovery
// fails.
import { jest } from "@jest/globals";
import { SETTING_KEYS } from "constants/settings";
import { readCollectedProjectTasks } from "dashboard/project-task-store";
import QuarterProject from "dashboard/quarter-project";
import { ideasInputRevision, similarityInputRevision } from "dashboard/quarter-project-refresh-state";
import QuarterProjectRepository from "dashboard/quarter-project-repository";
import { workHandlerRegistry } from "dashboard/work-queue/dashboard-work-handlers";
import DashboardWorkRepository from "dashboard/work-queue/dashboard-work-repository";
import { createDashboardWorkRuntime } from "dashboard/work-queue/dashboard-work-runtime";
import { createDiscoverDictionaryTermsHandler } from "dashboard/work-queue/jobs/discover-dictionary-terms";
import { createGenerateProjectIdeasHandler } from "dashboard/work-queue/jobs/generate-project-ideas";
import { projectReconciliationRequest } from "dashboard/work-queue/jobs/project-job-requests";
import { createRankProjectTasksHandler } from "dashboard/work-queue/jobs/rank-project-tasks";
import { createReconcileProjectsHandler } from "dashboard/work-queue/jobs/reconcile-projects";
import QuarterProjectWorkPlanner, { projectCoverageTarget } from "dashboard/work-queue/quarter-project-work-planner";
import { prepareProjectTaskRanker } from "plan-wizard/stack-rank/stack-rank-project-tasks";
import { setPluginData } from "plugin-data";
import { backlogTasks, DISCOVERED_TERMS, GENERATED_IDEA, jobContext, maintenanceApp, NOW, ratingRequest,
  SCOPE_INPUT } from "./project-maintenance-test-app";

const HOUR = 60 * 60 * 1000;
const SCOPE_KEY = "work-domain:Q3 2026";
const WATERMARK = { sequence: 5, snapshotId: "snapshot" };

// ----------------------------------------------------------------------------------------------
// @desc A stored project ranked hoursAgo before NOW against the given watermark sequence, its search through both pages,
//   with its ideas asked for at the same time against its current inputs, unless told otherwise.
// @param {string} uuid - Project UUID, also its summary.
// @param {object} [options] - { ideasHoursAgo, ideasRevision, hoursAgo = 1, ranked = true, sequence = 5, tasks = true }.
// @returns {QuarterProject} The project.
function storedProject(uuid, { hoursAgo = 1, ideasHoursAgo = hoursAgo, ideasRevision, ranked = true, sequence = 5,
  tasks = true } = {}) {
  const project = new QuarterProject({ summary: uuid, uuid });
  if (tasks) project.setRelatedTaskRecords([{ taskText: `${ uuid } task`, taskUuid: `${ uuid }-task` }]);
  const rankedAt = new Date(NOW.getTime() - hoursAgo * HOUR).toISOString();
  if (ranked) {
    project.markRanked(rankedAt, { similaritySearchedTaskCount: 40, similaritySearchPageCount: 2 });
    project.recordRefreshSuccess("similarity", { inputRevision: similarityInputRevision(project, { scorerEm: "jev" }),
      succeededAt: rankedAt, watermark: { sequence, snapshotId: WATERMARK.snapshotId } });
  }
  project.recordRefreshSuccess("ideas", { inputRevision: ideasRevision ?? ideasInputRevision(project),
    succeededAt: new Date(NOW.getTime() - ideasHoursAgo * HOUR).toISOString() });
  return project;
}

// ----------------------------------------------------------------------------------------------
// @desc Plan a quarter whose live projects are the stored ones.
// @param {QuarterProjectWorkPlanner} planner - The planner.
// @param {Array<QuarterProject>} storedProjects - Stored projects.
// @param {object} [options] - { dictionaryDiscoveryDue = false, scorerEm = "jev", termChangedCounts = new Map() }.
// @returns {Array<object>} The planned requests.
function planned(planner, storedProjects, { dictionaryDiscoveryDue = false, scorerEm = "jev", termChangedCounts = new Map() } = {}) {
  const projects = storedProjects.map(project => new QuarterProject({ summary: project.summary, uuid: project.uuid }));
  return planner.plan({ dictionaryDiscoveryDue, input: SCOPE_INPUT, now: NOW, projects, scopeKey: SCOPE_KEY, scorerEm,
    storedProjects, taskWatermark: WATERMARK, termChangedCounts });
}

// ----------------------------------------------------------------------------------------------
// @desc A work runtime over the maintenance test app with every project maintenance handler registered, its outcomes
//   counted by the planner and listed in the order they arrive.
// @param {object} app - From maintenanceApp.
// @param {object} options - { discoveryRunner, ideaGenerator, planner, requestAnswers }.
// @returns {object} { outcomes, repository, runtime }.
function maintenanceRuntime(app, { discoveryRunner, ideaGenerator, planner, requestAnswers }) {
  const handlers = workHandlerRegistry([
    createDiscoverDictionaryTermsHandler({ promptRunner: discoveryRunner }),
    createGenerateProjectIdeasHandler({ ideaGenerator }),
    createRankProjectTasksHandler({ rankerFactory: (currentApp, options) => prepareProjectTaskRanker(currentApp,
      { ...options, requestAnswers }) }),
    createReconcileProjectsHandler({ planner, taskScorer: async () => "jev" }),
  ]);
  const clock = () => NOW.getTime();
  const repository = new DashboardWorkRepository({ app, clock });
  const runtime = createDashboardWorkRuntime({ app, clearTimer: () => {}, clock, handlers, repository, setTimer: () => 0 });
  const outcomes = [];
  runtime.durable.subscribeOutcomes(outcome => {
    outcomes.push(outcome);
    planner.recordOutcome(outcome);
  });
  runtime.scheduler.setScope(SCOPE_KEY);
  runtime.scheduler.setConditions({ loadSettled: true });
  return { outcomes, repository, runtime };
}

// ----------------------------------------------------------------------------------------------
// @desc Read the saved jobs of the test scope once the runtime has settled every job, or after a bounded wait.
// @param {DashboardWorkRepository} repository - The queue repository.
// @param {function} isSettled - (jobs) => true once the expected jobs have finished.
// @returns {Promise<Array<DashboardWorkJob>>} The saved jobs.
async function settledJobs(repository, isSettled) {
  let jobs = [];
  for (let round = 0; round < 400 && !isSettled(jobs); round += 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
    ({ jobs } = await repository.readAll(SCOPE_KEY));
  }
  return jobs;
}

describe("QuarterProjectWorkPlanner", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A visit aims for half the projects, but at least five, and never more than there are.
  it("aims for half the quarter's projects, at least five", () => {
    expect([0, 3, 8, 12, 30].map(projectCoverageTarget)).toEqual([0, 3, 5, 6, 15]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Due projects are taken changed first, then never ranked, then those with no tasks, then the oldest, and only
  //   the visit's target are in flight; a current project is counted as checked with no request.
  it("orders due projects and keeps only the visit's target in flight", () => {
    const planner = new QuarterProjectWorkPlanner();
    const storedProjects = [storedProject("current"), storedProject("old-five", { hoursAgo: 120 }),
      storedProject("old-four", { hoursAgo: 96 }), storedProject("changed", { sequence: 3 }),
      storedProject("empty", { hoursAgo: 80, tasks: false }), storedProject("never", { ranked: false }),
      storedProject("old-six", { hoursAgo: 144 })];
    const requests = planned(planner, storedProjects);
    const changedRevision = `${ similarityInputRevision(storedProjects[3], { scorerEm: "jev" }) }@snapshot:5`;
    expect(requests.map(request => request.key)).toEqual(["discoverDictionaryTerms:2026-Q3", "rankProjectTasks:changed",
      "rankProjectTasks:never", "rankProjectTasks:empty", "rankProjectTasks:old-six", "rankProjectTasks:old-five"]);
    expect(requests[1]).toMatchObject({ desiredRevision: changedRevision, entityId: "changed",
      input: { ...SCOPE_INPUT, projectUuid: "changed" } });
    expect(requests.slice(2).map(request => request.desiredRevision)).toEqual([null, null, null, null]);
    expect(planner.coverage(SCOPE_KEY)).toMatchObject({ checked: 1, covered: 1, inFlight: 5, submitted: 5, target: 5 });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A finished project frees its slot for the next due one, and counts toward coverage.
  it("submits the next due project once one in flight finishes", () => {
    const planner = new QuarterProjectWorkPlanner();
    const storedProjects = [storedProject("current"), storedProject("old-five", { hoursAgo: 120 }),
      storedProject("old-four", { hoursAgo: 96 }), storedProject("changed", { sequence: 3 }),
      storedProject("empty", { hoursAgo: 80, tasks: false }), storedProject("never", { ranked: false }),
      storedProject("old-six", { hoursAgo: 144 })];
    planned(planner, storedProjects);
    planner.recordOutcome({ entityId: "changed", jobType: "rankProjectTasks", scopeKey: SCOPE_KEY, status: "completed" });
    planner.recordOutcome({ entityId: "never", jobType: "rankProjectTasks", scopeKey: SCOPE_KEY, status: "retryWaiting" });
    storedProjects[3] = storedProject("changed");
    const requests = planned(planner, storedProjects);
    expect(requests.map(request => request.entityId).filter(Boolean)).toEqual(["never", "empty", "old-six", "old-five", "old-four"]);
    expect(planner.coverage(SCOPE_KEY)).toMatchObject({ checked: 2, covered: 2, failed: 0, inFlight: 5, rated: 1, succeeded: 1 });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A project whose ranking is current is asked for ideas alone when they have aged, forcing a request, or when
  //   the tasks they were asked about have changed, naming the new inputs; ideas always wait at maintenance priority.
  it("asks for ideas alone when only a project's ideas are due", () => {
    const planner = new QuarterProjectWorkPlanner();
    const staleIdeas = storedProject("stale-ideas", { ideasHoursAgo: 100 });
    const changedIdeas = storedProject("changed-ideas", { ideasRevision: "00000000" });
    const requests = planned(planner, [staleIdeas, changedIdeas]);
    expect(requests.slice(1)).toEqual([
      expect.objectContaining({ category: "maintenance", desiredRevision: null, key: "generateProjectIdeas:stale-ideas" }),
      expect.objectContaining({ category: "maintenance", desiredRevision: ideasInputRevision(changedIdeas),
        key: "generateProjectIdeas:changed-ideas" }),
    ]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc While the dictionary has projects to examine, rankings ride inside the discovery request, which names a new
  //   revision so it runs even after an earlier discovery completed; ideas requests are not held.
  it("holds rankings inside discovery while the dictionary has projects to examine", () => {
    const planner = new QuarterProjectWorkPlanner();
    const storedProjects = [storedProject("never", { ranked: false }), storedProject("stale-ideas", { ideasHoursAgo: 100 })];
    const requests = planned(planner, storedProjects, { dictionaryDiscoveryDue: true });
    const [discoveryRequest] = requests;
    expect(requests.map(request => request.key)).toEqual(["discoverDictionaryTerms:2026-Q3", "generateProjectIdeas:stale-ideas"]);
    expect(discoveryRequest.input.heldRequests.map(request => request.key)).toEqual(["rankProjectTasks:never"]);
    expect(discoveryRequest.desiredRevision).toMatch(new RegExp(`@${ NOW.getTime() }$`));
    expect(planner.coverage(SCOPE_KEY)).toMatchObject({ inFlight: 2, submitted: 2 });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A current project with open tasks mentioning a term whose definition changed is forced a ranking, which
  //   re-rates those tasks; a current project with none stays checked.
  it("ranks a current project whose tasks mention a changed definition", () => {
    const planner = new QuarterProjectWorkPlanner();
    const storedProjects = [storedProject("mentions-term"), storedProject("unaffected")];
    const requests = planned(planner, storedProjects, { termChangedCounts: new Map([["mentions-term", 3]]) });
    expect(requests.slice(1)).toEqual([expect.objectContaining({ desiredRevision: null, key: "rankProjectTasks:mentions-term" })]);
    expect(planner.coverage(SCOPE_KEY)).toMatchObject({ checked: 1, submitted: 1 });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc With nothing to rate, a project's associations are refreshed on the staleness of its last refresh, and no
  //   dictionary discovery is planned.
  it("refreshes associations on the staleness window when nothing can rate", () => {
    const planner = new QuarterProjectWorkPlanner();
    const stale = storedProject("stale", { ranked: false });
    stale.setAttemptedAt(new Date(NOW.getTime() - 80 * HOUR).toISOString());
    const recent = storedProject("recent", { ranked: false });
    recent.setAttemptedAt(new Date(NOW.getTime() - HOUR).toISOString());
    const requests = planned(planner, [stale, recent], { scorerEm: null });
    expect(requests).toEqual([expect.objectContaining({ desiredRevision: null, key: "rankProjectTasks:stale" })]);
  });
});

describe("reconcileProjects", () => {
  beforeEach(() => setPluginData({ settings: { [SETTING_KEYS.JEV_ACCESS_TOKEN]: "token" } }));

  // ----------------------------------------------------------------------------------------------
  // @desc A project drawn only from the quarterly plan is stored before any job names it, so a second reconciliation
  //   plans it under the same UUID, and a stored project the plan no longer holds is retired.
  it("stores a plan-only project once and retires one that left the plan", async () => {
    const app = maintenanceApp({ tasks: backlogTasks() });
    const scope = { ...SCOPE_INPUT, quarterKey: "2026-Q3" };
    await new QuarterProjectRepository({ app }).applyResult(scope, { apply: () => {}, projectUuid: "dropped",
      summary: "Dropped project" });
    const handler = createReconcileProjectsHandler({ planner: new QuarterProjectWorkPlanner(), taskScorer: async () => "jev" });
    const job = { attempt: 1, cursor: null, desiredRevision: "1", input: SCOPE_INPUT, key: "reconcile", scopeKey: SCOPE_KEY,
      type: "reconcileProjects" };
    const first = await handler.run({ context: jobContext(app), job, signal: null });
    const second = await handler.run({ context: jobContext(app), job, signal: null });
    const projects = await readCollectedProjectTasks(app, scope, { includeInactive: true });
    const launch = projects.find(project => project.summary === "Launch dashboard");
    expect(projects.find(project => project.uuid === "dropped").isActive).toBe(false);
    expect(first.followUps.map(request => request.key)).toEqual(["discoverDictionaryTerms:2026-Q3"]);
    expect(first.followUps[0].input.heldRequests.map(request => request.key)).toEqual([`rankProjectTasks:${ launch.uuid }`]);
    expect(second.followUps[0].input.heldRequests.map(request => request.key)).toEqual([`rankProjectTasks:${ launch.uuid }`]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Submitted to a work runtime as foreground work, a reconciliation plans discovery at its own priority, and
  //   discovery submits the ranking it held once the dictionary has grown; the finished ranking asks for ideas at
  //   maintenance priority. A second reconciliation finds the project current, submits nothing, and counts it as checked.
  it("ranks a project after discovery and then asks for its ideas, from one reconciliation", async () => {
    const app = maintenanceApp({ tasks: backlogTasks() });
    const requestAnswers = ratingRequest();
    const ideaGenerator = jest.fn().mockResolvedValue({ failureReason: null, foundTasks: [], suggestedTasks: [GENERATED_IDEA] });
    const planner = new QuarterProjectWorkPlanner();
    const discoveryRunner = jest.fn().mockResolvedValue(DISCOVERED_TERMS);
    const { outcomes, repository, runtime } = maintenanceRuntime(app, { discoveryRunner, ideaGenerator, planner, requestAnswers });
    const allFinished = jobs => jobs.length === 4 && jobs.every(job => job.status === "completed");
    await runtime.durable.submit(projectReconciliationRequest(SCOPE_INPUT, { category: "foregroundData", requestedAt: 1 }));
    const jobs = await settledJobs(repository, allFinished);
    const categoryByType = Object.fromEntries(jobs.map(job => [job.type, job.category]));
    expect(categoryByType).toEqual({ discoverDictionaryTerms: "foregroundData", generateProjectIdeas: "maintenance",
      rankProjectTasks: "foregroundData", reconcileProjects: "foregroundData" });
    const [project] = await readCollectedProjectTasks(app, { ...SCOPE_INPUT, quarterKey: "2026-Q3" });
    expect(project.lastRankedAt).toBe(NOW.toISOString());
    expect(project.suggestedTasks.map(idea => idea.taskText)).toEqual([GENERATED_IDEA.taskText]);
    expect(planner.coverage(SCOPE_KEY)).toMatchObject({ covered: 1, rated: 1, succeeded: 1, target: 1 });
    expect(outcomes.map(outcome => outcome.jobType)).toEqual(["reconcileProjects", "discoverDictionaryTerms", "rankProjectTasks",
      "generateProjectIdeas"]);

    const ratingCalls = requestAnswers.mock.calls.length;
    await runtime.durable.submit(projectReconciliationRequest(SCOPE_INPUT, { requestedAt: 2 }));
    const secondJobs = await settledJobs(repository, current => current.some(job => job.type === "reconcileProjects"
      && job.succeededRevision === "2"));
    runtime.dispose();
    expect(secondJobs.filter(job => job.type !== "reconcileProjects").map(job => job.status)).toEqual(["completed", "completed",
      "completed"]);
    expect(requestAnswers.mock.calls.length).toBe(ratingCalls);
    expect(ideaGenerator).toHaveBeenCalledTimes(1);
    expect(planner.coverage(SCOPE_KEY)).toMatchObject({ checked: 1, covered: 1, inFlight: 0 });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A term the user adds to the dictionary by hand makes the next reconciliation rank the project again, and that
  //   ranking sends only the tasks that name the term.
  it("ranks a current project again for the tasks that name a term the user added", async () => {
    const app = maintenanceApp({ tasks: backlogTasks() });
    const requestAnswers = ratingRequest();
    const ideaGenerator = jest.fn().mockResolvedValue({ failureReason: null, foundTasks: [], suggestedTasks: [GENERATED_IDEA] });
    const planner = new QuarterProjectWorkPlanner();
    const discoveryRunner = jest.fn().mockResolvedValue(DISCOVERED_TERMS);
    const { outcomes, repository, runtime } = maintenanceRuntime(app, { discoveryRunner, ideaGenerator, planner, requestAnswers });
    await runtime.durable.submit(projectReconciliationRequest(SCOPE_INPUT, { requestedAt: 1 }));
    await settledJobs(repository, jobs => jobs.length === 4 && jobs.every(job => job.status === "completed"));

    const dictionaryHandle = await app.findNote({ name: "User terms dictionary 2026" });
    const dictionaryContent = app.noteContent("User terms dictionary 2026");
    await app.replaceNoteContent(dictionaryHandle, dictionaryContent.replace("\n# Examined projects",
      "- **widget**: A card on the Dashboard.\n\n# Examined projects"));
    requestAnswers.mockClear();
    const rankingCount = () => outcomes.filter(outcome => outcome.jobType === "rankProjectTasks" && outcome.status === "completed").length;
    await runtime.durable.submit(projectReconciliationRequest(SCOPE_INPUT, { requestedAt: 2 }));
    await settledJobs(repository, () => rankingCount() === 2);
    runtime.dispose();
    const resentTexts = requestAnswers.mock.calls.flatMap(([{ state }]) => Object.values(state.prospectiveTasks)
      .map(task => task.text));
    expect(resentTexts.sort()).toEqual(["Tune widget layout 37", "Tune widget layout 67", "Tune widget layout 7",
      "Tune widget layout 97"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A discovery that fails still submits the ranking it held, so the project is ranked with the dictionary as
  //   it stands while discovery waits to retry.
  it("ranks a project when the discovery holding it fails", async () => {
    const app = maintenanceApp({ tasks: backlogTasks() });
    const ideaGenerator = jest.fn().mockResolvedValue({ failureReason: null, foundTasks: [], suggestedTasks: [GENERATED_IDEA] });
    const planner = new QuarterProjectWorkPlanner();
    const discoveryRunner = jest.fn().mockRejectedValue(new Error("Provider unavailable"));
    const { repository, runtime } = maintenanceRuntime(app, { discoveryRunner, ideaGenerator, planner,
      requestAnswers: ratingRequest() });
    const rankingFinished = jobs => jobs.some(job => job.type === "generateProjectIdeas" && job.status === "completed");
    await runtime.durable.submit(projectReconciliationRequest(SCOPE_INPUT, { requestedAt: 1 }));
    const jobs = await settledJobs(repository, rankingFinished);
    runtime.dispose();
    const statusByType = Object.fromEntries(jobs.map(job => [job.type, job.status]));
    expect(statusByType).toEqual({ discoverDictionaryTerms: "retryWaiting", generateProjectIdeas: "completed",
      rankProjectTasks: "completed", reconcileProjects: "completed" });
    expect(planner.coverage(SCOPE_KEY)).toMatchObject({ covered: 1, rated: 1 });
  });
});
