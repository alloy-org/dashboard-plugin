// Create the mounted Dashboard's work runtime, browser driver, and widget mount coordinator, and keep the scheduler's
// admission conditions in step with the Dashboard: its domain and quarter scope, whether the page is hidden, whether
// an overlay holds its renders, whether its initial load has settled, and whether the user is scrolling, touching, or
// typing in it. With durable work switched on, the runtime also saves durable jobs and keeps their history, and resumes
// a scope's saved work once the load gate opens or the scope changes after it. A main-thread lag monitor runs alongside
// the interaction tracker, for the Queue inspector's export. Everything is disposed when the Dashboard unmounts.
// Nothing here re-renders the Dashboard as jobs come and go.
import { subscribeToWidgetMountSuspension, widgetMountingSuspended } from "dashboard/widget-mount-suspension";
import { createBrowserWorkDriver } from "dashboard/work-queue/browser-work-driver";
import DashboardWorkDiagnosticsStore from "dashboard/work-queue/dashboard-work-diagnostics-store";
import { DURABLE_WORK_ENABLED } from "dashboard/work-queue/dashboard-work-features";
import { dashboardWorkHandlers, workHandlerRegistry } from "dashboard/work-queue/dashboard-work-handlers";
import { LOAD_GATE_CONTENT_WAIT_MILLISECONDS, LOAD_GATE_GRACE_MILLISECONDS } from "dashboard/work-queue/dashboard-work-policy";
import DashboardWorkRepository from "dashboard/work-queue/dashboard-work-repository";
import { createDashboardWorkRuntime } from "dashboard/work-queue/dashboard-work-runtime";
import { createInteractionTracker } from "dashboard/work-queue/interaction-tracker";
import MainThreadLagMonitor from "dashboard/work-queue/main-thread-lag-monitor";
import QuarterProjectWorkPlanner from "dashboard/work-queue/quarter-project-work-planner";
import WidgetMountCoordinator from "dashboard/work-queue/widget-mount-coordinator";
import { useCallback, useEffect, useRef, useState } from "react";
import { CallTimingMeter } from "util/call-timing-meter";
import { logIfEnabled } from "util/log";

