// Drive one "Generate ideas" run through its four steps and describe its progress for the progress window. Each step
// submits its requests to the durable work runner and waits for the jobs it started, and the follow-ups those jobs
// ask for, to settle: refining waits for term refinements and for the rankings discovery releases, and rating waits
// for the ratings the ideas step asked for. A step also ends when its time budget runs out, leaving its jobs to finish
// in the background, so a slow provider never stalls the run. A failure is recorded for the summary and never blocks
// the next step. The estimated time left starts at the sum of the step budgets and only ever shrinks. Host-compatible:
// no React or DOM, so the dashboard runs it and the host relays its snapshots.
import { ideaRecommendable } from "dashboard/project-task-idea-ratings";
import { RUN_STEP_KEYS } from "dashboard/idea-generation-run-plan";
import { GENERATE_PROJECT_IDEAS_JOB_TYPE, RANK_PROJECT_TASKS_JOB_TYPE, RATE_PROJECT_IDEAS_JOB_TYPE,
  REFINE_DICTIONARY_TERM_JOB_TYPE } from "dashboard/work-queue/jobs/project-job-requests";
import { cancelWorkTimer, startWorkTimer } from "dashboard/work-queue/work-timers";
import { logIfEnabled } from "util/log";

// How long each step may take before the run moves on, in seconds. They sum to the five minutes first estimated.
export const STEP_BUDGET_SECONDS = Object.freeze({ ideas: 120, rate: 75, refine: 75, summarize: 30 });
// What the progress window calls each step.
export const STEP_LABELS = Object.freeze({ ideas: "Generate ideas", rate: "Rate ideas", refine: "Refine definitions",
  summarize: "Summarize results" });
// How often the run re-checks its budget and estimate.
export const RUN_TICK_MILLISECONDS = 1000;
// Job statuses that mean a saved job will run, so a step waits for its outcome.
const AWAITED_STATUSES = ["pending", "running"];
// Outcome statuses that count as a failure in the summary.
const FAILED_STATUSES = ["blockedConfiguration", "failed", "retryWaiting"];
// The step each follow-up job type is waited for in.
const FOLLOW_UP_STEPS = Object.freeze({ [RANK_PROJECT_TASKS_JOB_TYPE]: "refine", [RATE_PROJECT_IDEAS_JOB_TYPE]: "rate",
  [REFINE_DICTIONARY_TERM_JOB_TYPE]: "refine" });
const RUN_LOG_LABEL = "[idea-generation-run]";

// ----------------------------------------------------------------------------------------------
// @desc One run of the steps above, from start until its summary is written.
export default class IdeaGenerationRun {
  allowance; // {object|null} { maximum, runNumber }: which of the day's runs this is.
  awaitedKeysByStep = new Map(); // {Map<string, Set<string>>} Job keys each step waits for, by step key.
  clearTimer; // {function} Cancels a timer from setTimer.
  clock; // {function} Returns epoch milliseconds; injected for tests.
  durable; // {DurableWorkRunner} Saves and runs the run's jobs.
  estimateShown; // {number} The estimate last shown, in seconds; the estimate never rises above it.
  failures = []; // {Array<object>} { detail, entityId, jobType } for each failed outcome.
  finishedAt = null; // {number|null} Epoch milliseconds once the summary is written.
  listeners = new Set(); // {Set<function>} Told of each change to the snapshot.
  outcomeDetailsByKey = new Map(); // {Map<string, object>} { detail, entityId, jobType, status } of each job's last outcome.
  plan; // {object} { activeProjects, requests, storedProjects, targets }, from planIdeaGenerationRun.
  projectReader; // {function} () => Promise<Array<QuarterProject>>: the store's projects, read for the summary.
  quotaUsedFraction = null; // {number|null} The share of the Agent Pro quota consumed, when known.
  runId; // {string} Identifies the run.
  scopeKey; // {string} The work scope the run's jobs are saved in.
  setTimer; // {function} (callback, milliseconds) => timer.
  settledKeys = new Set(); // {Set<string>} Job keys whose outcome arrived since they were last awaited.
  startedAt = null; // {number|null} Epoch milliseconds when the run started.
  stepIndex = -1; // {number} Index into RUN_STEP_KEYS of the step under way; RUN_STEP_KEYS.length once finished.
  stepStartedAt = null; // {number|null} Epoch milliseconds when the step under way began.
  stepStates = Object.fromEntries(RUN_STEP_KEYS.map(stepKey => [stepKey, "waiting"])); // {object} By step key: waiting, active, done, or timedOut.
  summary = null; // {object|null} From ideaGenerationRunSummary, once written.
  timer = null; // {*} The tick timer.
  unsubscribeOutcomes = null; // {function|null} Stops listening to the runner.

