// Create the mounted Dashboard's work runtime, browser driver, and widget mount coordinator, and keep the scheduler's
// admission conditions in step with the Dashboard: its domain and quarter scope, whether the page is hidden, whether
// an overlay holds its renders, and whether its initial load has settled. With durable work switched on, the runtime
// also saves durable jobs and keeps their history, and resumes a scope's saved work once the load gate opens or the
// scope changes after it. Everything is disposed when the Dashboard unmounts. Nothing here re-renders the Dashboard
// as jobs come and go.
import { subscribeToWidgetMountSuspension, widgetMountingSuspended } from "dashboard/widget-mount-suspension";
import { createBrowserWorkDriver } from "dashboard/work-queue/browser-work-driver";
import DashboardWorkDiagnosticsStore from "dashboard/work-queue/dashboard-work-diagnostics-store";
import { DURABLE_WORK_ENABLED } from "dashboard/work-queue/dashboard-work-features";
import { dashboardWorkHandlers, workHandlerRegistry } from "dashboard/work-queue/dashboard-work-handlers";
import { LOAD_GATE_GRACE_MILLISECONDS } from "dashboard/work-queue/dashboard-work-policy";
import DashboardWorkRepository from "dashboard/work-queue/dashboard-work-repository";
import { createDashboardWorkRuntime } from "dashboard/work-queue/dashboard-work-runtime";
import QuarterProjectWorkPlanner from "dashboard/work-queue/quarter-project-work-planner";
import WidgetMountCoordinator from "dashboard/work-queue/widget-mount-coordinator";
import { useCallback, useEffect, useRef, useState } from "react";
import { logIfEnabled } from "util/log";

// ------------------------------------------------------------------------------------------
// @desc Own the Dashboard's work runtime for as long as the Dashboard is mounted.
// @param {object} options - An object with the following properties:
//   - {object} app - Amplenote app bridge, passed to jobs in their context
//   - {boolean} [durableEnabled=DURABLE_WORK_ENABLED] - Whether to save, resume, and record durable work
//   - {boolean} enabled - False creates nothing, leaving widgets on their unscheduled mount path. Nothing is created
//     without IntersectionObserver either: the unscheduled path then mounts every widget at once, so none is stranded
//   - {string|null} scopeKey - The active domain and quarter; work scoped to an earlier one is superseded
// @returns {object} An object with the following properties:
//   - {function} reportLoadSettled - Call once the Dashboard's initial load settles; opens the maintenance gate
//     after a grace period
//   - {object|null} work - { app, mountCoordinator, planner, runtime } for DashboardWorkProvider, or null while none
//     exists; planner is null without durable work
export default function useDashboardWorkQueue({ app, durableEnabled = DURABLE_WORK_ENABLED, enabled, scopeKey }) {
  const [work, setWork] = useState(null);
  const loadSettledRef = useRef(false);

  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === "undefined") return undefined;
    const created = _createDashboardWork(app, { durableEnabled });
    if (loadSettledRef.current) created.reportLoadSettled();
    setWork(created);
    return () => {
      created.dispose();
      setWork(null);
    };
  }, [app, durableEnabled, enabled]);

  useEffect(() => {
    if (!work) return;
    work.runtime.scheduler.setScope(scopeKey);
    if (work.runtime.scheduler.conditions.loadSettled) work.recoverDurableWork();
  }, [scopeKey, work]);

  const reportLoadSettled = useCallback(() => {
    loadSettledRef.current = true;
    work?.reportLoadSettled();
  }, [work]);

  return { reportLoadSettled, work };
}

// ------------------------------------------------------------------------------------------
// @desc Compose a runtime whose admission passes run on animation frames, a mount coordinator over its scheduler,
//   and the subscriptions that feed page visibility and overlay suspension to the scheduler. With durable work on,
//   the runtime also gets a queue repository, the registered handlers, a history store, and the project work planner
//   that the reconciliation job plans with, told of every durable outcome so it can count the visit's coverage.
// @param {object} app - Amplenote app bridge.
// @param {object} options - { durableEnabled }.
// @returns {object} { app, dispose, mountCoordinator, planner, recoverDurableWork, reportLoadSettled, runtime }. app is the
//   bridge the Queue inspector reads dictionary progress through; recoverDurableWork resumes the current scope's saved
//   work, logging rather than throwing when the queue note cannot be read.
function _createDashboardWork(app, { durableEnabled }) {
  let runtime = null;
  const driver = createBrowserWorkDriver({ runReady: () => runtime?.scheduler.runReady() });
  const planner = durableEnabled ? new QuarterProjectWorkPlanner() : null;
  const durableParts = durableEnabled ? { diagnosticsStore: new DashboardWorkDiagnosticsStore({ app }),
    handlers: workHandlerRegistry(dashboardWorkHandlers({ planner })), repository: new DashboardWorkRepository({ app }) } : {};
  runtime = createDashboardWorkRuntime({ app, requestRun: driver.requestRun, ...durableParts });
  const unsubscribeOutcomes = runtime.durable ? runtime.durable.subscribeOutcomes(outcome => planner.recordOutcome(outcome)) : () => {};
  const recoverDurableWork = () => {
    if (!runtime.durable) return;
    runtime.durable.recover().catch(error => logIfEnabled("[dashboard-work] could not resume saved work", error?.message));
  };
  const { scheduler } = runtime;
  const mountCoordinator = new WidgetMountCoordinator({ scheduler });
  scheduler.setConditions({ hidden: driver.hidden(), overlayHeld: widgetMountingSuspended() });
  const unsubscribeVisibility = driver.subscribeVisibility(hidden => scheduler.setConditions({ hidden }));
  const unsubscribeSuspension = subscribeToWidgetMountSuspension(overlayHeld => scheduler.setConditions({ overlayHeld }));
  let loadGateTimer = null;
  const reportLoadSettled = () => {
    if (loadGateTimer !== null || scheduler.conditions.loadSettled) return;
    loadGateTimer = setTimeout(() => {
      scheduler.setConditions({ loadSettled: true });
      recoverDurableWork();
    }, LOAD_GATE_GRACE_MILLISECONDS);
  };
  const dispose = () => {
    clearTimeout(loadGateTimer);
    unsubscribeOutcomes();
    unsubscribeSuspension();
    unsubscribeVisibility();
    mountCoordinator.dispose();
    runtime.dispose();
    driver.dispose();
  };
  return { app, dispose, mountCoordinator, planner, recoverDurableWork, reportLoadSettled, runtime };
}
