// Decide which projects one background pass refreshes and when it stops. Two regimes share one ordering: while
// any project has gone unrefreshed for longer than the staleness window every stale project is refreshed, and
// once none has, each dashboard load refreshes the single oldest project instead. A pass that finishes its work
// quickly keeps going until its time budget is spent, so a load costs roughly the same either way.
import { dateFromDateInput } from "util/date-utility";

// A project refreshed inside this window is current enough that spending a provider call on it would displace
// work on a project the user has heard nothing about for longer.
export const PROJECT_STALENESS_HOURS = 72;
// Once every project is current, a pass still refreshes at least one, and keeps taking the next-oldest project
// until this much time has gone by. A pass that stops at one fast project would leave the cycle barely moving.
export const REFRESH_BUDGET_MILLISECONDS = 20000;

// ----------------------------------------------------------------------------------------------
// @desc Order every project by how long it has gone unrefreshed, never-refreshed projects first. Both regimes
//   consume this same order, so the project a catch-up pass would reach first is the project a cycling pass
//   picks up, and a pass cut short resumes where it left off rather than restarting.
// @param {Array<object>} projects - Live projects for the quarter.
// @param {Map<string, object>} recordsByUuid - Stored records keyed by project UUID.
// @returns {Array<object>} Projects, oldest refresh first.
export function oldestRefreshFirst(projects, recordsByUuid) {
  const withRefreshTime = projects.map(project => {
    const storedRefresh = recordsByUuid.get(project.uuid)?.lastAttemptedAt;
    const refreshDate = storedRefresh ? dateFromDateInput(storedRefresh, { throwOnInvalid: false }) : null;
    return { project, refreshedAt: refreshDate ? refreshDate.getTime() : 0 };
  });
  const sortedByRefresh = withRefreshTime.sort((left, right) => left.refreshedAt - right.refreshedAt);
  return sortedByRefresh.map(entry => entry.project);
}

// ----------------------------------------------------------------------------------------------
// @desc Decide whether a project has gone long enough without a refresh to be worth a provider call.
// @param {object} record - Stored project record, or undefined when the project is new to the store.
// @param {Date} now - Current time.
// @returns {boolean} True when the project has never been refreshed or its last refresh has aged out.
export function projectNeedsRefresh(record, now) {
  if (!record?.lastAttemptedAt) return true;
  const lastRefresh = dateFromDateInput(record.lastAttemptedAt, { throwOnInvalid: false });
  if (!lastRefresh) return true;
  return now.getTime() - lastRefresh.getTime() >= PROJECT_STALENESS_HOURS * 60 * 60 * 1000;
}

// ----------------------------------------------------------------------------------------------
// @desc Choose the projects this pass will walk, and say which regime chose them. Catching up is the priority:
//   while anything is stale the pass refreshes all of it, because a project the user has heard nothing about
//   for three days matters more than keeping the cycle even. Only when nothing is stale does the pass fall back
//   to cycling, and it is handed every project in oldest-first order so its time budget decides where it stops.
// @param {object} options - An object with the following properties:
//   - {Date} now - Current time
//   - {Array<object>} projects - Live projects for the quarter
//   - {Map<string, object>} recordsByUuid - Stored records keyed by project UUID
// @returns {object} An object with the following properties:
//   - {Array<object>} orderedProjects - Projects to walk, oldest refresh first
//   - {string} regimeEm - "catchUp" when stale projects drove the selection, "cycle" when none were stale
export function projectsToRefresh({ now, projects, recordsByUuid }) {
  const staleProjects = projects.filter(project => projectNeedsRefresh(recordsByUuid.get(project.uuid), now));
  if (staleProjects.length) return { orderedProjects: oldestRefreshFirst(staleProjects, recordsByUuid), regimeEm: "catchUp" };
  return { orderedProjects: oldestRefreshFirst(projects, recordsByUuid), regimeEm: "cycle" };
}

// ----------------------------------------------------------------------------------------------
// @desc Decide whether a cycling pass has done enough. The first project is always refreshed, so a load that
//   reaches the cycle always advances it; past that the pass continues only while its budget remains. A
//   catch-up pass is never stopped by the budget, because leaving a stale project unrefreshed is the outcome
//   the staleness window exists to prevent.
// @param {object} options - An object with the following properties:
//   - {number} elapsedMilliseconds - How long the pass has been refreshing projects
//   - {number} refreshedCount - Projects refreshed so far in this pass
//   - {string} regimeEm - Regime from projectsToRefresh
// @returns {boolean} True when the pass should refresh another project.
export function shouldRefreshAnotherProject({ elapsedMilliseconds, refreshedCount, regimeEm }) {
  if (regimeEm === "catchUp") return true;
  if (!refreshedCount) return true;
  return elapsedMilliseconds < REFRESH_BUDGET_MILLISECONDS;
}