  // ----------------------------------------------------------------------------------------------
  // @desc Construct a run. Nothing is submitted until start.
  // @param {object} options - An object with the following properties:
  //   - {object|null} [allowance=null] - { maximum, runNumber }
  //   - {function} [clearTimer=cancelWorkTimer] - Cancels a timer
  //   - {function} [clock=Date.now] - Returns epoch milliseconds
  //   - {DurableWorkRunner} durable - The Dashboard's durable work runner
  //   - {object} plan - From planIdeaGenerationRun
  //   - {function} projectReader - () => Promise of the store's projects
  //   - {string} runId - Identifies the run
  //   - {string} scopeKey - The work scope to save the jobs in
  //   - {function} [setTimer=startWorkTimer] - (callback, milliseconds) => timer
  constructor({ allowance = null, clearTimer = cancelWorkTimer, clock = Date.now, durable, plan, projectReader, runId, scopeKey,
      setTimer = startWorkTimer }) {
    Object.assign(this, { allowance, clearTimer, clock, durable, plan, projectReader, runId, scopeKey, setTimer });
    this.estimateShown = _budgetSeconds(RUN_STEP_KEYS);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Whether the run has written its summary.
  // @returns {boolean} True once finished.
  get finished() {
    return this.finishedAt !== null;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Stop listening and ticking. Jobs already submitted keep running in the queue.
  dispose() {
    this.unsubscribeOutcomes?.();
    this.unsubscribeOutcomes = null;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Record the share of the Agent Pro quota consumed, for the status line.
  // @param {number|null} usedFraction - From 0 to 1, or null when unknown.
  setQuotaUsedFraction(usedFraction) {
    this.quotaUsedFraction = Number.isFinite(usedFraction) ? Math.min(1, Math.max(0, usedFraction)) : null;
    this._notify();
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Describe the run for the progress window, as plain JSON.
  // @returns {object} An object with the following properties:
  //   - {object|null} allowance - { maximum, runNumber }
  //   - {number|null} etaSeconds - Estimated seconds left; null once finished, 0 while finishing up past the estimate
  //   - {boolean} finished - True once the summary is written
  //   - {number} projectCount - How many projects the title counts
  //   - {number|null} quotaUsedFraction - The share of the Agent Pro quota consumed, when known
  //   - {string} runId - Identifies the run
  //   - {number|null} startedAt - Epoch milliseconds
  //   - {Array<object>} steps - { key, label, state } in order; state is waiting, active, done, or timedOut
  //   - {object|null} summary - From ideaGenerationRunSummary
  //   - {string} title - Such as "Generating ideas for 3 Projects"
  snapshot() {
    const steps = RUN_STEP_KEYS.map(stepKey => ({ key: stepKey, label: STEP_LABELS[stepKey], state: this.stepStates[stepKey] }));
    const etaSeconds = this.finished ? null : this.estimateShown;
    const { projectCount, title } = ideaGenerationRunTitle(this.plan);
    return { allowance: this.allowance, etaSeconds, finished: this.finished, projectCount, quotaUsedFraction: this.quotaUsedFraction,
      runId: this.runId, startedAt: this.startedAt, steps, summary: this.summary, title };
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Start the run: listen for outcomes, submit the first step, and begin ticking.
  // @returns {Promise<void>} Settles once the first step's requests are saved.
  async start() {
    if (this.startedAt !== null) return;
    this.startedAt = this.clock();
    this.unsubscribeOutcomes = this.durable.subscribeOutcomes(outcome => this._observeOutcome(outcome));
    this._scheduleTick();
    await this._beginStep(0);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Listen for snapshot changes.
  // @param {function} listener - Receives the snapshot.
  // @returns {function} Stops listening.
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Wait for the given jobs in a step, when their saved status means they will run.
  // @param {string} stepKey - One of RUN_STEP_KEYS.
  // @param {Array<object>} jobs - { key, status } of saved jobs.
  _await(stepKey, jobs) {
    const awaitedKeys = this.awaitedKeysByStep.get(stepKey) || new Set();
    for (const job of jobs) {
      if (!AWAITED_STATUSES.includes(job.status)) continue;
      awaitedKeys.add(job.key);
      this.settledKeys.delete(job.key);
    }
    this.awaitedKeysByStep.set(stepKey, awaitedKeys);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Begin a step: submit its requests, or write the summary for the last step, then finish it at once when
  //   nothing it submitted needs to run.
  // @param {number} stepIndex - Index into RUN_STEP_KEYS.
  // @returns {Promise<void>}
  async _beginStep(stepIndex) {
    if (stepIndex >= RUN_STEP_KEYS.length) return this._finish();
    const stepKey = RUN_STEP_KEYS[stepIndex];
    Object.assign(this, { stepIndex, stepStartedAt: this.clock() });
    this.stepStates[stepKey] = "active";
    this._notify();
    if (stepKey === "summarize") return this._summarize();
    const requests = this.plan.requests[stepKey] || [];
    if (requests.length) {
      const jobs = await this.durable.submitAll(requests, { scopeKey: this.scopeKey }).catch(error => {
        logIfEnabled(`${ RUN_LOG_LABEL } could not submit the ${ stepKey } step`, error?.message);
        this.failures.push({ detail: error?.message || "Could not queue the step's work", entityId: null, jobType: stepKey });
        return [];
      });
      this._await(stepKey, jobs);
    }
    return this._finishStepIfSettled();
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Mark the step under way done or timed out, and begin the next one.
  // @param {string} state - "done" or "timedOut".
  // @returns {Promise<void>}
  async _endStep(state) {
    const stepKey = RUN_STEP_KEYS[this.stepIndex];
    if (!stepKey || this.stepStates[stepKey] !== "active") return;
    this.stepStates[stepKey] = state;
    await this._beginStep(this.stepIndex + 1);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Finish the run: stop ticking and listening, and tell listeners.
  _finish() {
    this.stepIndex = RUN_STEP_KEYS.length;
    this.finishedAt = this.clock();
    this.dispose();
    this._notify();
  }

  // ----------------------------------------------------------------------------------------------
  // @desc End the step under way when every job it waits for has settled.
  // @returns {Promise<void>}
  async _finishStepIfSettled() {
    const stepKey = RUN_STEP_KEYS[this.stepIndex];
    if (!stepKey || stepKey === "summarize" || this.stepStates[stepKey] !== "active") return;
    const awaitedKeys = [...(this.awaitedKeysByStep.get(stepKey) || [])];
    if (awaitedKeys.every(key => this.settledKeys.has(key))) await this._endStep("done");
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Tell listeners of the current snapshot.
  _notify() {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        logIfEnabled(`${ RUN_LOG_LABEL } a snapshot listener failed`, error?.message);
      }
    }
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Record the outcome of a job the run waits for: settle it, wait for the follow-ups it asked for in the step
  //   they belong to, keep its detail for the summary, and end the step under way if nothing else is awaited.
  //   Outcomes of the queue's other work are ignored.
  // @param {object} outcome - As DurableWorkRunner#subscribeOutcomes reports it.
  _observeOutcome(outcome) {
    if (outcome.scopeKey !== this.scopeKey || this.finished) return;
    const { entityId, followUps = [], jobKey, jobType, outcomeDetail, status } = outcome;
    const awaitedByAnyStep = [...this.awaitedKeysByStep.values()].some(keys => keys.has(jobKey));
    if (!awaitedByAnyStep) return;
    this.settledKeys.add(jobKey);
    this.outcomeDetailsByKey.set(jobKey, { detail: outcomeDetail ?? null, entityId: entityId ?? null, jobType, status });
    if (FAILED_STATUSES.includes(status)) this.failures.push({ detail: outcomeDetail || status, entityId: entityId ?? null, jobType });
    for (const followUp of followUps) {
      const followUpStep = FOLLOW_UP_STEPS[followUp.jobType];
      const stepNotEnded = followUpStep && ["waiting", "active"].includes(this.stepStates[followUpStep]);
      if (stepNotEnded) this._await(followUpStep, [{ key: followUp.jobKey, status: followUp.status }]);
    }
    this._notify();
    this._finishStepIfSettled().catch(error => logIfEnabled(`${ RUN_LOG_LABEL } could not advance`, error?.message));
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Tick every RUN_TICK_MILLISECONDS until the run finishes.
  _scheduleTick() {
    this.timer = this.setTimer(() => {
      this.timer = null;
      if (this.finished) return;
      this._tick().catch(error => logIfEnabled(`${ RUN_LOG_LABEL } tick failed`, error?.message));
      if (!this.finished) this._scheduleTick();
    }, RUN_TICK_MILLISECONDS);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Write the summary from the store's projects as they are now, then finish the run.
  // @returns {Promise<void>}
  async _summarize() {
    const afterProjects = await Promise.resolve().then(() => this.projectReader()).catch(error => {
      logIfEnabled(`${ RUN_LOG_LABEL } could not read projects for the summary`, error?.message);
      return null;
    });
    this.summary = ideaGenerationRunSummary({ activeProjects: this.plan.activeProjects, afterProjects,
      beforeProjects: this.plan.storedProjects, failures: this.failures, outcomes: [...this.outcomeDetailsByKey.values()],
      targets: this.plan.targets });
    this.stepStates.summarize = "done";
    this._finish();
  }

  // ----------------------------------------------------------------------------------------------
  // @desc End the step under way when its budget has run out, and lower the estimate shown.
  // @returns {Promise<void>}
  async _tick() {
    const stepKey = RUN_STEP_KEYS[this.stepIndex];
    if (stepKey && stepKey !== "summarize" && this._stepElapsedSeconds() >= STEP_BUDGET_SECONDS[stepKey]) await this._endStep("timedOut");
    const remainingStepKeys = RUN_STEP_KEYS.slice(this.stepIndex + 1);
    const currentStepKey = RUN_STEP_KEYS[this.stepIndex];
    const currentRemaining = currentStepKey ? Math.max(0, STEP_BUDGET_SECONDS[currentStepKey] - this._stepElapsedSeconds()) : 0;
    const estimate = Math.ceil(currentRemaining + _budgetSeconds(remainingStepKeys));
    this.estimateShown = Math.min(this.estimateShown, estimate);
    this._notify();
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Seconds since the step under way began.
  // @returns {number} Seconds, 0 before the first step.
  _stepElapsedSeconds() {
    return this.stepStartedAt === null ? 0 : (this.clock() - this.stepStartedAt) / 1000;
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Summarize a finished run: what the ideas step did for each project, how many of each active project's ideas
//   are now recommendable and how many tasks it is associated with, compared to before the run, how many dictionary
//   terms were refined, and what failed.
// @param {object} options - An object with the following properties:
//   - {Array<QuarterProject>} activeProjects - The run's active projects
//   - {Array<QuarterProject>|null} afterProjects - The store's projects after the run; null when they could not be read
//   - {Array<QuarterProject>} beforeProjects - The store's projects before the run
//   - {Array<object>} failures - { detail, entityId, jobType }
//   - {Array<object>} outcomes - { detail, entityId, jobType, status } of each job's last outcome
//   - {Array<QuarterProject>} targets - The projects ideas were generated for
// @returns {object} { failures, projects, refinedTermCount }: projects lists { ideasDetail, name, recommendableAfter,
//   recommendableBefore, relatedTasksAfter, relatedTasksBefore, targeted, uuid } in active project order, the after
//   counts null when the store could not be read; failures name the project or term each was about where known.
export function ideaGenerationRunSummary({ activeProjects, afterProjects, beforeProjects, failures, outcomes, targets }) {
  const beforeByUuid = new Map(beforeProjects.map(project => [project.uuid, project]));
  const afterByUuid = afterProjects ? new Map(afterProjects.map(project => [project.uuid, project])) : null;
  const targetUuids = new Set(targets.map(project => project.uuid));
  const ideasOutcomes = outcomes.filter(outcome => outcome.jobType === GENERATE_PROJECT_IDEAS_JOB_TYPE);
  const ideasDetailByUuid = new Map(ideasOutcomes.map(outcome => [outcome.entityId, outcome.detail]));
  const projects = activeProjects.map(project => {
    const before = beforeByUuid.get(project.uuid);
    const after = afterByUuid ? afterByUuid.get(project.uuid) || null : null;
    return { ideasDetail: ideasDetailByUuid.get(project.uuid) || null, name: project.summary,
      recommendableAfter: afterByUuid ? _recommendableCount(after) : null, recommendableBefore: _recommendableCount(before),
      relatedTasksAfter: afterByUuid ? after?.relatedTaskRecords?.length || 0 : null, relatedTasksBefore: before?.relatedTaskRecords?.length || 0,
      targeted: targetUuids.has(project.uuid), uuid: project.uuid };
  });
  const refinedOutcomes = outcomes.filter(outcome => outcome.jobType === REFINE_DICTIONARY_TERM_JOB_TYPE && outcome.status === "completed");
  const namesByUuid = new Map(activeProjects.map(project => [project.uuid, project.summary]));
  const namedFailures = failures.map(failure => ({ ...failure, subject: namesByUuid.get(failure.entityId) || failure.entityId || null }));
  return { failures: namedFailures, projects, refinedTermCount: refinedOutcomes.length };
}

// ----------------------------------------------------------------------------------------------
// @desc The progress window's title for a run: the projects ideas are generated for, or, when every active project is
//   already saturated, the active projects the run refreshes.
// @param {object} plan - { activeProjects, targets }.
// @returns {object} { projectCount, title }: title such as "Generating ideas for 3 Projects".
export function ideaGenerationRunTitle({ activeProjects, targets }) {
  const generating = targets.length > 0;
  const projectCount = generating ? targets.length : activeProjects.length;
  const projectNoun = projectCount === 1 ? "Project" : "Projects";
  const title = generating ? `Generating ideas for ${ projectCount } ${ projectNoun }` : `Refreshing ${ projectCount } ${ projectNoun }`;
  return { projectCount, title };
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc The summed budgets of some steps.
// @param {Array<string>} stepKeys - Step keys.
// @returns {number} Seconds.
function _budgetSeconds(stepKeys) {
  return stepKeys.reduce((total, stepKey) => total + STEP_BUDGET_SECONDS[stepKey], 0);
}

// ----------------------------------------------------------------------------------------------
// @desc How many of a project's ideas may compete in the daily recommendations.
// @param {QuarterProject|null|undefined} project - The project as the store holds it.
// @returns {number} The count; 0 without a project.
function _recommendableCount(project) {
  const recommendableIdeas = (project?.suggestedTasks || []).filter(idea => ideaRecommendable(idea));
  return recommendableIdeas.length;
}
