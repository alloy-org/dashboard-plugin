// Attribute open tasks to projects by a rating of how applicable each is. A ranker is prepared once per pass:
// it refreshes the user terms dictionary, then rates each project's pool of open tasks the project does not already
// hold, and accepts the tasks that clear the project's minimum match score (see project-match-scores). Jev rates
// the pool when a Jev key is set. An installed Ample Agent Pro note rates the same pool by asking Agent Pro, through
// callPlugin, to call Jev's model at Jev's URL. Otherwise the generative provider's fast model rates a smaller pool,
// since each of its tasks costs far more than a Jev rating (see generative-task-scores).
// A project that has been ranked stores that time as lastRankedAt. A later pass submits only tasks created after
// it, so the note does not have to keep a rating for every task the project did not take. A cited task is still
// sent when it has no similarity score. Task details are cached across projects, since the pools overlap heavily
// and each note read costs a bridge round trip. Both the background collection pass and Plan Builder rank here.
import { devJevAccessToken, SETTING_KEYS } from "constants/settings";
import { candidateTaskRecords } from "dashboard/project-candidate-tasks";
import { buildProjectTaskContext } from "plan-wizard/stack-rank/build-project-task-context";
import { generativeScoreRequester } from "plan-wizard/stack-rank/generative-task-scores";
import { acceptedRankedTasks, DEFAULT_MINIMUM_MATCH_SCORE, matchScoresFromSetting, matchScoresWithProjectScore,
  storedMinimumMatchScore } from "plan-wizard/stack-rank/project-match-scores";
import { prospectiveTaskDetails } from "plan-wizard/stack-rank/prospective-task-details";
import { DEFAULT_BATCH_SIZE, DEFAULT_CONCURRENT_BATCHES, rankProspectiveTasks } from "plan-wizard/stack-rank/rank-prospective-tasks";
import { partitionedByStoredRating, storableTaskRatings } from "plan-wizard/stack-rank/task-rating-cache";
import { pluginSettings, updatePluginSetting } from "plugin-data";
import { fastModelOptions, findAmpleAgentProNote } from "providers/ai-provider-settings";
import { agentProPrompt } from "providers/fetch-ai-provider";
import { JEV_DIRECT_ENDPOINT, JEV_DIRECT_MODEL } from "providers/jev-client";
import { logIfEnabled } from "util/log";

// Jev rates each task on its own, so its pool can reach far past the 40 a generative prompt can cite. Past 500 the
// oldest open tasks are rarely live work, and each further batch adds a request to every project's refresh.
export const JEV_CANDIDATE_TASK_LIMIT = 500;
// The fast model is asked about far fewer tasks: a generative prompt costs much more per task than a Jev rating, and
// the 150 most recently updated open tasks hold most of the live work a project could take on.
export const GENERATIVE_CANDIDATE_TASK_LIMIT = 150;
// How each rater's pool is drawn and batched. A generative reply grows with each task it rates, so its batches stay
// small enough to answer well inside the wizard's timeout, and only two run at once so they do not crowd out the
// provider calls the rest of the dashboard makes.
const SCORER_CONFIGURATIONS = {
  generative: { batchSize: 25, candidateTaskLimit: GENERATIVE_CANDIDATE_TASK_LIMIT, concurrentBatches: 2 },
  jev: { batchSize: DEFAULT_BATCH_SIZE, candidateTaskLimit: JEV_CANDIDATE_TASK_LIMIT, concurrentBatches: DEFAULT_CONCURRENT_BATCHES },
};
const RANKER_LOG_LABEL = "[stack-rank-project-tasks]";

