// Refresh the task rankings of the current quarter's projects once Plan Builder opens, so a project the builder
// shows is associated with the tasks that belong to it. The pass waits for a moment when the builder is not
// waiting on the generative provider, because it first refreshes the user terms dictionary through that provider.
// An installed Ample Agent Pro note asks Agent Pro to call Jev; a provider key and no Jev path uses the fast model.
// When project maintenance is queued and the builder plans the Dashboard's own quarter, the builder submits that
// quarter's reconciliation as foreground work instead of running its own pass, and re-reads scores as the queue's
// rankings complete. A builder planning another quarter runs its own pass, since the queue holds only the Dashboard's.
import { useDashboardWork } from "dashboard/work-queue/dashboard-work-context";
import { queuedMaintenanceSelected } from "dashboard/work-queue/dashboard-work-features";
import { RANK_PROJECT_TASKS_JOB_TYPE, projectReconciliationRequest,
  projectWorkScopeKey } from "dashboard/work-queue/jobs/project-job-requests";
import { refreshStaleProjectRankings } from "plan-wizard/stack-rank/refresh-stale-project-rankings";
import { useEffect, useRef } from "react";
import { logIfEnabled } from "util/log";

const RANKING_LOG_LABEL = "[project-task-ranking]";
// How long the builder must sit without a provider request before the pass starts. Long enough that the request
// following a page change has begun, so the pass does not start in the gap between two of the builder's calls.
const RANKING_IDLE_DELAY_MS = 3000;
// How long after a queued ranking completes before scores are re-read, so rankings finishing together cause one read.
const RANKED_RELOAD_DELAY_MS = 1000;

// ------------------------------------------------------------------------------------------
// @desc Start one ranking pass per mounted Plan Builder, after the builder has been idle for RANKING_IDLE_DELAY_MS.
//   The pass outlives the builder: it writes only the project task store, and stopping between projects would only
//   leave work for the next pass. A pass rating with the fast model does stop once the builder next waits on the
//   provider, which it learns from a ref kept current across renders. Failures are logged rather than shown, since
//   nothing in the builder waits on it. With queued maintenance for this quarter, the pass is a submitted
//   reconciliation, and onRanked follows each burst of completed rankings instead of the pass's end.
// @param {Object} options - An object with the following properties:
//   - {Object} app - Amplenote app bridge
//   - {string|null} domainName - Display name of the active task domain
//   - {string|null} domainUuid - UUID of the active task domain
//   - {boolean} isAwaitingProvider - True while the builder waits on a generative provider response
//   - {Function} [onRanked] - Called after a pass that wrote at least one project, so open pages can re-read scores
//   - {number} [quarter] - Quarter being planned; the calendar quarter when omitted
//   - {number} [year] - Year of that quarter
export function useProjectTaskRanking({ app, domainName, domainUuid, isAwaitingProvider, onRanked, quarter, year }) {
  const awaitingProviderRef = useRef(isAwaitingProvider);
  const startedRef = useRef(false);
  awaitingProviderRef.current = isAwaitingProvider;
  const work = useDashboardWork();
  const today = new Date();
  const planQuarter = quarter ?? Math.floor(today.getMonth() / 3) + 1;
  const planYear = year ?? today.getFullYear();
  const scopeKey = projectWorkScopeKey({ domainUuid, quarter: planQuarter, year: planYear });
  const queuedForScope = queuedMaintenanceSelected() && work?.runtime.scheduler.scopeKey === scopeKey;
  const durable = queuedForScope ? work.runtime.durable : null;

  useEffect(() => {
    if (!durable || !onRanked) return undefined;
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
  }, [durable, onRanked, scopeKey]);

  useEffect(() => {
    if (startedRef.current || isAwaitingProvider || !app) return undefined;
    const timer = setTimeout(() => {
      startedRef.current = true;
      if (durable) {
        _submitBuilderReconciliation(durable, { domainName, domainUuid, quarter: planQuarter, scopeKey, year: planYear });
        return;
      }
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
  }, [app, domainName, domainUuid, durable, isAwaitingProvider, onRanked, planQuarter, planYear, quarter, scopeKey, year]);
}

// ------------------------------------------------------------------------------------------
// @desc Submit the quarter's reconciliation as foreground work, so it and the rankings it plans run while the builder
//   covers the Dashboard; the ideas it plans stay maintenance and wait for the builder to close.
// @param {DurableWorkRunner} durable - The Dashboard runtime's durable runner.
// @param {Object} options - { domainName, domainUuid, quarter, scopeKey, year }.
function _submitBuilderReconciliation(durable, { domainName, domainUuid, quarter, scopeKey, year }) {
  const request = projectReconciliationRequest({ domainName, domainUuid, quarter, year }, { category: "foregroundData",
    requestedAt: Date.now() });
  durable.submit({ ...request, scopeKey })
    .then(() => logIfEnabled(`${ RANKING_LOG_LABEL } submitted the quarter's reconciliation`, { scopeKey }))
    .catch(error => logIfEnabled(`${ RANKING_LOG_LABEL } could not submit the quarter's reconciliation`, error?.message));
}
