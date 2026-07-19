import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { logIfEnabled } from "util/log";
import { snapDashboardAction } from "util/plausible";

// Context carries { reportError, reportLoaded } down to each widget cell. Defaults to null so the
// hooks below no-op when a cell is rendered outside a provider (e.g. in isolation tests).
export const DashboardLoadContext = createContext(null);
export const DASHBOARD_WIDGET_LOADED_EVENT = "dashboard:widget-loaded";

// ------------------------------------------------------------------------------------------
// @desc Dispatch the one-shot widget data-readiness event that external tools (notably the memory
//   measurement harness) can observe without coupling to React internals.
// @param {string} widgetId - Stable dashboard widget id.
// @param {"loaded"|"error"} outcome - Whether the initial load settled cleanly or with a handled error.
export function dispatchWidgetLoadedEvent(widgetId, outcome = "loaded") {
  if (typeof window === "undefined" || !widgetId) return;
  window.dispatchEvent(new CustomEvent(DASHBOARD_WIDGET_LOADED_EVENT, { detail: { outcome, widgetId } }));
}

// ------------------------------------------------------------------------------------------
// @desc Owns the load-settling state for one dashboard render and returns the reporter callbacks
//   that widget cells use to announce they mounted (loaded) or crashed (errored). A widget is
//   "settled" once it has either loaded or errored; when every expected widget has settled, exactly
//   one Plausible event fires: "dashboardLoadSuccess" if all loaded cleanly, otherwise
//   "dashboardLoadError". The tracker resets synchronously during render whenever the set of
//   rendered widgets changes (layout edit, drag) so a later layout gets its own single event.
//   Resetting during render (rather than in an effect) matters because child mount effects run
//   before the parent's effects; a render-time reset lands before children report into fresh sets.
// @param {string[]} widgetIds - Widget ids for the cells actually rendered this pass
// @param {Object} [options] - Optional callbacks.
//   - {function({ erroredIds: string[], expectedCount: number, errorCount: number }): void} [onSettle]
//     Called exactly once per widget set, right after the aggregate event fires. Used by the crash
//     breadcrumb to stamp a clean load. Held in a ref so passing an inline callback does not churn deps.
// @returns {Object} An object with the following properties:
//   - {function} reportError - Call with a widgetId when its error boundary catches a crash
//   - {function} reportLoaded - Call with a widgetId when its cell finishes its first mount
export function useDashboardLoadTracker(widgetIds, options = {}) {
  const key = widgetIds.join('|');
  const stateRef = useRef({ deferred: new Set(), errored: new Set(), expected: [], fired: false, key: null, loaded: new Set() });
  if (stateRef.current.key !== key) {
    stateRef.current = { deferred: new Set(), errored: new Set(), expected: widgetIds.slice(), fired: false, key, loaded: new Set() };
  }
  const onSettleRef = useRef(options.onSettle);
  onSettleRef.current = options.onSettle;

  // ------------------------------------------------------------------------------------------
  // @desc Fire the aggregate event once, but only after every expected widget has settled.
  //   No-op while any widget is still pending, when nothing is expected, or after it has fired.
  const maybeFire = useCallback(() => {
    const state = stateRef.current;
    if (state.fired || state.expected.length === 0) return;
    // A widget is settled once it has loaded, errored, or been deferred (rendered as a lazy-mount
    // placeholder because it is not yet near the viewport). Deferred widgets let the aggregate event
    // fire on the initially-visible set instead of waiting for below-the-fold widgets to scroll in.
    for (const id of state.expected) {
      if (!state.loaded.has(id) && !state.errored.has(id) && !state.deferred.has(id)) return;
    }
    state.fired = true;
    const deferredCount = state.expected.filter(id => !state.loaded.has(id) && !state.errored.has(id)).length;
    if (state.errored.size > 0) {
      logIfEnabled(`[dashboard] ${ state.errored.size }/${ state.expected.length } components failed to load:`, [...state.errored]);
      snapDashboardAction("dashboardLoadError", { deferredCount, errorCount: state.errored.size, widgetCount: state.expected.length });
    } else {
      logIfEnabled(`[dashboard] all ${ state.expected.length } components settled successfully (${ deferredCount } deferred until scrolled into view)`);
      snapDashboardAction("dashboardLoadSuccess", { deferredCount, widgetCount: state.expected.length });
    }
    onSettleRef.current?.({ deferredCount, errorCount: state.errored.size, erroredIds: [...state.errored], expectedCount: state.expected.length });
  }, []);

  return useMemo(() => ({
    reportDeferred: (widgetId) => { stateRef.current.deferred.add(widgetId); maybeFire(); },
    reportError: (widgetId) => { stateRef.current.errored.add(widgetId); maybeFire(); },
    reportLoaded: (widgetId) => { stateRef.current.loaded.add(widgetId); maybeFire(); },
  }), [maybeFire]);
}

// ------------------------------------------------------------------------------------------
// @desc Report that a widget mounted successfully, exactly once per mount. Rendered inside the
//   widget's error boundary so that a widget which throws during its initial render never commits
//   this reporter and therefore never counts as loaded — the boundary reports the error instead.
// @param {string} widgetId - The id of the widget that just mounted
export function useReportWidgetLoaded(widgetId) {
  const tracker = useContext(DashboardLoadContext);
  const reportedRef = useRef(false);
  useEffect(() => {
    if (reportedRef.current) return;
    reportedRef.current = true;
    tracker?.reportLoaded(widgetId);
  }, []);
}

// ------------------------------------------------------------------------------------------
// @desc Emit a browser CustomEvent exactly once when a widget's initial data load has settled.
//   This is separate from useReportWidgetLoaded, which only means React mounted the cell.
// @param {string} widgetId - The id of the widget whose data lifecycle is being reported.
// @param {boolean} isReady - True when initial data work has completed successfully.
// @param {boolean} [hasError=false] - True when initial data work ended in a handled error state.
export function useWidgetLoadedEvent(widgetId, isReady, hasError = false) {
  const reportedRef = useRef(false);
  useEffect(() => {
    if (reportedRef.current || (!isReady && !hasError)) return;
    reportedRef.current = true;
    dispatchWidgetLoadedEvent(widgetId, hasError ? "error" : "loaded");
  }, [hasError, isReady, widgetId]);
}

// ------------------------------------------------------------------------------------------
// @desc Report that a widget has been deferred (rendered as a lazy-mount placeholder rather than
//   mounted, because it is not yet near the viewport). Counts the widget as settled so the aggregate
//   load event can fire on the initially-visible widgets. If the widget later scrolls into view and
//   mounts, its own useReportWidgetLoaded takes over — by then the event has already fired, which is
//   the intended semantics: the event reflects the initial paint.
// @param {string} widgetId - The id of the widget being deferred.
export function useReportWidgetDeferred(widgetId) {
  const tracker = useContext(DashboardLoadContext);
  const reportedRef = useRef(false);
  useEffect(() => {
    if (reportedRef.current) return;
    reportedRef.current = true;
    tracker?.reportDeferred(widgetId);
  }, []);
}
