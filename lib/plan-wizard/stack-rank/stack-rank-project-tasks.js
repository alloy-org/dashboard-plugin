// Attribute open tasks to projects by a rating of how applicable each is. A ranker is prepared once per pass:
// it refreshes the user terms dictionary, then rates each project's pool of open tasks the project does not already
// hold, and accepts the tasks that clear the project's minimum match score (see project-match-scores). Jev rates
// the pool when a Jev key is set. An installed Ample Agent Pro note rates the same pool by asking Agent Pro, through
// callPlugin, to call Jev's model at Jev's URL. Otherwise the generative provider's fast model rates a smaller pool,
// since each of its tasks costs far more than a Jev rating (see generative-task-scores).
// A project that has been ranked stores that time as lastRankedAt. A later pass submits only tasks created after
// it, so the note does not have to keep a rating for every task the project did not take. A project whose first
// page of tasks turned up (almost) nothing similar has the next page searched once, so a project whose work sits
// further back in the backlog is not left empty. The tasks a project's similarity hash holds are re-checked every
// pass: an unchanged one is read from the hash, an edited one is rated again. The ranking log names the cutoff and
// how many open tasks it left out, including tasks whose creation time cannot be read. A cited task is still sent
// when it has no similarity score, and so is an older task the caller reports changed since the project's last
// ranking, which the creation-time cutoff would otherwise leave out after an edit. Task details are cached across projects, since the pools overlap heavily and
// each note read costs a bridge round trip. Both the background collection pass and Plan Builder rank here.
import { devJevAccessToken, SETTING_KEYS } from "constants/settings";
import { candidateTaskPool } from "dashboard/project-candidate-tasks";
import { buildProjectTaskContext } from "plan-wizard/stack-rank/build-project-task-context";
import { generativeScoreRequester } from "plan-wizard/stack-rank/generative-task-scores";
import { acceptedRankedTasks, matchScoresFromSetting, matchScoresWithProjectScore,
  storedMinimumMatchScore } from "plan-wizard/stack-rank/project-match-scores";
import { prospectiveTaskDetails } from "plan-wizard/stack-rank/prospective-task-details";
import { DEFAULT_BATCH_SIZE, DEFAULT_CONCURRENT_BATCHES, rankProspectiveTasks } from "plan-wizard/stack-rank/rank-prospective-tasks";
import { partitionedByStoredRating, similarityScoresAfterRanking, similarTaskCount,
  similarTaskRecords } from "plan-wizard/stack-rank/task-rating-cache";
