// Rank the stored projects that have not been rated recently, every guide project that has never been rated, any
// project whose search is due its second page, and any project whose cited tasks still have no similarity score,
// writing the tasks each one accepts into the project task store. Plan Builder starts this when it opens: the
// background collection pass stands down while the builder covers the dashboard, and the builder is where a user is
// deciding what their projects hold. With Jev, whose batches answer in about a second, several projects are ranked
// at once; their section writes still go to the note one at a time. Only task associations are refreshed here.
// Ideas and the collection timestamp are left for the background pass, whose generative provider call this pass
// deliberately avoids.
import { sourceProjectRows } from "dashboard/plan-wizard/project-sources-page-fields";
import { PROJECT_STALENESS_HOURS } from "dashboard/project-refresh-schedule";
import { candidateTaskPool } from "dashboard/project-candidate-tasks";
import QuarterProject from "dashboard/quarter-project";
import QuarterProjectRepository from "dashboard/quarter-project-repository";
import { resolvePlanScope } from "plan-wizard/plan-models";
import { needsSecondSearchPage, prepareProjectTaskRanker, projectTaskScorer,
  rankedTaskAssociations } from "plan-wizard/stack-rank/stack-rank-project-tasks";
import { retainedSimilarityScores, taskMatchScoresByProject } from "plan-wizard/stack-rank/task-rating-cache";
import { readVisionGuide } from "plan-wizard/vision-guide-repository";
import { fetchDomainOrAllNotesTasks } from "util/all-notes-tasks";
import { dateFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";

// Projects Jev ranks at once. Each already keeps several batches in flight, so a handful of projects keeps Jev busy
// without opening dozens of requests at a time.
export const CONCURRENT_JEV_PROJECT_RANKINGS = 6;
const REFRESH_LOG_LABEL = "[refresh-stale-project-rankings]";

// ----------------------------------------------------------------------------------------------
// @desc Choose which projects this pass ranks. A project last ranked outside the staleness window is ranked again,
//   as is a guide project the store has never ranked, and a project whose search is due its second page. Such a
//   project's pool is the tasks created after its last ranking (all of them when it has none), plus the second page
//   when due. A project ranked more recently is ranked only for the tasks the sources page cites that still have no
//   similarity score, so a fresh timestamp cannot hide an unrated task.
// @param {object} params - { now, prospects, quarterKey, scorerEm, storedProjects, tasks }. scorerEm is "jev" or
//   "generative"; without it, no project is due its second page.
// @returns {Array<object>} { includeCandidatePool, project, requiredTaskRecords }, pooled projects first.
export function projectsDueForRanking({ now, prospects = [], quarterKey = null, scorerEm = null, storedProjects = [],
    tasks = [] }) {
  const identifiedProjects = storedProjects.filter(project => project?.uuid);
  const storedByUuid = new Map(identifiedProjects.map(project => [project.uuid, project]));
  const scoresByProject = taskMatchScoresByProject(storedProjects);
  const dueByUuid = new Map();
  for (const stored of storedByUuid.values()) {
    if (!_needsPooledRanking(stored, { now, scorerEm, tasks })) continue;
    dueByUuid.set(stored.uuid, { includeCandidatePool: true, project: stored, requiredTaskRecords: [] });
  }
  const quarterProspects = prospects.filter(prospect => !quarterKey || prospect?.quarterKey === quarterKey);
  const projectRows = sourceProjectRows(quarterProspects);
  for (const row of projectRows) {
    const stored = storedByUuid.get(row.uuid) || _blankProject(row);
    const prospect = quarterProspects.find(candidate => candidate.uuid === row.uuid);
    const scores = scoresByProject[row.uuid] || {};
    const requiredTaskRecords = _unscoredTaskRecords(row, { prospect, scores, tasks });
    const existing = dueByUuid.get(row.uuid);
    if (existing) {
      existing.requiredTaskRecords = requiredTaskRecords;
      continue;
    }
    const includeCandidatePool = _needsPooledRanking(stored, { now, scorerEm, tasks });
    if (!includeCandidatePool && !requiredTaskRecords.length) continue;
    dueByUuid.set(row.uuid, { includeCandidatePool, project: stored, requiredTaskRecords });
  }
  const dueProjects = [...dueByUuid.values()];
  const pooledProjects = dueProjects.filter(item => item.includeCandidatePool);
  const unscoredProjects = dueProjects.filter(item => !item.includeCandidatePool);
  const oldestFirst = pooledProjects.sort((left, right) => _rankedAtMilliseconds(left.project)
    - _rankedAtMilliseconds(right.project));
  return [...oldestFirst, ...unscoredProjects];
}

// ----------------------------------------------------------------------------------------------
// @desc Rank every project projectsDueForRanking selects, writing each as soon as it is ranked. A project whose
//   ranking failed keeps what the store held. Jev ranks up to CONCURRENT_JEV_PROJECT_RANKINGS projects at once.
//   When the fast model rates in place of Jev, projects are ranked one at a time and the pass stops before a
//   project while the builder is waiting on the provider, so its rating prompts never hold up the page the user is
//   looking at; the next pass resumes it.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - An object with the following properties:
//   - {string} [accessToken] - Jev key; defaults to the Jev Access Token plugin setting
//   - {string|null} domainName - Active task domain display name
//   - {string|null} domainUuid - Active task domain UUID
//   - {function} [isProviderBusy=() => false] - True while the builder waits on a generative provider response
//   - {Date} [now=new Date()] - Injected for tests
//   - {Array<object>|null} [prospects=null] - Guide projects, injected for tests; otherwise read from the Vision Guide
//   - {number} [quarter] - Quarter being planned; the calendar quarter of now when omitted
//   - {function} [rankerFactory=prepareProjectTaskRanker] - Injected for tests
//   - {boolean} [refineDictionary=true] - False when the user is waiting on the generative provider
//   - {function} [shouldContinue=() => true] - Consulted before each project
//   - {number} [year] - Year of that quarter; the year of now when omitted
// @returns {Promise<object>} { failures, rankedCount, skippedReason }, skippedReason null when the pass ran, and
//   "noScorer" when neither Jev nor a generative provider can rate, "current" when nothing was due.
export async function refreshStaleProjectRankings(app, { accessToken, domainName, domainUuid, isProviderBusy = () => false,
    now = new Date(), prospects = null, quarter, rankerFactory = prepareProjectTaskRanker, refineDictionary = true,
    shouldContinue = () => true, year } = {}) {
  const scorerEm = await projectTaskScorer(app, accessToken);
  if (!scorerEm) return { failures: 0, rankedCount: 0, skippedReason: "noScorer" };
  const scope = resolvePlanScope({ domainName, domainUuid, quarter: quarter ?? Math.floor(now.getMonth() / 3) + 1,
    year: year ?? now.getFullYear() });
  const repository = new QuarterProjectRepository({ app });
  const storedProjects = await repository.readStored(scope, { includeInactive: true });
  const guideProspects = prospects || await _quarterProspects(app, scope);
  const citedByProject = _citedTaskUuidsByProject(guideProspects);
  const shouldRank = _mightNeedRanking({ now, prospects: guideProspects, quarterKey: scope.quarterKey, scorerEm,
    storedProjects });
  const shouldCompact = _hasDroppableScores(storedProjects, citedByProject);
  if (!shouldRank && !shouldCompact) {
    logIfEnabled(`${ REFRESH_LOG_LABEL } nothing stale or unscored`, { scorerEm, storedCount: storedProjects.length });
    return { failures: 0, rankedCount: 0, skippedReason: "current" };
  }
  await _compactSimilarityScores(repository, { citedByProject, projects: storedProjects, scope });
  if (!shouldRank) return { failures: 0, rankedCount: 0, skippedReason: "current" };
  const tasks = await fetchDomainOrAllNotesTasks(app, domainUuid);
  if (!Array.isArray(tasks)) throw new Error("Could not read tasks for project ranking");
  const dueProjects = projectsDueForRanking({ now, prospects: guideProspects, quarterKey: scope.quarterKey, scorerEm,
    storedProjects, tasks });
  if (!dueProjects.length) return { failures: 0, rankedCount: 0, skippedReason: "current" };
  const tasksForRanker = _tasksCoveringRecords(tasks, dueProjects.flatMap(item => item.requiredTaskRecords));
  const ranker = await rankerFactory(app, { accessToken, domainName, domainUuid, now,
    projects: dueProjects.map(item => item.project), refineDictionary, tasks: tasksForRanker });
  if (!ranker) return { failures: 0, rankedCount: 0, skippedReason: "noScorer" };
  const unscoredTaskCount = dueProjects.reduce((count, item) => count + item.requiredTaskRecords.length, 0);
  logIfEnabled(`${ REFRESH_LOG_LABEL } scoring projects`, { projectCount: dueProjects.length, scorerEm: ranker.scorerEm,
    unscoredTaskCount });
  const { failures, rankedCount } = await _rankDueProjects(repository, { citedByProject, dueProjects, isProviderBusy, now,
    ranker, scope, shouldContinue, tasks });
  logIfEnabled(`${ REFRESH_LOG_LABEL } pass complete`, { dictionaryChanges: ranker.dictionaryChanges, failures,
    rankedCount, scorerEm: ranker.scorerEm, unscoredTaskCount });
  return { failures, rankedCount, skippedReason: null };
}

// ----------------------------------------------------------------------------------------------
// @desc Apply one project's ranking through its setters: the compacted similarity hash always, and for a pooled ranking
//   its accepted tasks, plus its ranking time and search progress when every batch succeeded.
// @param {QuarterProject} project - Project as the store holds it, updated in place.
// @param {object} result - From _projectRankingResult: { rankedAt, relatedTaskRecords, searchProgress,
//   taskSimilarityScores }; rankedAt and relatedTaskRecords are null when they should not change.
function _applyRankingResult(project, { rankedAt, relatedTaskRecords, searchProgress, taskSimilarityScores }) {
  project.setSimilarityScores(taskSimilarityScores);
  if (rankedAt) project.markRanked(rankedAt, searchProgress);
  if (relatedTaskRecords) project.setRelatedTaskRecords(relatedTaskRecords);
}

// ----------------------------------------------------------------------------------------------
// @desc A store project for a guide project that has never been written, so its scores have a project to land on.
// @param {object} row - Row from sourceProjectRows.
// @returns {QuarterProject} An empty project with that row's identity.
function _blankProject(row) {
  return new QuarterProject({ summary: row.summary, uuid: row.uuid });
}

// ----------------------------------------------------------------------------------------------
// @desc Map each guide project to the task UUIDs the sources page cites for it.
// @param {Array<object>} prospects - Guide prospects for the quarter.
// @returns {Map<string, Array<string>>} Cited task UUIDs keyed by project UUID.
function _citedTaskUuidsByProject(prospects) {
  const rows = sourceProjectRows(prospects);
  return new Map(rows.map(row => [row.uuid, row.servedTaskUuids]));
}

// ----------------------------------------------------------------------------------------------
// @desc Drop the scores a project no longer needs: low scores for tasks the sources page does not cite. Those only
//   recorded that the pool had already been judged, which lastRankedAt now records. Each project is rewritten on its
//   own, so the write stays under the section limit, and the scores dropped are judged against the project as the
//   store holds it when written, so a score another pass has just added is judged rather than lost. The project
//   object is updated in place so a later ranking of it does not write the dropped scores back.
// @param {QuarterProjectRepository} repository - Writes the project task store.
// @param {object} params - { citedByProject, projects, scope }.
// @returns {Promise<void>}
async function _compactSimilarityScores(repository, { citedByProject, projects, scope }) {
  for (const project of projects) {
    const citedTaskUuids = citedByProject.get(project.uuid) || [];
    const keptScores = retainedSimilarityScores(project.taskSimilarityScores, citedTaskUuids);
    if (Object.keys(keptScores).length === Object.keys(project.taskSimilarityScores || {}).length) continue;
    project.setSimilarityScores(keptScores);
    const compact = target => target.setSimilarityScores(retainedSimilarityScores(target.taskSimilarityScores,
      citedTaskUuids));
    await repository.applyResult(scope, { apply: compact, projectUuid: project.uuid, summary: project.summary });
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Report whether any project stores a score _compactSimilarityScores would drop.
// @param {Array<object>} projects - Stored project records.
// @param {Map<string, Array<string>>} citedByProject - Cited task UUIDs keyed by project UUID.
// @returns {boolean} True when a rewrite would drop at least one score.
function _hasDroppableScores(projects, citedByProject) {
  return projects.some(project => {
    const citedTaskUuids = citedByProject.get(project.uuid) || [];
    const keptCount = Object.keys(retainedSimilarityScores(project.taskSimilarityScores, citedTaskUuids)).length;
    return keptCount !== Object.keys(project.taskSimilarityScores || {}).length;
  });
}

// ----------------------------------------------------------------------------------------------
// @desc Report whether any project is due a pooled ranking, any guide project has never been ranked, or any cited
//   task still has no similarity score. This avoids reading every task when the pass has nothing to send. Tasks are
//   not read yet, so a fast-model project counts as due its second page whatever has been created since.
// @param {object} params - { now, prospects, quarterKey, scorerEm, storedProjects }.
// @returns {boolean} True when the pass should read tasks and rank.
function _mightNeedRanking({ now, prospects, quarterKey, scorerEm, storedProjects }) {
  const identifiedProjects = storedProjects.filter(project => project?.uuid);
  if (identifiedProjects.some(project => _needsPooledRanking(project, { now, scorerEm, tasks: [] }))) return true;
  const storedUuids = new Set(identifiedProjects.map(project => project.uuid));
  const scoresByProject = taskMatchScoresByProject(storedProjects);
  const quarterProspects = prospects.filter(prospect => !quarterKey || prospect?.quarterKey === quarterKey);
  const projectRows = sourceProjectRows(quarterProspects);
  if (projectRows.some(row => !storedUuids.has(row.uuid))) return true;
  return projectRows.some(row => row.servedTaskUuids.some(taskUuid => {
    const score = scoresByProject[row.uuid]?.[taskUuid];
    return !Number.isFinite(score);
  }));
}

// ----------------------------------------------------------------------------------------------
// @desc Decide whether a project's ranking should search a pool rather than only its unscored cited tasks: it was
//   never ranked, its ranking has aged past the staleness window, or its search is due a second page. A project the
//   background pass retired to Past projects is not searched again; only its cited tasks are scored.
// @param {object} project - Stored project record.
// @param {object} params - { now, scorerEm, tasks }; tasks count the open tasks created since its last ranking.
// @returns {boolean} True when the project's candidate pool should be ranked.
function _needsPooledRanking(project, { now, scorerEm, tasks }) {
  if (project.isActive === false) return false;
  if (_rankingIsStale(project, now)) return true;
  if (!scorerEm) return false;
  const recentPool = candidateTaskPool(tasks, { createdAfter: project.lastRankedAt, maximumTaskCount: tasks.length,
    relatedTaskRecords: [] });
  return needsSecondSearchPage(project, { recentTaskCount: recentPool.records.length, scorerEm });
}

// ----------------------------------------------------------------------------------------------
// @desc Re-rank one stored project. A pooled project keeps its locally matched tasks and adds the ones the ranker
//   accepts, and its lastRankedAt and search progress move forward only when every batch of that pool succeeded. A
//   project ranked only to fill missing scores keeps the associations and the ranking time it already has. The
//   similarity hash kept in the note is the ranker's, compacted to similar tasks and the tasks the page cites.
// @param {QuarterProject} project - Stored project; left unchanged.
// @param {object} options - { citedTaskUuids, includeCandidatePool, now, ranker, requiredTaskRecords, tasks }.
// @returns {Promise<object|null>} The result _applyRankingResult writes, or null when the ranking failed.
async function _projectRankingResult(project, { citedTaskUuids = [], includeCandidatePool, now, ranker,
    requiredTaskRecords, tasks }) {
  const isLocalMatch = task => task.uuid && project.matchesTask(task, { includeSimilarTasks: false });
  const matchingTasks = tasks.filter(isLocalMatch);
  const openTasks = matchingTasks.filter(task => !task.completedAt && !task.dismissedAt);
  const matchedTaskRecords = openTasks.map(task => ({ taskText: task.content || "", taskUuid: task.uuid }));
  let ranking = null;
  try {
    ranking = await ranker.rankProject(project, matchedTaskRecords, { limitToRequiredTasks: !includeCandidatePool,
      requiredTaskRecords, storedRatings: project.taskSimilarityScores });
  } catch (error) {
    ranking = { failureReason: error?.message || "Jev ranking failed" };
  }
  if (ranking.failureReason) {
    logIfEnabled(`${ REFRESH_LOG_LABEL } ranking failed`, { project: project.summary, reason: ranking.failureReason });
    return null;
  }
  const rankedScores = ranking.taskSimilarityScores || project.taskSimilarityScores;
  const taskSimilarityScores = retainedSimilarityScores(rankedScores, citedTaskUuids);
  if (!includeCandidatePool) return { rankedAt: null, relatedTaskRecords: null, searchProgress: null, taskSimilarityScores };
  const rankedAt = ranking.rankingIncomplete ? null : now.toISOString();
  const { associatedRecords } = rankedTaskAssociations(matchedTaskRecords, ranking.acceptedTasks);
  return { rankedAt, relatedTaskRecords: associatedRecords, searchProgress: ranking.searchProgress || null,
    taskSimilarityScores };
}

// ----------------------------------------------------------------------------------------------
// @desc Read the quarter's guide projects. A missing guide leaves the pass with the store alone.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} scope - Resolved plan scope.
// @returns {Promise<Array<object>>} Prospect records from the guide.
async function _quarterProspects(app, scope) {
  const guide = await readVisionGuide(app, scope);
  const envelopes = [guide?.workProspects, guide?.personalProspects].filter(Boolean);
  return envelopes.flatMap(envelope => envelope.prospects || []);
}

// ----------------------------------------------------------------------------------------------
// @desc Rank the due projects and write each one as its ranking completes. Jev rankings run up to
//   CONCURRENT_JEV_PROJECT_RANKINGS at a time; fast-model rankings run one at a time and stop while the builder waits
//   on the provider. The repository's note writer applies one result at a time to the store as it then stands,
//   whatever order the rankings finish in.
// @param {QuarterProjectRepository} repository - Writes the project task store.
// @param {object} options - { citedByProject, dueProjects, isProviderBusy, now, ranker, scope, shouldContinue, tasks }.
// @returns {Promise<object>} { failures, rankedCount }.
async function _rankDueProjects(repository, { citedByProject, dueProjects, isProviderBusy, now, ranker, scope,
    shouldContinue, tasks }) {
  const isGenerative = ranker.scorerEm === "generative";
  const workerCount = isGenerative ? 1 : Math.max(1, Math.min(CONCURRENT_JEV_PROJECT_RANKINGS, dueProjects.length));
  const counts = { failures: 0, rankedCount: 0 };
  let nextIndex = 0;
  const rankRemainingProjects = async () => {
    while (nextIndex < dueProjects.length) {
      if (!shouldContinue() || (isGenerative && isProviderBusy())) return;
      const { includeCandidatePool, project, requiredTaskRecords } = dueProjects[nextIndex];
      nextIndex += 1;
      const citedTaskUuids = citedByProject.get(project.uuid) || [];
      const result = await _projectRankingResult(project, { citedTaskUuids, includeCandidatePool, now, ranker,
        requiredTaskRecords, tasks });
      if (!result) {
        counts.failures += 1;
        continue;
      }
      await repository.applyResult(scope, { apply: target => _applyRankingResult(target, result),
        isActive: project.isActive !== false, projectUuid: project.uuid, summary: project.summary });
      counts.rankedCount += 1;
    }
  };
  await Promise.all(Array.from({ length: workerCount }, rankRemainingProjects));
  return counts;
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

// ----------------------------------------------------------------------------------------------
// @desc Add a task record for every cited task the fetched task list does not already contain, so the ranker can
//   describe a completed or evidence-only task.
// @param {Array<object>} tasks - Tasks read for the pass.
// @param {Array<object>} records - Required task records, as { noteUuid, taskText, taskUuid }.
// @returns {Array<object>} The fetched tasks plus a synthetic task for each missing UUID.
function _tasksCoveringRecords(tasks, records) {
  const coveredUuids = new Set(tasks.map(task => task.uuid));
  const addedTasks = records.filter(record => record.taskUuid && !coveredUuids.has(record.taskUuid))
    .map(record => ({ content: record.taskText, noteUUID: record.noteUuid || null, uuid: record.taskUuid }));
  return addedTasks.length ? [...tasks, ...addedTasks] : tasks;
}

// ----------------------------------------------------------------------------------------------
// @desc The cited tasks that still have no stored similarity, with enough text for a rater to judge them.
// @param {object} row - Row from sourceProjectRows, carrying servedTaskUuids.
// @param {object} params - { prospect, scores, tasks }. scores is { [taskUuid]: number }.
// @returns {Array<object>} { noteUuid, taskText, taskUuid }.
function _unscoredTaskRecords(row, { prospect, scores, tasks }) {
  const taskByUuid = new Map(tasks.map(task => [task.uuid, task]));
  const textByUuid = new Map();
  const noteByUuid = new Map();
  for (const item of prospect?.evidence || []) {
    if (!item?.taskUuid) continue;
    if (item.text) textByUuid.set(item.taskUuid, item.text);
    if (item.noteUuid) noteByUuid.set(item.taskUuid, item.noteUuid);
  }
  const records = [];
  for (const taskUuid of row.servedTaskUuids) {
    if (Number.isFinite(scores[taskUuid])) continue;
    const task = taskByUuid.get(taskUuid);
    const taskText = String(task?.content || textByUuid.get(taskUuid) || "").trim();
    if (!taskText) continue;
    records.push({ noteUuid: task?.noteUUID || noteByUuid.get(taskUuid) || null, taskText, taskUuid });
  }
  return records;
}
