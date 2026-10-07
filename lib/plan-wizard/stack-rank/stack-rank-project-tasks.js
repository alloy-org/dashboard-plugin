// Attribute open tasks to projects by a rating of how applicable each is. A ranker is prepared once per pass: it
// refreshes the user terms dictionary, then rates each project's pool of open tasks the project does not already hold,
// and accepts the tasks that clear the project's minimum match score (see project-match-scores). Jev rates the pool
// when a Jev key is set, or through an installed Ample Agent Pro note (see agent-pro-jev-requester); otherwise the
// generative provider's fast model rates a smaller pool (see generative-task-scores). A ranked project stores that
// time as lastRankedAt, and a later pass submits only tasks created after it; a project whose first page turned up
// (almost) nothing similar has the next page searched once. Tasks the similarity hash holds are re-checked every pass
// by checksum. A cited task with no score is still sent, and so is an older task the caller reports changed since the
// project's last ranking, or reports mentioning a dictionary term whose definition changed since then, which is rated
// again even when the hash holds its rating. A ranking can be rated in slices of whole batches (see project-ranking-progress), so the
// work queue can pause between them. Task details are cached across projects, since the pools overlap heavily.
import { devJevAccessToken, SETTING_KEYS } from "constants/settings";
import { candidateTaskPool } from "dashboard/project-candidate-tasks";
import { agentProJevRequester } from "plan-wizard/stack-rank/agent-pro-jev-requester";
import { buildProjectTaskContext } from "plan-wizard/stack-rank/build-project-task-context";
import { generativeScoreRequester } from "plan-wizard/stack-rank/generative-task-scores";
import { selectionWithStoredMinimum } from "plan-wizard/stack-rank/project-match-scores";
import ProjectRankingProgress from "plan-wizard/stack-rank/project-ranking-progress";
import { prospectiveTaskDetails } from "plan-wizard/stack-rank/prospective-task-details";
import { DEFAULT_BATCH_SIZE, DEFAULT_CONCURRENT_BATCHES, rankProspectiveTasks } from "plan-wizard/stack-rank/rank-prospective-tasks";
import { similarTaskCount, similarTaskRecords } from "plan-wizard/stack-rank/task-rating-cache";
import { pluginSettings } from "plugin-data";
import { fastModelOptions, findAmpleAgentProNote } from "providers/ai-provider-settings";
import { requestJevAnswers } from "providers/jev-client";
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
// A project's search reaches at most this many pages of its rater's pool: the most recent page on its first ranking,
// and the page after it once, when the first turned up too little.
const MAXIMUM_SEARCH_PAGES = 2;
// Fewer similar tasks than this after the first page sends a project's search to the second. Jev rates so cheaply
// that any project with none goes deeper; a generative page costs more, so it goes deeper only when nearly empty.
const SECOND_PAGE_SIMILAR_TASK_LIMITS = { generative: 3, jev: 1 };

