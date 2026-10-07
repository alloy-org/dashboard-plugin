// Preserve task-change, idea-refinement, and completion evidence through the queued handlers after legacy removal.
import { jest } from "@jest/globals";
import { SETTING_KEYS } from "constants/settings";
import { readCollectedProjectTasks } from "dashboard/project-task-store";
import QuarterProjectRepository from "dashboard/quarter-project-repository";
import { createGenerateProjectIdeasHandler } from "dashboard/work-queue/jobs/generate-project-ideas";
import { createRankProjectTasksHandler } from "dashboard/work-queue/jobs/rank-project-tasks";
import { createReconcileProjectsHandler } from "dashboard/work-queue/jobs/reconcile-projects";
import QuarterProjectWorkPlanner from "dashboard/work-queue/quarter-project-work-planner";
import { resolvePlanScope } from "plan-wizard/plan-models";
import { prepareProjectTaskRanker } from "plan-wizard/stack-rank/stack-rank-project-tasks";
import { taskRatingKey } from "plan-wizard/stack-rank/task-rating-cache";
import { guideSectionRange, jsonPayloadMarkdown, prospectIndexHeadingText } from "plan-wizard/vision-guide-markdown";
import { initializeVisionGuide } from "plan-wizard/vision-guide-notes";
import { setPluginData } from "plugin-data";
import { GENERATED_IDEA, jobContext, maintenanceApp, NOW, ratingRequest, runProjectJob, SCOPE_INPUT,
  storedProjectUuid } from "./project-maintenance-test-app";

const SCOPE = resolvePlanScope(SCOPE_INPUT);

// ----------------------------------------------------------------------------------------------
// @desc Read the only project's latest stored state.
// @param {object} app - In-memory maintenance app.
// @returns {Promise<QuarterProject>} Stored project.
async function readProject(app) {
  const [project] = await readCollectedProjectTasks(app, SCOPE);
  return project;
}

// ----------------------------------------------------------------------------------------------
// @desc Save a live guide project citing a task absent from the task API, so reconciliation and ranking use evidence.
// @param {object} app - In-memory maintenance app.
// @returns {Promise<string>} Project UUID.
async function seedCitedProject(app) {
  const projectUuid = await storedProjectUuid(app);
  const guide = await initializeVisionGuide(app, null, SCOPE);
  const range = guideSectionRange(guide.content, prospectIndexHeadingText("Professional", SCOPE));
  const payload = { prospectTasks: [], prospects: [{ approvalStatusEm: "humanAffirmed", evidence: [{ noteUuid: "source",
    taskUuid: "cited-task", text: "Cited old task" }], linkedGoalUuids: [], priorityEm: "quarterFocus", quarterKey: SCOPE.quarterKey,
    capturedAt: NOW.toISOString(), relatedNotes: [], relatedTasks: ["cited-task"], substantiations: ["Ship the dashboard"], summary: "Launch dashboard", userCategoryEm: "work",
    uuid: projectUuid }] };
  await app.replaceNoteContent(guide.noteHandle, jsonPayloadMarkdown(payload),
    { section: { heading: { level: range.level, text: range.text } } });
  return projectUuid;
}

