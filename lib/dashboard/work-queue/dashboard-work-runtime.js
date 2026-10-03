// Compose the Dashboard's work runtime: one resource budget, one diagnostics record, and one scheduler that admits
// work through the budget and reports to the diagnostics. A mounted Dashboard creates one runtime and shares it with
// its widgets and Plan Builder. The runtime keeps no durable state, so it works the same whether or not queue
// persistence exists.
import DashboardResourceBudget from "work-queue/dashboard-resource-budget";
import DashboardWorkDiagnostics from "work-queue/dashboard-work-diagnostics";
import DashboardWorkScheduler from "work-queue/dashboard-work-scheduler";

// ----------------------------------------------------------------------------------------------
// @desc Create a work runtime.
// @param {object} [options] - An object with the following properties:
//   - {object|null} [app=null] - Host-compatible Amplenote API, passed to each job's run in its context
//   - {function} [clock=Date.now] - Returns epoch milliseconds
//   - {object} [limits] - Permits per resource; defaults to the policy's RESOURCE_LIMITS
//   - {function} [requestRun] - Arranges an admission pass; defaults to a microtask
// @returns {object} An object with the following properties:
//   - {DashboardResourceBudget} budget - Permits per resource
//   - {DashboardWorkDiagnostics} diagnostics - Recent events, counters, and timings
//   - {function} dispose - Cancels every job and stops admitting
//   - {function} exportSnapshot - Returns a sanitized copy of the diagnostics and scheduler state
//   - {DashboardWorkScheduler} scheduler - Admits and runs jobs
export function createDashboardWorkRuntime({ app = null, clock = Date.now, limits, requestRun } = {}) {
  const budget = new DashboardResourceBudget({ limits });
  const diagnostics = new DashboardWorkDiagnostics({ clock });
  const scheduler = new DashboardWorkScheduler({ budget, clock, context: { app, clock }, diagnostics, requestRun });
  const dispose = () => scheduler.dispose();
  const exportSnapshot = () => diagnostics.exportSnapshot(scheduler.snapshot());
  return { budget, diagnostics, dispose, exportSnapshot, scheduler };
}