// ----------------------------------------------------------------------------------------------
// @desc Build a ranker over one pass's tasks. Ranking a project rates its pool, chooses the accepted tasks, and saves
//   the project's minimum match score when it changed. A project with lastRankedAt set submits only tasks created
//   after that time; a cited task with no stored score is still submitted. The ratings returned are those cited
//   tasks, not the rest of the pool. A project whose every uncached batch failed, with nothing cached to fall back
//   on, reports the failure and accepts nothing, so its caller can fall back to the generative provider's attribution.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - An object with the following properties:
//   - {string|null} accessToken - TypeSafe or OpenRouter key; unused by the generative scorer
//   - {object} dictionary - Definitions keyed by term
//   - {function} [requestAnswers] - Rating request in requestJevAnswers' shape; required for the generative scorer
//   - {object} scope - Resolved quarter scope the projects belong to
//   - {string} [scorerEm="jev"] - "jev" or "generative", which sets the pool size and batching
//   - {Array<object>} tasks - Every task read for this pass
// @returns {object} { rankProject(project, relatedTaskRecords, options), scorerEm }. options may set
//   limitToRequiredTasks and requiredTaskRecords. rankProject resolves to { acceptedTasks, failureReason,
//   minimumMatchScore, rankingIncomplete, ratedCount, taskRatings } with acceptedTasks as { matchScore, taskText,
//   taskUuid }, highest score first. taskRatings holds required tasks only (null on failure). rankingIncomplete is
//   true when a batch failed, so the caller leaves lastRankedAt where it is and the missed tasks are sent again.
export function createProjectTaskRanker(app, { accessToken, dictionary, requestAnswers, scope, scorerEm = "jev", tasks }) {
  const scorerConfiguration = SCORER_CONFIGURATIONS[scorerEm];
  const identifiedTasks = tasks.filter(task => task?.uuid);
  const taskByUuid = new Map(identifiedTasks.map(task => [task.uuid, task]));
  const detailByUuid = new Map();
  const rankProject = async (project, relatedTaskRecords, { limitToRequiredTasks = false, requiredTaskRecords = [],
      storedRatings } = {}) => {
    const createdAfter = limitToRequiredTasks ? null : (project.lastRankedAt || null);
    const candidateRecords = limitToRequiredTasks ? [] : candidateTaskRecords(identifiedTasks, { createdAfter,
      maximumTaskCount: scorerConfiguration.candidateTaskLimit, relatedTaskRecords });
    const requiredRecords = requiredTaskRecords.filter(record => record?.taskUuid
      && String(record.taskText || "").trim());
    const pooledRecords = _unionTaskRecords(candidateRecords, requiredRecords);
    const { cachedTasks, ratingKeyByUuid, uncachedRecords } = partitionedByStoredRating(pooledRecords,
      { projectSummary: project.summary, storedRatings });
    const freshRanking = await _freshRanking(app, { accessToken, detailByUuid, dictionary, project, relatedTaskRecords,
      requestAnswers, scorerConfiguration, taskByUuid, uncachedRecords });
    const rankingIncomplete = freshRanking.failures.length > 0;
    if (!cachedTasks.length && !freshRanking.rankedTasks.length && rankingIncomplete) {
      return { acceptedTasks: [], failureReason: freshRanking.failures[0].reason, minimumMatchScore: null,
        rankingIncomplete, ratedCount: 0, taskRatings: null };
    }
    const combinedTasks = [...freshRanking.rankedTasks, ...cachedTasks];
    const rankedTasks = combinedTasks.sort((first, second) => second.rating - first.rating);
    const scoreScope = { domainUuid: scope.domainUuid, projectUuid: project.uuid, quarter: scope.quarter, year: scope.year };
    const storedScore = storedMinimumMatchScore(matchScoresFromSetting(pluginSettings()?.[SETTING_KEYS.PROJECT_MATCH_SCORES]),
      scoreScope);
    const selection = acceptedRankedTasks(rankedTasks, { isComplete: !freshRanking.failures.length,
      storedMinimumMatchScore: storedScore });
    if (selection.minimumMatchScore !== null && selection.minimumMatchScore !== storedScore) {
      await _persistMinimumMatchScore(app, { ...scoreScope, minimumMatchScore: selection.minimumMatchScore });
    }
    const acceptedTasks = selection.acceptedTasks.map(task => ({ matchScore: task.rating,
      taskText: taskByUuid.get(task.taskUuid)?.content || task.taskText, taskUuid: task.taskUuid }));
    const requiredUuids = new Set(requiredRecords.map(record => record.taskUuid));
    const requiredTasks = rankedTasks.filter(task => requiredUuids.has(task.taskUuid));
    const taskRatings = storableTaskRatings({ keptTaskUuids: [], ratedTasks: requiredTasks, ratingKeyByUuid });
    logIfEnabled(`${ RANKER_LOG_LABEL } ranked project`, { acceptedCount: acceptedTasks.length,
      cachedCount: cachedTasks.length, minimumMatchScore: selection.minimumMatchScore, project: project.summary,
      rankingIncomplete, scorerEm, sentCount: uncachedRecords.length });
    return { acceptedTasks, failureReason: null, minimumMatchScore: selection.minimumMatchScore, rankingIncomplete,
      ratedCount: rankedTasks.length, taskRatings };
  };
  return { rankProject, scorerEm };
}

