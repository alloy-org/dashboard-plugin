// Exercise the "Generate ideas" run coordinator against a fake durable runner: steps that end when their jobs and
// follow-ups settle, a step that ends when its budget runs out, an estimate that only shrinks, and the summary.
import IdeaGenerationRun, { ideaGenerationRunSummary, ideaGenerationRunTitle, ideaRunStoreCounts,
  STEP_BUDGET_SECONDS } from "dashboard/idea-generation/idea-generation-run";
import { ideaComparisonKey } from "dashboard/project-tasks/project-idea-records";
import { GENERATE_PROJECT_IDEAS_JOB_TYPE, RANK_PROJECT_TASKS_JOB_TYPE, RATE_PROJECT_IDEAS_JOB_TYPE,
  REFINE_DICTIONARY_TERM_JOB_TYPE } from "dashboard/work-queue/jobs/project-job-requests";

const SCOPE = "domain-1:Q4 2026";

// ----------------------------------------------------------------------------------------------
// @desc A durable runner that saves every request as pending and lets the test publish outcomes.
// @returns {object} { durable, publish, submitted }.
function fakeDurable() {
  const listeners = new Set();
  const submitted = [];
  const durable = {
    submitAll: async requests => {
      submitted.push(...requests);
      return requests.map(request => ({ key: request.key, status: "pending", type: request.type }));
    },
    subscribeOutcomes: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const publish = outcome => {
    for (const listener of listeners) listener({ entityId: null, followUps: [], outcomeDetail: null, scopeKey: SCOPE, status: "completed", ...outcome });
  };
  return { durable, publish, submitted };
}

// ----------------------------------------------------------------------------------------------
// @desc A run over two projects, one targeted for ideas, with a manual clock and timer.
// @param {object} durable - From fakeDurable.
// @returns {object} { clockState, run, tick }: tick advances the clock and fires the pending timer.
function runOver(durable) {
  const clockState = { now: 0 };
  let pendingTimer = null;
  const activeProjects = [{ summary: "Launch", uuid: "launch" }, { summary: "Hiring", uuid: "hiring" }];
  const plan = { activeProjects, requests: {
    ideas: [{ entityId: "launch", key: "generateProjectIdeas:launch", type: GENERATE_PROJECT_IDEAS_JOB_TYPE }],
    rate: [],
    refine: [{ key: "discoverDictionaryTerms:2026-Q4", type: "discoverDictionaryTerms" }, { key: "collectTermEvidence:2026:roadmap",
      type: "collectTermEvidence" }],
  }, storedProjects: [{ relatedTaskRecords: [], suggestedTasks: [], uuid: "launch" }], targets: [activeProjects[0]] };
  const projectReader = async () => [{ relatedTaskRecords: [{ taskUuid: "t1" }], suggestedTasks: [], uuid: "launch" }];
  const run = new IdeaGenerationRun({ allowance: { maximum: 2, runNumber: 1 }, clearTimer: () => { pendingTimer = null; },
    clock: () => clockState.now, durable, plan, projectReader, runId: "run-1", scopeKey: SCOPE,
    setTimer: callback => { pendingTimer = callback; return 1; } });
  const tick = async seconds => {
    clockState.now += seconds * 1000;
    const callback = pendingTimer;
    pendingTimer = null;
    callback?.();
    await new Promise(resolve => setTimeout(resolve, 0));
  };
  return { clockState, run, tick };
}

// ----------------------------------------------------------------------------------------------
// @desc Let pending promise callbacks finish.
// @returns {Promise<void>}
function settle() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe("IdeaGenerationRun", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc The refine step waits for the rankings discovery releases and the refinement evidence asks for; the ideas
  //   step's rating follow-up is waited for in the rate step, which ends at once when it already settled; then the
  //   summary is written.
  it("moves through the steps as jobs and their follow-ups settle", async () => {
    const { durable, publish, submitted } = fakeDurable();
    const { run } = runOver(durable);
    await run.start();
    expect(run.snapshot()).toMatchObject({ etaSeconds: 300, title: "Generating ideas for 1 Project" });
    expect(run.snapshot().steps.map(step => step.state)).toEqual(["active", "waiting", "waiting", "waiting"]);

    publish({ followUps: [{ jobKey: "rankProjectTasks:launch", jobType: RANK_PROJECT_TASKS_JOB_TYPE, status: "pending" }],
      jobKey: "discoverDictionaryTerms:2026-Q4", jobType: "discoverDictionaryTerms" });
    publish({ followUps: [{ jobKey: "refineDictionaryTerm:2026:roadmap", jobType: REFINE_DICTIONARY_TERM_JOB_TYPE, status: "pending" }],
      jobKey: "collectTermEvidence:2026:roadmap", jobType: "collectTermEvidence" });
    publish({ entityId: "unrelated", jobKey: "rankProjectTasks:unrelated", jobType: RANK_PROJECT_TASKS_JOB_TYPE, status: "failed" });
    publish({ jobKey: "rankProjectTasks:launch", jobType: RANK_PROJECT_TASKS_JOB_TYPE });
    await settle();
    expect(run.snapshot().steps[0].state).toBe("active");
    publish({ entityId: "roadmap", jobKey: "refineDictionaryTerm:2026:roadmap", jobType: REFINE_DICTIONARY_TERM_JOB_TYPE });
    await settle();
    expect(run.snapshot().steps.map(step => step.state)).toEqual(["done", "active", "waiting", "waiting"]);
    expect(submitted.map(request => request.key)).toContain("generateProjectIdeas:launch");

    publish({ entityId: "launch", followUps: [{ jobKey: "rateProjectIdeas:launch", jobType: RATE_PROJECT_IDEAS_JOB_TYPE, status: "pending" }],
      jobKey: "generateProjectIdeas:launch", jobType: GENERATE_PROJECT_IDEAS_JOB_TYPE, outcomeDetail: "Generated 5 ideas, kept 4" });
    await settle();
    expect(run.snapshot().steps.map(step => step.state)).toEqual(["done", "done", "active", "waiting"]);
    publish({ entityId: "launch", jobKey: "rateProjectIdeas:launch", jobType: RATE_PROJECT_IDEAS_JOB_TYPE });
    await settle();
    await settle();

    const snapshot = run.snapshot();
    expect(snapshot.finished).toBe(true);
    expect(snapshot.steps.map(step => step.state)).toEqual(["done", "done", "done", "done"]);
    expect(snapshot.summary.refinedTermCount).toBe(1);
    expect(snapshot.summary.failures).toEqual([]);
    expect(snapshot.summary.projects[0]).toMatchObject({ ideasDetail: "Generated 5 ideas, kept 4", name: "Launch", suggestableTasksAfter: 1,
      suggestableTasksBefore: 0, targeted: true });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The snapshot's progress names the terms discovery found and the terms being refined with how many were
  //   rewritten, the projects ideas are generated for, and, recounted from the store after each ideas or rating
  //   outcome, how many new ideas met the bar and how many suggestions are eligible.
  it("reports what it has found as it runs", async () => {
    const { durable, publish } = fakeDurable();
    const storeState = { projects: [] };
    const activeProjects = [{ summary: "Launch", uuid: "launch" }];
    const plan = { activeProjects, requests: { ideas: [{ key: "generateProjectIdeas:launch", type: GENERATE_PROJECT_IDEAS_JOB_TYPE }], rate: [],
      refine: [{ key: "discoverDictionaryTerms:2026-Q4", type: "discoverDictionaryTerms" },
        { input: { term: "Roadmap" }, key: "collectTermEvidence:2026:roadmap", type: "collectTermEvidence" },
        { input: { term: "Jots" }, key: "collectTermEvidence:2026:jots", type: "collectTermEvidence" }] },
    storedProjects: [], targets: activeProjects };
    const run = new IdeaGenerationRun({ clock: () => 1000, durable, plan, projectReader: async () => storeState.projects, runId: "run-1",
      scopeKey: SCOPE, setTimer: () => 1 });
    await run.start();
    expect(run.snapshot().progress).toMatchObject({ foundTerms: null, ideaProjects: { count: 1, examples: ["Launch"] },
      refiningTerms: { count: 2, examples: ["Roadmap", "Jots"], refinedCount: 0 } });

    publish({ jobKey: "discoverDictionaryTerms:2026-Q4", jobType: "discoverDictionaryTerms",
      outcomeFacts: { addedTerms: ["Ample Agent Pro", "GTD"], refinedTerms: [] } });
    publish({ followUps: [{ jobKey: "refineDictionaryTerm:2026:roadmap", jobType: REFINE_DICTIONARY_TERM_JOB_TYPE, status: "pending" }],
      jobKey: "collectTermEvidence:2026:roadmap", jobType: "collectTermEvidence" });
    publish({ jobKey: "collectTermEvidence:2026:jots", jobType: "collectTermEvidence" });
    publish({ jobKey: "refineDictionaryTerm:2026:roadmap", jobType: REFINE_DICTIONARY_TERM_JOB_TYPE,
      outcomeFacts: { outcome: "refined", term: "Roadmap" } });
    await settle();
    expect(run.snapshot().progress).toMatchObject({ foundTerms: { count: 2, examples: ["Ample Agent Pro", "GTD"] },
      refiningTerms: { refinedCount: 1 } });

    const rated = (taskText, actionability, relevance) => ({ generatedAt: "2026-10-15T19:30:00.000Z", status: "open", taskText,
      rating: { actionability, ratedTextKey: ideaComparisonKey(taskText), relevance } });
    storeState.projects = [{ completedTasks: [], relatedTaskRecords: [{ taskUuid: "t1" }, { matchScore: 2, taskUuid: "t2" }],
      suggestedTasks: [rated("Call the lender", 8, 9), rated("Think about lakes", 3, 8), { generatedAt: "2026-10-15T19:30:00.000Z",
        status: "open", taskText: "Book a viewing" }], uuid: "launch" }];
    publish({ followUps: [{ jobKey: "rateProjectIdeas:launch", jobType: RATE_PROJECT_IDEAS_JOB_TYPE, status: "pending" }],
      jobKey: "generateProjectIdeas:launch", jobType: GENERATE_PROJECT_IDEAS_JOB_TYPE });
    await settle();
    await settle();
    expect(run.snapshot().progress.storeCounts).toEqual({ eligibleIdeaCount: 1, eligibleTaskCount: 1, newEligibleIdeaCount: 1, newIdeaCount: 3,
      newRatedIdeaCount: 2 });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Ideas generated before the run began are not new, and projects outside the run are not counted.
  it("counts only the run's new ideas and its active projects", () => {
    const projects = [{ suggestedTasks: [{ generatedAt: "2026-10-01T00:00:00.000Z", taskText: "Old" },
      { generatedAt: "2026-10-15T00:00:00.000Z", taskText: "New" }], uuid: "launch" },
    { relatedTaskRecords: [{ taskUuid: "t9" }], suggestedTasks: [{ generatedAt: "2026-10-15T00:00:00.000Z", taskText: "Other" }], uuid: "other" }];
    const counts = ideaRunStoreCounts(projects, { activeProjects: [{ uuid: "launch" }], since: "2026-10-10T00:00:00.000Z" });
    expect(counts).toEqual({ eligibleIdeaCount: 0, eligibleTaskCount: 0, newEligibleIdeaCount: 0, newIdeaCount: 1, newRatedIdeaCount: 0 });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A step whose jobs never settle ends when its budget runs out, and the estimate falls with the clock but
  //   never rises, even when the next step starts with its whole budget.
  it("ends a step at its budget and only lowers the estimate", async () => {
    const { durable } = fakeDurable();
    const { run, tick } = runOver(durable);
    await run.start();
    const estimates = [];
    for (let second = 0; second < STEP_BUDGET_SECONDS.refine + 3; second += 1) {
      await tick(1);
      estimates.push(run.snapshot().etaSeconds);
    }
    expect(run.snapshot().steps.map(step => step.state)).toEqual(["timedOut", "active", "waiting", "waiting"]);
    const rises = estimates.filter((estimate, index) => index > 0 && estimate > estimates[index - 1]);
    expect(rises).toEqual([]);
    expect(estimates.at(-1)).toBeLessThan(300 - STEP_BUDGET_SECONDS.refine);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The title counts projects ideas are generated for, or the projects refreshed when all are saturated; a
  //   failure names its project.
  it("titles the run and names failures in the summary", () => {
    const launch = { summary: "Launch", uuid: "launch" };
    expect(ideaGenerationRunTitle({ activeProjects: [launch, launch], targets: [] }).title).toBe("Refreshing 2 Projects");
    const summary = ideaGenerationRunSummary({ activeProjects: [launch], afterProjects: null, beforeProjects: [],
      failures: [{ detail: "Provider down", entityId: "launch", jobType: GENERATE_PROJECT_IDEAS_JOB_TYPE }], outcomes: [], targets: [] });
    expect(summary.failures[0]).toMatchObject({ detail: "Provider down", subject: "Launch" });
    expect(summary.projects[0]).toMatchObject({ recommendableAfter: null, suggestableTasksAfter: null, targeted: false });
  });
});
