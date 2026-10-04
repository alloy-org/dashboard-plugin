// Verify the queued project maintenance handlers against the background collection pass: dictionary discovery, task
// ranking, and idea generation run as separate jobs leave a project's store section as one collection pass does, a
// large ranking pauses between rounds of batches with its similar ratings saved, a ranking resumed by another session
// restarts from those saved ratings, a changed definition re-rates only the tasks that mention it, and failed provider
// work fails the attempt for the queue to retry.
import { jest } from "@jest/globals";
import { SETTING_KEYS } from "constants/settings";
import { collectProjectTasks } from "dashboard/project-task-collection";
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
import { backlogTasks, DISCOVERED_TERMS, GENERATED_IDEA, jobContext, maintenanceApp, NOW, QUARTERLY_CONTENT, ratingRequest,
  SCOPE_INPUT, storedProjectUuid } from "./project-maintenance-test-app";

// ----------------------------------------------------------------------------------------------
// @desc Run a handler's job through every yielded turn, as the durable runner does, carrying each checkpoint.
// @param {object} handler - A work handler.
// @param {object} options - { context, input, cursor = null }.
// @returns {Promise<object>} { result, turns }: the last turn's result and how many turns ran.
async function runToEnd(handler, { context, cursor = null, input }) {
  let jobCursor = cursor;
  for (let turns = 1; turns < 20; turns += 1) {
    const job = { attempt: 1, cursor: jobCursor, desiredRevision: null, entityId: input.projectUuid || null, input,
      key: `${ handler.type }:${ input.projectUuid || "quarter" }`, scopeKey: "work-domain:Q3 2026", type: handler.type };
    const result = await handler.run({ context, job, signal: null });
    if (result?.status !== "yielded") return { result, turns };
    jobCursor = result.checkpoint;
  }
  throw new Error("The job never finished");
}

// ----------------------------------------------------------------------------------------------
// @desc The stored project, with the bookkeeping two routes record differently set aside: its output revision, which
//   counts writes, the ideas refresh and dictionary position only the queue records, and the snapshot identity each
//   run generates.
// @param {object} app - From maintenanceApp.
// @returns {Promise<string>} The project's store section.
async function comparableSection(app) {
  const [project] = await readCollectedProjectTasks(app, { ...SCOPE_INPUT, quarterKey: "2026-Q3" });
  const similarity = project.refreshState.similarity;
  project.projectRevision = 0;
  const comparableSimilarity = { ...similarity, watermark: { sequence: similarity?.watermark?.sequence } };
  delete comparableSimilarity.dictionaryPosition;
  project.refreshState = similarity ? { similarity: comparableSimilarity } : {};
  return project.toStoreSection();
}