// ----------------------------------------------------------------------------------------------
// @desc Resolve the Jev key a pass ranks with. In development, the JEV_ACCESS_TOKEN in .env is used when the
//   setting is empty.
// @param {string} [accessToken] - Explicit key, used by tests; the Jev Access Token setting otherwise.
// @returns {string|null} The key, or null when none is set.
export function jevAccessTokenFromSettings(accessToken) {
  return accessToken || pluginSettings()?.[SETTING_KEYS.JEV_ACCESS_TOKEN] || devJevAccessToken() || null;
}

// ----------------------------------------------------------------------------------------------
// @desc Prepare a ranker for one pass, first refreshing the dictionary from any project it has not yet examined.
//   Jev rates when a Jev key is set. When Ample Agent Pro is installed and no key is, Agent Pro is asked to call
//   Jev's model at Jev's URL. Without either, the generative provider's fast model rates instead, if a provider key
//   is set. With none of these, null tells the caller to attribute tasks the way it did before ranking. A caller
//   the user is waiting on passes refineDictionary false, since term discovery is a generative provider call that
//   would queue behind, or ahead of, the one the user is waiting for.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - An object with the following properties:
//   - {string} [accessToken] - Jev key; defaults to the Jev Access Token plugin setting
//   - {string|null} domainName - Active task domain display name
//   - {string|null} domainUuid - Active task domain UUID
//   - {Date} [now=new Date()] - Selects the quarter and the dictionary's year
//   - {Array<object>} [projects] - The quarter's projects; read from the project task store when omitted
//   - {function} [promptRunner] - Injected into term discovery, and into generative rating, for tests
//   - {boolean} [refineDictionary=true] - False reads the dictionary without contacting a provider
//   - {function} [requestAnswers] - Injected rating request for tests, used by either scorer
//   - {Array<object>} tasks - Every task read for this pass
// @returns {Promise<object|null>} The ranker with its dictionaryChanges and scorerEm, or null when nothing can rate.
export async function prepareProjectTaskRanker(app, { accessToken, domainName, domainUuid, now = new Date(), projects,
    promptRunner, refineDictionary = true, requestAnswers, tasks }) {
  const scorerEm = await projectTaskScorer(app, accessToken);
  if (!scorerEm) {
    const reason = `no "${ SETTING_KEYS.JEV_ACCESS_TOKEN }", no Ample Agent Pro, and no generative provider`;
    logIfEnabled(`${ RANKER_LOG_LABEL } ${ reason }; tasks are not ranked`);
    return null;
  }
  const context = await buildProjectTaskContext(app, { domainName, domainUuid, now, projects, promptRunner,
    refineDictionary });
  const jevToken = jevAccessTokenFromSettings(accessToken);
  const agentProJevRequest = scorerEm === "jev" && !jevToken ? _agentProJevRequester(app) : null;
  if (agentProJevRequest) {
    logIfEnabled(`${ RANKER_LOG_LABEL } Ample Agent Pro is installed; asking it to call Jev`);
  }
  const generativeRequest = scorerEm === "generative" ? generativeScoreRequester(app, promptRunner ? { promptRunner } : {}) : null;
  const ranker = createProjectTaskRanker(app, { accessToken: jevToken, dictionary: context.dictionary,
    requestAnswers: requestAnswers || agentProJevRequest || generativeRequest, scope: context.scope,
    scorerEm, tasks });
  return { ...ranker, dictionaryChanges: context.dictionaryChanges };
}

