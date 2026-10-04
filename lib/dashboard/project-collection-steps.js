// The steps that refresh one project's task lists, shared by the background collection pass and the work queue's
// project handlers so both produce the same project from the same reads. A refresh matches the project's tasks
// locally, ranks the tasks it might own, folds the ranking into its associations, completions, and kept ideas, and
// then asks the generative provider for ideas and for tasks the local match missed. The collection pass runs every
// step in one go; the queue runs the ranking and the idea request as separate jobs.
import { rankedTaskAssociations } from "plan-wizard/stack-rank/stack-rank-project-tasks";
import { candidateTaskRecords } from "project-candidate-tasks";
import { similarityInputRevision } from "quarter-project-refresh-state";
import { dateFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";

const COLLECTION_LOG_LABEL = "[project-task-collection]";
// How many unassociated open tasks one project's prompt may cite. The pool exists so the model can attribute a
// task the local name match missed; sending the user's whole backlog would crowd out the project's own context.
export const MAXIMUM_CANDIDATE_TASKS = 40;
// How many changed older tasks one project's ranking may add to its pool, the most recently changed first. A burst
// of edits larger than this is mostly bulk housekeeping, and rating all of it would delay every other project.
export const MAXIMUM_CHANGED_TASKS = 150;

// ----------------------------------------------------------------------------------------------
// @desc Apply what a refresh resolved for a project through its setters. A ranking that failed or was absent leaves
//   the similarity hash and ranking time as stored; a complete ranking also records the similarity refresh's success,
//   with the task change watermark it caught up to. The project is in the live plan, so a project the store had
//   retired moves back beneath "Active projects".
// @param {QuarterProject} project - Project to update in place.
// @param {object} result - { attemptedAt, completedTasks, generatedAt, ranking, relatedTaskRecords, relatedTaskUuids,
//   similarityRefresh, suggestedTasks }, from associationResult, optionally extended by withGeneratedIdeas.
export function applyCollectedTaskResult(project, result) {
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
// @desc Fold a ranking into the project's associations: the locally matched open tasks joined with the ones the
//   ranking accepted, the completions moved out of that list, and the stored ideas that have not since become open
//   tasks. The project then takes the store's fields, so what follows sees what the store holds. A ranking that failed
//   outright, or that nothing could make, leaves the similarity hash as stored.
// @param {object} options - An object with the following properties:
//   - {object} [dictionaryPosition] - { revisionsId, sequence } of the term revisions a complete ranking read; undefined
//     keeps the stored one
//   - {object} matches - From projectTaskMatches
//   - {Date} now - When the refresh ran
//   - {QuarterProject} project - The refresh's own copy of the live project; takes the store's fields in place
//   - {object|null} ranking - From rankProject, or null when nothing could rank
//   - {string|null} scorerEm - Which rater ranked, recorded in the similarity input revision
//   - {QuarterProject|undefined} stored - The project as the store held it, undefined for a project new to the store
//   - {object|undefined} watermark - Task change watermark a complete ranking caught up to; undefined keeps the stored one
// @returns {object} { rankedTaskRecords, result }: the accepted tasks, null when the ranking failed or was absent, and
//   the result applyCollectedTaskResult writes.
export function associationResult({ dictionaryPosition, matches, now, project, ranking, scorerEm, stored, watermark }) {
  const rankedTaskRecords = ranking && !ranking.failureReason ? ranking.acceptedTasks : null;
  const { associatedRecords } = rankedTaskAssociations(matches.matchedTaskRecords, rankedTaskRecords || []);
  const openTaskTexts = new Set(associatedRecords.map(task => (task.taskText || "").trim().toLowerCase()));
  const keptIdeas = (stored?.suggestedTasks || []).filter(idea => !openTaskTexts.has((idea.taskText || "").trim().toLowerCase()));
  if (stored) project.adoptStoreFields(stored);
  const rankingResult = _rankingResult(ranking, now);
  const similarityRefresh = rankingResult?.rankedAt ? { dictionaryPosition, inputRevision: similarityInputRevision(project,
    { scorerEm }), succeededAt: rankingResult.rankedAt, watermark } : null;
  const result = { attemptedAt: now.toISOString(), completedTasks: _completedTaskRecords(matches.matchingTasks, stored),
    generatedAt: null, ranking: rankingResult, relatedTaskRecords: associatedRecords,
    relatedTaskUuids: matches.localTasks.map(task => task.uuid), similarityRefresh, suggestedTasks: keptIdeas };
  return { rankedTaskRecords, result };
}

// ----------------------------------------------------------------------------------------------
// @desc Ask the idea generator for the project's ideas and for tasks it can attribute from the project's candidate
//   pool, and merge the returned ideas into the ones it keeps.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { ideaGenerator, keptIdeas, now, project, quarterlyContent }. project carries the
//   associations and candidate tasks the prompt describes.
// @returns {Promise<object>} { failureReason, foundRecords, generatedAt, mergedIdeas, requestFailed }: generatedAt is now
//   when an idea was added, else null; requestFailed is true when the provider call itself failed.
export async function generatedIdeas(app, { ideaGenerator, keptIdeas, now, project, quarterlyContent }) {
  const response = await ideaGenerator(app, { project, quarterlyContext: quarterlyContent });
  const mergedIdeas = _mergedSuggestedTasks(keptIdeas, response.suggestedTasks || []);
  const generatedAt = mergedIdeas.length > keptIdeas.length ? now.toISOString() : null;
  return { failureReason: response.failureReason || null, foundRecords: response.foundTasks || [], generatedAt, mergedIdeas,
    requestFailed: Boolean(response.requestFailed) };
}

// ----------------------------------------------------------------------------------------------
// @desc The pool of unassociated open tasks the idea prompt may attribute to the project. A project a rater has
//   judged is offered none, so a task is never claimed twice by two judges.
// @param {Array<object>} tasks - Every task read for this refresh.
// @param {object} options - { offerPool, relatedTaskRecords }: relatedTaskRecords are left out of the pool.
// @returns {Array<object>} Candidate tasks as { taskText, taskUuid }.
export function ideaCandidateTasks(tasks, { offerPool, relatedTaskRecords }) {
  if (!offerPool) return [];
  return candidateTaskRecords(tasks, { maximumTaskCount: MAXIMUM_CANDIDATE_TASKS, relatedTaskRecords });
}

// ----------------------------------------------------------------------------------------------
// @desc Match a project's tasks locally. The local match leaves out the tasks the similarity hash holds, since the
//   ranker re-checks those; completions still count them.
// @param {QuarterProject} project - Project to match.
// @param {Array<object>} tasks - Every task read for this refresh.
// @returns {object} { localTasks, matchedTaskRecords, matchingTasks }: tasks matched by name, their open ones as
//   { taskText, taskUuid }, and every task matched by name or similarity.
export function projectTaskMatches(project, tasks) {
  const matchingTasks = tasks.filter(task => task.uuid && project.matchesTask(task));
  const localTasks = matchingTasks.filter(task => project.matchesTask(task, { includeSimilarTasks: false }));
  const openTasks = localTasks.filter(task => !task.completedAt && !task.dismissedAt);
  const matchedTaskRecords = openTasks.map(task => ({ taskText: task.content || "", taskUuid: task.uuid }));
  return { localTasks, matchedTaskRecords, matchingTasks };
}

// ----------------------------------------------------------------------------------------------
// @desc Bring the domain's task snapshot up to date with a refresh's task read. A domain's read holds every open task
//   of the domain; the All Notes fallback scans a capped number of notes and skips any it fails to read, so its read
//   is partial and a task it misses is not taken to have gone. A snapshot that cannot be read or saved is logged and
//   the refresh ranks as it did before change tracking.
// @param {DashboardTaskSnapshotStore|null} taskSnapshotStore - Store, or null to rank without change tracking.
// @param {object} options - { domainUuid, tasks }.
// @returns {Promise<DashboardTaskSnapshot|null>} The saved snapshot, or null.
export async function reconciledTaskSnapshot(taskSnapshotStore, { domainUuid, tasks }) {
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
export function similarityChanges(taskSnapshot, { project, stored, tasks }) {
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

// ----------------------------------------------------------------------------------------------
// @desc Extend an association result with what the idea generator returned: the tasks it attributed join the
//   project's associations, and its ideas replace the kept ones.
// @param {object} result - From associationResult.
// @param {object} ideas - From generatedIdeas.
// @returns {object} The result applyCollectedTaskResult writes.
export function withGeneratedIdeas(result, { foundRecords, generatedAt, mergedIdeas }) {
  const relatedTaskUuids = [...result.relatedTaskUuids, ...foundRecords.map(task => task.taskUuid)];
  return { ...result, generatedAt, relatedTaskRecords: [...result.relatedTaskRecords, ...foundRecords], relatedTaskUuids,
    suggestedTasks: mergedIdeas };
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Move completions into their own list without discarding evidence of a completion that has since
//   aged out of what the task API returns, which is what keeps a project's history from shrinking over a
//   quarter. A task that was reopened or dismissed stops counting as a completion.
// @param {Array<object>} matchingTasks - Tasks matched to this project on this refresh.
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
// @desc Reduce a ranking to what it records on the project. A ranking that succeeded supplies the similarity hash;
//   its time and search progress move forward only when every batch succeeded, so missed tasks are sent again.
// @param {object|null} ranking - From rankProject, or null when nothing could rank.
// @param {Date} now - When the refresh ran.
// @returns {object|null} { rankedAt, searchProgress, taskSimilarityScores }, rankedAt null for an incomplete ranking;
//   null when the ranking failed or was absent.
function _rankingResult(ranking, now) {
  if (!ranking || ranking.failureReason) return null;
  const rankedAt = ranking.rankingIncomplete ? null : now.toISOString();
  return { rankedAt, searchProgress: ranking.searchProgress || null, taskSimilarityScores: ranking.taskSimilarityScores || null };
}
