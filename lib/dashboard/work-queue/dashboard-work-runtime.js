// Compose the Dashboard's work runtime: one resource budget, one diagnostics record, one scheduler that admits work
// through the budget and reports to the diagnostics, and the dispatchers through which a running job's provider and
// app calls take their own permits. A mounted Dashboard creates one runtime and shares it with its widgets and Plan
// Builder. Durable work is optional: given a queue repository and handlers, the runtime also saves, recovers, and
// retries durable jobs, and given a history store it keeps their outcomes; without them it holds only in-memory work.
import { createAppDispatch } from "dashboard/work-queue/dashboard-app-dispatch";
import { createProviderDispatch } from "dashboard/work-queue/dashboard-provider-dispatch";
import DashboardResourceBudget from "dashboard/work-queue/dashboard-resource-budget";
import DashboardWorkDiagnostics from "dashboard/work-queue/dashboard-work-diagnostics";
import DashboardWorkScheduler from "dashboard/work-queue/dashboard-work-scheduler";
import DurableWorkRunner from "dashboard/work-queue/durable-work-runner";
import { cancelWorkTimer, startWorkTimer } from "dashboard/work-queue/work-timers";

// ----------------------------------------------------------------------------------------------
// @desc Create a work runtime.
// @param {object} [options] - An object with the following properties:
//   - {object|null} [app=null] - Host-compatible Amplenote API, passed to each job's run in its context
//   - {function} [clock=Date.now] - Returns epoch milliseconds
//   - {DashboardWorkDiagnosticsStore|null} [diagnosticsStore=null] - Keeps durable job outcomes across sessions
//   - {Map<string, object>|null} [handlers=null] - From workHandlerRegistry; durable work needs it and a repository
//   - {object} [limits] - Permits per resource; defaults to the policy's RESOURCE_LIMITS
//   - {DashboardWorkRepository|null} [repository=null] - Durable job records
//   - {function} [requestRun] - Arranges an admission pass; defaults to a microtask
//   - {function} [setTimer=startWorkTimer] - Schedules retries; clearTimer cancels them
// @returns {object} An object with the following properties:
//   - {DashboardResourceBudget} budget - Permits per resource
//   - {DashboardWorkDiagnostics} diagnostics - Recent events, counters, and timings
//   - {DashboardWorkDiagnosticsStore|null} diagnosticsStore - As given
//   - {function} dispose - Cancels every job, releases durable claims, and saves buffered history
//   - {DurableWorkRunner|null} durable - Saves and runs durable jobs, when a repository and handlers were given
//   - {function} exportSnapshot - ({ mountSnapshot } = {}) => a sanitized copy of the session, diagnostics, scheduler
//     state, and the given widget mount snapshot
//   - {DashboardWorkRepository|null} repository - As given
//   - {DashboardWorkScheduler} scheduler - Admits and runs jobs
//   - {object} session - { sessionId, startedAt }: identifies this runtime in an inspector, export, or claimed job
export function createDashboardWorkRuntime({ app = null, clearTimer = cancelWorkTimer, clock = Date.now, diagnosticsStore = null,
    handlers = null, limits, repository = null, requestRun, setTimer = startWorkTimer } = {}) {
  const budget = new DashboardResourceBudget({ limits });
  const diagnostics = new DashboardWorkDiagnostics({ clock });
  const appDispatch = app ? createAppDispatch({ app, budget }) : null;
  const providerDispatch = createProviderDispatch({ budget });
  const context = { app, appDispatch, clock, providerDispatch };
  const scheduler = new DashboardWorkScheduler({ budget, clock, context, diagnostics, requestRun });
  const session = { sessionId: Math.random().toString(36).slice(2, 10), startedAt: clock() };
  if (diagnosticsStore) diagnosticsStore.sessionId = session.sessionId;
  const durable = repository && handlers ? new DurableWorkRunner({ clearTimer, clock, diagnosticsStore, handlers,
    ownerId: session.sessionId, repository, scheduler, setTimer }) : null;
  const dispose = () => {
    scheduler.dispose();
    durable?.dispose();
    diagnosticsStore?.dispose();
  };
  const exportSnapshot = ({ mountSnapshot = null } = {}) => diagnostics.exportSnapshot(scheduler.snapshot(), { mountSnapshot, session });
  return { budget, diagnostics, diagnosticsStore, dispose, durable, exportSnapshot, repository, scheduler, session };
}
