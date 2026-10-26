// Read what a past quarter's retrospective is computed from: the quarter's completed tasks, the completed task ledger
// that records which project each one advanced, and the intents chosen for the quarter in Plan Builder.
import { readCompletedTaskLedger } from "dashboard/projects/completed-task-project-ledger";
import { retrospectiveStatistics } from "dashboard/quarter-retrospective/retrospective-statistics";
import { resolvePlanScope } from "plan-wizard/plan-models";
import { readVisionGuide } from "plan-wizard/vision-guide-repository";
import { logIfEnabled } from "util/log";

const RETROSPECTIVE_LOG_LABEL = "[quarter-retrospective]";

// ----------------------------------------------------------------------------------------------
// @desc Read a quarter's tasks, ledger, and intents, and summarize them. The ledger and the intents are optional: a
//   quarter that had neither still gets the facts its completed tasks alone can tell.
// @param {object} app - Amplenote API.
// @param {object} options - An object with the following properties:
//   - {string|null} domainName - Display name of the task domain, or null for All Notes
//   - {string|null} domainUuid - Task domain UUID, or null for All Notes
//   - {number} quarter - 1 through 4
//   - {number} year - Calendar year
// @returns {Promise<object>} Statistics, as retrospectiveStatistics returns them.
// @throws When the completed tasks could not be read.
export async function loadRetrospectiveStatistics(app, { domainName, domainUuid, quarter, year }) {
  const scope = resolvePlanScope({ domainName: domainName || "All Notes", domainUuid: domainUuid || null, quarter, year });
  const [completedTasks, entriesByDate, intents] = await Promise.all([_quarterCompletedTasks(app, scope),
    _ledgerEntriesByDate(app, scope), _quarterIntents(app, scope)]);
  return retrospectiveStatistics({ completedTasks, entriesByDate, intentTexts: intents.intentTexts, quarter, quarterName: intents.quarterName,
    year });
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc The quarter's ledger entries, or none when the ledger is missing or cannot be read.
// @param {object} app - Amplenote API.
// @param {object} scope - Resolved plan scope.
// @returns {Promise<Map<string, Array<object>>>} Entries by date key.
async function _ledgerEntriesByDate(app, scope) {
  try {
    const ledger = await readCompletedTaskLedger(app, scope);
    return ledger.entriesByDate;
  } catch (error) {
    logIfEnabled(`${ RETROSPECTIVE_LOG_LABEL } could not read the completed task ledger`, error?.message);
    return new Map();
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Every task completed during the quarter, in the scope's task domain.
// @param {object} app - Amplenote API.
// @param {object} scope - Resolved plan scope.
// @returns {Promise<Array<object>>} Completed tasks.
// @throws When getCompletedTasks is unavailable or does not return a list.
async function _quarterCompletedTasks(app, scope) {
  if (typeof app?.getCompletedTasks !== "function") throw new Error("Completed tasks cannot be read here");
  const fromSeconds = Math.floor(new Date(scope.year, (scope.quarter - 1) * 3, 1).getTime() / 1000);
  const toSeconds = Math.floor(Math.min(Date.now(), new Date(scope.year, scope.quarter * 3, 1).getTime()) / 1000);
  const lookupOptions = scope.domainUuid ? { taskDomainUUID: scope.domainUuid } : {};
  const tasks = await app.getCompletedTasks(fromSeconds, toSeconds, lookupOptions);
  if (!Array.isArray(tasks)) throw new Error("Could not read the quarter's completed tasks");
  return tasks.filter(task => task && typeof task === "object");
}

// ----------------------------------------------------------------------------------------------
// @desc The quarter's chosen intents, highest ranked first, and the name the user gave the quarter.
// @param {object} app - Amplenote API.
// @param {object} scope - Resolved plan scope.
// @returns {Promise<object>} { intentTexts, quarterName }; empty when no Vision Guide holds the quarter.
async function _quarterIntents(app, scope) {
  try {
    const guide = await readVisionGuide(app, scope);
    const goals = guide?.goals?.goals || [];
    const liveGoals = goals.filter(goal => !goal.isDeleted && goal.goalText);
    const rankedGoals = [...liveGoals].sort((first, second) => first.goalRank - second.goalRank);
    const intentTexts = rankedGoals.map(goal => goal.goalText);
    return { intentTexts, quarterName: guide?.goals?.quarterName?.text || null };
  } catch (error) {
    logIfEnabled(`${ RETROSPECTIVE_LOG_LABEL } could not read the quarter's intents`, error?.message);
    return { intentTexts: [], quarterName: null };
  }
}
