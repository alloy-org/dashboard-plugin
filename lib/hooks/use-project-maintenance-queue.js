// Route the Dashboard's project maintenance through the work queue. Once the Dashboard's load settles, a reconciliation
// of the active domain and quarter is submitted; it plans the dictionary, ranking, and ideas jobs that replace the
// background collection pass. The queue's own gate holds that work until the load has settled for its grace period,
// while no overlay covers the Dashboard, and while nothing in the foreground is waiting. Another reconciliation is
// submitted when the domain or quarter changes, every few minutes while the Dashboard stays open, since edits from
// other clients raise no event here, and shortly after a widget reports a task change.
import { projectReconciliationRequest } from "dashboard/work-queue/jobs/project-job-requests";
import { DASHBOARD_TASKS_UPDATED_EVENT } from "hooks/use-dashboard-task-updates";
import { useCallback, useEffect, useState } from "react";
import { logIfEnabled } from "util/log";

const MAINTENANCE_LOG_LABEL = "[project-maintenance-queue]";
// How often a long-open Dashboard reconciles again. Each reconciliation reads the domain's tasks, so this is spaced
// well apart; a reconciliation that finds nothing changed submits no project work.
export const RECONCILE_INTERVAL_MILLISECONDS = 5 * 60 * 1000;
// How long after a task change to wait before reconciling, so a burst of changes produces one reconciliation.
export const TASK_CHANGE_DEBOUNCE_MILLISECONDS = 15 * 1000;

// ----------------------------------------------------------------------------------------------
// @desc Submit the quarter's reconciliation at the moments described above, for as long as queued maintenance is
//   selected and the Dashboard's work runtime has durable work.
// @param {object} options - An object with the following properties:
//   - {string|null} domainName - Display name of the active task domain
//   - {string|null} domainUuid - UUID of the active task domain
//   - {boolean} enabled - False submits nothing, leaving maintenance to the background collection pass
//   - {number} quarter - The Dashboard's quarter, 1 through 4
//   - {string|null} scopeKey - The work scope that quarter's jobs are saved in
//   - {object|null} work - The Dashboard's work, from useDashboardWorkQueue
//   - {number} year - The quarter's year
// @returns {function} Call once the Dashboard's widgets have settled.
export function useProjectMaintenanceQueue({ domainName, domainUuid, enabled, quarter, scopeKey, work, year }) {
  const [settled, setSettled] = useState(false);
  const durable = enabled ? work?.runtime.durable || null : null;

  const submitReconciliation = useCallback(() => {
    if (!durable) return;
    const request = projectReconciliationRequest({ domainName, domainUuid, quarter, year }, { requestedAt: Date.now() });
    durable.submit({ ...request, scopeKey })
      .catch(error => logIfEnabled(`${ MAINTENANCE_LOG_LABEL } could not submit a reconciliation`, error?.message));
  }, [domainName, domainUuid, durable, quarter, scopeKey, year]);

  useEffect(() => {
    if (settled) submitReconciliation();
  }, [settled, submitReconciliation]);

  useEffect(() => {
    if (!settled || !durable) return undefined;
    let taskChangeTimer = null;
    const handleTaskChange = () => {
      clearTimeout(taskChangeTimer);
      taskChangeTimer = setTimeout(submitReconciliation, TASK_CHANGE_DEBOUNCE_MILLISECONDS);
    };
    const reconcileTimer = setInterval(submitReconciliation, RECONCILE_INTERVAL_MILLISECONDS);
    window.addEventListener(DASHBOARD_TASKS_UPDATED_EVENT, handleTaskChange);
    return () => {
      clearInterval(reconcileTimer);
      clearTimeout(taskChangeTimer);
      window.removeEventListener(DASHBOARD_TASKS_UPDATED_EVENT, handleTaskChange);
    };
  }, [durable, settled, submitReconciliation]);

  return useCallback(() => setSettled(true), []);
}
