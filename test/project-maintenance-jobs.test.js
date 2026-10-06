// Verify queued dictionary discovery, task ranking, and idea generation persist project evidence and ideas. A
// large ranking pauses between rounds of batches with its similar ratings saved, a ranking resumed by another session
// restarts from those saved ratings, a changed definition re-rates only the tasks that mention it, and failed provider
// work fails the attempt for the queue to retry.
import { jest } from "@jest/globals";
import { SETTING_KEYS } from "constants/settings";
import { readCollectedProjectTasks } from "dashboard/project-task-store";
import { refreshRevision } from "dashboard/quarter-project-refresh-state";
import { dashboardWorkHandlers, workHandlerRegistry } from "dashboard/work-queue/dashboard-work-handlers";
import DashboardWorkRepository from "dashboard/work-queue/dashboard-work-repository";
import { createDashboardWorkRuntime } from "dashboard/work-queue/dashboard-work-runtime";
import { createDiscoverDictionaryTermsHandler } from "dashboard/work-queue/jobs/discover-dictionary-terms";
import { createGenerateProjectIdeasHandler } from "dashboard/work-queue/jobs/generate-project-ideas";
import { createRankProjectTasksHandler, RANK_PROJECT_TASKS_JOB_TYPE } from "dashboard/work-queue/jobs/rank-project-tasks";
import { prepareProjectTaskRanker } from "plan-wizard/stack-rank/stack-rank-project-tasks";
import { setPluginData } from "plugin-data";
import { backlogTasks, DISCOVERED_TERMS, GENERATED_IDEA, jobContext, maintenanceApp, NOW, ratingRequest, runProjectJob,
  SCOPE_INPUT, storedProjectUuid } from "./project-maintenance-test-app";

