// Feed the admin Queue inspector a live view of the Dashboard's work runtime while it is open. The view is re-read
// when the scheduler, its diagnostics, or the widget mount coordinator report a change, at most four times a second,
// and once a second regardless so ages keep advancing while a stalled queue reports nothing. Subscriptions exist only
// while the inspector is open. Reading is passive: it never enqueues work or changes priority.
import { queueInspectorView } from "dashboard/work-queue/dashboard-queue-inspector-model";
import { useEffect, useState } from "react";

// The shortest interval between two refreshes, holding live updates to four a second.
export const INSPECTOR_UPDATE_MILLISECONDS = 250;
// How often the view is re-read with no change reported, so ages and waiting times keep moving.
const INSPECTOR_TICK_MILLISECONDS = 1000;

// ------------------------------------------------------------------------------------------
// @desc Subscribe to a work runtime while enabled and return its latest throttled view.
// @param {object|null} work - { mountCoordinator, runtime } as the Dashboard provides it, or null when none is running.
// @param {object} [options] - An object with the following properties:
//   - {function} [clock=Date.now] - Returns epoch milliseconds
//   - {boolean} [enabled=true] - False unsubscribes and returns null
//   - {number} [throttleMilliseconds=INSPECTOR_UPDATE_MILLISECONDS] - Shortest interval between two refreshes
// @returns {object|null} From queueInspectorView, or null while disabled or without a runtime.
export default function useDashboardQueueDiagnostics(work, { clock = Date.now, enabled = true,
    throttleMilliseconds = INSPECTOR_UPDATE_MILLISECONDS } = {}) {
  const [view, setView] = useState(null);

  useEffect(() => {
    if (!enabled || !work) {
      setView(null);
      return undefined;
    }
    let lastRefreshAt = clock();
    let pendingTimer = null;
    const refresh = () => {
      pendingTimer = null;
      lastRefreshAt = clock();
      setView(queueInspectorView(work, clock));
    };
    const changed = () => {
      if (pendingTimer !== null) return;
      pendingTimer = setTimeout(refresh, Math.max(0, lastRefreshAt + throttleMilliseconds - clock()));
    };
    setView(queueInspectorView(work, clock));
    const tickTimer = setInterval(changed, INSPECTOR_TICK_MILLISECONDS);
    const unsubscribers = [work.runtime.scheduler.subscribe(changed), work.runtime.diagnostics.subscribe(changed),
      work.mountCoordinator?.subscribe(changed)];
    return () => {
      clearTimeout(pendingTimer);
      clearInterval(tickTimer);
      for (const unsubscribe of unsubscribers) unsubscribe?.();
    };
  }, [clock, enabled, throttleMilliseconds, work]);

  return view;
}
