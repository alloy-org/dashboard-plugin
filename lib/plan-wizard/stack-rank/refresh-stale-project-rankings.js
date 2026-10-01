// Rank the stored projects that have not been rated recently, and write the tasks each one accepts into the project task
// store. Plan Builder starts this when it opens: the background collection pass stands down while the builder covers
// the dashboard, and the builder is where a user is deciding what their projects hold. Only task associations are
// refreshed here. Ideas and the collection timestamp are left for the background pass, whose generative provider
// call this pass deliberately avoids.
import { projectMatchesTask } from "dashboard/project-progress-model";
import { PROJECT_STALENESS_HOURS } from "dashboard/project-refresh-schedule";
import { openProjectTaskStore, readCollectedProjectTasks, writeProjectSection } from "dashboard/project-task-store";
import { resolvePlanScope } from "plan-wizard/plan-models";
import { prepareProjectTaskRanker, projectTaskScorer,
  rankedTaskAssociations } from "plan-wizard/stack-rank/stack-rank-project-tasks";
import { fetchDomainOrAllNotesTasks } from "util/all-notes-tasks";
import { dateFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";

const REFRESH_LOG_LABEL = "[refresh-stale-project-rankings]";

// ----------------------------------------------------------------------------------------------
// @desc Rank every stored project of the current quarter whose last ranking is older than the staleness window,
//   oldest first, writing each as soon as it is ranked. A project whose ranking failed keeps what the store held.
//   When the fast model rates in place of Jev, the pass stops before a project while the builder is waiting on the
//   provider, so its rating prompts never hold up the page the user is looking at; the next pass resumes it.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - An object with the following properties:
//   - {string} [accessToken] - Jev key; defaults to the Jev Access Token plugin setting
//   - {string|null} domainName - Active task domain display name
//   - {string|null} domainUuid - Active task domain UUID
//   - {function} [isProviderBusy=() => false] - True while the builder waits on a generative provider response
//   - {Date} [now=new Date()] - Injected for tests
//   - {function} [rankerFactory=prepareProjectTaskRanker] - Injected for tests
//   - {boolean} [refineDictionary=true] - False when the user is waiting on the generative provider
//   - {function} [shouldContinue=() => true] - Consulted before each project
// @returns {Promise<object>} { failures, rankedCount, skippedReason }, skippedReason null when the pass ran, and
//   "noScorer" when neither Jev nor a generative provider can rate.
export async function refreshStaleProjectRankings(app, { accessToken, domainName, domainUuid, isProviderBusy = () => false,
    now = new Date(), rankerFactory = prepareProjectTaskRanker, refineDictionary = true, shouldContinue = () => true }) {
  const scorerEm = await projectTaskScorer(app, accessToken);
  if (!scorerEm) return { failures: 0, rankedCount: 0, skippedReason: "noScorer" };
  const scope = resolvePlanScope({ domainName, domainUuid, quarter: Math.floor(now.getMonth() / 3) + 1,
    year: now.getFullYear() });
  const storedProjects = await readCollectedProjectTasks(app, scope);
  const staleProjects = storedProjects.filter(project => _rankingIsStale(project, now));
  if (!staleProjects.length) return { failures: 0, rankedCount: 0, skippedReason: "current" };
  const tasks = await fetchDomainOrAllNotesTasks(app, domainUuid);
  if (!Array.isArray(tasks)) throw new Error("Could not read tasks for project ranking");
  const ranker = await rankerFactory(app, { accessToken, domainName, domainUuid, now, projects: storedProjects,
    refineDictionary, tasks });
  if (!ranker) return { failures: 0, rankedCount: 0, skippedReason: "noScorer" };
  const store = await openProjectTaskStore(app, scope);
  const oldestFirst = staleProjects.sort((left, right) => _rankedAtMilliseconds(left) - _rankedAtMilliseconds(right));
  let content = store.content;
  let failures = 0;
  let rankedCount = 0;
  for (const project of oldestFirst) {
    if (!shouldContinue()) break;
    if (ranker.scorerEm === "generative" && isProviderBusy()) break;
    const rankedProject = await _projectWithRankedTasks(project, { now, ranker, tasks });
    if (!rankedProject) {
      failures += 1;
      continue;
    }
    content = await writeProjectSection(app, { content, isActive: true, noteHandle: store.noteHandle, project: rankedProject });
    rankedCount += 1;
  }
  logIfEnabled(`${ REFRESH_LOG_LABEL } pass complete`, { dictionaryChanges: ranker.dictionaryChanges, failures,
    rankedCount, scorerEm: ranker.scorerEm, staleCount: staleProjects.length });
  return { failures, rankedCount, skippedReason: null };
}

// ----------------------------------------------------------------------------------------------
// @desc Re-rank one stored project: its locally matched open tasks are kept, and the tasks the ranker accepts are
//   added. Its stored ratings are handed to the ranker and replaced by the ratings the ranking returns.
//   Tasks a previous pass accepted only as fallback leads are not in relatedTasks, so they are rated again here.
// @param {object} project - Stored project record.
// @param {object} options - { now, ranker, tasks }.
// @returns {Promise<object|null>} The record to write, or null when the ranking failed.
async function _projectWithRankedTasks(project, { now, ranker, tasks }) {
  const matchingTasks = tasks.filter(task => task.uuid && projectMatchesTask(project, task));
  const openTasks = matchingTasks.filter(task => !task.completedAt && !task.dismissedAt);
  const matchedTaskRecords = openTasks.map(task => ({ taskText: task.content || "", taskUuid: task.uuid }));
  let ranking = null;
  try {
    ranking = await ranker.rankProject(project, matchedTaskRecords, { storedRatings: project.jevRatings });
  } catch (error) {
    ranking = { failureReason: error?.message || "Jev ranking failed" };
  }
  if (ranking.failureReason) {
    logIfEnabled(`${ REFRESH_LOG_LABEL } ranking failed`, { project: project.summary, reason: ranking.failureReason });
    return null;
  }
  const { associatedRecords, rememberedTaskUuids } = rankedTaskAssociations(matchedTaskRecords, ranking.acceptedTasks);
  const relatedTasks = [...new Set([...(project.relatedTasks || []), ...rememberedTaskUuids])];
  return { ...project, jevRatings: ranking.taskRatings, lastRankedAt: now.toISOString(), relatedTaskRecords: associatedRecords,
    relatedTasks };
}

// ----------------------------------------------------------------------------------------------
// @desc Read when a project was last ranked, with a never-ranked project sorting first.
// @param {object} project - Stored project record.
// @returns {number} Epoch milliseconds, 0 when never ranked or unreadable.
function _rankedAtMilliseconds(project) {
  const rankedDate = project.lastRankedAt ? dateFromDateInput(project.lastRankedAt, { throwOnInvalid: false }) : null;
  return rankedDate ? rankedDate.getTime() : 0;
}

// ----------------------------------------------------------------------------------------------
// @desc Decide whether a project's ranking has aged past the window the background pass refreshes projects on.
// @param {object} project - Stored project record.
// @param {Date} now - Current time.
// @returns {boolean} True when the project was never ranked or was ranked before the window began.
function _rankingIsStale(project, now) {
  return now.getTime() - _rankedAtMilliseconds(project) >= PROJECT_STALENESS_HOURS * 60 * 60 * 1000;
}
