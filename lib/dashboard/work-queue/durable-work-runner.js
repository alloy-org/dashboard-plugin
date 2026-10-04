// Run durable jobs on the Dashboard's scheduler. A request is saved to its scope's queue note before it is enqueued,
// and each attempt claims the saved job, runs its registered handler, writes the output, and only then acknowledges
// the job. If the session stops between writing and acknowledging, the claim lapses, and the next session asks the
// handler which revision its output already reflects and completes the job without running it again. An attempt
// whose claim was taken over, or that the scheduler cancelled, never writes its output. Failures are retried with
// backoff, wait for a settings change, or stay failed, and every outcome is offered to the history store.
import { sanitizedValue } from "dashboard/work-queue/dashboard-work-diagnostics";
import { retryDelayMilliseconds, workFailureClassification } from "dashboard/work-queue/dashboard-work-policy";
import { cancelWorkTimer, startWorkTimer } from "dashboard/work-queue/work-timers";
import { logIfEnabled } from "util/log";

// ----------------------------------------------------------------------------------------------
// @desc Connects the durable queue repository, the handler registry, and the in-memory scheduler.
export default class DurableWorkRunner {
  attemptSequence = 0; // {number} Makes each attempt token from this session unique.
  claimsByKey = new Map(); // {Map<string, object>} { scopeKey, token } for each job this session has claimed.
  clearTimer; // {function} Cancels a timer from setTimer.
  clock; // {function} Returns epoch milliseconds; injected for tests.
  diagnosticsStore; // {DashboardWorkDiagnosticsStore|null} Receives each outcome for durable history.
  disposed = false; // {boolean} True once disposed; nothing further is enqueued.
  handlers; // {Map<string, object>} From workHandlerRegistry.
  outcomeListeners = new Set(); // {Set<function>} Told of each attempt's outcome; see subscribeOutcomes.
  ownerId; // {string} Identifies this session in the jobs it claims.
  random; // {function} Returns a number in [0, 1); jitters retry delays.
  repository; // {DashboardWorkRepository} Durable job records.
  retryTimersByKey = new Map(); // {Map<string, *>} Timers that enqueue jobs once their retry delay passes.
  scheduler; // {DashboardWorkScheduler} Admits attempts.
  setTimer; // {function} (callback, milliseconds) => timer.

