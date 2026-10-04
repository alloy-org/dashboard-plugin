// Feed the admin Queue inspector a live view of the Dashboard's work runtime while it is open. The view is re-read
// when the scheduler, its diagnostics, or the widget mount coordinator report a change, at most four times a second,
// and once a second regardless so ages keep advancing while a stalled queue reports nothing. Subscriptions exist only
// while the inspector is open. Saved jobs and durable history are read from their notes only when the inspector opens
// or the operator asks to refresh, directly rather than as queue work, so a stalled queue cannot hold up its own
// diagnosis; so is each dictionary term's evidence and refinement progress. Reading is passive: it never enqueues work
// or changes priority.
import { queueInspectorView } from "dashboard/work-queue/dashboard-queue-inspector-model";
import { readTermProgress } from "plan-wizard/stack-rank/dictionary-term-schedule";
import { useCallback, useEffect, useState } from "react";

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

// ------------------------------------------------------------------------------------------
// @desc Read a work runtime's saved jobs, durable history, and dictionary term progress for its current scope when first
//   called, and again on refresh. A runtime without durable work reports all three as unavailable without reading anything.
// @param {object|null} work - { app, mountCoordinator, runtime } as the Dashboard provides it, or null.
// @returns {object} { durable, loading, refresh }: durable is null until the first read finishes, then { available,
//   error, history, jobs, readAt, scopeKey, terms, unreadableRecords }, history being from readHistory or null, and terms
//   { error, rows } with rows from termProgressRows, or null without an app to read through.
export function useDashboardQueueHistory(work) {
  const [durable, setDurable] = useState(null);
  const [loading, setLoading] = useState(false);
  const runtime = work?.runtime || null;
  const app = work?.app || null;

  const refresh = useCallback(async () => {
    if (!runtime?.repository) {
      setDurable({ available: false, error: null, history: null, jobs: [], readAt: null, scopeKey: null, terms: null, unreadableRecords: 0 });
      return;
    }
    setLoading(true);
    const scopeKey = runtime.scheduler.scopeKey;
    const [queueRead, history, terms] = await Promise.all([
      runtime.repository.readAll(scopeKey).then(result => ({ result }), error => ({ error })),
      runtime.diagnosticsStore ? runtime.diagnosticsStore.readHistory(scopeKey) : Promise.resolve(null),
      app ? readTermProgress(app, { now: new Date() }).then(rows => ({ error: null, rows }),
        error => ({ error: String(error?.message || error), rows: [] })) : Promise.resolve(null),
    ]);
    setDurable({ available: !queueRead.error, error: queueRead.error ? String(queueRead.error.message || queueRead.error) : null,
      history, jobs: queueRead.result?.jobs || [], readAt: Date.now(), scopeKey, terms,
      unreadableRecords: queueRead.result?.unreadableRecords || 0 });
    setLoading(false);
  }, [app, runtime]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { durable, loading, refresh };
}