// ----------------------------------------------------------------------------------------------
// @desc Build a ranker over one pass's tasks. Ranking a project rates its pool, chooses the accepted tasks, and saves
//   the project's minimum match score when it changed. A project with lastRankedAt set submits only tasks created
//   after that time, unless its search is due a second page (see needsSecondSearchPage); a cited task with no stored
//   score is still submitted, and so is every open task the project's similarity hash holds, whose checksum decides
//   whether it is read from the hash or rated again. The ranking log records the cutoff, how many open tasks it
//   dropped for being older, and how many it dropped for having no readable creation time. A project whose every
//   uncached batch failed, with nothing cached to fall back on, reports the failure and accepts nothing, so its
//   caller can fall back to the generative provider's attribution.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - An object with the following properties:
//   - {string|null} accessToken - TypeSafe or OpenRouter key; unused by the generative scorer
//   - {object} dictionary - Definitions keyed by term
//   - {function} [requestAnswers] - Rating request in requestJevAnswers' shape; required for the generative scorer
//   - {object} scope - Resolved quarter scope the projects belong to
//   - {string} [scorerEm="jev"] - "jev" or "generative", which sets the pool size and batching
//   - {Array<object>} tasks - Every task read for this pass
// @returns {object} { beginRanking(project, relatedTaskRecords, options), rankProject(project, relatedTaskRecords, options),
//   scorerEm, sliceSize }. beginRanking draws the pool and returns a ProjectRankingProgress whose rateNext(sliceSize)
//   rates one slice of whole batches; rankProject rates the whole pool at once. options may set
//   citedTaskUuids (every task the sources page cites, or null when unknown, which decides the low scores the hash
//   keeps; see similarityScoresAfterRanking), changedTaskRecords (open tasks added or edited since the project's last ranking, pooled whatever their creation
//   time and kept in the hash only when similar), limitToRequiredTasks, requiredTaskRecords, rescoredTaskRecords (open
//   tasks mentioning a term whose definition changed since the project's last ranking, pooled whatever their creation
//   time and rated again even when the hash holds their rating), and storedRatings (the project's
//   taskSimilarityScores). rankProject
//   resolves to { acceptedTasks, failureReason, minimumMatchScore, rankingIncomplete, ratedCount, searchProgress,
//   taskSimilarityScores } with acceptedTasks as { matchScore, taskText, taskUuid }, highest score first.
//   taskSimilarityScores is the project's whole hash after this ranking (null on failure). searchProgress is
//   { similaritySearchPageCount, similaritySearchedTaskCount } when this ranking searched a new page, else null.
//   rankingIncomplete is true when a batch failed, so the caller leaves lastRankedAt and the search progress where
//   they are and the missed tasks are sent again. sliceSize is one round of concurrent batches for this rater.
export function createProjectTaskRanker(app, { accessToken, dictionary, requestAnswers, scope, scorerEm = "jev", tasks }) {
  const scorerConfiguration = SCORER_CONFIGURATIONS[scorerEm];
  const identifiedTasks = tasks.filter(task => task?.uuid);
  const taskByUuid = new Map(identifiedTasks.map(task => [task.uuid, task]));
  const detailByUuid = new Map();
  const rateRecords = (project, relatedTaskRecords, uncachedRecords) => _freshRanking(app, { accessToken, detailByUuid,
    dictionary, project, relatedTaskRecords, requestAnswers, scorerConfiguration, taskByUuid, uncachedRecords });
  const selectAcceptedTasks = ({ isComplete, project, rankedTasks }) => selectionWithStoredMinimum(app, { isComplete, project,
    rankedTasks, scope });
  const rankerContext = { rateRecords, scorerEm, selectAcceptedTasks, taskByUuid };
  const beginRanking = (project, relatedTaskRecords, { changedTaskRecords = [], citedTaskUuids = null, limitToRequiredTasks = false,
      requiredTaskRecords = [], rescoredTaskRecords = [], storedRatings } = {}) => {
    const search = limitToRequiredTasks ? _requiredTasksOnlySearch()
      : _candidateSearch(identifiedTasks, { project, relatedTaskRecords, scorerEm });
    const requiredRecords = requiredTaskRecords.filter(record => record?.taskUuid && String(record.taskText || "").trim());
    const changedRecords = limitToRequiredTasks ? [] : _unassociatedRecords(changedTaskRecords, relatedTaskRecords);
    const rescoredRecords = limitToRequiredTasks ? [] : _unassociatedRecords(rescoredTaskRecords, relatedTaskRecords);
    const recheckedRecords = similarTaskRecords(storedRatings, taskByUuid);
    const searchedRecords = _unionTaskRecords(_unionTaskRecords(search.records, changedRecords), requiredRecords);
    const pooledRecords = _unionTaskRecords(_unionTaskRecords(searchedRecords, rescoredRecords), recheckedRecords);
    const rescoredTaskUuids = new Set(rescoredRecords.map(record => record.taskUuid));
    return new ProjectRankingProgress({ changedCount: changedRecords.length, citedTaskUuids, limitToRequiredTasks, pooledRecords, project,
      rankerContext, recheckedCount: recheckedRecords.length, relatedTaskRecords, requiredRecords, rescoredTaskUuids, search,
      storedRatings });
  };
  const rankProject = async (project, relatedTaskRecords, options) => {
    const progress = beginRanking(project, relatedTaskRecords, options);
    await progress.rateNext();
    return progress.finish();
  };
  const sliceSize = scorerConfiguration.batchSize * scorerConfiguration.concurrentBatches;
  return { beginRanking, rankProject, scorerEm, sliceSize };
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
// @desc The requester a suggestion ranking uses when Jev itself can answer. A key calls Jev directly. With no
//   key, an installed Ample Agent Pro note is asked to call Jev. Anything else returns null.
// @param {object} app - Host-compatible Amplenote API.
// @param {string} [accessToken] - Explicit Jev key, used by tests.
// @returns {Promise<object|null>} { accessToken, requestAnswers }, or null when Jev cannot be asked.
export async function jevAnswerRequester(app, accessToken) {
  if ((await projectTaskScorer(app, accessToken)) !== "jev") return null;
  const jevToken = jevAccessTokenFromSettings(accessToken);
  if (!jevToken) return { accessToken: null, requestAnswers: agentProJevRequester(app) };
  return { accessToken: jevToken, requestAnswers: requestJevAnswers };
}

// ----------------------------------------------------------------------------------------------
// @desc Decide whether a ranked project's search should reach its second page on the next ranking. That happens once
//   per project, when its first page was full and turned up fewer similar tasks than its rater's limit: Jev, which
//   is cheap per task, goes deeper whenever it found none; the fast model goes deeper when it found fewer than three
//   and the tasks created since its last ranking would not fill a page on their own. A project ranked before the
//   search was recorded is assumed to have searched one full page.
// @param {object} project - Stored project record.
// @param {object} options - An object with the following properties:
//   - {number} [recentTaskCount=0] - Open tasks created since the project's lastRankedAt
//   - {string} scorerEm - "jev" or "generative"
// @returns {boolean} True when the next ranking should also search the second page.
export function needsSecondSearchPage(project, { recentTaskCount = 0, scorerEm }) {
  const scorerConfiguration = SCORER_CONFIGURATIONS[scorerEm];
  if (!scorerConfiguration || !project?.lastRankedAt) return false;
  const pageSize = scorerConfiguration.candidateTaskLimit;
  const pageCount = Number.isFinite(project.similaritySearchPageCount) ? project.similaritySearchPageCount : 1;
  const searchedCount = Number.isFinite(project.similaritySearchedTaskCount) ? project.similaritySearchedTaskCount
    : pageSize;
  if (pageCount >= MAXIMUM_SEARCH_PAGES || searchedCount < pageSize) return false;
  if (similarTaskCount(project.taskSimilarityScores) >= SECOND_PAGE_SIMILAR_TASK_LIMITS[scorerEm]) return false;
  return scorerEm === "jev" || recentTaskCount < pageSize;
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
//   - {object|null} [providerDispatch=null] - A work runtime's provider dispatcher; when given, every rating request
//     waits for its own permit of the scorer's resource, "jev" or "generative"
//   - {boolean} [refineDictionary=true] - False reads the dictionary without contacting a provider
//   - {function} [requestAnswers] - Injected rating request for tests, used by either scorer
//   - {AbortSignal|null} [signal=null] - Gives up rating requests still waiting for a permit
//   - {Array<object>} tasks - Every task read for this pass
// @returns {Promise<object|null>} The ranker with its dictionary (definitions keyed by term, as its requests read
//   them), dictionaryChanges, and scorerEm, or null when nothing can rate.
export async function prepareProjectTaskRanker(app, { accessToken, domainName, domainUuid, now = new Date(), projects,
    promptRunner, providerDispatch = null, refineDictionary = true, requestAnswers, signal = null, tasks }) {
  const scorerEm = await projectTaskScorer(app, accessToken);
  if (!scorerEm) {
    const reason = `no "${ SETTING_KEYS.JEV_ACCESS_TOKEN }", no Ample Agent Pro, and no generative provider`;
    logIfEnabled(`${ RANKER_LOG_LABEL } ${ reason }; tasks are not ranked`);
    return null;
  }
  const context = await buildProjectTaskContext(app, { domainName, domainUuid, now, projects, promptRunner,
    refineDictionary });
  const jevToken = jevAccessTokenFromSettings(accessToken);
  const agentProJevRequest = scorerEm === "jev" && !jevToken ? agentProJevRequester(app) : null;
  if (agentProJevRequest) {
    logIfEnabled(`${ RANKER_LOG_LABEL } Ample Agent Pro is installed; asking it to call Jev`);
  }
  const generativeRequest = scorerEm === "generative" ? generativeScoreRequester(app, promptRunner ? { promptRunner } : {}) : null;
  const ratingRequest = requestAnswers || agentProJevRequest || generativeRequest;
  const dispatchedRequest = providerDispatch ? _dispatchedRequest(ratingRequest || requestJevAnswers,
    { providerDispatch, resource: scorerEm, signal }) : ratingRequest;
  const ranker = createProjectTaskRanker(app, { accessToken: jevToken, dictionary: context.dictionary,
    requestAnswers: dispatchedRequest, scope: context.scope, scorerEm, tasks });
  return { ...ranker, dictionary: context.dictionary, dictionaryChanges: context.dictionaryChanges };
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
// @desc Join a project's locally matched tasks with the scored ones: those the ranker accepted, or the ones the
//   similarity hash already holds. A task both matched and scored appears once, carrying its score and how it is
//   linked. Accepted tasks are no longer copied into relatedTasks: the similarity hash remembers them, and re-checks
//   them when their text changes.
// @param {Array<object>} matchedTaskRecords - Open tasks the local match associated, as { linkedBy?, taskText, taskUuid }.
// @param {Array<object>} scoredTaskRecords - Scored open tasks, as { matchScore, taskText, taskUuid }.
// @returns {object} { associatedRecords }.
export function rankedTaskAssociations(matchedTaskRecords, scoredTaskRecords) {
  const matchedByUuid = new Map(matchedTaskRecords.map(record => [record.taskUuid, record]));
  const scoredUuids = new Set(scoredTaskRecords.map(task => task.taskUuid));
  const unscoredRecords = matchedTaskRecords.filter(record => !scoredUuids.has(record.taskUuid));
  const linkedScoredRecords = scoredTaskRecords.map(task => {
    const linkedBy = matchedByUuid.get(task.taskUuid)?.linkedBy;
    return linkedBy ? { ...task, linkedBy } : task;
  });
  return { associatedRecords: [...unscoredRecords, ...linkedScoredRecords] };
}

// ----------------------------------------------------------------------------------------------
// @desc Draw the pool a project's ranking searches. A project never ranked searches its rater's first page, the most
//   recently updated open tasks. A ranked project searches the tasks created since its last ranking, plus, when it
//   is due one (see needsSecondSearchPage), the page after its first: the next most recently updated open tasks,
//   whatever their age.
// @param {Array<object>} tasks - Every identified task read for this pass.
// @param {object} options - { project, relatedTaskRecords, scorerEm }.
// @returns {object} { createdAfter, excludedBeforeCreatedAfter, excludedWithoutCreatedAt, records, searchProgress },
//   searchProgress null when no new page was searched.
function _candidateSearch(tasks, { project, relatedTaskRecords, scorerEm }) {
  const pageSize = SCORER_CONFIGURATIONS[scorerEm].candidateTaskLimit;
  const createdAfter = project.lastRankedAt || null;
  const recentPool = candidateTaskPool(tasks, { createdAfter, maximumTaskCount: pageSize, relatedTaskRecords });
  const search = { createdAfter, excludedBeforeCreatedAfter: recentPool.excludedBeforeCreatedAfter,
    excludedWithoutCreatedAt: recentPool.excludedWithoutCreatedAt, records: recentPool.records, searchProgress: null };
  if (!createdAfter) {
    const searchProgress = { similaritySearchPageCount: 1, similaritySearchedTaskCount: recentPool.records.length };
    return { ...search, searchProgress };
  }
  if (!needsSecondSearchPage(project, { recentTaskCount: recentPool.records.length, scorerEm })) return search;
  const deepPool = candidateTaskPool(tasks, { maximumTaskCount: pageSize * MAXIMUM_SEARCH_PAGES, relatedTaskRecords });
  const secondPageRecords = deepPool.records.slice(pageSize);
  const searchProgress = { similaritySearchPageCount: MAXIMUM_SEARCH_PAGES,
    similaritySearchedTaskCount: pageSize + secondPageRecords.length };
  return { ...search, records: _unionTaskRecords(recentPool.records, secondPageRecords), searchProgress };
}

// ----------------------------------------------------------------------------------------------
// @desc Wrap a rating request so each call waits for its own provider permit and returns it when the call ends.
// @param {function} request - Rating request in requestJevAnswers' shape.
// @param {object} options - { providerDispatch, resource, signal }: resource is "jev" or "generative".
// @returns {function} The same request, admitted through the dispatcher.
function _dispatchedRequest(request, { providerDispatch, resource, signal }) {
  return requestOptions => providerDispatch[resource](() => request(requestOptions), { signal });
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
// @desc The empty search a ranking limited to its required tasks makes: no pool, and no search progress.
// @returns {object} The same shape _candidateSearch returns.
function _requiredTasksOnlySearch() {
  return { createdAfter: null, excludedBeforeCreatedAfter: 0, excludedWithoutCreatedAt: 0, records: [],
    searchProgress: null };
}

// ----------------------------------------------------------------------------------------------
// @desc The changed tasks a ranking can pool: open tasks with text that the project does not already hold.
// @param {Array<object>} changedTaskRecords - Changed open tasks, as { taskText, taskUuid }.
// @param {Array<object>} relatedTaskRecords - The project's associated open tasks, as { taskText, taskUuid }.
// @returns {Array<object>} The poolable records.
function _unassociatedRecords(changedTaskRecords, relatedTaskRecords) {
  const associatedUuids = new Set(relatedTaskRecords.map(record => record.taskUuid));
  return changedTaskRecords.filter(record => record?.taskUuid && !associatedUuids.has(record.taskUuid)
    && String(record.taskText || "").trim());
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
