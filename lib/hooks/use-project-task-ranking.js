// Refresh the task rankings of the current quarter's projects once Plan Builder opens, so a project the builder
// shows is associated with the tasks that belong to it. The pass waits for a moment when the builder is not
// waiting on the generative provider, because it first refreshes the user terms dictionary through that provider,
// and without a Jev key the provider's fast model also does the rating.
import { refreshStaleProjectRankings } from "plan-wizard/stack-rank/refresh-stale-project-rankings";
import { useEffect, useRef } from "react";
import { logIfEnabled } from "util/log";

const RANKING_LOG_LABEL = "[project-task-ranking]";
// How long the builder must sit without a provider request before the pass starts. Long enough that the request
// following a page change has begun, so the pass does not start in the gap between two of the builder's calls.
const RANKING_IDLE_DELAY_MS = 3000;

// ------------------------------------------------------------------------------------------
// @desc Start one ranking pass per mounted Plan Builder, after the builder has been idle for RANKING_IDLE_DELAY_MS.
//   The pass outlives the builder: it writes only the project task store, and stopping between projects would only
//   leave work for the next pass. A pass rating with the fast model does stop once the builder next waits on the
//   provider, which it learns from a ref kept current across renders. Failures are logged rather than shown, since
//   nothing in the builder waits on it.
// @param {Object} options - An object with the following properties:
//   - {Object} app - Amplenote app bridge
//   - {string|null} domainName - Display name of the active task domain
//   - {string|null} domainUuid - UUID of the active task domain
//   - {boolean} isAwaitingProvider - True while the builder waits on a generative provider response
export function useProjectTaskRanking({ app, domainName, domainUuid, isAwaitingProvider }) {
  const awaitingProviderRef = useRef(isAwaitingProvider);
  const startedRef = useRef(false);
  awaitingProviderRef.current = isAwaitingProvider;
  useEffect(() => {
    if (startedRef.current || isAwaitingProvider || !app) return undefined;
    const timer = setTimeout(() => {
      startedRef.current = true;
      refreshStaleProjectRankings(app, { domainName, domainUuid, isProviderBusy: () => awaitingProviderRef.current })
        .then(result => logIfEnabled(`${ RANKING_LOG_LABEL } pass finished`, result))
        .catch(error => logIfEnabled(`${ RANKING_LOG_LABEL } pass failed`, error?.message));
    }, RANKING_IDLE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [app, domainName, domainUuid, isAwaitingProvider]);
}
