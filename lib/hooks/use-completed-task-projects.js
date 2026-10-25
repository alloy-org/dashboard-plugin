// Read which project each completed task in the Victory Value chart's seven days advanced, from the completed task
// ledger of every quarter those days fall in, along with the color each project is drawn in and the victory value any
// task was raised to. The ledgers are read again whenever a classification or potential rating job finishes, since
// those jobs are the only things that write them.
import { appliedVictoryValuesByCompletion } from "dashboard/projects/completed-task-potential";
import { projectColorAssignments, projectUuidsByCompletion } from "dashboard/projects/completed-task-project-colors";
import { ledgerEntriesForQuarters, quartersSpanningDays } from "dashboard/projects/project-week-completions";
import { useDashboardWork } from "dashboard/work-queue/dashboard-work-context";
import { CLASSIFY_COMPLETED_TASKS_JOB_TYPE, SCORE_COMPLETED_TASK_POTENTIAL_JOB_TYPE } from "dashboard/work-queue/jobs/project-job-requests";
import { useEffect, useState } from "react";
import { logIfEnabled } from "util/log";

const COMPLETED_TASK_PROJECTS_LOG_LABEL = "[completed-task-projects]";
// How many days the chart shows, ending on its reference date.
const DISPLAYED_DAY_COUNT = 7;
// The jobs whose completion means a ledger changed.
const LEDGER_WRITING_JOB_TYPES = new Set([CLASSIFY_COMPLETED_TASKS_JOB_TYPE, SCORE_COMPLETED_TASK_POTENTIAL_JOB_TYPE]);

// ----------------------------------------------------------------------------------------------
// @desc The quarters the seven days ending on a date fall in.
// @param {Date|string} referenceDate - The last displayed day.
// @returns {Array<object>} { quarter, year }, earliest first; two when the days cross a quarter boundary.
export function displayedQuarters(referenceDate) {
  return quartersSpanningDays(referenceDate, DISPLAYED_DAY_COUNT);
}

// ----------------------------------------------------------------------------------------------
// @desc Read the ledgers of the given quarters into the lookups the chart colors its bars with.
// @param {object} app - Amplenote API.
// @param {object} options - An object with the following properties:
//   - {string} domainName - Display name of the task domain whose ledgers are read
//   - {Array<object>} quarters - { quarter, year } of each ledger to read
// @returns {Promise<object|null>} { appliedVictoryValuesByCompletion, colorAssignments, projectUuidsByCompletion }, or null
//   when no ledger holds an entry.
export async function readCompletedTaskProjects(app, { domainName, quarters }) {
  const entriesByDate = await ledgerEntriesForQuarters(app, { domainName, quarters });
  if (!entriesByDate.size) return null;
  return { appliedVictoryValuesByCompletion: appliedVictoryValuesByCompletion(entriesByDate),
    colorAssignments: projectColorAssignments(entriesByDate), projectUuidsByCompletion: projectUuidsByCompletion(entriesByDate) };
}

// ----------------------------------------------------------------------------------------------
// @desc Keep the displayed days' project lookups current for the Victory Value chart.
// @param {object} app - Amplenote API.
// @param {object} options - An object with the following properties:
//   - {string|null} domainName - Display name of the active task domain; without one nothing is read
//   - {Date|string} referenceDate - The last displayed day
// @returns {object|null} { appliedVictoryValuesByCompletion, colorAssignments, projectUuidsByCompletion }, or null until a
//   ledger with entries is read.
export function useCompletedTaskProjects(app, { domainName, referenceDate }) {
  const [completedTaskProjects, setCompletedTaskProjects] = useState(null);
  const [ledgerRevision, setLedgerRevision] = useState(0);
  const durable = useDashboardWork()?.runtime?.durable || null;
  const quarters = displayedQuarters(referenceDate);
  const quartersKey = quarters.map(({ quarter, year }) => `${ year }-Q${ quarter }`).join(",");

  useEffect(() => {
    if (!durable) return undefined;
    return durable.subscribeOutcomes(({ jobType, status }) => {
      if (LEDGER_WRITING_JOB_TYPES.has(jobType) && status === "completed") setLedgerRevision(revision => revision + 1);
    });
  }, [durable]);

  useEffect(() => {
    if (!app || !domainName) {
      setCompletedTaskProjects(null);
      return undefined;
    }
    let cancelled = false;
    readCompletedTaskProjects(app, { domainName, quarters })
      .then(projects => { if (!cancelled) setCompletedTaskProjects(projects); })
      .catch(error => logIfEnabled(`${ COMPLETED_TASK_PROJECTS_LOG_LABEL } could not read the ledger`, error?.message));
    return () => { cancelled = true; };
  }, [app, domainName, ledgerRevision, quartersKey]);

  return completedTaskProjects;
}
