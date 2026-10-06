// Submit Plan Builder's selected quarter to the Dashboard's shared work queue and re-read scores as rankings finish.
// A mounted Builder retains its quarter alongside the Dashboard's scope; closing it leaves unfinished durable work
// for the next visit. Only durable-disabled mode keeps the legacy idle-timed ranking pass.
import { useDashboardWork } from "dashboard/work-queue/dashboard-work-context";
import { queuedMaintenanceSelected } from "dashboard/work-queue/dashboard-work-features";
import { RANK_PROJECT_TASKS_JOB_TYPE, projectReconciliationRequest,
  projectWorkScopeKey } from "dashboard/work-queue/jobs/project-job-requests";
import { refreshStaleProjectRankings } from "plan-wizard/stack-rank/refresh-stale-project-rankings";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { logIfEnabled } from "util/log";

const RANKING_LOG_LABEL = "[project-task-ranking]";
// How long the builder must sit without a provider request before the pass starts. Long enough that the request
// following a page change has begun, so the pass does not start in the gap between two of the builder's calls.
const RANKING_IDLE_DELAY_MS = 3000;
// How long after a queued ranking completes before scores are re-read, so rankings finishing together cause one read.
const RANKED_RELOAD_DELAY_MS = 1000;

// ------------------------------------------------------------------------------------------
// @desc Request queued rankings for the Builder's quarter once its provider is idle, without an independent delay.
//   Repeated idle signals submit the same revision, so the durable runner coalesces them. The queue shares resource
//   limits across quarters, and only matching completed rankings trigger a debounced score reload. When durable work
//   is disabled, retain the legacy pass and its idle timer until rollout cleanup removes that fallback.
// @param {Object} options - An object with the following properties:
//   - {Object} app - Amplenote app bridge
//   - {string|null} domainName - Display name of the active task domain
//   - {string|null} domainUuid - UUID of the active task domain
//   - {boolean} isAwaitingProvider - True while the builder waits on a generative provider response
//   - {Function} [onRanked] - Called after a pass that wrote at least one project, so open pages can re-read scores
//   - {number} [quarter] - Quarter being planned; the calendar quarter when omitted
//   - {number} [year] - Year of that quarter
export function useProjectTaskRanking({ app, domainName, domainUuid, isAwaitingProvider, onRanked, quarter, year }) {
  const work = useDashboardWork();
  const today = new Date();
  const planQuarter = quarter ?? Math.floor(today.getMonth() / 3) + 1;
  const planYear = year ?? today.getFullYear();
  const scopeKey = projectWorkScopeKey({ domainUuid, quarter: planQuarter, year: planYear });
  const maintenanceQueued = queuedMaintenanceSelected();
  useQueuedProjectRanking({ app, domainName, domainUuid, enabled: maintenanceQueued, isAwaitingProvider, onRanked,
    quarter: planQuarter, scopeKey, work, year: planYear });
  useLegacyProjectRanking({ app, domainName, domainUuid, enabled: !maintenanceQueued, isAwaitingProvider, onRanked, quarter, year });
}

// ----------------------------------------------------------------------------------------------
// @desc Keep the old idle-timed pass available only while durable work is explicitly disabled.
// @param {object} options - { app, domainName, domainUuid, enabled, isAwaitingProvider, onRanked, quarter, year }.
function useLegacyProjectRanking({ app, domainName, domainUuid, enabled, isAwaitingProvider, onRanked, quarter, year }) {
  const awaitingProviderRef = useRef(isAwaitingProvider);
  const startedRef = useRef(false);
  awaitingProviderRef.current = isAwaitingProvider;
  useEffect(() => {
    if (!enabled || startedRef.current || isAwaitingProvider || !app) return undefined;
    const timer = setTimeout(() => {
      startedRef.current = true;
      refreshStaleProjectRankings(app, { domainName, domainUuid, isProviderBusy: () => awaitingProviderRef.current,
        quarter, year })
        .then(result => {
          logIfEnabled(`${ RANKING_LOG_LABEL } pass finished`, result);
          if (result?.rankedCount && onRanked) return onRanked();
          return null;
        })
        .catch(error => logIfEnabled(`${ RANKING_LOG_LABEL } pass failed`, error?.message));
    }, RANKING_IDLE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [app, domainName, domainUuid, enabled, isAwaitingProvider, onRanked, quarter, year]);
}

// ----------------------------------------------------------------------------------------------
// @desc Retain the Builder's quarter on the shared scheduler, recover saved jobs, and submit one stable reconciliation
//   revision whenever the provider returns idle. A primary scope change revokes registrations; subscribe only to that
//   scope value so other queue transitions do not re-render Builder or resubmit work.
// @param {object} options - { app, domainName, domainUuid, enabled, isAwaitingProvider, onRanked, quarter, scopeKey, work, year }.
function useQueuedProjectRanking({ app, domainName, domainUuid, enabled, isAwaitingProvider, onRanked, quarter, scopeKey, work, year }) {
  const durable = enabled ? work?.runtime.durable || null : null;
  const scheduler = durable ? work.runtime.scheduler : null;
  const subscribeScope = useCallback(listener => scheduler ? scheduler.subscribe(listener) : () => {}, [scheduler]);
  const readScope = useCallback(() => scheduler?.scopeKey ?? null, [scheduler]);
  const dashboardScopeKey = useSyncExternalStore(subscribeScope, readScope);
  const matchingDomain = dashboardScopeKey?.startsWith(`${ domainUuid || "all" }:Q`) || false;
  const request = useMemo(() => ({ ...projectReconciliationRequest({ domainName, domainUuid, quarter, year },
    { category: "foregroundData", requestedAt: Date.now() }), scopeKey }), [domainName, domainUuid, quarter, scopeKey, year]);

  useEffect(() => {
    if (!scheduler || !matchingDomain) return undefined;
    return scheduler.retainScope(scopeKey);
  }, [dashboardScopeKey, matchingDomain, scheduler, scopeKey]);

  useEffect(() => {
    if (!app || !durable || !matchingDomain || isAwaitingProvider) return undefined;
    let cancelled = false;
    durable.recover(scopeKey).then(() => {
      if (!cancelled) return durable.submit(request);
      return null;
    }).catch(error => logIfEnabled(`${ RANKING_LOG_LABEL } could not queue the quarter's rankings`, error?.message));
    return () => { cancelled = true; };
  }, [app, dashboardScopeKey, durable, isAwaitingProvider, matchingDomain, request, scopeKey]);
  useRankedProjectReload({ durable, enabled: matchingDomain, onRanked, scopeKey });
}

// ----------------------------------------------------------------------------------------------
// @desc Reload scores after a burst of completed rankings in this Builder's scope, cancelling delayed publication
//   when the Builder closes or changes scope.
// @param {object} options - { durable, enabled, onRanked, scopeKey }.
function useRankedProjectReload({ durable, enabled, onRanked, scopeKey }) {
  useEffect(() => {
    if (!durable || !enabled || !onRanked) return undefined;
    let reloadTimer = null;
    const unsubscribe = durable.subscribeOutcomes(outcome => {
      if (outcome.scopeKey !== scopeKey || outcome.jobType !== RANK_PROJECT_TASKS_JOB_TYPE || outcome.status !== "completed") return;
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(onRanked, RANKED_RELOAD_DELAY_MS);
    });
    return () => {
      unsubscribe();
      clearTimeout(reloadTimer);
    };
  }, [durable, enabled, onRanked, scopeKey]);
}
