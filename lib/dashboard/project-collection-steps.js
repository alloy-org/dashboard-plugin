// Refresh one project's task lists for the queue's ranking and idea handlers: match local tasks, merge ranked
// associations and completion evidence, and prepare novel ideas without mixing their persistence responsibilities.
import { rankedTaskAssociations } from "plan-wizard/stack-rank/stack-rank-project-tasks";
import { taskUuidFromRatingKey } from "plan-wizard/stack-rank/task-rating-cache";
import { candidateTaskRecords } from "project-candidate-tasks";
import { ideasAcceptedByTasks, mergedIdeaRecords } from "project-idea-records";
import { observedCompletionRecord } from "quarter-project";
import { ideasInputRevision, similarityInputRevision } from "quarter-project-refresh-state";
import { logIfEnabled } from "util/log";

const MAINTENANCE_LOG_LABEL = "[project-maintenance]";
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
// @param {object} result - { attemptedAt, completedTasks, ranking, relatedTaskRecords, relatedTaskUuids,
//   similarityRefresh, suggestedTasks }, from associationResult.
export function applyCollectedTaskResult(project, result) {
  const { attemptedAt, completedTasks, ranking, relatedTaskRecords, relatedTaskUuids, similarityRefresh,
    suggestedTasks } = result;
  if (ranking?.taskSimilarityScores) project.setSimilarityScores(ranking.taskSimilarityScores);
  if (ranking?.rankedAt) project.markRanked(ranking.rankedAt, ranking.searchProgress);
  if (similarityRefresh) project.recordRefreshSuccess("similarity", similarityRefresh);
  project.setActive(true);
  project.setAttemptedAt(attemptedAt);
  project.setCompletedTasks(completedTasks);
  project.setRelatedTaskRecords(relatedTaskRecords);
  project.addRelatedTaskUuids(relatedTaskUuids);
  project.setSuggestedTasks(suggestedTasks);
}

// ----------------------------------------------------------------------------------------------
// @desc Fold a ranking into the project's associations: the locally matched open tasks joined with the ones the
//   ranking accepted, or with the open tasks the similarity hash already holds when nothing ranked, the completions moved out of that list, and the stored ideas, an open one that has since become
//   an open task marked accepted with that task's UUID. The project then takes the store's fields, so what follows
//   sees what the store holds. A ranking that failed outright, or that nothing could make, leaves the similarity hash
//   as stored.
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
// @returns {object} The associations, completions, kept ideas, and successful ranking state applyCollectedTaskResult writes.
export function associationResult({ dictionaryPosition, matches, now, project, ranking, scorerEm, stored, watermark }) {
  const rankedTaskRecords = ranking && !ranking.failureReason ? ranking.acceptedTasks : null;
  const scoredTaskRecords = rankedTaskRecords || matches.similarTaskRecords || [];
  const { associatedRecords } = rankedTaskAssociations(matches.matchedTaskRecords, scoredTaskRecords);
  const keptIdeas = ideasAcceptedByTasks(stored?.suggestedTasks || [], { decidedAt: now.toISOString(),
    openTaskRecords: associatedRecords });
  if (stored) project.adoptStoreFields(stored);
  const rankingResult = _rankingResult(ranking, now);
  const similarityRefresh = rankingResult?.rankedAt ? { dictionaryPosition, inputRevision: similarityInputRevision(project,
    { scorerEm }), succeededAt: rankingResult.rankedAt, watermark } : null;
  const result = { attemptedAt: now.toISOString(), completedTasks: _completedTaskRecords(matches.matchingTasks, stored),
    ranking: rankingResult, relatedTaskRecords: associatedRecords,
    relatedTaskUuids: matches.localTasks.map(task => task.uuid), similarityRefresh, suggestedTasks: keptIdeas };
  return result;
}