describe("queued project evidence", () => {
  beforeEach(() => setPluginData({ settings: {} }));

  // ----------------------------------------------------------------------------------------------
  // @desc Edits to old discarded tasks are retried after an incomplete ranking, and only complete work advances the
  //   task-change watermark. Once ranked, unchanged content is read from the saved score rather than sent again.
  it("re-rates an edited old task and preserves its watermark until every batch succeeds", async () => {
    setPluginData({ settings: { [SETTING_KEYS.JEV_ACCESS_TOKEN]: "token" } });
    const oldTask = { content: "Errand", createdAt: "2026-01-01T00:00:00.000Z", uuid: "old-task" };
    const app = maintenanceApp({ tasks: [oldTask] });
    const input = { ...SCOPE_INPUT, projectUuid: await storedProjectUuid(app) };
    const requestAnswers = ratingRequest();
    const handler = createRankProjectTasksHandler({ rankerFactory: (currentApp, options) => prepareProjectTaskRanker(currentApp,
      { ...options, requestAnswers }) });
    await runProjectJob(handler, { context: jobContext(app), input });
    const baseline = (await readProject(app)).refreshState.similarity;
    expect(baseline.watermark.sequence).toBe(1);
    app.getTaskDomainTasks.mockResolvedValue([{ ...oldTask, content: "Tune widget layout" }]);
    requestAnswers.mockRejectedValueOnce(new Error("Batch unavailable"));
    await expect(runProjectJob(handler, { context: jobContext(app), input })).rejects.toThrow("Batch unavailable");
    expect((await readProject(app)).refreshState.similarity).toEqual(baseline);
    requestAnswers.mockClear();
    await runProjectJob(handler, { context: jobContext(app), input });
    expect(Object.values(requestAnswers.mock.calls[0][0].state.prospectiveTasks)).toEqual([expect.objectContaining({ text: "Tune widget layout" })]);
    const refreshed = await readProject(app);
    expect(refreshed.refreshState.similarity.watermark.sequence).toBe(2);
    expect(refreshed.relatedTaskRecords.map(record => record.taskUuid)).toContain("old-task");
    requestAnswers.mockClear();
    await runProjectJob(handler, { context: jobContext(app), input });
    expect(requestAnswers).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Refinement replaces the original idea in place, keeps unrelated ideas and their identities.
  it("refines an idea in place and appends another idea", async () => {
    const app = maintenanceApp({ tasks: [] });
    const input = { ...SCOPE_INPUT, projectUuid: await storedProjectUuid(app) };
    const ideaGenerator = jest.fn().mockResolvedValueOnce({ foundTasks: [], suggestedTasks: [GENERATED_IDEA,
      { ...GENERATED_IDEA, taskText: "Draft the release notes" }] }).mockResolvedValueOnce({ foundTasks: [], suggestedTasks: [
      { ...GENERATED_IDEA, beforeTask: GENERATED_IDEA.taskText, taskText: "Audit widget memory and cap the cache" },
      { ...GENERATED_IDEA, taskText: "Wire the date picker to the store" }] });
    const handler = createGenerateProjectIdeasHandler({ ideaGenerator });
    await runProjectJob(handler, { context: jobContext(app), input });
    const unchangedId = (await readProject(app)).suggestedTasks[1].ideaId;
    await runProjectJob(handler, { context: jobContext(app), input });
    const project = await readProject(app);
    expect(project.suggestedTasks.map(idea => idea.taskText)).toEqual(["Audit widget memory and cap the cache",
      "Draft the release notes", "Wire the date picker to the store"]);
    expect(unchangedId).toBeTruthy();
    expect(project.suggestedTasks[1].ideaId).toBe(unchangedId);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Completion text survives an API window that no longer returns the task, but reopening removes the completion.
  it("retains completion history until a task is observed reopened", async () => {
    const task = { completedAt: 1789552800, content: "Launch dashboard polish", uuid: "finished-task" };
    const app = maintenanceApp({ tasks: [task] });
    const input = { ...SCOPE_INPUT, projectUuid: await storedProjectUuid(app) };
    const handler = createRankProjectTasksHandler();
    await runProjectJob(handler, { context: jobContext(app), input });
    const completions = (await readProject(app)).completedTasks;
    expect(completions).toEqual([expect.objectContaining({ taskText: task.content, taskUuid: task.uuid })]);
    app.getTaskDomainTasks.mockResolvedValue([]);
    await runProjectJob(handler, { context: jobContext(app), input });
    expect((await readProject(app)).completedTasks).toEqual(completions);
    app.getTaskDomainTasks.mockResolvedValue([{ ...task, completedAt: null }]);
    await runProjectJob(handler, { context: jobContext(app), input });
    expect((await readProject(app)).completedTasks).toEqual([]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Reconciliation compacts uncited low scores without another ranking, retaining low cited scores, high scores,
  //   timestamps, and retired status. The no-provider path must still perform this storage maintenance.
  it("compacts uncited scores while preserving cited scores and project history", async () => {
    const app = maintenanceApp({ tasks: [] });
    const projectUuid = await seedCitedProject(app);
    const repository = new QuarterProjectRepository({ app });
    const scores = { "aaaa:cited-task": 2, "bbbb:uncited-task": 1, "cccc:similar-task": 8 };
    await repository.applyResult(SCOPE, { apply: project => { project.setSimilarityScores(scores); project.markRanked(NOW.toISOString()); }, projectUuid });
    await repository.applyResult(SCOPE, { apply: project => project.setSimilarityScores({ "dddd:discarded-task": 1 }),
      projectUuid: "departed", summary: "Departed project" });
    const planner = new QuarterProjectWorkPlanner();
    await runProjectJob(createReconcileProjectsHandler({ planner, taskScorer: async () => null }),
      { context: jobContext(app), input: SCOPE_INPUT });
    const stored = await repository.readOne(SCOPE, projectUuid);
    expect(stored.taskSimilarityScores).toEqual({ "aaaa:cited-task": 2, "cccc:similar-task": 8 });
    expect(stored.lastRankedAt).toBe(NOW.toISOString());
    const departed = (await repository.readStored(SCOPE, { includeInactive: true })).find(project => project.uuid === "departed");
    expect(departed).toMatchObject({ isActive: false, taskSimilarityScores: {} });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A project whose ranking was interrupted keeps its low scores through reconciliation, since they are the
  //   ratings the restarted ranking reads instead of sending those tasks again.
  it("leaves the scores of an unfinished ranking for the restart to read", async () => {
    const app = maintenanceApp({ tasks: [] });
    const projectUuid = await seedCitedProject(app);
    const repository = new QuarterProjectRepository({ app });
    const scores = { "aaaa:cited-task": 2, "bbbb:uncited-task": 1, "cccc:similar-task": 8 };
    await repository.applyResult(SCOPE, { apply: project => { project.setSimilarityScores(scores);
      project.recordUnfinishedRanking(NOW.toISOString()); }, projectUuid });
    await runProjectJob(createReconcileProjectsHandler({ planner: new QuarterProjectWorkPlanner(), taskScorer: async () => null }),
      { context: jobContext(app), input: SCOPE_INPUT });
    const stored = await repository.readOne(SCOPE, projectUuid);
    expect(stored.taskSimilarityScores).toEqual(scores);
    expect(stored.unfinishedRankingAt).toBe(NOW.toISOString());
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Even a recent ranking must fill a missing cited score; evidence-only tasks receive scores without a new pool.
  it("plans and rates an unscored cited task on a recently ranked project", async () => {
    setPluginData({ settings: { [SETTING_KEYS.JEV_ACCESS_TOKEN]: "token" } });
    const app = maintenanceApp({ tasks: [] });
    const projectUuid = await seedCitedProject(app);
    const repository = new QuarterProjectRepository({ app });
    await repository.applyResult(SCOPE, { apply: project => project.markRanked(NOW.toISOString(), { similaritySearchedTaskCount: 0, similaritySearchPageCount: 2 }), projectUuid });
    const handler = createReconcileProjectsHandler({ planner: new QuarterProjectWorkPlanner(), taskScorer: async () => "jev",
      termEvidenceScheduler: null, unexaminedProjectReader: async () => [] });
    const { result } = await runProjectJob(handler, { context: jobContext(app), input: SCOPE_INPUT });
    expect(result.followUps).toEqual(expect.arrayContaining([expect.objectContaining({ entityId: projectUuid, type: "rankProjectTasks" })]));
    const requestAnswers = ratingRequest();
    const ranker = createRankProjectTasksHandler({ rankerFactory: (currentApp, options) => prepareProjectTaskRanker(currentApp,
      { ...options, requestAnswers }) });
    await runProjectJob(ranker, { context: jobContext(app), input: { ...SCOPE_INPUT, projectUuid } });
    const ratingKey = taskRatingKey("Launch dashboard", { taskText: "Cited old task", taskUuid: "cited-task" });
    expect((await readProject(app)).taskSimilarityScores[ratingKey]).toBe(1);
    expect(requestAnswers).toHaveBeenCalledTimes(1);
  });
});
