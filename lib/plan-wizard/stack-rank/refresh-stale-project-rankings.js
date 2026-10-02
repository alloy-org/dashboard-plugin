// Rank the stored projects that have not been rated recently, and any project whose cited tasks still have no
// similarity score, writing the tasks each one accepts into the project task store. Plan Builder starts this when
// it opens: the background collection pass stands down while the builder covers the dashboard, and the builder is
// where a user is deciding what their projects hold. Only task associations are refreshed here. Ideas and the
// collection timestamp are left for the background pass, whose generative provider call this pass deliberately avoids.
import { sourceProjectRows } from "dashboard/plan-wizard/project-sources-page-fields";
import { projectMatchesTask } from "dashboard/project-progress-model";
import { PROJECT_STALENESS_HOURS } from "dashboard/project-refresh-schedule";
import { openProjectTaskStore, readCollectedProjectTasks, writeProjectSection } from "dashboard/project-task-store";
import { resolvePlanScope } from "plan-wizard/plan-models";
import { prepareProjectTaskRanker, projectTaskScorer,
  rankedTaskAssociations } from "plan-wizard/stack-rank/stack-rank-project-tasks";
import { ratingsForTaskUuids, taskMatchScoresByProject } from "plan-wizard/stack-rank/task-rating-cache";
import { readVisionGuide } from "plan-wizard/vision-guide-repository";
import { fetchDomainOrAllNotesTasks } from "util/all-notes-tasks";
import { dateFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";

const REFRESH_LOG_LABEL = "[refresh-stale-project-rankings]";

// ----------------------------------------------------------------------------------------------
// @desc Choose which projects this pass ranks. A project last ranked outside the staleness window is ranked again.
//   Its pool is only the tasks created after that ranking. A project ranked more recently is ranked only for the
//   tasks the sources page cites that still have no similarity score, so a fresh timestamp cannot hide an unrated task.
// @param {object} params - { now, prospects, quarterKey, storedProjects, tasks }.
// @returns {Array<object>} { includeCandidatePool, project, requiredTaskRecords }, stale projects first.
export function projectsDueForRanking({ now, prospects = [], quarterKey = null, storedProjects = [], tasks = [] }) {
  const identifiedProjects = storedProjects.filter(project => project?.uuid);
  const storedByUuid = new Map(identifiedProjects.map(project => [project.uuid, project]));
  const scoresByProject = taskMatchScoresByProject(storedProjects);
  const dueByUuid = new Map();
  for (const stored of storedByUuid.values()) {
    if (!_rankingIsStale(stored, now)) continue;
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
    if (!requiredTaskRecords.length) continue;
    const includeCandidatePool = _rankingIsStale(stored, now);
    dueByUuid.set(row.uuid, { includeCandidatePool, project: stored, requiredTaskRecords });
  }
  const dueProjects = [...dueByUuid.values()];
  const staleProjects = dueProjects.filter(item => item.includeCandidatePool);
  const unscoredProjects = dueProjects.filter(item => !item.includeCandidatePool);
  const oldestFirst = staleProjects.sort((left, right) => _rankedAtMilliseconds(left.project)
    - _rankedAtMilliseconds(right.project));
  return [...oldestFirst, ...unscoredProjects];
}

// ----------------------------------------------------------------------------------------------
// @desc Rank every stored project of the quarter whose last ranking is older than the staleness window, and every
//   project that still has cited tasks with no similarity score, writing each as soon as it is ranked. A project
//   whose ranking failed keeps what the store held. When the fast model rates in place of Jev, the pass stops
//   before a project while the builder is waiting on the provider, so its rating prompts never hold up the page
//   the user is looking at; the next pass resumes it.
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
//   "noScorer" when neither Jev nor a generative provider can rate, "current" when nothing was stale or unscored.
export async function refreshStaleProjectRankings(app, { accessToken, domainName, domainUuid, isProviderBusy = () => false,
    now = new Date(), prospects = null, quarter, rankerFactory = prepareProjectTaskRanker, refineDictionary = true,
    shouldContinue = () => true, year } = {}) {
  const scorerEm = await projectTaskScorer(app, accessToken);
  if (!scorerEm) return { failures: 0, rankedCount: 0, skippedReason: "noScorer" };
  const scope = resolvePlanScope({ domainName, domainUuid, quarter: quarter ?? Math.floor(now.getMonth() / 3) + 1,
    year: year ?? now.getFullYear() });
  const storedProjects = await readCollectedProjectTasks(app, scope);
  const guideProspects = prospects || await _quarterProspects(app, scope);
  const citedByProject = _citedTaskUuidsByProject(guideProspects);
  const shouldRank = _mightNeedRanking({ now, prospects: guideProspects, quarterKey: scope.quarterKey, storedProjects });
  const shouldCompact = _hasUncitedRatings(storedProjects, citedByProject);
  if (!shouldRank && !shouldCompact) {
    logIfEnabled(`${ REFRESH_LOG_LABEL } nothing stale or unscored`, { scorerEm, storedCount: storedProjects.length });
    return { failures: 0, rankedCount: 0, skippedReason: "current" };
  }
  const store = await openProjectTaskStore(app, scope);
  let content = await _compactUncitedRatings(app, { citedByProject, content: store.content,
    noteHandle: store.noteHandle, projects: storedProjects });
  if (!shouldRank) return { failures: 0, rankedCount: 0, skippedReason: "current" };
  const tasks = await fetchDomainOrAllNotesTasks(app, domainUuid);
  if (!Array.isArray(tasks)) throw new Error("Could not read tasks for project ranking");
  const dueProjects = projectsDueForRanking({ now, prospects: guideProspects, quarterKey: scope.quarterKey,
    storedProjects, tasks });
  if (!dueProjects.length) return { failures: 0, rankedCount: 0, skippedReason: "current" };
  const requiredRecords = dueProjects.flatMap(item => item.requiredTaskRecords);
  const tasksForRanker = _tasksCoveringRecords(tasks, requiredRecords);
  const projects = dueProjects.map(item => item.project);
  const ranker = await rankerFactory(app, { accessToken, domainName, domainUuid, now, projects, refineDictionary,
    tasks: tasksForRanker });
  if (!ranker) return { failures: 0, rankedCount: 0, skippedReason: "noScorer" };
  let failures = 0;
  let rankedCount = 0;
  const unscoredTaskCount = dueProjects.reduce((count, item) => count + item.requiredTaskRecords.length, 0);
  logIfEnabled(`${ REFRESH_LOG_LABEL } scoring projects`, { projectCount: dueProjects.length, scorerEm: ranker.scorerEm,
    unscoredTaskCount });
  for (const due of dueProjects) {
    if (!shouldContinue()) break;
    if (ranker.scorerEm === "generative" && isProviderBusy()) break;
    const citedTaskUuids = citedByProject.get(due.project.uuid) || [];
    const rankedProject = await _projectWithRankedTasks(due.project, { citedTaskUuids,
      includeCandidatePool: due.includeCandidatePool, now, ranker, requiredTaskRecords: due.requiredTaskRecords, tasks });
    if (!rankedProject) {
      failures += 1;
      continue;
    }
    content = await writeProjectSection(app, { content, isActive: true, noteHandle: store.noteHandle,
      project: rankedProject });
    rankedCount += 1;
  }
  logIfEnabled(`${ REFRESH_LOG_LABEL } pass complete`, { dictionaryChanges: ranker.dictionaryChanges, failures,
    rankedCount, scorerEm: ranker.scorerEm, unscoredTaskCount });
  return { failures, rankedCount, skippedReason: null };
}

// ----------------------------------------------------------------------------------------------
// @desc A store record for a guide project that has never been written, so its scores have a project to land on.
// @param {object} row - Row from sourceProjectRows.
// @returns {object} An empty project record with that row's identity.
function _blankProject(row) {
  return { completedTasks: [], jevRatings: {}, lastRankedAt: null, relatedTaskRecords: [], relatedTasks: [],
    suggestedTasks: [], summary: row.summary, uuid: row.uuid };
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
// @desc Drop ratings for tasks the sources page does not cite. Those ratings only recorded that the pool had
//   already been judged, which lastRankedAt now records, and a section that keeps all of them cannot be rewritten
//   once several projects have been ranked. Each project is rewritten on its own, so the write stays under the
//   section limit. The project object is updated in place so a later ranking of it does not write the dropped
//   ratings back.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} params - { citedByProject, content, noteHandle, projects }.
// @returns {Promise<string>} Store note markdown after the rewrites.
async function _compactUncitedRatings(app, { citedByProject, content, noteHandle, projects }) {
  let nextContent = content;
  for (const project of projects) {
    const citedTaskUuids = citedByProject.get(project.uuid) || [];
    const keptRatings = ratingsForTaskUuids(project.jevRatings, citedTaskUuids);
    if (Object.keys(keptRatings).length === Object.keys(project.jevRatings || {}).length) continue;
    project.jevRatings = keptRatings;
    nextContent = await writeProjectSection(app, { content: nextContent, isActive: project.isActive !== false,
      noteHandle, project });
  }
  return nextContent;
}

// ----------------------------------------------------------------------------------------------
// @desc Report whether any project stores a rating for a task the sources page does not cite.
// @param {Array<object>} projects - Stored project records.
// @param {Map<string, Array<string>>} citedByProject - Cited task UUIDs keyed by project UUID.
// @returns {boolean} True when a rewrite would drop at least one rating.
function _hasUncitedRatings(projects, citedByProject) {
  return projects.some(project => {
    const citedTaskUuids = citedByProject.get(project.uuid) || [];
    const keptCount = Object.keys(ratingsForTaskUuids(project.jevRatings, citedTaskUuids)).length;
    return keptCount !== Object.keys(project.jevRatings || {}).length;
  });
}

// ----------------------------------------------------------------------------------------------
// @desc Report whether any stored project is stale or any cited task still has no similarity score. This avoids
//   reading every task when the pass has nothing to send.
// @param {object} params - { now, prospects, quarterKey, storedProjects }.
// @returns {boolean} True when the pass should read tasks and rank.
function _mightNeedRanking({ now, prospects, quarterKey, storedProjects }) {
  if (storedProjects.some(project => project?.uuid && _rankingIsStale(project, now))) return true;
  const scoresByProject = taskMatchScoresByProject(storedProjects);
  const quarterProspects = prospects.filter(prospect => !quarterKey || prospect?.quarterKey === quarterKey);
  const projectRows = sourceProjectRows(quarterProspects);
  return projectRows.some(row => row.servedTaskUuids.some(taskUuid => {
    const score = scoresByProject[row.uuid]?.[taskUuid];
    return !Number.isFinite(score);
  }));
}

// ----------------------------------------------------------------------------------------------
// @desc Re-rank one stored project. A stale project keeps its locally matched tasks and adds the ones the ranker
//   accepts, and its lastRankedAt moves forward only when every batch of that pool succeeded. A project ranked
//   only to fill missing scores keeps the associations and the ranking time it already has. Ratings kept in the
//   note are the cited tasks' scores, including any this pass just produced.
// @param {object} project - Stored project record.
// @param {object} options - { citedTaskUuids, includeCandidatePool, now, ranker, requiredTaskRecords, tasks }.
// @returns {Promise<object|null>} The record to write, or null when the ranking failed.
async function _projectWithRankedTasks(project, { citedTaskUuids = [], includeCandidatePool, now, ranker,
    requiredTaskRecords, tasks }) {
  const matchingTasks = tasks.filter(task => task.uuid && projectMatchesTask(project, task));
  const openTasks = matchingTasks.filter(task => !task.completedAt && !task.dismissedAt);
  const matchedTaskRecords = openTasks.map(task => ({ taskText: task.content || "", taskUuid: task.uuid }));
  let ranking = null;
  try {
    ranking = await ranker.rankProject(project, matchedTaskRecords, { limitToRequiredTasks: !includeCandidatePool,
      requiredTaskRecords, storedRatings: project.jevRatings });
  } catch (error) {
    ranking = { failureReason: error?.message || "Jev ranking failed" };
  }
  if (ranking.failureReason) {
    logIfEnabled(`${ REFRESH_LOG_LABEL } ranking failed`, { project: project.summary, reason: ranking.failureReason });
    return null;
  }
  const citedRatings = ratingsForTaskUuids(project.jevRatings, citedTaskUuids);
  const jevRatings = { ...citedRatings, ...(ranking.taskRatings || {}) };
  const rankingCoversPool = includeCandidatePool && !ranking.rankingIncomplete;
  const lastRankedAt = rankingCoversPool ? now.toISOString() : project.lastRankedAt;
  if (!includeCandidatePool) return { ...project, jevRatings, lastRankedAt };
  const { associatedRecords, rememberedTaskUuids } = rankedTaskAssociations(matchedTaskRecords, ranking.acceptedTasks);
  const relatedTasks = [...new Set([...(project.relatedTasks || []), ...rememberedTaskUuids])];
  return { ...project, jevRatings, lastRankedAt, relatedTaskRecords: associatedRecords, relatedTasks };
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
