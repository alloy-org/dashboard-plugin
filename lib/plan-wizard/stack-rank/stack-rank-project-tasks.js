// Attribute open tasks to projects by Jev's rating of how applicable each is. A ranker is prepared once per pass:
// it refreshes the user terms dictionary, then rates each project's pool of up to 500 open tasks the project does
// not already hold, and accepts the tasks that clear the project's minimum match score (see project-match-scores).
// Task details are cached across projects, since the pools overlap heavily and each note read costs a bridge round
// trip. Both the background project-task collection pass and Plan Builder's entry pass rank through this module.
import { SETTING_KEYS } from "constants/settings";
import { candidateTaskRecords } from "dashboard/project-candidate-tasks";
import { buildProjectTaskContext } from "plan-wizard/stack-rank/build-project-task-context";
import { acceptedRankedTasks, DEFAULT_MINIMUM_MATCH_SCORE, matchScoresFromSetting, matchScoresWithProjectScore,
  storedMinimumMatchScore } from "plan-wizard/stack-rank/project-match-scores";
import { prospectiveTaskDetails } from "plan-wizard/stack-rank/prospective-task-details";
import { rankProspectiveTasks } from "plan-wizard/stack-rank/rank-prospective-tasks";
import { pluginSettings, updatePluginSetting } from "plugin-data";
import { logIfEnabled } from "util/log";

// Jev rates each task on its own, so its pool can reach far past the 40 a generative prompt can cite. Past 500 the
// oldest open tasks are rarely live work, and each further batch adds a request to every project's refresh.
export const JEV_CANDIDATE_TASK_LIMIT = 500;
const RANKER_LOG_LABEL = "[stack-rank-project-tasks]";

// ----------------------------------------------------------------------------------------------
// @desc Build a ranker over one pass's tasks. Ranking a project rates its pool, chooses the accepted tasks, and saves
//   the project's minimum match score when it changed. A project whose every batch failed reports the failure and
//   accepts nothing, so its caller can fall back to the generative provider's attribution.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - An object with the following properties:
//   - {string} accessToken - TypeSafe or OpenRouter key
//   - {object} dictionary - Definitions keyed by term
//   - {function} [requestAnswers] - Injected Jev request for tests
//   - {object} scope - Resolved quarter scope the projects belong to
//   - {Array<object>} tasks - Every task read for this pass
// @returns {object} { rankProject(project, relatedTaskRecords) }, resolving to { acceptedTasks, failureReason,
//   minimumMatchScore, ratedCount } with acceptedTasks as { matchScore, taskText, taskUuid }, highest score first.
export function createProjectTaskRanker(app, { accessToken, dictionary, requestAnswers, scope, tasks }) {
  const identifiedTasks = tasks.filter(task => task?.uuid);
  const taskByUuid = new Map(identifiedTasks.map(task => [task.uuid, task]));
  const detailByUuid = new Map();
  const rankProject = async (project, relatedTaskRecords) => {
    const candidateRecords = candidateTaskRecords(identifiedTasks, { maximumTaskCount: JEV_CANDIDATE_TASK_LIMIT,
      relatedTaskRecords });
    const uncachedRecords = candidateRecords.filter(record => !detailByUuid.has(record.taskUuid));
    const uncachedTasks = uncachedRecords.map(record => taskByUuid.get(record.taskUuid));
    const fetchedDetails = await prospectiveTaskDetails(app, uncachedTasks);
    fetchedDetails.forEach(detail => detailByUuid.set(detail.taskUuid, detail));
    const taskDetails = candidateRecords.map(record => detailByUuid.get(record.taskUuid));
    const ranking = await rankProspectiveTasks({ accessToken, dictionary, project: { ...project, relatedTaskRecords },
      taskDetails, ...(requestAnswers ? { requestAnswers } : {}) });
    if (!ranking.rankedTasks.length && ranking.failures.length) {
      return { acceptedTasks: [], failureReason: ranking.failures[0].reason, minimumMatchScore: null, ratedCount: 0 };
    }
    const scoreScope = { domainUuid: scope.domainUuid, projectUuid: project.uuid, quarter: scope.quarter, year: scope.year };
    const storedScore = storedMinimumMatchScore(matchScoresFromSetting(pluginSettings()?.[SETTING_KEYS.PROJECT_MATCH_SCORES]),
      scoreScope);
    const selection = acceptedRankedTasks(ranking.rankedTasks, { isComplete: !ranking.failures.length,
      storedMinimumMatchScore: storedScore });
    if (selection.minimumMatchScore !== null && selection.minimumMatchScore !== storedScore) {
      await _persistMinimumMatchScore(app, { ...scoreScope, minimumMatchScore: selection.minimumMatchScore });
    }
    const acceptedTasks = selection.acceptedTasks.map(task => ({ matchScore: task.rating,
      taskText: taskByUuid.get(task.taskUuid)?.content || task.taskText, taskUuid: task.taskUuid }));
    logIfEnabled(`${ RANKER_LOG_LABEL } ranked project`, { acceptedCount: acceptedTasks.length,
      minimumMatchScore: selection.minimumMatchScore, project: project.summary, ratedCount: ranking.rankedTasks.length });
    return { acceptedTasks, failureReason: null, minimumMatchScore: selection.minimumMatchScore,
      ratedCount: ranking.rankedTasks.length };
  };
  return { rankProject };
}

