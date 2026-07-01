import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { logIfEnabled } from "util/log";
import { snapDashboardAction } from "util/plausible";

// Context carries { reportError, reportLoaded } down to each widget cell. Defaults to null so the
// hooks below no-op when a cell is rendered outside a provider (e.g. in isolation tests).
export const DashboardLoadContext = createContext(null);

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
// @returns {Object} An object with the following properties:
//   - {function} reportError - Call with a widgetId when its error boundary catches a crash
//   - {function} reportLoaded - Call with a widgetId when its cell finishes its first mount
export function useDashboardLoadTracker(widgetIds) {
  const key = widgetIds.join('|');
  const stateRef = useRef({ errored: new Set(), expected: [], fired: false, key: null, loaded: new Set() });
  if (stateRef.current.key !== key) {
    stateRef.current = { errored: new Set(), expected: widgetIds.slice(), fired: false, key, loaded: new Set() };
  }

  // ------------------------------------------------------------------------------------------
  // @desc Fire the aggregate event once, but only after every expected widget has settled.
  //   No-op while any widget is still pending, when nothing is expected, or after it has fired.
  const maybeFire = useCallback(() => {
    const state = stateRef.current;
    if (state.fired || state.expected.length === 0) return;
    for (const id of state.expected) {
      if (!state.loaded.has(id) && !state.errored.has(id)) return;
    }
    state.fired = true;
    if (state.errored.size > 0) {
      logIfEnabled(`[dashboard] ${ state.errored.size }/${ state.expected.length } components failed to load:`, [...state.errored]);
      snapDashboardAction("dashboardLoadError", { errorCount: state.errored.size, widgetCount: state.expected.length });
    } else {
      logIfEnabled(`[dashboard] all ${ state.expected.length } components finished loading successfully`);
      snapDashboardAction("dashboardLoadSuccess", { widgetCount: state.expected.length });
    }
  }, []);

  return useMemo(() => ({
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
