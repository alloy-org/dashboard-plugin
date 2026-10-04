// Shape the Dashboard work runtime's state for the admin Queue inspector: capture one read-only view of the scheduler,
// diagnostics, and widget mounts, filter its jobs, summarize the overview, pair each widget mount with its scheduler
// job, and pick recent outcomes from the event ring. Reading a view never enqueues, promotes, or cancels anything, so
// an inspector stays usable while the queue it inspects is stalled.
import { PRIORITY_CATEGORIES, WAITING_REASONS } from "dashboard/work-queue/dashboard-work-policy";

// Event types that end a job, shown as recent outcomes.
const OUTCOME_EVENT_TYPES = ["cancelled", "completed", "failed", "superseded"];
// How many recent outcomes the inspector lists.
const OUTCOME_LIMIT = 50;
// Order saved jobs are listed in: unfinished work first, most actionable first.
const SAVED_JOB_STATUS_ORDER = ["running", "pending", "retryWaiting", "blockedConfiguration", "failed", "superseded", "completed"];
// How far from now a numeric revision may lie and still be read as the time it was requested.
const YEAR_MILLISECONDS = 365 * 24 * 60 * 60 * 1000;
// Filter values that match every job.
export const ALL_JOBS_FILTER = { category: "", keyText: "", scopeKey: "", status: "", type: "" };

// ------------------------------------------------------------------------------------------
// @desc The jobs matching every set filter. An empty filter value matches anything; keyText matches part of a job key,
//   which holds the project or term identity of project work.
// @param {Array<object>} jobs - From the scheduler snapshot.
// @param {object} filters - { category, keyText, scopeKey, status, type }.
// @returns {Array<object>} The matching jobs, in snapshot order.
export function filteredJobs(jobs, filters) {
  const keyText = String(filters.keyText || "").trim().toLowerCase();
  const matchingJobs = jobs.filter(job => (!filters.category || job.effectiveCategory === filters.category)
    && (!filters.scopeKey || String(job.scopeKey) === filters.scopeKey) && (!filters.status || job.status === filters.status)
    && (!filters.type || job.type === filters.type) && (!keyText || job.key.toLowerCase().includes(keyText)));
  return matchingJobs;
}

// ------------------------------------------------------------------------------------------
// @desc How long before a reference time something happened, formatted.
// @param {number|null} at - Epoch milliseconds.
// @param {number} now - Epoch milliseconds to measure from.
// @returns {string} Such as "12.4 s ago", or "—" when at is missing.
export function formattedAge(at, now) {
  if (typeof at !== "number") return "—";
  return `${ formattedDuration(Math.max(0, now - at)) } ago`;
}

// ------------------------------------------------------------------------------------------
// @desc A job revision as an operator reads it. Revisions are opaque to the queue, but a reconciliation names each
//   request by the time it was made, so a revision that reads as a time within a year of now is shown as an age.
// @param {string|number|null} revision - A desired or succeeded revision.
// @param {number} now - Epoch milliseconds.
// @returns {string} Such as "38.0 s ago", the revision itself, or "—" when there is none.
export function formattedRevision(revision, now) {
  if (revision === null || revision === undefined) return "—";
  const revisionText = String(revision);
  const revisionTime = /^\d{12,14}$/.test(revisionText) ? Number(revisionText) : null;
  if (revisionTime !== null && Math.abs(now - revisionTime) < YEAR_MILLISECONDS) return formattedAge(revisionTime, now);
  return revisionText;
}

// ------------------------------------------------------------------------------------------
// @desc Format a duration for the inspector, from milliseconds through hours.
// @param {number|null} milliseconds - A duration.
// @returns {string} Such as "850 ms", "12.4 s", "3 min", or "—" when there is none.
export function formattedDuration(milliseconds) {
  if (typeof milliseconds !== "number" || !Number.isFinite(milliseconds)) return "—";
  if (milliseconds < 1000) return `${ Math.round(milliseconds) } ms`;
  if (milliseconds < 60000) return `${ (milliseconds / 1000).toFixed(1) } s`;
  if (milliseconds < 3600000) return `${ Math.round(milliseconds / 60000) } min`;
  return `${ (milliseconds / 3600000).toFixed(1) } h`;
}

// ------------------------------------------------------------------------------------------
// @desc The values each job filter can choose from, drawn from the current jobs. Categories list every priority.
// @param {Array<object>} jobs - From the scheduler snapshot.
// @returns {object} { categories, scopeKeys, statuses, types }, each sorted.
export function jobFilterOptions(jobs) {
  const distinctSorted = values => [...new Set(values)].sort();
  const scopeKeys = distinctSorted(jobs.map(job => String(job.scopeKey)));
  const statuses = distinctSorted(jobs.map(job => job.status));
  const types = distinctSorted(jobs.map(job => job.type));
  return { categories: PRIORITY_CATEGORIES, scopeKeys, statuses, types };
}

// ------------------------------------------------------------------------------------------
// @desc Capture one read-only view of a work runtime and its mount coordinator.
// @param {object} work - { mountCoordinator, runtime } as the Dashboard provides it.
// @param {function} [clock=Date.now] - Returns epoch milliseconds.
// @returns {object} { capturedAt, diagnostics, durableEnabled, mountingEnabled, mounts, projectCoverage, scheduler, session }.
export function queueInspectorView(work, clock = Date.now) {
  const { mountCoordinator, planner, runtime } = work;
  const mounts = mountCoordinator ? mountCoordinator.snapshot() : { widgets: [] };
  const scheduler = runtime.scheduler.snapshot();
  const projectCoverage = planner ? planner.coverage(scheduler.scopeKey) : null;
  return { capturedAt: clock(), diagnostics: runtime.diagnostics.snapshot(), durableEnabled: Boolean(runtime.durable),
    mountingEnabled: Boolean(mountCoordinator), mounts, projectCoverage, scheduler, session: runtime.session };
}

