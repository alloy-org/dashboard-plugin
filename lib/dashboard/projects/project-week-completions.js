// Decide which quarterly project each task completed in the week before a planned day advanced, with the "Completed
// Tasks by Project" ledger as the source of truth. A completion the ledger records counts only toward the project the
// ledger names, and one it records as advancing no project counts toward none. A completion the classification job has
// not reached yet falls back to the project's own link and similarity matching, so a task finished an hour ago still
// counts. Day planning reads this rather than keeping completions in the project task store, whose project sections
// would otherwise grow with every completion of the quarter.
import { ledgerEntryKey, readCompletedTaskLedger } from "dashboard/projects/completed-task-project-ledger";
import { observedCompletionRecord } from "dashboard/quarter-project";
import { checkedAppResult } from "plan-wizard/vision-guide-notes";
import { dateFromDateInput, dateKeyFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";

// How many days ending on the planned day are read: the rolling week and the Monday-based week that progressEvidence
// counts both fall inside it.
export const COMPLETION_WINDOW_DAYS = 7;
const WEEK_COMPLETIONS_LOG_LABEL = "[project-week-completions]";

// ----------------------------------------------------------------------------------------------
// @desc The quarters a run of days ending on a date falls in.
// @param {Date|string} endDate - The last day.
// @param {number} [dayCount=COMPLETION_WINDOW_DAYS] - How many days, the last one included.
// @returns {Array<object>} { quarter, year }, earliest first; two when the days cross a quarter boundary.
export function quartersSpanningDays(endDate, dayCount = COMPLETION_WINDOW_DAYS) {
  const lastDate = dateFromDateInput(endDate);
  const firstDate = new Date(lastDate);
  firstDate.setDate(firstDate.getDate() - (dayCount - 1));
  const quarters = [firstDate, lastDate].map(date => ({ quarter: Math.floor(date.getMonth() / 3) + 1, year: date.getFullYear() }));
  const [firstQuarter, lastQuarter] = quarters;
  const sameQuarter = firstQuarter.quarter === lastQuarter.quarter && firstQuarter.year === lastQuarter.year;
  return sameQuarter ? [firstQuarter] : quarters;
}

// ----------------------------------------------------------------------------------------------
// @desc Read the ledger entries of several quarters into one map. A quarter whose ledger does not exist adds nothing.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - An object with the following properties:
//   - {string} domainName - Display name of the task domain whose ledgers are read
//   - {Array<object>} quarters - { quarter, year } of each ledger to read
// @returns {Promise<Map<string, Array<object>>>} Ledger entries by date key.
export async function ledgerEntriesForQuarters(app, { domainName, quarters }) {
  const entriesByDate = new Map();
  for (const { quarter, year } of quarters) {
    const ledger = await readCompletedTaskLedger(app, { domainName, quarter, year });
    for (const [dateKey, entries] of ledger.entriesByDate) entriesByDate.set(dateKey, entries);
  }
  return entriesByDate;
}

// ----------------------------------------------------------------------------------------------
// @desc Read what the week ending on a planned day says about completions: the ledger's entries and the tasks the
//   domain completed. Either read failing yields an empty result for that part, so a day can still be planned from the
//   other, and from the completions a project already carries.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - An object with the following properties:
//   - {string} domainName - Display name of the task domain, which names its ledgers
//   - {string|null} domainUuid - The task domain, or null to read completions across all notes
//   - {Date} targetDate - The day being planned
//   - {Date} [now] - The present moment; completions are not read past it
// @returns {Promise<object>} { completedTasks, ledgerEntriesByDate }: native completed tasks, and ledger entries by date key.
export async function readWeekCompletionEvidence(app, { domainName, domainUuid, now = new Date(), targetDate }) {
  const ledgerEntriesByDate = await ledgerEntriesForQuarters(app, { domainName, quarters: quartersSpanningDays(targetDate) })
    .catch(error => {
      logIfEnabled(`${ WEEK_COMPLETIONS_LOG_LABEL } could not read the completed task ledger`, error?.message);
      return new Map();
    });
  const completedTasks = await _completedTasksInWindow(app, { domainUuid, now, targetDate }).catch(error => {
    logIfEnabled(`${ WEEK_COMPLETIONS_LOG_LABEL } could not read completed tasks`, error?.message);
    return [];
  });
  return { completedTasks, ledgerEntriesByDate };
}

// ----------------------------------------------------------------------------------------------
// @desc A project's completions with the ledger's decisions applied. The project's own completions are kept unless the
//   ledger records that completion under another project or none; the ledger's completions for this project are added;
//   and a completed task the ledger has not recorded is added when the project matches it by link or similarity.
// @param {QuarterProject} project - Project whose completions are reconciled; it is not changed.
// @param {object} evidence - { completedTasks, ledgerEntriesByDate }, from readWeekCompletionEvidence.
// @returns {Array<object>} Completions as { completedAt, noteUuid?, sourceTaskUuid, taskText?, taskUuid }, one per task
//   and completion day.
export function projectCompletionsWithLedger(project, { completedTasks = [], ledgerEntriesByDate = new Map() }) {
  const ledgerProjectUuidByKey = new Map();
  const ledgerCompletions = [];
  for (const [dateKey, entries] of ledgerEntriesByDate) {
    for (const entry of entries) {
      ledgerProjectUuidByKey.set(ledgerEntryKey({ dateKey, taskUuid: entry.taskUuid }), entry.projectUuid || null);
      if (entry.projectUuid === project.uuid) ledgerCompletions.push(entry);
    }
  }
  const completionsByKey = new Map();
  const addCompletion = completion => {
    if (!completion) return;
    const key = _completionKey(completion.completedAt, completion.taskUuid);
    if (!completionsByKey.has(key)) completionsByKey.set(key, completion);
  };
  for (const completion of project.completedTasks) {
    const key = _completionKey(completion.completedAt, completion.taskUuid);
    if (!ledgerProjectUuidByKey.has(key) || ledgerProjectUuidByKey.get(key) === project.uuid) addCompletion(completion);
  }
  for (const entry of ledgerCompletions) {
    addCompletion(observedCompletionRecord({ completedAt: entry.completedAt, content: entry.taskText, uuid: entry.taskUuid }));
  }
  for (const task of completedTasks) {
    if (!task?.uuid || task.dismissedAt || !task.completedAt) continue;
    if (ledgerProjectUuidByKey.has(_completionKey(task.completedAt, task.uuid))) continue;
    if (project.matchesTask(task)) addCompletion(observedCompletionRecord(task));
  }
  const completions = [...completionsByKey.values()];
  return completions;
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Read the tasks completed from the start of the window's first day until the end of the planned day, or until
//   now when that comes first.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { domainUuid, now, targetDate }.
// @returns {Promise<Array<object>>} Native completed tasks; empty when the window has not begun.
// @throws When the completed tasks could not be read.
async function _completedTasksInWindow(app, { domainUuid, now, targetDate }) {
  const windowStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate() - (COMPLETION_WINDOW_DAYS - 1));
  const dayEnd = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate() + 1);
  const windowEnd = Math.min(dayEnd.getTime(), now.getTime());
  if (windowStart.getTime() >= windowEnd) return [];
  const lookupOptions = domainUuid ? { taskDomainUUID: domainUuid } : {};
  const tasks = checkedAppResult(await app.getCompletedTasks(Math.floor(windowStart.getTime() / 1000), Math.floor(windowEnd / 1000),
    lookupOptions));
  if (!Array.isArray(tasks)) throw new Error("Could not read completed tasks");
  return tasks;
}

// ----------------------------------------------------------------------------------------------
// @desc Name a completion the way the ledger does: the task on the local day it was completed.
// @param {*} completedAt - The completion time, in any form dateFromDateInput reads.
// @param {string} taskUuid - The task.
// @returns {string} Such as "2026-10-11:task-uuid", or the bare UUID when the time cannot be read.
function _completionKey(completedAt, taskUuid) {
  const completedDate = dateFromDateInput(completedAt, { throwOnInvalid: false });
  if (!completedDate) return taskUuid;
  return ledgerEntryKey({ dateKey: dateKeyFromDateInput(completedDate), taskUuid });
}
