// Admit Dashboard work by priority, one resource at a time. Each job names the resource it needs and a priority
// category; an admission pass starts every job whose category the current conditions allow and whose resource has a
// free permit, skipping blocked jobs rather than waiting on them, so a pending provider request never holds up a
// component mount. A pass returns as soon as it has started what it can; each job reports its own completion and
// triggers the next pass. Enqueueing a key already pending coalesces into the one job, and enqueueing a key already
// running keeps one replacement to run after it. The scheduler holds only in-memory jobs: it does not persist work.
import { admissionWaitingReason, FOREGROUND_CATEGORIES, moreUrgentCategory, priorityRank, WAITING_REASONS } from "dashboard/work-queue/dashboard-work-policy";
import { abortController, coalesceScheduledJob, effectiveJobCategory, scheduledJob, scheduledJobRequest } from "dashboard/work-queue/scheduled-work-job";

// The conditions an admission pass consults, as setConditions accepts them.
const CONDITION_NAMES = ["hidden", "loadSettled", "overlayHeld"];

// ----------------------------------------------------------------------------------------------
// @desc Holds pending and running jobs, admits them through a resource budget, and settles each job's promise once.
export default class DashboardWorkScheduler {
  budget; // {DashboardResourceBudget} Permits per resource.
  clock; // {function} Returns epoch milliseconds; injected for tests.
  conditions = { hidden: false, loadSettled: false, overlayHeld: false }; // {object} Dashboard state admission consults.
  context; // {object} Passed to every job's run, such as { app, clock }.
  diagnostics; // {object|null} Receives scheduler events through record(event).
  disposed = false; // {boolean} True once disposed; nothing further is admitted.
  foregroundKeysByRequester = new Map(); // {Map<string, Set<string>>} Job keys each foreground requester needs.
  generation = 0; // {number} Incremented whenever the scope changes.
  jobsByKey = new Map(); // {Map<string, object>} Pending and running jobs.
  listeners = new Set(); // {Set<function>} Called after a batch of state changes.
  notifyScheduled = false; // {boolean} True while a subscriber notification is queued.
  requestRun; // {function} Arranges for runReady to be called soon.
  runScheduled = false; // {boolean} True while the default requestRun has a pass queued.
  scopeKey = null; // {string|null} The domain and quarter whose work may run.
  sequence = 0; // {number} Orders jobs within a category, first enqueued first.