// ------------------------------------------------------------------------------------------
// @desc Summarize a view for the overview: counts, the oldest pending job's age, the last progress, and the conditions.
// @param {object} view - From queueInspectorView.
// @returns {object} { conditions, durableEnabled, foregroundDemand, lastProgressAt, mountingEnabled, oldestPendingMilliseconds, pending,
//   projectCoverage, running, scopeKey, session, waitingByReason }; projectCoverage is from
//   QuarterProjectWorkPlanner#coverage, or null without queued project maintenance.
export function queueOverview(view) {
  const { capturedAt, diagnostics, scheduler } = view;
  const pendingJobs = scheduler.jobs.filter(job => job.status === "pending");
  const oldestEnqueuedAt = pendingJobs.length ? Math.min(...pendingJobs.map(job => job.enqueuedAt)) : null;
  const waitingByReason = {};
  for (const job of pendingJobs) {
    const reason = job.waitingReason || "notYetConsidered";
    waitingByReason[reason] = (waitingByReason[reason] || 0) + 1;
  }
  return { conditions: scheduler.conditions, durableEnabled: view.durableEnabled, foregroundDemand: scheduler.foregroundRequesters > 0,
    lastProgressAt: diagnostics.lastProgressAt, mountingEnabled: view.mountingEnabled,
    oldestPendingMilliseconds: oldestEnqueuedAt === null ? null : capturedAt - oldestEnqueuedAt,
    pending: scheduler.counts.pending, projectCoverage: view.projectCoverage || null, running: scheduler.counts.running,
    scopeKey: scheduler.scopeKey, session: view.session, waitingByReason };
}

// ------------------------------------------------------------------------------------------
// @desc The most recent finished jobs, newest first.
// @param {Array<object>} events - From the diagnostics snapshot, oldest first.
// @returns {Array<object>} Up to OUTCOME_LIMIT outcome events.
export function recentOutcomes(events) {
  const outcomeEvents = events.filter(event => OUTCOME_EVENT_TYPES.includes(event.type));
  const newestOutcomes = outcomeEvents.slice(-OUTCOME_LIMIT).reverse();
  return newestOutcomes;
}

// ------------------------------------------------------------------------------------------
// @desc Describe each saved job for an operator. A job another session claims is shown as claimed, with when it was
//   last updated and when its claim lapses, never as definitely running, since that session may have closed.
// @param {Array<object>} jobs - DashboardWorkJob instances or their records, from the repository.
// @param {object} options - { now, sessionId }: this session's ID tells its own attempts from other sessions'.
// @returns {Array<object>} Each job's fields plus { statusLabel }, unfinished work first, then newest first.
export function savedJobRows(jobs, { now, sessionId }) {
  const rows = jobs.map(job => ({ attempt: job.attempt, claimExpiresAt: job.claimExpiresAt, cursor: job.cursor,
    desiredRevision: job.desiredRevision, key: job.key, lastFailure: job.lastFailure, nextEligibleAt: job.nextEligibleAt,
    status: job.status, statusLabel: _savedJobStatusLabel(job, { now, sessionId }), succeededAt: job.succeededAt,
    succeededRevision: job.succeededRevision, type: job.type, updatedAt: job.updatedAt }));
  rows.sort((first, second) => SAVED_JOB_STATUS_ORDER.indexOf(first.status) - SAVED_JOB_STATUS_ORDER.indexOf(second.status)
    || second.updatedAt - first.updatedAt);
  return rows;
}

// ------------------------------------------------------------------------------------------
// @desc Pair each registered widget with its mount job, so its waiting reason shows beside its visibility. Widgets
//   still waiting come first, then those mounting, then those mounted, each group in registration order.
// @param {object} view - From queueInspectorView.
// @returns {Array<object>} Each widget's mount fields plus { waitingExplanation, waitingReason }.
export function urgentRenderRows(view) {
  const jobsByKey = new Map(view.scheduler.jobs.map(job => [job.key, job]));
  const statusOrder = ["waiting", "mounting", "mounted"];
  const rows = view.mounts.widgets.map(widget => {
    const job = jobsByKey.get(`widgetMount:${ widget.widgetId }`);
    const waitingReason = job?.waitingReason || null;
    return { ...widget, waitingExplanation: WAITING_REASONS[waitingReason] || null, waitingReason };
  });
  rows.sort((first, second) => statusOrder.indexOf(first.status) - statusOrder.indexOf(second.status)
    || first.registeredAt - second.registeredAt);
  return rows;
}

// ------------------------------------------------------------------------------------------
// @desc A readable status for a saved job, separating this session's attempts from other sessions' claims.
// @param {object} job - A saved job.
// @param {object} options - { now, sessionId }.
// @returns {string} The label.
function _savedJobStatusLabel(job, { now, sessionId }) {
  if (job.status === "running") {
    if (job.ownerId === sessionId) return "Running in this session";
    if (job.claimExpiresAt === null || job.claimExpiresAt <= now) return "Claim lapsed; resumes on the next recovery";
    return `Claimed by another session (${ job.ownerId || "unknown" }), not verified running`;
  }
  if (job.status === "retryWaiting") {
    const retryDelay = (job.nextEligibleAt ?? now) - now;
    return retryDelay > 0 ? `Retrying in ${ formattedDuration(retryDelay) }` : "Retry due";
  }
  if (job.status === "blockedConfiguration") return "Waiting for a setting, such as a provider key";
  return job.status;
}
