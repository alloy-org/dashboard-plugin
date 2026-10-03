// Build and update the in-memory job records DashboardWorkScheduler holds: validating an enqueue request, creating a
// pending job whose promise settles exactly once, folding a newer request for the same key into it, and naming the
// category it is admitted at. These records carry a run function and live only as long as the scheduler does.
import { moreUrgentCategory, priorityRank } from "work-queue/dashboard-work-policy";

// ----------------------------------------------------------------------------------------------
// @desc An abort controller, or a minimal stand-in exposing the same signal.aborted where the runtime has none.
// @returns {object} { abort, signal }.
export function abortController() {
  if (typeof AbortController === "function") return new AbortController();
  const signal = { aborted: false };
  return { abort: () => { signal.aborted = true; }, signal };
}

// ----------------------------------------------------------------------------------------------
// @desc Fold a newer request for the same key into a pending job: the newer run, input, resource and dependencies
//   replace the older, and the more urgent category is kept.
// @param {object} job - The pending job or replacement, updated in place.
// @param {object} request - From scheduledJobRequest.
export function coalesceScheduledJob(job, request) {
  Object.assign(job, { dependsOn: request.dependsOn, input: request.input, resource: request.resource, run: request.run });
  job.category = moreUrgentCategory(job.category, request.category);
}

// ----------------------------------------------------------------------------------------------
// @desc The category a job is admitted at: foreground data while a requester needs it, otherwise its own.
// @param {object} job - The job.
// @param {Set<string>} demandedKeys - Keys foreground requesters need, with their dependencies.
// @returns {string} One of PRIORITY_CATEGORIES.
export function effectiveJobCategory(job, demandedKeys) {
  if (!demandedKeys.has(job.key)) return job.category;
  return moreUrgentCategory(job.category, "foregroundData");
}

// ----------------------------------------------------------------------------------------------
// @desc Build a pending job from a request, with a promise that settles exactly once however often settle is called.
// @param {object} request - From scheduledJobRequest.
// @param {object} options - { enqueuedAt, sequence }: epoch milliseconds, and its place in line.
// @returns {object} The job, carrying promise and settle.
export function scheduledJob(request, { enqueuedAt, sequence }) {
  let resolvePromise = null;
  const promise = new Promise(resolve => { resolvePromise = resolve; });
  let settled = false;
  const settle = outcome => {
    if (settled) return;
    settled = true;
    resolvePromise(outcome);
  };
  return { ...request, attempt: 0, checkpoint: null, controller: null, enqueuedAt, permit: null, promise,
    replacement: null, sequence, settle, startedAt: null, status: "pending", waitingReason: null };
}

// ----------------------------------------------------------------------------------------------
// @desc Validate an enqueue descriptor and fill in its defaults.
// @param {object} descriptor - As DashboardWorkScheduler#enqueue accepts it.
// @param {string|null} currentScopeKey - The scheduler's scope, used when the descriptor names none.
// @returns {object} { category, dependsOn, input, key, resource, run, scopeKey, type }.
export function scheduledJobRequest(descriptor, currentScopeKey) {
  const { category = "maintenance", dependsOn = [], input = null, key, resource = null, run, type } = descriptor || {};
  if (typeof key !== "string" || !key) throw new Error("A work job needs a key");
  if (typeof run !== "function") throw new Error(`Work job "${ key }" needs a run function`);
  priorityRank(category);
  const scopeKey = descriptor.scopeKey === undefined ? currentScopeKey : descriptor.scopeKey;
  return { category, dependsOn: [...dependsOn], input, key, resource, run, scopeKey, type: type || key };
}