  // ----------------------------------------------------------------------------------------------
  // @desc Construct a scheduler. By default an admission pass runs in a microtask after any change; a browser driver
  //   or test can supply its own requestRun instead and call runReady itself.
  // @param {object} options - { budget, clock = Date.now, context = {}, diagnostics = null, requestRun }.
  constructor({ budget, clock = Date.now, context = {}, diagnostics = null, requestRun = null }) {
    Object.assign(this, { budget, clock, context, diagnostics });
    this.requestRun = requestRun || (() => this._queueRun());
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Stop a job. A pending job is removed. A running job's signal is aborted and its permit released at once;
  //   whatever it later returns is ignored, so it is never completed twice. A queued replacement is cancelled with it.
  // @param {string} key - Job key.
  // @param {object} [options] - { status = "cancelled" }: "superseded" when a scope change retires the job.
  // @returns {boolean} Whether a job was found.
  cancel(key, { status = "cancelled" } = {}) {
    const job = this.jobsByKey.get(key);
    if (!job) return false;
    this.jobsByKey.delete(key);
    if (job.status === "running") {
      job.controller.abort();
      job.permit?.release();
    }
    if (job.replacement) job.replacement.settle({ status });
    job.settle({ status });
    this._record(status, job);
    this._changed();
    return true;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Cancel every job, stop admitting, and drop subscribers.
  dispose() {
    for (const key of [...this.jobsByKey.keys()]) this.cancel(key);
    this.disposed = true;
    this.listeners.clear();
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Add a job, or coalesce it into the pending job with the same key: the newer run, input, resource and
  //   dependencies replace the older, the more urgent category is kept, and the job keeps its place in line. A key
  //   already running gets one replacement, run after the current attempt finishes. A job scoped to anything other
  //   than the current scope settles superseded at once.
  // @param {object} descriptor - An object with the following properties:
  //   - {string} key - Identity used to coalesce, promote, and cancel, such as "rankProjectTasks:<projectUuid>"
  //   - {function} run - Async ({ checkpoint, context, job, signal }) => result. A result { status: "yielded",
  //     checkpoint } returns the job to the queue to continue from the checkpoint; { status: "superseded" } settles it
  //     superseded; any other result completes it. A throw fails it.
  //   - {string} type - Job type, for diagnostics
  //   - {string} [category="maintenance"] - One of PRIORITY_CATEGORIES
  //   - {Array<string>} [dependsOn=[]] - Keys of jobs that must finish before this one starts
  //   - {*} [input=null] - Passed to run as job.input
  //   - {string|null} [resource=null] - Budget resource the job holds while running; null needs none
  //   - {string|null} [scopeKey] - Scope the job belongs to; defaults to the current scope, null for unscoped work
  // @returns {Promise<object>} Settles once with { status, result?, error? }, status being "completed", "failed",
  //   "cancelled", or "superseded". It never rejects.
  enqueue(descriptor) {
    const request = scheduledJobRequest(descriptor, this.scopeKey);
    if (this.disposed) return Promise.resolve({ status: "cancelled" });
    if (request.scopeKey !== null && request.scopeKey !== this.scopeKey) return Promise.resolve({ status: "superseded" });
    const existing = this.jobsByKey.get(request.key);
    if (existing?.status === "pending") {
      coalesceScheduledJob(existing, request);
      this._record("coalesced", existing);
      this._changed();
      return existing.promise;
    }
    if (existing) {
      if (existing.replacement) coalesceScheduledJob(existing.replacement, request);
      else existing.replacement = scheduledJob(request, { enqueuedAt: this.clock(), sequence: ++this.sequence });
      this._record("coalesced", existing);
      this._changed();
      return existing.replacement.promise;
    }
    const job = scheduledJob(request, { enqueuedAt: this.clock(), sequence: ++this.sequence });
    this.jobsByKey.set(job.key, job);
    this._record("enqueued", job);
    this._changed();
    return job.promise;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Whether a job with the key is pending or running.
  // @param {string} key - Job key.
  // @returns {boolean} True while the scheduler holds the job.
  holds(key) {
    return this.jobsByKey.has(key);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Raise a pending or running job, or its replacement, to a more urgent category. A job is never lowered.
  // @param {string} key - Job key.
  // @param {string} category - One of PRIORITY_CATEGORIES.
  // @returns {boolean} Whether a job was found.
  promote(key, category) {
    const job = this.jobsByKey.get(key);
    if (!job) return false;
    priorityRank(category);
    const target = job.replacement || job;
    if (target.category === moreUrgentCategory(target.category, category)) return true;
    target.category = category;
    this._record("promoted", target);
    this._changed();
    return true;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Start every job that may start now, most urgent first, and return without waiting for any of them. Each
  //   pending job is checked on its own: one waiting for a dependency, a condition, or a busy resource is skipped
  //   with its waiting reason recorded, and later jobs still start.
  // @returns {number} How many jobs this pass started.
  runReady() {
    if (this.disposed) return 0;
    const demandedKeys = this._demandedKeys();
    const foregroundPressure = this._foregroundPressure(demandedKeys);
    this.budget.setForegroundDemand(foregroundPressure);
    const pendingJobs = [...this.jobsByKey.values()].filter(job => job.status === "pending");
    const rankedJobs = pendingJobs.map(job => ({ effectiveCategory: effectiveJobCategory(job, demandedKeys), job }));
    rankedJobs.sort((first, second) => priorityRank(first.effectiveCategory) - priorityRank(second.effectiveCategory)
      || first.job.sequence - second.job.sequence);
    let started = 0;
    let visibleRenderWaiting = false;
    for (const { effectiveCategory, job } of rankedJobs) {
      const blockingDependency = job.dependsOn.some(key => this.jobsByKey.has(key));
      let waitingReason = blockingDependency ? "dependency" : admissionWaitingReason(effectiveCategory,
        { conditions: this.conditions, foregroundPressure, visibleRenderWaiting });
      let permit = null;
      if (!waitingReason && job.resource) {
        permit = this.budget.tryAcquire(job.resource, { background: !FOREGROUND_CATEGORIES.includes(effectiveCategory) });
        if (!permit) waitingReason = "resourceBusy";
      }
      if (waitingReason) {
        if (effectiveCategory === "visibleRender") visibleRenderWaiting = true;
        this._setWaitingReason(job, waitingReason, effectiveCategory);
        continue;
      }
      this._start(job, { effectiveCategory, permit });
      started += 1;
    }
    if (started) this._changed();
    return started;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Update the Dashboard conditions admission consults: whether it is hidden, whether its initial load has
  //   settled, and whether an overlay holds its renders.
  // @param {object} conditions - Any of { hidden, loadSettled, overlayHeld } as booleans.
  setConditions(conditions) {
    for (const name of CONDITION_NAMES) {
      if (name in conditions) this.conditions[name] = Boolean(conditions[name]);
    }
    this._changed();
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Record which jobs a foreground requester, such as a visible widget, is waiting on. Those jobs and the jobs
  //   they depend on run as foreground data while any requester needs them, and return to their own category once
  //   none does. An empty list removes the requester.
  // @param {string} requesterId - Stable identity of the requester.
  // @param {Array<string>} jobKeys - Keys of the jobs it needs.
  setForegroundDemand(requesterId, jobKeys) {
    if (jobKeys?.length) this.foregroundKeysByRequester.set(requesterId, new Set(jobKeys));
    else this.foregroundKeysByRequester.delete(requesterId);
    this._changed();
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Switch to another domain or quarter. Every job scoped to a different scope is superseded, so none of its
  //   results reaches the new scope's consumers; unscoped jobs continue.
  // @param {string|null} scopeKey - The new scope.
  setScope(scopeKey) {
    if (scopeKey === this.scopeKey) return;
    this.scopeKey = scopeKey;
    this.generation += 1;
    const staleJobs = [...this.jobsByKey.values()].filter(job => job.scopeKey !== null && job.scopeKey !== scopeKey);
    for (const job of staleJobs) this.cancel(job.key, { status: "superseded" });
    this._changed();
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Describe the scheduler for an operator: conditions, scope, permits, and each job with its waiting reason.
  // @returns {object} { conditions, counts, foregroundRequesters, generation, jobs, resources, scopeKey }.
  snapshot() {
    const demandedKeys = this._demandedKeys();
    const jobs = [...this.jobsByKey.values()].map(job => ({ attempt: job.attempt, category: job.category,
      effectiveCategory: effectiveJobCategory(job, demandedKeys), enqueuedAt: job.enqueuedAt, key: job.key,
      resource: job.resource, scopeKey: job.scopeKey, startedAt: job.startedAt, status: job.status, type: job.type,
      waitingExplanation: WAITING_REASONS[job.waitingReason] || null, waitingReason: job.waitingReason }));
    const counts = { pending: jobs.filter(job => job.status === "pending").length,
      running: jobs.filter(job => job.status === "running").length };
    return { conditions: { ...this.conditions }, counts, foregroundRequesters: this.foregroundKeysByRequester.size,
      generation: this.generation, jobs, resources: this.budget.snapshot().resources, scopeKey: this.scopeKey };
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Call a listener after each batch of state changes, so a subscriber can select what it shows from snapshot.
  // @param {function} listener - Called with no arguments.
  // @returns {function} Removes the listener.
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Note a state change: ask for an admission pass and queue one subscriber notification.
  _changed() {
    if (this.disposed) return;
    this.requestRun();
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    Promise.resolve().then(() => {
      this.notifyScheduled = false;
      for (const listener of [...this.listeners]) listener();
    });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc The keys foreground requesters need, with every job those jobs depend on, transitively.
  // @returns {Set<string>} Demanded job keys.
  _demandedKeys() {
    const demandedKeys = new Set();
    const queue = [];
    for (const keys of this.foregroundKeysByRequester.values()) queue.push(...keys);
    while (queue.length) {
      const key = queue.pop();
      if (demandedKeys.has(key)) continue;
      demandedKeys.add(key);
      queue.push(...(this.jobsByKey.get(key)?.dependsOn || []));
    }
    return demandedKeys;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Settle a running attempt with what its run returned or threw. An attempt that is no longer the job's current
  //   one, because it was cancelled or superseded, is ignored. A yielded job returns to the back of its category.
  // @param {object} job - The running job.
  // @param {object} outcome - { attempt, error, result, threw }.
  _finish(job, { attempt, error, result, threw }) {
    if (this.jobsByKey.get(job.key) !== job || job.status !== "running" || job.attempt !== attempt) return;
    job.permit?.release();
    job.permit = null;
    const durationMilliseconds = this.clock() - job.startedAt;
    const yielded = !threw && result?.status === "yielded";
    if (yielded && !job.replacement) {
      Object.assign(job, { checkpoint: result.checkpoint ?? null, sequence: ++this.sequence, startedAt: null,
        status: "pending" });
      this._record("yielded", job, { durationMilliseconds });
      this._changed();
      return;
    }
    this.jobsByKey.delete(job.key);
    if (threw) {
      job.settle({ error, status: "failed" });
      this._record("failed", job, { durationMilliseconds, error });
    } else {
      const status = yielded || result?.status === "superseded" ? "superseded" : "completed";
      job.settle(status === "completed" ? { result, status } : { status });
      this._record(status, job, { durationMilliseconds });
    }
    if (job.replacement) {
      this.jobsByKey.set(job.key, job.replacement);
      this._record("enqueued", job.replacement);
    }
    this._changed();
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Whether foreground work is demanded, waiting, or running, which pauses new maintenance.
  // @param {Set<string>} demandedKeys - From _demandedKeys.
  // @returns {boolean} True under foreground pressure.
  _foregroundPressure(demandedKeys) {
    if (demandedKeys.size) return true;
    return [...this.jobsByKey.values()].some(job => FOREGROUND_CATEGORIES.includes(job.category));
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Queue one admission pass in a microtask, for a scheduler given no requestRun.
  _queueRun() {
    if (this.runScheduled) return;
    this.runScheduled = true;
    Promise.resolve().then(() => {
      this.runScheduled = false;
      this.runReady();
    });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Send one event about a job to diagnostics.
  // @param {string} type - Event type.
  // @param {object} job - The job.
  // @param {object} [details] - Further allow-listed fields.
  _record(type, job, details = {}) {
    this.diagnostics?.record({ attempt: job.attempt, category: job.category, jobKey: job.key, jobType: job.type,
      resource: job.resource, scopeKey: job.scopeKey, type, ...details });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Record a pending job's waiting reason, sending an event only when the reason changes.
  // @param {object} job - The pending job.
  // @param {string} waitingReason - A WAITING_REASONS key.
  // @param {string} effectiveCategory - The category the job was considered at.
  _setWaitingReason(job, waitingReason, effectiveCategory) {
    if (job.waitingReason === waitingReason) return;
    job.waitingReason = waitingReason;
    this._record("waiting", job, { effectiveCategory, waitingReason });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Start one attempt of a job. Its run is called in a later microtask, so a pass never runs job code
  //   synchronously, and its completion is reported through _finish whatever it returns or throws.
  // @param {object} job - The pending job.
  // @param {object} options - { effectiveCategory, permit }.
  _start(job, { effectiveCategory, permit }) {
    const attempt = job.attempt + 1;
    const startedAt = this.clock();
    Object.assign(job, { attempt, controller: abortController(), permit, startedAt, status: "running",
      waitingReason: null });
    this._record("started", job, { effectiveCategory, waitedMilliseconds: startedAt - job.enqueuedAt });
    const jobView = { attempt, input: job.input, key: job.key, type: job.type };
    const runArguments = { checkpoint: job.checkpoint, context: this.context, job: jobView, signal: job.controller.signal };
    Promise.resolve()
      .then(() => job.run(runArguments))
      .then(result => this._finish(job, { attempt, result, threw: false }),
        error => this._finish(job, { attempt, error, threw: true }));
  }
}