// ----------------------------------------------------------------------------------------------
// @desc Resolve the Jev key a pass ranks with, so a caller can skip reading tasks when there is none.
// @param {string} [accessToken] - Explicit key, used by tests; the Jev Access Token setting otherwise.
// @returns {string|null} The key, or null when none is set.
export function jevAccessTokenFromSettings(accessToken) {
  return accessToken || pluginSettings()?.[SETTING_KEYS.JEV_ACCESS_TOKEN] || null;
}

// ----------------------------------------------------------------------------------------------
// @desc Prepare a ranker for one pass, first refreshing the dictionary from any project it has not yet examined.
//   Without a Jev Access Token there is nothing to rank with, and null tells the caller to attribute tasks the way it
//   did before Jev. A caller the user is waiting on passes refineDictionary false, since term discovery is a
//   generative provider call that would queue behind, or ahead of, the one the user is waiting for.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - An object with the following properties:
//   - {string} [accessToken] - Jev key; defaults to the Jev Access Token plugin setting
//   - {string|null} domainName - Active task domain display name
//   - {string|null} domainUuid - Active task domain UUID
//   - {Date} [now=new Date()] - Selects the quarter and the dictionary's year
//   - {Array<object>} [projects] - The quarter's projects; read from the project task store when omitted
//   - {function} [promptRunner] - Injected into term discovery for tests
//   - {boolean} [refineDictionary=true] - False reads the dictionary without contacting a provider
//   - {function} [requestAnswers] - Injected Jev request for tests
//   - {Array<object>} tasks - Every task read for this pass
// @returns {Promise<object|null>} The ranker with its dictionaryChanges, or null when no Jev key is set.
export async function prepareProjectTaskRanker(app, { accessToken, domainName, domainUuid, now = new Date(), projects,
    promptRunner, refineDictionary = true, requestAnswers, tasks }) {
  const jevAccessToken = jevAccessTokenFromSettings(accessToken);
  if (!jevAccessToken) {
    logIfEnabled(`${ RANKER_LOG_LABEL } no "${ SETTING_KEYS.JEV_ACCESS_TOKEN }" set; tasks are not ranked`);
    return null;
  }
  const context = await buildProjectTaskContext(app, { domainName, domainUuid, now, projects, promptRunner,
    refineDictionary });
  const ranker = createProjectTaskRanker(app, { accessToken: jevAccessToken, dictionary: context.dictionary,
    requestAnswers, scope: context.scope, tasks });
  return { ...ranker, dictionaryChanges: context.dictionaryChanges };
}

// ----------------------------------------------------------------------------------------------
// @desc Join a project's locally matched tasks with the ones Jev accepted, and say which accepted tasks the project
//   should remember. A task accepted at the default minimum or above is remembered in relatedTasks, as a task the
//   generative provider found is; a fallback lead is not, so it is rated again next pass rather than kept for good.
// @param {Array<object>} matchedTaskRecords - Open tasks the local match associated, as { taskText, taskUuid }.
// @param {Array<object>} acceptedTasks - From rankProject, as { matchScore, taskText, taskUuid }.
// @returns {object} { associatedRecords, rememberedTaskUuids }.
export function rankedTaskAssociations(matchedTaskRecords, acceptedTasks) {
  const associatedRecords = [...matchedTaskRecords, ...acceptedTasks];
  const confidentTasks = acceptedTasks.filter(task => task.matchScore >= DEFAULT_MINIMUM_MATCH_SCORE);
  const rememberedTaskUuids = confidentTasks.map(task => task.taskUuid);
  return { associatedRecords, rememberedTaskUuids };
}

// ----------------------------------------------------------------------------------------------
// @desc Save one project's minimum match score, reading the setting afresh so a pass ranking several projects never
//   writes back a snapshot that predates the project it ranked before. The embed cache is updated alongside the
//   write, as every embed-side setting write is.
// @param {object} app - Amplenote app bridge; only setSetting is called.
// @param {object} params - { domainUuid, minimumMatchScore, projectUuid, quarter, year }.
// @returns {Promise<void>}
async function _persistMinimumMatchScore(app, { domainUuid, minimumMatchScore, projectUuid, quarter, year }) {
  const matchScores = matchScoresFromSetting(pluginSettings()?.[SETTING_KEYS.PROJECT_MATCH_SCORES]);
  const updatedScores = matchScoresWithProjectScore(matchScores, { domainUuid, minimumMatchScore, projectUuid, quarter, year });
  const serialized = JSON.stringify(updatedScores);
  updatePluginSetting(SETTING_KEYS.PROJECT_MATCH_SCORES, serialized);
  try {
    await app.setSetting(SETTING_KEYS.PROJECT_MATCH_SCORES, serialized);
  } catch (error) {
    logIfEnabled(`${ RANKER_LOG_LABEL } could not save minimum match score`, error?.message);
  }
}