import { pluginSettings, updatePluginSetting } from "plugin-data";
import { fastModelOptions, findAmpleAgentProNote } from "providers/ai-provider-settings";
import { agentProPrompt } from "providers/fetch-ai-provider";
import { JEV_DIRECT_ENDPOINT, JEV_DIRECT_MODEL, requestJevAnswers } from "providers/jev-client";
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
// @returns {object} { rankProject(project, relatedTaskRecords, options), scorerEm }. options may set
//   changedTaskRecords (open tasks added or edited since the project's last ranking, pooled whatever their creation
//   time and kept in the hash only when similar), limitToRequiredTasks, requiredTaskRecords, and storedRatings (the
//   project's taskSimilarityScores). rankProject
//   resolves to { acceptedTasks, failureReason, minimumMatchScore, rankingIncomplete, ratedCount, searchProgress,
//   taskSimilarityScores } with acceptedTasks as { matchScore, taskText, taskUuid }, highest score first.
//   taskSimilarityScores is the project's whole hash after this ranking (null on failure). searchProgress is
//   { similaritySearchPageCount, similaritySearchedTaskCount } when this ranking searched a new page, else null.
//   rankingIncomplete is true when a batch failed, so the caller leaves lastRankedAt and the search progress where
//   they are and the missed tasks are sent again.
export function createProjectTaskRanker(app, { accessToken, dictionary, requestAnswers, scope, scorerEm = "jev", tasks }) {
  const scorerConfiguration = SCORER_CONFIGURATIONS[scorerEm];
  const identifiedTasks = tasks.filter(task => task?.uuid);
  const taskByUuid = new Map(identifiedTasks.map(task => [task.uuid, task]));
  const detailByUuid = new Map();
  const rankProject = async (project, relatedTaskRecords, { changedTaskRecords = [], limitToRequiredTasks = false,
      requiredTaskRecords = [], storedRatings } = {}) => {
    const search = limitToRequiredTasks ? _requiredTasksOnlySearch()
      : _candidateSearch(identifiedTasks, { project, relatedTaskRecords, scorerEm });
    const requiredRecords = requiredTaskRecords.filter(record => record?.taskUuid
      && String(record.taskText || "").trim());
    const changedRecords = limitToRequiredTasks ? [] : _unassociatedRecords(changedTaskRecords, relatedTaskRecords);
    const recheckedRecords = similarTaskRecords(storedRatings, taskByUuid);
    const searchedRecords = _unionTaskRecords(_unionTaskRecords(search.records, changedRecords), requiredRecords);
    const pooledRecords = _unionTaskRecords(searchedRecords, recheckedRecords);
    const { cachedTasks, ratingKeyByUuid, uncachedRecords } = partitionedByStoredRating(pooledRecords,
      { projectSummary: project.summary, storedRatings });
    const freshRanking = await _freshRanking(app, { accessToken, detailByUuid, dictionary, project, relatedTaskRecords,
      requestAnswers, scorerConfiguration, taskByUuid, uncachedRecords });
    const rankingIncomplete = freshRanking.failures.length > 0;
    if (!cachedTasks.length && !freshRanking.rankedTasks.length && rankingIncomplete) {
      return { acceptedTasks: [], failureReason: freshRanking.failures[0].reason, minimumMatchScore: null,
        rankingIncomplete, ratedCount: 0, searchProgress: null, taskSimilarityScores: null };
    }
    const combinedTasks = [...freshRanking.rankedTasks, ...cachedTasks];
    const rankedTasks = combinedTasks.sort((first, second) => second.rating - first.rating);
    const selection = await _selectionWithStoredMinimum(app, { isComplete: !rankingIncomplete, project, rankedTasks, scope });
    const acceptedTasks = selection.acceptedTasks.map(task => ({ matchScore: task.rating,
      taskText: taskByUuid.get(task.taskUuid)?.content || task.taskText, taskUuid: task.taskUuid }));
    const taskSimilarityScores = similarityScoresAfterRanking({ ratedTasks: rankedTasks, ratingKeyByUuid,
      requiredTaskUuids: requiredRecords.map(record => record.taskUuid), storedScores: storedRatings });
    logIfEnabled(`${ RANKER_LOG_LABEL } ranked project`, { acceptedCount: acceptedTasks.length,
      cachedCount: cachedTasks.length, candidateCount: search.records.length, changedCount: changedRecords.length,
      createdAfter: search.createdAfter,
      excludedBeforeCreatedAfter: search.excludedBeforeCreatedAfter, excludedWithoutCreatedAt: search.excludedWithoutCreatedAt,
      limitToRequiredTasks, minimumMatchScore: selection.minimumMatchScore, project: project.summary, rankingIncomplete,
      recheckedCount: recheckedRecords.length, requiredCount: requiredRecords.length, scorerEm,
      searchProgress: search.searchProgress, sentCount: uncachedRecords.length });
    return { acceptedTasks, failureReason: null, minimumMatchScore: selection.minimumMatchScore, rankingIncomplete,
      ratedCount: rankedTasks.length, searchProgress: search.searchProgress, taskSimilarityScores };
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
// @desc The requester a suggestion ranking uses when Jev itself can answer. A key calls Jev directly. With no
//   key, an installed Ample Agent Pro note is asked to call Jev. Anything else returns null.
// @param {object} app - Host-compatible Amplenote API.
// @param {string} [accessToken] - Explicit Jev key, used by tests.
// @returns {Promise<object|null>} { accessToken, requestAnswers }, or null when Jev cannot be asked.
export async function jevAnswerRequester(app, accessToken) {
  if ((await projectTaskScorer(app, accessToken)) !== "jev") return null;
  const jevToken = jevAccessTokenFromSettings(accessToken);
  if (!jevToken) return { accessToken: null, requestAnswers: _agentProJevRequester(app) };
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
// @desc Join a project's locally matched tasks with the ones the ranker accepted. A task both matched and accepted
//   appears once, carrying its score. Accepted tasks are no longer copied into relatedTasks: the similarity hash
//   remembers them, and re-checks them when their text changes.
// @param {Array<object>} matchedTaskRecords - Open tasks the local match associated, as { taskText, taskUuid }.
// @param {Array<object>} acceptedTasks - From rankProject, as { matchScore, taskText, taskUuid }.
// @returns {object} { associatedRecords }.
export function rankedTaskAssociations(matchedTaskRecords, acceptedTasks) {
  const acceptedUuids = new Set(acceptedTasks.map(task => task.taskUuid));
  const unscoredRecords = matchedTaskRecords.filter(record => !acceptedUuids.has(record.taskUuid));
  return { associatedRecords: [...unscoredRecords, ...acceptedTasks] };
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
// @desc The empty search a ranking limited to its required tasks makes: no pool, and no search progress.
// @returns {object} The same shape _candidateSearch returns.
function _requiredTasksOnlySearch() {
  return { createdAfter: null, excludedBeforeCreatedAfter: 0, excludedWithoutCreatedAt: 0, records: [],
    searchProgress: null };
}

// ----------------------------------------------------------------------------------------------
// @desc Choose the accepted tasks against the project's stored minimum, and save the minimum when it changed.
// @param {object} app - Amplenote app bridge; only setSetting is called.
// @param {object} params - { isComplete, project, rankedTasks, scope }.
// @returns {Promise<object>} { acceptedTasks, minimumMatchScore }, as acceptedRankedTasks returns.
async function _selectionWithStoredMinimum(app, { isComplete, project, rankedTasks, scope }) {
  const scoreScope = { domainUuid: scope.domainUuid, projectUuid: project.uuid, quarter: scope.quarter, year: scope.year };
  const storedScore = storedMinimumMatchScore(matchScoresFromSetting(pluginSettings()?.[SETTING_KEYS.PROJECT_MATCH_SCORES]),
    scoreScope);
  const selection = acceptedRankedTasks(rankedTasks, { isComplete, storedMinimumMatchScore: storedScore });
  if (selection.minimumMatchScore !== null && selection.minimumMatchScore !== storedScore) {
    await _persistMinimumMatchScore(app, { ...scoreScope, minimumMatchScore: selection.minimumMatchScore });
  }
  return selection;
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
