// Create the mounted Dashboard's work runtime, browser driver, and widget mount coordinator, and keep the scheduler's
// admission conditions in step with the Dashboard: its domain and quarter scope, whether the page is hidden, whether
// an overlay holds its renders, and whether its initial load has settled. Everything is disposed when the Dashboard
// unmounts. Nothing here re-renders the Dashboard as jobs come and go.
import { subscribeToWidgetMountSuspension, widgetMountingSuspended } from "dashboard/widget-mount-suspension";
import { createBrowserWorkDriver } from "dashboard/work-queue/browser-work-driver";
import { LOAD_GATE_GRACE_MILLISECONDS } from "dashboard/work-queue/dashboard-work-policy";
import { createDashboardWorkRuntime } from "dashboard/work-queue/dashboard-work-runtime";
import WidgetMountCoordinator from "dashboard/work-queue/widget-mount-coordinator";
import { useCallback, useEffect, useRef, useState } from "react";

// ------------------------------------------------------------------------------------------
// @desc Own the Dashboard's work runtime for as long as the Dashboard is mounted.
// @param {object} options - An object with the following properties:
//   - {object} app - Amplenote app bridge, passed to jobs in their context
//   - {boolean} enabled - False creates nothing, leaving widgets on their unscheduled mount path. Nothing is created
//     without IntersectionObserver either: the unscheduled path then mounts every widget at once, so none is stranded
//   - {string|null} scopeKey - The active domain and quarter; work scoped to an earlier one is superseded
// @returns {object} An object with the following properties:
//   - {function} reportLoadSettled - Call once the Dashboard's initial load settles; opens the maintenance gate
//     after a grace period
//   - {object|null} work - { mountCoordinator, runtime } for DashboardWorkProvider, or null while none exists
export default function useDashboardWorkQueue({ app, enabled, scopeKey }) {
  const [work, setWork] = useState(null);
  const loadSettledRef = useRef(false);

  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === "undefined") return undefined;
    const created = _createDashboardWork(app);
    if (loadSettledRef.current) created.reportLoadSettled();
    setWork(created);
    return () => {
      created.dispose();
      setWork(null);
    };
  }, [app, enabled]);

  useEffect(() => {
    work?.runtime.scheduler.setScope(scopeKey);
  }, [scopeKey, work]);

  const reportLoadSettled = useCallback(() => {
    loadSettledRef.current = true;
    work?.reportLoadSettled();
  }, [work]);

  return { reportLoadSettled, work };
}

// ------------------------------------------------------------------------------------------
// @desc Compose a runtime whose admission passes run on animation frames, a mount coordinator over its scheduler,
//   and the subscriptions that feed page visibility and overlay suspension to the scheduler.
// @param {object} app - Amplenote app bridge.
// @returns {object} { dispose, mountCoordinator, reportLoadSettled, runtime }.
function _createDashboardWork(app) {
  let runtime = null;
  const driver = createBrowserWorkDriver({ runReady: () => runtime?.scheduler.runReady() });
  runtime = createDashboardWorkRuntime({ app, requestRun: driver.requestRun });
  const { scheduler } = runtime;
  const mountCoordinator = new WidgetMountCoordinator({ scheduler });
  scheduler.setConditions({ hidden: driver.hidden(), overlayHeld: widgetMountingSuspended() });
  const unsubscribeVisibility = driver.subscribeVisibility(hidden => scheduler.setConditions({ hidden }));
  const unsubscribeSuspension = subscribeToWidgetMountSuspension(overlayHeld => scheduler.setConditions({ overlayHeld }));
  let loadGateTimer = null;
  const reportLoadSettled = () => {
    if (loadGateTimer !== null || scheduler.conditions.loadSettled) return;
    loadGateTimer = setTimeout(() => scheduler.setConditions({ loadSettled: true }), LOAD_GATE_GRACE_MILLISECONDS);
  };
  const dispose = () => {
    clearTimeout(loadGateTimer);
    unsubscribeSuspension();
    unsubscribeVisibility();
    mountCoordinator.dispose();
    runtime.dispose();
    driver.dispose();
  };
  return { dispose, mountCoordinator, reportLoadSettled, runtime };
}