describe("project maintenance jobs", () => {
  beforeEach(() => setPluginData({ settings: { [SETTING_KEYS.JEV_ACCESS_TOKEN]: "token" } }));

  // ----------------------------------------------------------------------------------------------
  // @desc Discovery, a ranking spread over two turns, and ideas persist local and similar tasks, completion text,
  //   generated ideas, and operation-specific successful refresh revisions.
  it("stores project evidence with ranking and ideas as separate jobs", async () => {
    const ideaGenerator = jest.fn().mockResolvedValue({ failureReason: null, foundTasks: [], suggestedTasks: [GENERATED_IDEA] });
    const discoveryRunner = jest.fn().mockResolvedValue(DISCOVERED_TERMS);
    const queueApp = maintenanceApp({ tasks: backlogTasks() });
    const queueRequest = ratingRequest();
    const context = jobContext(queueApp);
    const input = { ...SCOPE_INPUT, projectUuid: await storedProjectUuid(queueApp) };
    const queueRanker = (app, options) => prepareProjectTaskRanker(app, { ...options, requestAnswers: queueRequest });
    await runProjectJob(createDiscoverDictionaryTermsHandler({ promptRunner: discoveryRunner }), { context, input: SCOPE_INPUT });
    const ranking = await runProjectJob(createRankProjectTasksHandler({ rankerFactory: queueRanker }), { context, input });
    const ideas = await runProjectJob(createGenerateProjectIdeasHandler({ ideaGenerator }), { context, input });

    expect(ranking.turns).toBe(2);
    expect(queueRequest).toHaveBeenCalledTimes(6);
    expect(queueApp.noteContent("User terms dictionary 2026")).toContain("dashboard");
    const [stored] = await readCollectedProjectTasks(queueApp, { ...SCOPE_INPUT, quarterKey: "2026-Q3" });
    expect(stored.relatedTaskRecords.map(record => record.taskUuid)).toEqual(["open-task", "errand-7", "errand-37", "errand-67", "errand-97"]);
    expect(stored.completedTasks).toEqual([expect.objectContaining({ taskText: "Launch dashboard polish", taskUuid: "finished-task" })]);
    expect(stored.suggestedTasks[0].taskText).toBe(GENERATED_IDEA.taskText);
    expect(stored.lastAttemptedAt).toBe(NOW.toISOString());
    expect(stored.lastRankedAt).toBe(NOW.toISOString());
    expect(stored.lastSuggestedAt).toBe(NOW.toISOString());
    expect(ranking.result.revision).toBe(refreshRevision(stored.refreshState, "similarity"));
    expect(ideas.result.revision).toBe(stored.refreshState.ideas.inputRevision);
    expect(ideaGenerator.mock.calls[0][1].project.candidateTaskRecords).toEqual([]);
    expect(typeof ideaGenerator.mock.calls[0][1].promptRunner).toBe("function");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc With nothing to rate, the ranking job refreshes the local associations alone, and the ideas job offers the
  //   provider its pool of open tasks and saves the tasks it attributes without persisting that transient pool.
  it("associates provider-found tasks when nothing can rate, offering the provider its pool", async () => {
    setPluginData({ settings: {} });
    const ideaGenerator = jest.fn(async (unusedApp, { project }) => ({ failureReason: null,
      foundTasks: [{ taskText: "Errand 5", taskUuid: "errand-5" }].filter(found => project.candidateTaskRecords
        .some(candidate => candidate.taskUuid === found.taskUuid)), suggestedTasks: [GENERATED_IDEA] }));
    const queueApp = maintenanceApp({ tasks: backlogTasks() });
    const context = jobContext(queueApp);
    const input = { ...SCOPE_INPUT, projectUuid: await storedProjectUuid(queueApp) };
    const ranking = await runProjectJob(createRankProjectTasksHandler(), { context, input });
    await runProjectJob(createGenerateProjectIdeasHandler({ ideaGenerator }), { context, input });
    expect(ranking).toMatchObject({ result: { revision: undefined }, turns: 1 });
    const [stored] = await readCollectedProjectTasks(queueApp, { ...SCOPE_INPUT, quarterKey: "2026-Q3" });
    expect(stored.relatedTaskRecords.map(record => record.taskUuid)).toEqual(["open-task", "errand-5"]);
    expect(stored.relatedTasks).toContain("errand-5");
    expect(stored.candidateTaskRecords).toEqual([]);
    expect(stored.lastRankedAt).toBeNull();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A paused ranking saves the similar tasks it has rated, and no ranking time. Another session handed the same
  //   cursor holds no ranking in progress, so it starts over and reads the saved ratings instead of sending them again.
  it("saves similar ratings at each pause, and restarts in another session from them", async () => {
    const app = maintenanceApp({ tasks: backlogTasks() });
    const context = jobContext(app);
    const input = { ...SCOPE_INPUT, projectUuid: await storedProjectUuid(app) };
    const firstRequest = ratingRequest();
    const firstSession = createRankProjectTasksHandler({ rankerFactory: (currentApp, options) => prepareProjectTaskRanker(
      currentApp, { ...options, requestAnswers: firstRequest }) });
    const job = { attempt: 1, cursor: null, desiredRevision: null, input, key: "rank", type: RANK_PROJECT_TASKS_JOB_TYPE };
    const paused = await firstSession.run({ context, job, signal: null });
    expect(paused).toMatchObject({ checkpoint: { ratedCount: 80, totalCount: 120 }, status: "yielded" });
    const [pausedProject] = await readCollectedProjectTasks(app, { ...SCOPE_INPUT, quarterKey: "2026-Q3" });
    const savedUuids = Object.keys(pausedProject.taskSimilarityScores).map(ratingKey => ratingKey.split(":")[1]);
    expect(savedUuids.sort()).toEqual(["errand-37", "errand-67", "errand-7"]);
    expect(pausedProject.lastRankedAt).toBeNull();

    const secondRequest = ratingRequest();
    const secondSession = createRankProjectTasksHandler({ rankerFactory: (currentApp, options) => prepareProjectTaskRanker(
      currentApp, { ...options, requestAnswers: secondRequest }) });
    const { result } = await runProjectJob(secondSession, { context, cursor: paused.checkpoint, input });
    const resentTexts = secondRequest.mock.calls.flatMap(([{ state }]) => Object.values(state.prospectiveTasks)
      .map(task => task.text));
    expect(resentTexts).toHaveLength(117);
    expect(resentTexts).not.toContain("Tune widget layout 7");
    const [finished] = await readCollectedProjectTasks(app, { ...SCOPE_INPUT, quarterKey: "2026-Q3" });
    expect(finished.lastRankedAt).toBe(NOW.toISOString());
    expect(result.revision).toBe(refreshRevision(finished.refreshState, "similarity"));
  });

  // ----------------------------------------------------------------------------------------------
  // @desc After terms are added to the dictionary, the next ranking re-rates only the open tasks that name them: the
  //   widget tasks the hash already rated similar and the chart tasks it rated low and discarded. A ranking after that,
  //   with nothing changed, sends nothing.
  it("re-rates only the tasks that mention a changed definition", async () => {
    const app = maintenanceApp({ tasks: backlogTasks() });
    const context = jobContext(app);
    const input = { ...SCOPE_INPUT, projectUuid: await storedProjectUuid(app) };
    const requestAnswers = ratingRequest();
    const handler = createRankProjectTasksHandler({ rankerFactory: (currentApp, options) => prepareProjectTaskRanker(currentApp,
      { ...options, requestAnswers }) });
    await runProjectJob(handler, { context, input });
    const [firstRanked] = await readCollectedProjectTasks(app, { ...SCOPE_INPUT, quarterKey: "2026-Q3" });
    expect(firstRanked.refreshState.similarity.dictionaryPosition).toMatchObject({ sequence: 0 });

    const dictionaryHandle = await app.findNote({ name: "User terms dictionary 2026" });
    const dictionaryContent = app.noteContent("User terms dictionary 2026");
    const addedTerms = "- **widget**: A card on the Dashboard.\n- **chart**: A plotted Dashboard widget.\n\n# Examined projects";
    await app.replaceNoteContent(dictionaryHandle, dictionaryContent.replace("\n# Examined projects", addedTerms));
    requestAnswers.mockClear();
    await runProjectJob(handler, { context, input });
    const resentTexts = requestAnswers.mock.calls.flatMap(([{ state }]) => Object.values(state.prospectiveTasks)
      .map(task => task.text));
    expect(resentTexts.sort()).toEqual(["Sketch chart idea 3", "Sketch chart idea 43", "Sketch chart idea 83",
      "Tune widget layout 37", "Tune widget layout 67", "Tune widget layout 7", "Tune widget layout 97"]);
    const [secondRanked] = await readCollectedProjectTasks(app, { ...SCOPE_INPUT, quarterKey: "2026-Q3" });
    expect(secondRanked.refreshState.similarity.dictionaryPosition).toMatchObject({ sequence: 1 });

    requestAnswers.mockClear();
    await runProjectJob(handler, { context, input });
    expect(requestAnswers).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A ranking with a failed batch keeps its similar ratings and associations but not its ranking time or
  //   refresh success, and fails the attempt so the queue retries it.
  it("saves a ranking that missed batches and fails the attempt", async () => {
    const app = maintenanceApp({ tasks: backlogTasks() });
    const input = { ...SCOPE_INPUT, projectUuid: await storedProjectUuid(app) };
    const requestAnswers = ratingRequest({ failingText: "Errand 100" });
    const handler = createRankProjectTasksHandler({ rankerFactory: (currentApp, options) => prepareProjectTaskRanker(currentApp,
      { ...options, requestAnswers }) });
    await expect(runProjectJob(handler, { context: jobContext(app), input })).rejects.toThrow("missed 1 batches");
    const [project] = await readCollectedProjectTasks(app, { ...SCOPE_INPUT, quarterKey: "2026-Q3" });
    expect(project.lastRankedAt).toBeNull();
    expect(project.refreshState.similarity).toBeUndefined();
    expect(project.relatedTaskRecords.map(record => record.taskUuid)).toContain("errand-7");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A provider call that fails writes nothing and fails the attempt; a project that has left the plan retires
  //   its job.
  it("fails an ideas attempt whose provider call failed, and retires a job for a project no longer planned", async () => {
    const app = maintenanceApp({ tasks: backlogTasks() });
    const context = jobContext(app);
    const ideaGenerator = jest.fn().mockResolvedValue({ failureReason: "Provider timed out", foundTasks: [], requestFailed: true,
      suggestedTasks: [] });
    const handler = createGenerateProjectIdeasHandler({ ideaGenerator });
    const input = { ...SCOPE_INPUT, projectUuid: await storedProjectUuid(app) };
    const [before] = await readCollectedProjectTasks(app, { ...SCOPE_INPUT, quarterKey: "2026-Q3" });
    await expect(runProjectJob(handler, { context, input })).rejects.toThrow("Provider timed out");
    const [after] = await readCollectedProjectTasks(app, { ...SCOPE_INPUT, quarterKey: "2026-Q3" });
    expect(after.toStoreSection()).toBe(before.toStoreSection());
    const retired = await runProjectJob(handler, { context, input: { ...input, projectUuid: "gone-project" } });
    expect(retired.result).toEqual({ status: "superseded" });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The registry runs every maintenance job type, and refuses a project job without a project or an evidence job without a term.
  it("registers the maintenance handlers and validates their input", () => {
    const registry = workHandlerRegistry(dashboardWorkHandlers());
    expect([...registry.keys()].sort()).toEqual(["collectTermEvidence", "discoverDictionaryTerms", "generateProjectIdeas",
      "prepareDayRanking", "rankProjectTasks", "rateProjectIdeas", "reconcileProjects", "refineDictionaryTerm"]);
    expect(() => registry.get("collectTermEvidence").validateInput({ term: " ", year: 2026 })).toThrow("term");
    expect(() => registry.get("reconcileProjects").validateInput(SCOPE_INPUT)).not.toThrow();
    expect(() => registry.get("rankProjectTasks").validateInput(SCOPE_INPUT)).toThrow("projectUuid");
    expect(() => registry.get("discoverDictionaryTerms").validateInput(SCOPE_INPUT)).not.toThrow();
    expect(() => registry.get("generateProjectIdeas").validateInput({ ...SCOPE_INPUT, quarter: 5 })).toThrow("quarter");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Submitted through a work runtime with durable work, a ranking yields between turns, keeps its claim, and
  //   completes at the revision of the similarity refresh it recorded.
  it("completes a ranking submitted through the durable work runtime", async () => {
    const app = maintenanceApp({ tasks: backlogTasks() });
    const requestAnswers = ratingRequest();
    const handler = createRankProjectTasksHandler({ rankerFactory: (currentApp, options) => prepareProjectTaskRanker(currentApp,
      { ...options, requestAnswers }) });
    const clock = () => NOW.getTime();
    const repository = new DashboardWorkRepository({ app, clock });
    const runtime = createDashboardWorkRuntime({ app, clearTimer: () => {}, clock, handlers: workHandlerRegistry([handler]),
      repository, setTimer: () => 0 });
    runtime.scheduler.setScope("work-domain:Q3 2026");
    runtime.scheduler.setConditions({ loadSettled: true });
    const input = { ...SCOPE_INPUT, projectUuid: await storedProjectUuid(app) };
    await runtime.durable.submit({ entityId: input.projectUuid, input, key: `rankProjectTasks:${ input.projectUuid }`,
      type: RANK_PROJECT_TASKS_JOB_TYPE });
    let job = null;
    for (let round = 0; round < 200 && job?.status !== "completed"; round += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
      [job] = (await repository.readAll("work-domain:Q3 2026")).jobs;
    }
    runtime.dispose();
    const [project] = await readCollectedProjectTasks(app, { ...SCOPE_INPUT, quarterKey: "2026-Q3" });
    expect(job).toMatchObject({ attempt: 1, cursor: null, status: "completed",
      succeededRevision: refreshRevision(project.refreshState, "similarity") });
  });
});
