// Advance the quarterly project task store in the background, after the dashboard has finished loading every
// component. While any project has gone unrefreshed past the staleness window the pass walks all of them, oldest
// first; once none has, one load refreshes the oldest project and keeps going until its time budget is spent, so
// the store stays current without ever competing with the dashboard's own load for bandwidth. With a Jev Access
// Token, or with Ample Agent Pro installed, Jev's ratings decide which unassociated tasks a project takes on, and
// the generative provider is left to suggest ideas. With only a provider key, that provider attributes tasks too.
// Each pass compares the tasks it reads with the domain's task snapshot, so a ranking also rates older tasks edited
// since the project's last complete ranking, which the ranker's creation-time cutoff would otherwise pass over.
import DashboardTaskSnapshotStore from "dashboard/work-queue/dashboard-task-snapshot-store";
import { resolvePlanScope } from "plan-wizard/plan-models";
import { prepareProjectTaskRanker, rankedTaskAssociations } from "plan-wizard/stack-rank/stack-rank-project-tasks";
import { candidateTaskRecords } from "project-candidate-tasks";
import { readVisionGuide } from "plan-wizard/vision-guide-repository";
import { projectsToRefresh, shouldRefreshAnotherProject } from "project-refresh-schedule";
import { generateProjectTaskIdeas } from "project-task-ideas";
import { similarityInputRevision } from "quarter-project-refresh-state";
import QuarterProjectRepository from "quarter-project-repository";
import { fetchDomainOrAllNotesTasks } from "util/all-notes-tasks";
import { dateFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";

const COLLECTION_LOG_LABEL = "[project-task-collection]";
// How many unassociated open tasks one project's prompt may cite. The pool exists so the model can attribute a
// task the local name match missed; sending the user's whole backlog would crowd out the project's own context.
const MAXIMUM_CANDIDATE_TASKS = 40;
// How many changed older tasks one project's ranking may add to its pool, the most recently changed first. A burst
// of edits larger than this is mostly bulk housekeeping, and rating all of it would delay every other project.
const MAXIMUM_CHANGED_TASKS = 150;

// ----------------------------------------------------------------------------------------------
// @desc Run one background refresh pass over a quarter's projects, serially. Each project is written as soon as
//   it is resolved, so a pass interrupted partway (the user closing the dashboard, or the time budget running
//   out) still leaves every project it finished durably stored.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - An object with the following properties:
//   - {string|null} domainName - Active task domain display name
//   - {string|null} domainUuid - Active task domain UUID
//   - {string|null} quarterlyContent - The quarterly plan note's markdown
//   - {Date} [now=new Date()] - Injected for tests
//   - {function} [elapsedMilliseconds] - Injected for tests; how long the pass has spent refreshing
//   - {function} [ideaGenerator=generateProjectTaskIdeas] - Injected for tests
//   - {function} [rankerFactory=prepareProjectTaskRanker] - Injected for tests; resolves to null when neither Jev nor a
//     generative provider can rate
//   - {function} [shouldContinue=() => true] - Consulted before each project so an unmounting dashboard can stop
//   - {DashboardTaskSnapshotStore|null} [taskSnapshotStore] - Injected for tests; null ranks without change tracking
// @returns {Promise<object>} An object with the following properties:
//   - {number} attempted - Projects refreshed and written
//   - {number} failures - Projects whose refresh threw
//   - {string} regimeEm - Which regime selected the projects, "catchUp" or "cycle"
//   - {number} skipped - Projects the pass did not reach
export async function collectProjectTasks(app, { domainName, domainUuid, elapsedMilliseconds = _elapsedSince(Date.now()),
    ideaGenerator = generateProjectTaskIdeas, now = new Date(), quarterlyContent, rankerFactory = prepareProjectTaskRanker,
    shouldContinue = () => true, taskSnapshotStore = new DashboardTaskSnapshotStore({ app }) }) {
  const scope = resolvePlanScope({ domainName, domainUuid, quarter: Math.floor(now.getMonth() / 3) + 1,
    year: now.getFullYear() });
  const guide = await readVisionGuide(app, scope).catch(error => {
    logIfEnabled(`${ COLLECTION_LOG_LABEL } guide unavailable, using quarterly plan alone`, error?.message);
    return null;
  });
  const repository = new QuarterProjectRepository({ app });
  const { projects, storedProjects } = await repository.readMany(scope, { guide, includeInactive: true, quarterlyContent });
  const recordsByUuid = new Map(storedProjects.map(project => [project.uuid, project]));
  if (!projects.length) return { attempted: 0, failures: 0, regimeEm: "catchUp", skipped: 0 };
  const { orderedProjects, regimeEm } = projectsToRefresh({ now, projects, recordsByUuid });
  logIfEnabled(`${ COLLECTION_LOG_LABEL } pass starting`, { candidateCount: orderedProjects.length,
    projectCount: projects.length, regimeEm });
  const tasks = await fetchDomainOrAllNotesTasks(app, domainUuid);
  if (!Array.isArray(tasks)) throw new Error("Could not read tasks for project association");
  const ranker = await _passRanker(app, { domainName, domainUuid, now, projects: orderedProjects, rankerFactory, tasks });
  const taskSnapshot = ranker ? await _reconciledTaskSnapshot(taskSnapshotStore, { domainUuid, tasks }) : null;
  let attempted = 0;
  let failures = 0;
  for (const project of orderedProjects) {
    if (!shouldContinue()) break;
    if (!shouldRefreshAnotherProject({ elapsedMilliseconds: elapsedMilliseconds(), refreshedCount: attempted, regimeEm })) break;
    try {
      const result = await _collectedTaskResult(app, { ideaGenerator, now, project, quarterlyContent, ranker,
        stored: recordsByUuid.get(project.uuid), tasks, taskSnapshot });
      await repository.applyResult(scope, { apply: target => _applyCollectedTaskResult(target, result),
        sourceProject: project });
      attempted += 1;
    } catch (error) {
      failures += 1;
      logIfEnabled(`${ COLLECTION_LOG_LABEL } project failed`, { error: error?.message, project: project.summary });
    }
  }
  const retired = storedProjects.filter(record => record.isActive && !projects.some(project => project.uuid === record.uuid));
  for (const record of retired) {
    if (!shouldContinue()) break;
    try {
      await repository.applyResult(scope, { apply: project => project.setActive(false), projectUuid: record.uuid,
        summary: record.summary });
    } catch (error) {
      logIfEnabled(`${ COLLECTION_LOG_LABEL } could not retire project`, error?.message);
    }
  }
  logIfEnabled(`${ COLLECTION_LOG_LABEL } pass complete`, { attempted, failures, regimeEm, retired: retired.length });
  return { attempted, failures, regimeEm, skipped: projects.length - attempted };
}

// ----------------------------------------------------------------------------------------------
// @desc Apply what one collection pass resolved for a project through its setters. The pass applies it to its own
//   copy before asking for ideas, then the repository applies the final result to the project as the store holds it
//   when written, so a field this pass leaves alone keeps what another pass stored in the meantime. A ranking that
//   failed or was absent leaves the similarity hash and ranking time as stored. The project is in the live plan, so a
//   project the store had retired moves back beneath "Active projects".
// @param {QuarterProject} project - Project to update in place.
//   A complete ranking also records the similarity refresh's success, with the task change watermark it caught up to.
// @param {object} result - From _collectedTaskResult: { attemptedAt, completedTasks, generatedAt, ranking,
//   relatedTaskRecords, relatedTaskUuids, similarityRefresh, suggestedTasks }.
function _applyCollectedTaskResult(project, result) {
  const { attemptedAt, completedTasks, generatedAt, ranking, relatedTaskRecords, relatedTaskUuids, similarityRefresh,
    suggestedTasks } = result;
  if (ranking?.taskSimilarityScores) project.setSimilarityScores(ranking.taskSimilarityScores);
  if (ranking?.rankedAt) project.markRanked(ranking.rankedAt, ranking.searchProgress);
  if (similarityRefresh) project.recordRefreshSuccess("similarity", similarityRefresh);
  project.setActive(true);
  project.setAttemptedAt(attemptedAt);
  project.setCompletedTasks(completedTasks);
  project.setRelatedTaskRecords(relatedTaskRecords);
  project.addRelatedTaskUuids(relatedTaskUuids);
  project.setSuggestedTasks(suggestedTasks, { generatedAt });
}

// ----------------------------------------------------------------------------------------------
// @desc Resolve one project's lists: the open tasks that match it locally, the tasks the provider attributes to
//   it that the local match missed, the completions moved out of that list, and the merged ideas. Unlike the
//   earlier ideas-only pass, the provider is consulted on every refresh, because finding scattered tasks is
//   work the local name match cannot do and a project holding usable ideas still accumulates new tasks.
//
//   When Jev ranked the project, the tasks it accepted join the project before the provider is asked for ideas, and
//   the provider is offered no pool to attribute from, so a task is never claimed twice by two judges. The local
//   match leaves out the tasks the similarity hash holds, since the ranker re-checks those; completions still count
//   them. A ranking that failed outright leaves the provider's pool in place, as though no Jev key were set, and
//   keeps the project's stored similarity hash for the next pass.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { ideaGenerator, now, project, quarterlyContent, ranker, stored, tasks, taskSnapshot };
//   project and stored are QuarterProjects, stored undefined for a project the store has never held. project is the
//   pass's own copy and is updated in place, so the idea prompt sees the tasks already associated. taskSnapshot is
//   the domain's reconciled DashboardTaskSnapshot, or null when it could not be read or saved.
// @returns {Promise<object>} The result _applyCollectedTaskResult writes.
async function _collectedTaskResult(app, { ideaGenerator, now, project, quarterlyContent, ranker, stored, tasks,
    taskSnapshot }) {
  const matchingTasks = tasks.filter(task => task.uuid && project.matchesTask(task));
  const localTasks = matchingTasks.filter(task => project.matchesTask(task, { includeSimilarTasks: false }));
  const openTasks = localTasks.filter(task => !task.completedAt && !task.dismissedAt);
  const matchedTaskRecords = openTasks.map(task => ({ taskText: task.content || "", taskUuid: task.uuid }));
  const storedRatings = stored?.taskSimilarityScores || project.taskSimilarityScores;
  const { changedTaskRecords, watermark } = _similarityChanges(taskSnapshot, { project, stored, tasks });
  const ranking = ranker ? await ranker.rankProject(project, matchedTaskRecords, { changedTaskRecords, storedRatings })
    .catch(error => ({ failureReason: error?.message || "Jev ranking failed" })) : null;
  const rankedTaskRecords = ranking && !ranking.failureReason ? ranking.acceptedTasks : null;
  if (ranking?.failureReason) {
    logIfEnabled(`${ COLLECTION_LOG_LABEL } Jev ranking failed`, { project: project.summary, reason: ranking.failureReason });
  }
  const { associatedRecords } = rankedTaskAssociations(matchedTaskRecords, rankedTaskRecords || []);
  const openTaskTexts = new Set(associatedRecords.map(task => (task.taskText || "").trim().toLowerCase()));
  const keptIdeas = (stored?.suggestedTasks || []).filter(idea => !openTaskTexts.has((idea.taskText || "").trim().toLowerCase()));
  if (stored) project.adoptStoreFields(stored);
  const rankingResult = _rankingResult(ranking, now);
  const similarityRefresh = rankingResult?.rankedAt ? { inputRevision: similarityInputRevision(project,
    { scorerEm: ranker.scorerEm }), succeededAt: rankingResult.rankedAt, watermark } : null;
  const associatedResult = { attemptedAt: now.toISOString(), completedTasks: _completedTaskRecords(matchingTasks, stored),
    generatedAt: null, ranking: rankingResult, relatedTaskRecords: associatedRecords,
    relatedTaskUuids: localTasks.map(task => task.uuid), similarityRefresh, suggestedTasks: keptIdeas };
  _applyCollectedTaskResult(project, associatedResult);
  project.setCandidateTasks(rankedTaskRecords ? [] : candidateTaskRecords(tasks, {
    maximumTaskCount: MAXIMUM_CANDIDATE_TASKS, relatedTaskRecords: matchedTaskRecords }));
  const { foundTasks, suggestedTasks } = await ideaGenerator(app, { project, quarterlyContext: quarterlyContent });
  const foundRecords = foundTasks || [];
  const mergedIdeas = _mergedSuggestedTasks(keptIdeas, suggestedTasks || []);
  const generatedAt = mergedIdeas.length > keptIdeas.length ? now.toISOString() : null;
  const relatedTaskUuids = [...associatedResult.relatedTaskUuids, ...foundRecords.map(task => task.taskUuid)];
  return { ...associatedResult, generatedAt, relatedTaskRecords: [...associatedRecords, ...foundRecords], relatedTaskUuids,
    suggestedTasks: mergedIdeas };
}

// ----------------------------------------------------------------------------------------------
// @desc Move completions into their own list without discarding evidence of a completion that has since
//   aged out of what the task API returns, which is what keeps a project's history from shrinking over a
//   quarter. A task that was reopened or dismissed stops counting as a completion.
// @param {Array<object>} matchingTasks - Tasks matched to this project on this pass.
// @param {object|undefined} stored - The project's previously stored record.
// @returns {Array<object>} Completion records as { completedAt, taskUuid }.
function _completedTaskRecords(matchingTasks, stored) {
  const completedByUuid = new Map((stored?.completedTasks || []).map(task => [task.taskUuid, task]));
  for (const task of matchingTasks) {
    if (task.completedAt && !task.dismissedAt) {
      const completedDate = dateFromDateInput(task.completedAt, { throwOnInvalid: false });
      if (completedDate) completedByUuid.set(task.uuid, { completedAt: completedDate.toISOString(), taskUuid: task.uuid });
    } else completedByUuid.delete(task.uuid);
  }
  return [...completedByUuid.values()];
}

// ----------------------------------------------------------------------------------------------
// @desc Build the clock the pass measures its budget against, as a function so tests can hand the pass a clock
//   they control rather than waiting out a real twenty seconds.
// @param {number} startedAt - Epoch milliseconds the pass began refreshing.
// @returns {function} Returns milliseconds elapsed since the pass began.
function _elapsedSince(startedAt) {
  return () => Date.now() - startedAt;
}

// ----------------------------------------------------------------------------------------------
// @desc Fold the model's returned ideas into the ones the project already holds. An idea naming an earlier one
//   in `beforeTask` replaces it at its original position, so a refinement reads as the same suggestion improved
//   rather than as a second nearly-identical entry the user has to judge twice.
// @param {Array<object>} keptIdeas - Ideas the project holds after pruning ones that became open tasks.
// @param {Array<object>} returnedIdeas - Ideas from the provider as { beforeTask, generatedAt, taskText }.
// @returns {Array<object>} Merged ideas as { generatedAt, taskText }.
function _mergedSuggestedTasks(keptIdeas, returnedIdeas) {
  const mergedIdeas = keptIdeas.map(idea => ({ generatedAt: idea.generatedAt, taskText: idea.taskText }));
  for (const returned of returnedIdeas) {
    const newIdea = { generatedAt: returned.generatedAt, taskText: returned.taskText };
    const supersededIndex = returned.beforeTask
      ? mergedIdeas.findIndex(idea => idea.taskText === returned.beforeTask) : -1;
    if (supersededIndex >= 0) mergedIdeas[supersededIndex] = newIdea;
    else mergedIdeas.push(newIdea);
  }
  return mergedIdeas;
}

// ----------------------------------------------------------------------------------------------
// @desc Prepare the pass's task ranker, refreshing the dictionary from the projects about to be walked. The pass runs
//   in the background, so nobody is waiting on the dictionary's provider call. The ranker rates with Jev, or with
//   the fast model when no Jev key is set. A failure is logged and the pass goes on without ranking, attributing
//   tasks through the generative provider's idea prompt as it would with nothing to rate.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { domainName, domainUuid, now, projects, rankerFactory, tasks }.
// @returns {Promise<object|null>} The ranker, or null when there is none to use.
async function _passRanker(app, { domainName, domainUuid, now, projects, rankerFactory, tasks }) {
  try {
    return await rankerFactory(app, { domainName, domainUuid, now, projects, refineDictionary: true, tasks });
  } catch (error) {
    logIfEnabled(`${ COLLECTION_LOG_LABEL } task ranking unavailable this pass`, error?.message);
    return null;
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Reduce a ranking to what it records on the project. A ranking that succeeded supplies the similarity hash;
//   its time and search progress move forward only when every batch succeeded, so missed tasks are sent again.
// @param {object|null} ranking - From rankProject, or null when nothing could rank.
// @param {Date} now - When the pass ran.
// @returns {object|null} { rankedAt, searchProgress, taskSimilarityScores }, rankedAt null for an incomplete ranking;
//   null when the ranking failed or was absent.
function _rankingResult(ranking, now) {
  if (!ranking || ranking.failureReason) return null;
  const rankedAt = ranking.rankingIncomplete ? null : now.toISOString();
  return { rankedAt, searchProgress: ranking.searchProgress || null, taskSimilarityScores: ranking.taskSimilarityScores || null };
}

// ----------------------------------------------------------------------------------------------
// @desc Bring the domain's task snapshot up to date with this pass's task read. A domain's read holds every open task
//   of the domain; the All Notes fallback scans a capped number of notes and skips any it fails to read, so its read
//   is partial and a task it misses is not taken to have gone. A snapshot that cannot be read or saved is logged and
//   the pass ranks as it did before change tracking. A pass with nothing to rank does not reconcile, since no ranking
//   could catch a project up to the snapshot.
// @param {DashboardTaskSnapshotStore|null} taskSnapshotStore - Store, or null to rank without change tracking.
// @param {object} options - { domainUuid, tasks }.
// @returns {Promise<DashboardTaskSnapshot|null>} The saved snapshot, or null.
async function _reconciledTaskSnapshot(taskSnapshotStore, { domainUuid, tasks }) {
  if (!taskSnapshotStore) return null;
  try {
    const { changedTaskUuids, snapshot } = await taskSnapshotStore.reconcile(domainUuid, tasks, { complete: !!domainUuid });
    logIfEnabled(`${ COLLECTION_LOG_LABEL } task snapshot reconciled`, { changedCount: changedTaskUuids.length,
      sequence: snapshot.sequence });
    return snapshot;
  } catch (error) {
    logIfEnabled(`${ COLLECTION_LOG_LABEL } task snapshot unavailable, ranking without change tracking`, error?.message);
    return null;
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Find the open tasks added or edited since the project's last complete similarity ranking, and the watermark a
//   complete ranking now would catch the project up to. A project never ranked against this snapshot gets no changes,
//   only the watermark, since its ranking searches its first page whatever changed. Changes beyond the cap keep the
//   most recent; the rest are logged and left to the ranker's own creation-time search.
// @param {DashboardTaskSnapshot|null} taskSnapshot - The domain's snapshot, or null when unavailable.
// @param {object} options - { project, stored, tasks }: stored holds the project's recorded watermark.
// @returns {object} { changedTaskRecords, watermark }: changed tasks as { taskText, taskUuid }, and the watermark to
//   record, undefined without a snapshot so the recorded one is kept.
function _similarityChanges(taskSnapshot, { project, stored, tasks }) {
  if (!taskSnapshot) return { changedTaskRecords: [], watermark: undefined };
  const { changes, complete, watermark } = taskSnapshot.changesSince(stored?.refreshState.similarity?.watermark || null);
  const taskByUuid = new Map(tasks.map(task => [task.uuid, task]));
  const openChanges = changes.filter(change => change.status === "open" && taskByUuid.has(change.taskUuid));
  const changedTasks = openChanges.map(change => taskByUuid.get(change.taskUuid));
  const changedTaskRecords = changedTasks.map(task => ({ taskText: task.content || "", taskUuid: task.uuid }));
  const keptRecords = changedTaskRecords.slice(-MAXIMUM_CHANGED_TASKS);
  if (changes.length || !complete) {
    logIfEnabled(`${ COLLECTION_LOG_LABEL } task changes since last ranking`, { changedCount: changedTaskRecords.length,
      complete, omittedCount: changedTaskRecords.length - keptRecords.length, project: project.summary });
  }
  return { changedTaskRecords: keptRecords, watermark };
}