// ----------------------------------------------------------------------------------------------
// @desc Choose what rates a pass's tasks, so a caller can skip reading tasks when nothing can.
// @param {object} app - Host-compatible Amplenote API.
// @param {string} [accessToken] - Explicit Jev key, used by tests.
// @returns {Promise<string|null>} "jev" when a Jev key is set or Ample Agent Pro is installed, "generative" when only
//   the fast model can answer, or null when nothing can.
export async function projectTaskScorer(app, accessToken) {
  if (jevAccessTokenFromSettings(accessToken)) return "jev";
  if (await findAmpleAgentProNote(app)) return "jev";
  return fastModelOptions(pluginSettings()) ? "generative" : null;
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
// @desc Read one Agent Pro reply as Jev score answers. A reply that already carries `answers` is used as Jev
//   returned it. A reply that carries `scores` names each question with a 1–10 rating, which is shifted down by
//   one so the rest of the pass can treat it as Jev's zero-indexed score. A rating outside 1–10 is left out.
// @param {object|null} result - Parsed callPlugin result.
// @returns {object|null} Answers keyed by question name, or null when the reply names none.
function _answersFromAgentProResult(result) {
  if (result?.answers && typeof result.answers === "object") return result.answers;
  if (!result?.scores || typeof result.scores !== "object") return null;
  const answerEntries = Object.entries(result.scores).map(([questionName, rating]) => {
    const numericRating = Number(rating);
    if (!Number.isFinite(numericRating) || numericRating < 1 || numericRating > 10) return null;
    return [questionName, { confidence: 0, score: numericRating - 1, type: "score" }];
  });
  const answers = Object.fromEntries(answerEntries.filter(Boolean));
  return Object.keys(answers).length ? answers : null;
}

// ----------------------------------------------------------------------------------------------
// @desc Ask Ample Agent Pro to submit one Jev batch. The plugin receives the System One body, then Jev's model and
//   URL, and makes the request itself. A missing or answerless reply throws, so the batch is recorded as failed.
// @param {object} app - Host-compatible Amplenote API.
// @returns {function} async ({ questions, state }) => { answers, model, usage }, as requestJevAnswers returns.
function _agentProJevRequester(app) {
  return async ({ questions, state }) => {
    const prompt = JSON.stringify({ model: JEV_DIRECT_MODEL, questions, state });
    const result = await agentProPrompt(app, prompt, { aiModel: JEV_DIRECT_MODEL, endpoint: JEV_DIRECT_ENDPOINT,
      jsonResponse: true });
    const answers = _answersFromAgentProResult(result);
    if (!answers) throw new Error("Jev response carried no answers");
    return { answers, model: result.model ?? JEV_DIRECT_MODEL, usage: result.usage ?? null };
  };
}

// ----------------------------------------------------------------------------------------------
// @desc Have the pass's scorer rate the pooled tasks with no stored rating. Task details are read only for tasks not
//   yet described this pass, and a pool with nothing uncached makes no request at all.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { accessToken, detailByUuid, dictionary, project, relatedTaskRecords, requestAnswers,
//   scorerConfiguration, taskByUuid, uncachedRecords }.
// @returns {Promise<object>} { failures, rankedTasks }, as from rankProspectiveTasks.
async function _freshRanking(app, { accessToken, detailByUuid, dictionary, project, relatedTaskRecords, requestAnswers,
    scorerConfiguration, taskByUuid, uncachedRecords }) {
  if (!uncachedRecords.length) return { failures: [], rankedTasks: [] };
  const undescribedRecords = uncachedRecords.filter(record => !detailByUuid.has(record.taskUuid));
  const undescribedTasks = undescribedRecords.map(record => taskByUuid.get(record.taskUuid));
  const fetchedDetails = await prospectiveTaskDetails(app, undescribedTasks);
  fetchedDetails.forEach(detail => detailByUuid.set(detail.taskUuid, detail));
  const taskDetails = uncachedRecords.map(record => detailByUuid.get(record.taskUuid));
  return rankProspectiveTasks({ accessToken, batchSize: scorerConfiguration.batchSize,
    concurrentBatches: scorerConfiguration.concurrentBatches, dictionary, project: { ...project, relatedTaskRecords }, taskDetails,
    ...(requestAnswers ? { requestAnswers } : {}) });
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

// ----------------------------------------------------------------------------------------------
// @desc Combine two task-record lists, keeping the first record for a UUID and appending the rest.
// @param {Array<object>} firstRecords - Records that win on a duplicate UUID.
// @param {Array<object>} secondRecords - Records added when their UUID is new.
// @returns {Array<object>} The combined records.
function _unionTaskRecords(firstRecords, secondRecords) {
  const seenUuids = new Set(firstRecords.map(record => record.taskUuid));
  const addedRecords = secondRecords.filter(record => record?.taskUuid && !seenUuids.has(record.taskUuid));
  return [...firstRecords, ...addedRecords];
}