// ----------------------------------------------------------------------------------------------
// @desc Ask the idea generator for the project's ideas and for tasks it can attribute from the project's candidate
//   pool, and merge the returned ideas into the ones it keeps. Each new idea records the ideas input revision of the
//   project it was generated for.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { destinationNotes = [], ideaGenerator, intentTexts = [], keptIdeas, now, project,
//   quarterlyContent }. project carries the associations, completions, and candidate tasks the prompt describes;
//   intentTexts are those of the intents it advances, from projectIntentTexts; destinationNotes are the notes an idea
//   may be created in, as { name, uuid }.
// @returns {Promise<object>} { failureReason, foundRecords, generatedAt, mergedIdeas, requestFailed }: generatedAt is now
//   when an idea was added or replaced one, else null; requestFailed is true when the provider call itself failed.
export async function generatedIdeas(app, { destinationNotes = [], ideaGenerator, intentTexts = [], keptIdeas, now, project, quarterlyContent }) {
  const response = await ideaGenerator(app, { destinationNotes, intentTexts, project, quarterlyContext: quarterlyContent });
  const { addedCount, ideas: mergedIdeas } = mergedIdeaRecords(keptIdeas, response.suggestedTasks || [],
    { projectUuid: project.uuid, sourceRevision: ideasInputRevision(project) });
  const generatedAt = addedCount ? now.toISOString() : null;
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
// @desc The texts of the Plan Builder intents a project advances, highest ranked first, which the idea prompt leads with
//   so ideas serve the outcome the project was chosen for. A deleted intent, or one the guide no longer holds, is
//   left out.
// @param {object|null} guide - The Vision Guide as readVisionGuide returns it, or null when it could not be read.
// @param {QuarterProject} project - The project.
// @returns {Array<string>} Intent texts; empty without a guide or linked intents.
export function projectIntentTexts(guide, project) {
  const linkedUuids = new Set(project.linkedGoalUuids || []);
  if (!linkedUuids.size) return [];
  const goals = guide?.goals?.goals || [];
  const linkedGoals = goals.filter(goal => linkedUuids.has(goal.uuid) && !goal.isDeleted && goal.goalText);
  const rankedGoals = [...linkedGoals].sort((first, second) => first.goalRank - second.goalRank);
  const intentTexts = rankedGoals.map(goal => goal.goalText);
  return intentTexts;
}

// ----------------------------------------------------------------------------------------------
// @desc Match a project's tasks locally. The local match leaves out the tasks the similarity hash holds, since the
//   ranker re-checks those; completions still count them. Each open local match records how it is linked, and the
//   open tasks the hash alone matches are kept apart with their stored score, so a refresh that cannot rank still
//   lists them.
// @param {QuarterProject} project - Project to match.
// @param {Array<object>} tasks - Every task read for this refresh.
// @returns {object} { localTasks, matchedTaskRecords, matchingTasks, similarTaskRecords }: tasks matched by a link
//   reason, their open ones as { linkedBy, taskText, taskUuid }, every task matched by a link reason or similarity,
//   and the open tasks matched by similarity alone as { matchScore, taskText, taskUuid }.
export function projectTaskMatches(project, tasks) {
  const matchingTasks = tasks.filter(task => task.uuid && project.matchesTask(task));
  const localTasks = matchingTasks.filter(task => project.matchesTask(task, { includeSimilarTasks: false }));
  const openTasks = localTasks.filter(task => _isOpenTask(task));
  const matchedTaskRecords = openTasks.map(task => ({ linkedBy: project.taskLinkReason(task), taskText: task.content || "",
    taskUuid: task.uuid }));
  const localUuids = new Set(localTasks.map(task => task.uuid));
  const openSimilarTasks = matchingTasks.filter(task => !localUuids.has(task.uuid) && _isOpenTask(task));
  const scoreByTaskUuid = new Map(Object.entries(project.taskSimilarityScores).map(([ratingKey, rating]) =>
    [taskUuidFromRatingKey(ratingKey), rating]));
  const similarTaskRecords = openSimilarTasks.map(task => ({ matchScore: scoreByTaskUuid.get(task.uuid),
    taskText: task.content || "", taskUuid: task.uuid }));
  return { localTasks, matchedTaskRecords, matchingTasks, similarTaskRecords };
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
    logIfEnabled(`${ MAINTENANCE_LOG_LABEL } task snapshot reconciled`, { changedCount: changedTaskUuids.length,
      sequence: snapshot.sequence });
    return snapshot;
  } catch (error) {
    logIfEnabled(`${ MAINTENANCE_LOG_LABEL } task snapshot unavailable, ranking without change tracking`, error?.message);
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
    logIfEnabled(`${ MAINTENANCE_LOG_LABEL } task changes since last ranking`, { changedCount: changedTaskRecords.length,
      complete, omittedCount: changedTaskRecords.length - keptRecords.length, project: project.summary });
  }
  return { changedTaskRecords: keptRecords, watermark };
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Move completions into their own list without discarding evidence of a completion that has since
//   aged out of what the task API returns, which is what keeps a project's history from shrinking over a
//   quarter. A task that was reopened or dismissed stops counting as a completion. A completion recorded before
//   completions kept their text takes it the next time the task is observed.
// @param {Array<object>} matchingTasks - Tasks matched to this project on this refresh.
// @param {object|undefined} stored - The project's previously stored record.
// @returns {Array<object>} Completion records, as observedCompletionRecord makes them.
function _completedTaskRecords(matchingTasks, stored) {
  const completedByUuid = new Map((stored?.completedTasks || []).map(task => [task.taskUuid, task]));
  for (const task of matchingTasks) {
    if (task.completedAt && !task.dismissedAt) {
      const completion = observedCompletionRecord(task, completedByUuid.get(task.uuid));
      if (completion) completedByUuid.set(task.uuid, completion);
    } else completedByUuid.delete(task.uuid);
  }
  return [...completedByUuid.values()];
}

// ----------------------------------------------------------------------------------------------
// @desc Whether a task is still open: neither completed nor dismissed.
// @param {object} task - Native task.
// @returns {boolean} True when open.
function _isOpenTask(task) {
  return !task.completedAt && !task.dismissedAt;
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