describe("project maintenance jobs", () => {
  beforeEach(() => setPluginData({ settings: { [SETTING_KEYS.JEV_ACCESS_TOKEN]: "token" } }));

  // ----------------------------------------------------------------------------------------------
  // @desc Discovery, a ranking spread over two turns, and ideas, each a separate job, leave the store section and the
  //   dictionary as one collection pass does over the same reads.
  it("writes the project a collection pass writes, with ranking and ideas as separate jobs", async () => {
    const legacyApp = maintenanceApp({ tasks: backlogTasks() });
    await storedProjectUuid(legacyApp);
    const legacyRequest = ratingRequest();
    const ideaGenerator = jest.fn().mockResolvedValue({ failureReason: null, foundTasks: [], suggestedTasks: [GENERATED_IDEA] });
    const discoveryRunner = jest.fn().mockResolvedValue(DISCOVERED_TERMS);
    const legacyRanker = (app, options) => prepareProjectTaskRanker(app, { ...options, promptRunner: discoveryRunner,
      requestAnswers: legacyRequest });
    await collectProjectTasks(legacyApp, { ...SCOPE_INPUT, ideaGenerator, now: NOW, quarterlyContent: QUARTERLY_CONTENT,
      rankerFactory: legacyRanker });

    setPluginData({ settings: { [SETTING_KEYS.JEV_ACCESS_TOKEN]: "token" } });
    const queueApp = maintenanceApp({ tasks: backlogTasks() });
    const queueRequest = ratingRequest();
    const context = jobContext(queueApp);
    const input = { ...SCOPE_INPUT, projectUuid: await storedProjectUuid(queueApp) };
    const queueRanker = (app, options) => prepareProjectTaskRanker(app, { ...options, requestAnswers: queueRequest });
    await runToEnd(createDiscoverDictionaryTermsHandler({ promptRunner: discoveryRunner }), { context, input: SCOPE_INPUT });
    const ranking = await runToEnd(createRankProjectTasksHandler({ rankerFactory: queueRanker }), { context, input });
    const ideas = await runToEnd(createGenerateProjectIdeasHandler({ ideaGenerator }), { context, input });

    expect(ranking.turns).toBe(2);
    expect(queueRequest.mock.calls.length).toBe(legacyRequest.mock.calls.length);
    const queueSection = await comparableSection(queueApp);
    expect(queueSection).toBe(await comparableSection(legacyApp));
    expect(queueSection).toContain("Tune widget layout 97");
    expect(queueSection).toContain("Audit widget memory before ship");
    expect(queueApp.noteContent("User terms dictionary 2026")).toContain("dashboard");
    expect(queueApp.noteContent("User terms dictionary 2026")).toBe(legacyApp.noteContent("User terms dictionary 2026"));
    const [stored] = await readCollectedProjectTasks(queueApp, { ...SCOPE_INPUT, quarterKey: "2026-Q3" });
    expect(ranking.result.revision).toBe(refreshRevision(stored.refreshState, "similarity"));
    expect(ideas.result.revision).toBe(stored.refreshState.ideas.inputRevision);
    expect(ideaGenerator.mock.calls[1][1].project.candidateTaskRecords).toEqual([]);
    expect(typeof ideaGenerator.mock.calls[1][1].promptRunner).toBe("function");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc With nothing to rate, the ranking job refreshes the local associations alone, and the ideas job offers the
  //   provider its pool of open tasks, so a task the provider attributes is associated as a collection pass does.
  it("matches a collection pass when nothing can rate, offering the provider its pool", async () => {
    setPluginData({ settings: {} });
    const ideaGenerator = jest.fn(async (unusedApp, { project }) => ({ failureReason: null,
      foundTasks: [{ taskText: "Errand 5", taskUuid: "errand-5" }].filter(found => project.candidateTaskRecords
        .some(candidate => candidate.taskUuid === found.taskUuid)), suggestedTasks: [GENERATED_IDEA] }));
    const legacyApp = maintenanceApp({ tasks: backlogTasks() });
    await storedProjectUuid(legacyApp);
    await collectProjectTasks(legacyApp, { ...SCOPE_INPUT, ideaGenerator, now: NOW, quarterlyContent: QUARTERLY_CONTENT });
    const queueApp = maintenanceApp({ tasks: backlogTasks() });
    const context = jobContext(queueApp);
    const input = { ...SCOPE_INPUT, projectUuid: await storedProjectUuid(queueApp) };
    const ranking = await runToEnd(createRankProjectTasksHandler(), { context, input });
    await runToEnd(createGenerateProjectIdeasHandler({ ideaGenerator }), { context, input });
    expect(ranking).toMatchObject({ result: { revision: undefined }, turns: 1 });
    expect(await comparableSection(queueApp)).toBe(await comparableSection(legacyApp));
    expect(await comparableSection(queueApp)).toContain("errand-5");
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
    const { result } = await runToEnd(secondSession, { context, cursor: paused.checkpoint, input });
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
    await runToEnd(handler, { context, input });
    const [firstRanked] = await readCollectedProjectTasks(app, { ...SCOPE_INPUT, quarterKey: "2026-Q3" });
    expect(firstRanked.refreshState.similarity.dictionaryPosition).toMatchObject({ sequence: 0 });

    const dictionaryHandle = await app.findNote({ name: "User terms dictionary 2026" });
    const dictionaryContent = app.noteContent("User terms dictionary 2026");
    const addedTerms = "- **widget**: A card on the Dashboard.\n- **chart**: A plotted Dashboard widget.\n\n# Examined projects";
    await app.replaceNoteContent(dictionaryHandle, dictionaryContent.replace("\n# Examined projects", addedTerms));
    requestAnswers.mockClear();
    await runToEnd(handler, { context, input });
    const resentTexts = requestAnswers.mock.calls.flatMap(([{ state }]) => Object.values(state.prospectiveTasks)
      .map(task => task.text));
    expect(resentTexts.sort()).toEqual(["Sketch chart idea 3", "Sketch chart idea 43", "Sketch chart idea 83",
      "Tune widget layout 37", "Tune widget layout 67", "Tune widget layout 7", "Tune widget layout 97"]);
    const [secondRanked] = await readCollectedProjectTasks(app, { ...SCOPE_INPUT, quarterKey: "2026-Q3" });
    expect(secondRanked.refreshState.similarity.dictionaryPosition).toMatchObject({ sequence: 1 });

    requestAnswers.mockClear();
    await runToEnd(handler, { context, input });
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
    await expect(runToEnd(handler, { context: jobContext(app), input })).rejects.toThrow("missed 1 batches");
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
    await expect(runToEnd(handler, { context, input })).rejects.toThrow("Provider timed out");
    const [after] = await readCollectedProjectTasks(app, { ...SCOPE_INPUT, quarterKey: "2026-Q3" });
    expect(after.toStoreSection()).toBe(before.toStoreSection());
    const retired = await runToEnd(handler, { context, input: { ...input, projectUuid: "gone-project" } });
    expect(retired.result).toEqual({ status: "superseded" });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The registry runs all four job types, and refuses a project job without a project.
  it("registers the maintenance handlers and validates their input", () => {
    const registry = workHandlerRegistry(dashboardWorkHandlers());
    expect([...registry.keys()].sort()).toEqual(["discoverDictionaryTerms", "generateProjectIdeas", "rankProjectTasks",
      "reconcileProjects"]);
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