  // ----------------------------------------------------------------------------------------------
  // @desc Construct a runner.
  // @param {object} options - { clearTimer = cancelWorkTimer, clock = Date.now, diagnosticsStore = null, handlers, ownerId,
  //   random = Math.random, repository, scheduler, setTimer = startWorkTimer }.
  constructor({ clearTimer = cancelWorkTimer, clock = Date.now, diagnosticsStore = null, handlers, ownerId, random = Math.random,
      repository, scheduler, setTimer = startWorkTimer }) {
    Object.assign(this, { clearTimer, clock, diagnosticsStore, handlers, ownerId, random, repository, scheduler, setTimer });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Let a scope's jobs that wait for configuration try again, after a setting such as a provider key changes.
  // @param {string|null} [scopeKey] - The scope; defaults to the scheduler's.
  // @returns {Promise<number>} How many jobs were enqueued.
  async configurationChanged(scopeKey = this.scheduler.scopeKey) {
    await this.repository.resumeAfterConfiguration(scopeKey);
    return this.recover(scopeKey);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Stop enqueueing and let go of every claim this session holds, so another session can resume the jobs at
  //   once instead of waiting for their claims to lapse.
  // @returns {Promise<void>} Settles once every release has been attempted.
  async dispose() {
    this.disposed = true;
    for (const timer of this.retryTimersByKey.values()) this.clearTimer(timer);
    this.retryTimersByKey.clear();
    const claims = [...this.claimsByKey.entries()];
    this.claimsByKey.clear();
    await Promise.all(claims.map(([key, claim]) => this.repository.release(claim.scopeKey, key, claim.token).catch(() => null)));
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Resume a scope's saved work: jobs whose sessions stopped are returned to pending, every eligible job with a
  //   registered handler is enqueued, and jobs waiting to retry are enqueued when their delay passes. Jobs of types
  //   this version has no handler for are left in the note untouched.
  // @param {string|null} [scopeKey] - The scope; defaults to the scheduler's.
  // @returns {Promise<number>} How many jobs were enqueued now.
  async recover(scopeKey = this.scheduler.scopeKey) {
    if (this.disposed) return 0;
    await this.repository.recoverExpired(scopeKey);
    const { jobs } = await this.repository.readAll(scopeKey);
    const now = this.clock();
    let enqueued = 0;
    for (const job of jobs) {
      if (!this.handlers.has(job.type)) continue;
      if (job.isEligible(now)) {
        this._enqueue(job);
        enqueued += 1;
      } else if (job.status === "retryWaiting") this._scheduleRetry(job);
    }
    return enqueued;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Which jobs this session holds claims on or will retry, for an operator.
  // @returns {object} { claimedKeys, retryKeys }.
  snapshot() {
    return { claimedKeys: [...this.claimsByKey.keys()], retryKeys: [...this.retryTimersByKey.keys()] };
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Save a request for durable work and enqueue it when it needs to run. A request for a key already saved
  //   coalesces into that job, replacing its desired revision and input.
  // @param {object} request - An object with the following properties:
  //   - {string} key - Stable identity, such as "rankProjectTasks:<projectUuid>"
  //   - {string} type - A registered handler's type
  //   - {string} [category] - Priority category; defaults to the handler's
  //   - {string|number|null} [desiredRevision=null] - The input revision the output should reflect
  //   - {string|null} [entityId=null] - The project or term the job is about
  //   - {*} [input=null] - Small plain JSON for the handler
  //   - {string|null} [scopeKey] - Defaults to the scheduler's scope
  // @returns {Promise<DashboardWorkJob>} The saved job.
  async submit(request) {
    const [job] = await this.submitAll([request], { scopeKey: request.scopeKey });
    return job;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Save several requests for durable work of one scope in a single write of its queue note, then enqueue each
  //   one that needs to run, in the order given.
  // @param {Array<object>} requests - Requests as submit takes them; each request's own scopeKey is ignored.
  // @param {object} [options] - { scopeKey }: the scope of every request; defaults to the scheduler's.
  // @returns {Promise<Array<DashboardWorkJob>>} The saved jobs, in order.
  // @throws When a request names no registered handler or its input is unusable; nothing is saved then.
  async submitAll(requests, { scopeKey } = {}) {
    const jobScopeKey = scopeKey === undefined ? this.scheduler.scopeKey : scopeKey;
    const savedRequests = requests.map(({ category, desiredRevision = null, entityId = null, input = null, key, type }) => {
      const handler = this.handlers.get(type);
      if (!handler) throw new Error(`No work handler is registered for "${ type }"`);
      handler.validateInput?.(input);
      return { category: category || handler.category, desiredRevision, entityId, input, key, type };
    });
    if (!savedRequests.length) return [];
    const saved = await this.repository.saveJobs(jobScopeKey, savedRequests);
    for (const { job, runnable } of saved) {
      if (!runnable || this.disposed) continue;
      if (job.status === "retryWaiting" && !job.isEligible(this.clock())) this._scheduleRetry(job);
      else this._enqueue(job);
    }
    return saved.map(({ job }) => job);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Listen for the outcome of each durable attempt this session finishes: completed, failed, waiting to retry or
  //   for configuration, or superseded.
  // @param {function} listener - Receives { entityId, jobKey, jobType, scopeKey, status }.
  // @returns {function} Stops listening.
  subscribeOutcomes(listener) {
    this.outcomeListeners.add(listener);
    return () => this.outcomeListeners.delete(listener);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Claim a job for an attempt, or renew the claim this session kept while the job was yielded.
  // @param {string|null} scopeKey - The job's scope.
  // @param {string} key - Job key.
  // @returns {Promise<object|null>} { job, token }, or null when the job is not this session's to run.
  async _claim(scopeKey, key) {
    const held = this.claimsByKey.get(key);
    if (held) {
      const renewed = await this.repository.renew(scopeKey, key, held.token);
      if (renewed) return { job: renewed, token: held.token };
      this.claimsByKey.delete(key);
      return null;
    }
    this.attemptSequence += 1;
    const token = `${ this.ownerId }:${ this.attemptSequence }`;
    const claimed = await this.repository.claim(scopeKey, key, { ownerId: this.ownerId, token });
    if (!claimed) return null;
    this.claimsByKey.set(key, { scopeKey, token });
    return { job: claimed, token };
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Write a finished attempt's output, then acknowledge it. The claim is confirmed first, so an attempt another
  //   session has taken over discards its result instead of writing it. A job that received newer inputs while it ran
  //   is enqueued again.
  // @param {object} attempt - { context, handler, job, jobView, recovered, result, revision, startedAt, token }.
  // @returns {Promise<object>} The result to report to the scheduler.
  async _complete({ context, handler, job, jobView, recovered, result, revision, startedAt, token }) {
    const { key, scopeKey } = jobView;
    if (!recovered && !(await this.repository.renew(scopeKey, key, token))) {
      this.claimsByKey.delete(key);
      return { status: "superseded" };
    }
    if (!recovered) await handler.applyResult?.({ context, job: jobView, result });
    const completed = await this.repository.complete(scopeKey, key, token, { revision });
    this.claimsByKey.delete(key);
    if (!completed) return { status: "superseded" };
    this._recordOutcome(scopeKey, job, { durationMilliseconds: this.clock() - startedAt, outputRevision: revision, recovered,
      status: "completed" });
    if (completed.status === "pending" && !this.disposed) this._enqueue(completed);
    if (!recovered) await this._submitFollowUps(jobView, result?.followUps);
    return { recovered, revision, status: "completed" };
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Enqueue an attempt of a saved job on the scheduler. If the scheduler drops it before it runs, as when the
  //   Dashboard switches scope, any claim this session holds on it is released.
  // @param {DashboardWorkJob} job - The saved job.
  _enqueue(job) {
    const handler = this.handlers.get(job.type);
    const { key, scopeKey } = job;
    const outcome = this.scheduler.enqueue({ category: job.category, key, resource: handler.resource, scopeKey, type: job.type,
      run: ({ context, signal }) => this._runAttempt(scopeKey, key, { context, signal }) });
    outcome.then(({ status }) => {
      if (status === "cancelled" || status === "superseded") this._releaseClaim(key);
    });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Record a failed attempt and decide what follows: a retry after a jittered delay, a wait for configuration,
  //   or a lasting failure. The failure is still reported to the scheduler.
  // @param {object} attempt - { error, job, jobView, startedAt, token }.
  // @returns {Promise<never>} Rethrows the error.
  async _fail({ error, job, jobView, startedAt, token }) {
    const { key, scopeKey } = jobView;
    this.claimsByKey.delete(key);
    const failureClassification = workFailureClassification(error);
    const retryAt = this.clock() + retryDelayMilliseconds(job.attempt, { random: this.random,
      retryAfterMilliseconds: error?.retryAfterMilliseconds });
    const message = sanitizedValue(error instanceof Error ? error : String(error));
    const failed = await this.repository.fail(scopeKey, key, token, { classification: failureClassification, message, retryAt })
      .catch(() => null);
    if (failed) {
      this._recordOutcome(scopeKey, job, { durationMilliseconds: this.clock() - startedAt, error: message, failureClassification,
        retryAt: failed.status === "retryWaiting" ? failed.nextEligibleAt : null, status: failed.status });
    }
    if (failed?.status === "retryWaiting") this._scheduleRetry(failed);
    throw error;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Offer an outcome to the history store.
  // @param {string|null} scopeKey - The job's scope.
  // @param {DashboardWorkJob} job - The job as claimed.
  // @param {object} details - Outcome fields, including status.
  _recordOutcome(scopeKey, job, details) {
    this.diagnosticsStore?.recordOutcome(scopeKey, { attempt: job.attempt, jobKey: job.key, jobType: job.type, ...details });
    const outcome = { entityId: job.entityId, jobKey: job.key, jobType: job.type, scopeKey, status: details.status };
    for (const listener of this.outcomeListeners) {
      try {
        listener(outcome);
      } catch (error) {
        logIfEnabled("[durable-work-runner] an outcome listener failed", error?.message);
      }
    }
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Let go of this session's claim on a job, without waiting for the write.
  // @param {string} key - Job key.
  _releaseClaim(key) {
    const claim = this.claimsByKey.get(key);
    if (!claim) return;
    this.claimsByKey.delete(key);
    this.repository.release(claim.scopeKey, key, claim.token).catch(() => null);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Run one attempt as the scheduler admits it: claim the job, complete it at once when its output already
  //   reflects the desired revision, otherwise run the handler and save its checkpoint, retire it, or complete it.
  // @param {string|null} scopeKey - The job's scope.
  // @param {string} key - Job key.
  // @param {object} options - { context, signal } from the scheduler.
  // @returns {Promise<object>} A scheduler result: yielded with its checkpoint, superseded, or completed.
  async _runAttempt(scopeKey, key, { context, signal }) {
    const startedAt = this.clock();
    const claim = await this._claim(scopeKey, key);
    if (!claim) return { status: "superseded" };
    const { job, token } = claim;
    const handler = this.handlers.get(job.type);
    const jobView = { attempt: job.attempt, category: job.category, cursor: job.cursor, desiredRevision: job.attemptRevision,
      entityId: job.entityId, input: job.input, key, scopeKey, type: job.type };
    const attempt = { context, handler, job, jobView, startedAt, token };
    try {
      const appliedRevision = await handler.appliedRevision?.({ context, job: jobView });
      if (appliedRevision !== undefined && appliedRevision !== null && appliedRevision === job.attemptRevision) {
        return await this._complete({ ...attempt, recovered: true, result: null, revision: appliedRevision });
      }
      const result = await handler.run({ context, job: jobView, signal });
      if (signal?.aborted) {
        this._releaseClaim(key);
        return { status: "superseded" };
      }
      if (result?.status === "yielded") return await this._saveCheckpoint(attempt, result.checkpoint ?? null);
      if (result?.status === "superseded") return await this._supersede(attempt);
      return await this._complete({ ...attempt, recovered: false, result, revision: result?.revision ?? job.attemptRevision });
    } catch (error) {
      if (signal?.aborted) {
        this._releaseClaim(key);
        throw error;
      }
      return this._fail({ ...attempt, error });
    }
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Save a yielded attempt's progress, keeping the claim so the next admission resumes it.
  // @param {object} attempt - { jobView, token }.
  // @param {*} checkpoint - Plain JSON progress.
  // @returns {Promise<object>} { checkpoint, status: "yielded" }, or superseded when the claim was lost.
  async _saveCheckpoint({ jobView, token }, checkpoint) {
    const saved = await this.repository.checkpoint(jobView.scopeKey, jobView.key, token, checkpoint);
    if (saved) return { checkpoint, status: "yielded" };
    this.claimsByKey.delete(jobView.key);
    return { status: "superseded" };
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Enqueue a job once its retry delay has passed.
  // @param {DashboardWorkJob} job - A job waiting to retry.
  _scheduleRetry(job) {
    if (this.disposed || this.retryTimersByKey.has(job.key)) return;
    const delay = Math.max(0, (job.nextEligibleAt ?? 0) - this.clock());
    const timer = this.setTimer(() => {
      this.retryTimersByKey.delete(job.key);
      if (!this.disposed) this._enqueue(job);
    }, delay);
    this.retryTimersByKey.set(job.key, timer);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Submit the work a completed attempt asked for next, in the finished job's scope and, unless a follow-up names
  //   its own, at the finished job's category, so work a foreground request started stays in the foreground. A
  //   follow-up that cannot be saved is logged; the finished job stays completed.
  // @param {object} jobView - The finished job, as its handler saw it.
  // @param {Array<object>|undefined} followUps - Requests as submit takes them.
  // @returns {Promise<void>}
  async _submitFollowUps(jobView, followUps) {
    if (!Array.isArray(followUps) || !followUps.length || this.disposed) return;
    const requests = followUps.map(followUp => ({ ...followUp, category: followUp.category || jobView.category }));
    await this.submitAll(requests, { scopeKey: jobView.scopeKey })
      .catch(error => logIfEnabled("[durable-work-runner] could not submit follow-up work", error?.message));
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Retire a job whose handler found its inputs no longer apply.
  // @param {object} attempt - { job, jobView, startedAt, token }.
  // @returns {Promise<object>} { status: "superseded" }.
  async _supersede({ job, jobView, startedAt, token }) {
    this.claimsByKey.delete(jobView.key);
    const superseded = await this.repository.supersede(jobView.scopeKey, jobView.key, token);
    if (superseded) this._recordOutcome(jobView.scopeKey, job, { durationMilliseconds: this.clock() - startedAt, status: "superseded" });
    return { status: "superseded" };
  }
}
