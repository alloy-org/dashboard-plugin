// Verify how queued project maintenance is planned: which projects a visit refreshes and in what order, how many are
// in flight at once, when ideas are asked for alone, how a reconciliation aligns the store with the live plan before
// any job names a project, and that one reconciliation submitted to a work runtime ranks a project and then asks for its
// ideas, leaving a second reconciliation nothing to do.
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
// @param {object} [options] - { scorerEm = "jev" }.
// @returns {Array<object>} The planned requests.
function planned(planner, storedProjects, { scorerEm = "jev" } = {}) {
  const projects = storedProjects.map(project => new QuarterProject({ summary: project.summary, uuid: project.uuid }));
  return planner.plan({ input: SCOPE_INPUT, now: NOW, projects, scopeKey: SCOPE_KEY, scorerEm, storedProjects,
    taskWatermark: WATERMARK });
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
    expect(first.followUps.map(request => request.key)).toEqual(["discoverDictionaryTerms:2026-Q3",
      `rankProjectTasks:${ launch.uuid }`]);
    expect(second.followUps.map(request => request.key)).toEqual(first.followUps.map(request => request.key));
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Submitted to a work runtime as foreground work, a reconciliation plans discovery and a ranking at its own
  //   priority; the finished ranking asks for ideas at maintenance priority. A second reconciliation finds the project
  //   current, submits nothing, and counts it as checked.
  it("ranks a project and then asks for its ideas, from one reconciliation", async () => {
    const app = maintenanceApp({ tasks: backlogTasks() });
    const requestAnswers = ratingRequest();
    const ideaGenerator = jest.fn().mockResolvedValue({ failureReason: null, foundTasks: [], suggestedTasks: [GENERATED_IDEA] });
    const planner = new QuarterProjectWorkPlanner();
    const handlers = workHandlerRegistry([
      createDiscoverDictionaryTermsHandler({ promptRunner: jest.fn().mockResolvedValue(DISCOVERED_TERMS) }),
      createGenerateProjectIdeasHandler({ ideaGenerator }),
      createRankProjectTasksHandler({ rankerFactory: (currentApp, options) => prepareProjectTaskRanker(currentApp,
        { ...options, requestAnswers }) }),
      createReconcileProjectsHandler({ planner, taskScorer: async () => "jev" }),
    ]);
    const clock = () => NOW.getTime();
    const repository = new DashboardWorkRepository({ app, clock });
    const runtime = createDashboardWorkRuntime({ app, clearTimer: () => {}, clock, handlers, repository, setTimer: () => 0 });
    runtime.durable.subscribeOutcomes(outcome => planner.recordOutcome(outcome));
    runtime.scheduler.setScope(SCOPE_KEY);
    runtime.scheduler.setConditions({ loadSettled: true });
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
});