// ------------------------------------------------------------------------------------------
// @desc Own the Dashboard's work runtime for as long as the Dashboard is mounted.
// @param {object} options - An object with the following properties:
//   - {object} app - Amplenote app bridge, passed to jobs in their context
//   - {boolean} [durableEnabled=DURABLE_WORK_ENABLED] - Whether to save, resume, and record durable work
//   - {boolean} enabled - Whether to schedule widget mounts. False, or a missing IntersectionObserver, leaves widgets
//     on their unscheduled path; durable work still gets a runtime independently of mounting
//   - {string|null} scopeKey - The active domain and quarter; work scoped to an earlier one is superseded
// @returns {object} An object with the following properties:
//   - {function} reportLoadSettled - (onLoadGateOpened = null) => void. Call once the Dashboard's initial load settles;
//     opens the maintenance gate after a grace period, once the widgets in the viewport have rendered their content or
//     LOAD_GATE_CONTENT_WAIT_MILLISECONDS have passed, and then calls onLoadGateOpened
//   - {object|null} work - { app, mainThreadMonitor, mountCoordinator, planner, runtime } for DashboardWorkProvider, or
//     null while none exists; planner is null without durable work
export default function useDashboardWorkQueue({ app, durableEnabled = DURABLE_WORK_ENABLED, enabled, scopeKey }) {
  const [work, setWork] = useState(null);
  const loadSettledRef = useRef(false);
  const loadGateOpenedRef = useRef(null);

  useEffect(() => {
    const mountingEnabled = enabled && typeof IntersectionObserver !== "undefined";
    if (!durableEnabled && !mountingEnabled) return undefined;
    const created = _createDashboardWork(app, { durableEnabled, mountingEnabled });
    if (loadSettledRef.current) created.reportLoadSettled(() => loadGateOpenedRef.current?.());
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

  const reportLoadSettled = useCallback((onLoadGateOpened = null) => {
    loadSettledRef.current = true;
    loadGateOpenedRef.current = onLoadGateOpened;
    work?.reportLoadSettled(() => loadGateOpenedRef.current?.());
  }, [work]);

  return { reportLoadSettled, work };
}

// ------------------------------------------------------------------------------------------
// @desc Compose a runtime whose admission passes run on animation frames, a mount coordinator over its scheduler,
//   and the subscriptions that feed page visibility and overlay suspension to the scheduler. With durable work on,
//   the runtime also gets a queue repository, the registered handlers, a history store, and the project work planner
//   that the reconciliation job plans with, told of every durable outcome so it can count the visit's coverage. The
//   queue repository and history store time their note calls on one meter that the runtime exports.
// @param {object} app - Amplenote app bridge.
// @param {object} options - { durableEnabled, mountingEnabled }: independent maintenance and mounting selection.
// @returns {object} { app, dispose, mainThreadMonitor, mountCoordinator, planner, recoverDurableWork, reportLoadSettled,
//   runtime }. app is the
//   bridge the Queue inspector reads dictionary progress through; recoverDurableWork resumes the current scope's saved
//   work, logging rather than throwing when the queue note cannot be read.
function _createDashboardWork(app, { durableEnabled, mountingEnabled }) {
  let runtime = null;
  const driver = createBrowserWorkDriver({ runReady: () => runtime?.scheduler.runReady() });
  const planner = durableEnabled ? new QuarterProjectWorkPlanner() : null;
  const bookkeepingMeter = new CallTimingMeter();
  const durableParts = durableEnabled ? { diagnosticsStore: new DashboardWorkDiagnosticsStore({ app, callTimingMeter: bookkeepingMeter }),
    handlers: workHandlerRegistry(dashboardWorkHandlers({ planner })),
    repository: new DashboardWorkRepository({ app, callTimingMeter: bookkeepingMeter }) } : {};
  runtime = createDashboardWorkRuntime({ app, bookkeepingMeter, requestRun: driver.requestRun, ...durableParts });
  const { dispose: disposeLagMonitoring, mainThreadMonitor } = _startMainThreadMonitoring(runtime, driver);
  const unsubscribeOutcomes = runtime.durable ? runtime.durable.subscribeOutcomes(outcome => planner.recordOutcome(outcome)) : () => {};
  const recoverDurableWork = () => {
    if (!runtime.durable) return;
    runtime.durable.recover().catch(error => logIfEnabled("[dashboard-work] could not resume saved work", error?.message));
  };
  const { scheduler } = runtime;
  const mountCoordinator = mountingEnabled ? new WidgetMountCoordinator({ scheduler }) : null;
  scheduler.setConditions({ hidden: driver.hidden(), overlayHeld: widgetMountingSuspended() });
  const unsubscribeVisibility = driver.subscribeVisibility(hidden => scheduler.setConditions({ hidden }));
  const unsubscribeSuspension = subscribeToWidgetMountSuspension(overlayHeld => scheduler.setConditions({ overlayHeld }));
  const loadGate = _loadGate({ mountCoordinator, recoverDurableWork, scheduler });
  const reportLoadSettled = loadGate.reportLoadSettled;
  const dispose = () => {
    loadGate.dispose();
    disposeLagMonitoring();
    unsubscribeOutcomes();
    unsubscribeSuspension();
    unsubscribeVisibility();
    mountCoordinator?.dispose();
    runtime.dispose();
    driver.dispose();
  };
  return { app, dispose, mainThreadMonitor, mountCoordinator, planner, recoverDurableWork, reportLoadSettled, runtime };
}

// ------------------------------------------------------------------------------------------
// @desc The maintenance load gate. Once the Dashboard reports its load settled and the grace period has passed, the
//   gate waits for every widget in the viewport to render its content, up to LOAD_GATE_CONTENT_WAIT_MILLISECONDS, then
//   opens: the scheduler may admit maintenance, the scope's saved work resumes, and the callback the settle report
//   named is called, which submits the visit's own maintenance. Without a mount coordinator there is nothing to wait
//   for, and the gate opens when the grace period ends.
// @param {object} options - { mountCoordinator, recoverDurableWork, scheduler }: mountCoordinator may be null.
// @returns {object} An object with the following properties:
//   - {function} dispose - Cancels the gate's timers and its subscription to the mount coordinator
//   - {function} reportLoadSettled - (onLoadGateOpened = null) => void; the latest callback given is the one called,
//     at once when the gate is already open
function _loadGate({ mountCoordinator, recoverDurableWork, scheduler }) {
  let graceTimer = null;
  let contentWaitTimer = null;
  let onLoadGateOpened = null;
  let unsubscribeContent = () => {};
  const stopWaiting = () => {
    clearTimeout(graceTimer);
    clearTimeout(contentWaitTimer);
    unsubscribeContent();
    unsubscribeContent = () => {};
  };
  const openGate = reason => {
    stopWaiting();
    if (scheduler.conditions.loadSettled) return;
    logIfEnabled("[dashboard-work] maintenance gate opened", { reason });
    scheduler.setConditions({ loadSettled: true });
    recoverDurableWork();
    onLoadGateOpened?.();
  };
  const openOnceVisibleContentRenders = () => {
    if (!mountCoordinator?.visibleContentPending()) {
      openGate("loadSettled");
      return;
    }
    contentWaitTimer = setTimeout(() => openGate("contentWaitExpired"), LOAD_GATE_CONTENT_WAIT_MILLISECONDS);
    unsubscribeContent = mountCoordinator.subscribe(() => {
      if (!mountCoordinator.visibleContentPending()) openGate("visibleContentRendered");
    });
  };
  const reportLoadSettled = (callback = null) => {
    onLoadGateOpened = callback;
    if (scheduler.conditions.loadSettled) {
      onLoadGateOpened?.();
      return;
    }
    if (graceTimer !== null) return;
    graceTimer = setTimeout(openOnceVisibleContentRenders, LOAD_GATE_GRACE_MILLISECONDS);
  };
  return { dispose: stopWaiting, reportLoadSettled };
}

// ------------------------------------------------------------------------------------------
// @desc Start tracking interactions and main-thread lag. Each interaction's start and end is passed to the scheduler,
//   which holds new maintenance until the user has been quiet for a second. The lag monitor credits each stall to the
//   runtime's jobs that could have caused it, and reports that stall so the finished attempt can record how much of
//   its elapsed time blocked the main thread. Timer samples are skipped while the driver reports the page hidden.
// @param {object} runtime - From createDashboardWorkRuntime.
// @param {object} driver - From createBrowserWorkDriver.
// @returns {object} { dispose, mainThreadMonitor }.
function _startMainThreadMonitoring(runtime, driver) {
  const interactionTracker = createInteractionTracker({ onInteractingChange: interacting => runtime.scheduler.setConditions({ interacting }) });
  const mainThreadMonitor = new MainThreadLagMonitor({ activeJobTypesSince: runtime.activeJobTypesSince, hidden: driver.hidden,
    interactionTracker, onStall: stall => runtime.diagnostics.attributeMainThreadStall(stall) });
  mainThreadMonitor.start();
  const dispose = () => {
    mainThreadMonitor.dispose();
    interactionTracker.dispose();
  };
  return { dispose, mainThreadMonitor };
}
