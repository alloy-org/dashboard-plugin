// Explain why a task the similarity hash rates similar is missing from a project's existing tasks lists, so the count
// of entries at or above the similar-task minimum in the hash can be reconciled with the tasks a day's suggestions
// may offer. A ranking names each such task's reason while it still holds the task read; the project task store
// writes the reasons as their own list and reads them back from it. Rendering takes the list from the hash itself,
// so every similar task that is not listed appears there, with a generic reason when no ranking has named one.
import { COMPETITIVE_TASK_COUNT, DEFAULT_MINIMUM_MATCH_SCORE } from "plan-wizard/stack-rank/project-match-scores";
import { SIMILAR_TASK_MINIMUM_SCORE, taskRatingKey, taskUuidFromRatingKey } from "plan-wizard/stack-rank/task-rating-cache";

// The words written beside a disqualified task. None may contain the "; " that separates a line's clauses.
export const DISQUALIFICATION_REASONS = Object.freeze({
  completed: "completed",
  dismissed: "dismissed",
  editedSinceRated: "edited since rated, awaiting a new rating",
  missingText: "task has no text",
  notAccepted: "not accepted by the last ranking",
  notRead: "not among the open tasks read (deleted, or outside the task domain)",
  notYetRanked: "rated since the last ranking finished, not yet accepted",
  outsideTopTasks: `beyond the ${ COMPETITIVE_TASK_COUNT } best-rated similar tasks`,
  unfinishedRanking: "ranking unfinished, not yet accepted",
});

// ----------------------------------------------------------------------------------------------
// @desc Name why each similar task in a project's hash is not among its existing tasks, as a finished ranking sees
//   it: the task was not read as open, has no text, was edited since its rating, rates below the minimum the project
//   settled on, fell past the competitive cap, or awaits a ranking still unfinished. Call it once the ranking's
//   hash and existing tasks are on the project.
// @param {QuarterProject} project - The ranked project, carrying taskSimilarityScores, relatedTaskRecords, summary,
//   and completedTasks.
// @param {object} options - An object with the following properties:
//   - {number|null} [minimumMatchScore=null] - The minimum the ranking accepted at, null when nothing ranked
//   - {boolean} [rankingIncomplete=false] - True when the ranking has tasks still unrated
//   - {Array<object>} tasks - Every task read for the ranking
// @returns {Array<object>} { matchScore, reason, taskText, taskUuid }, highest score first.
export function disqualifiedSimilarTasks(project, { minimumMatchScore = null, rankingIncomplete = false, tasks }) {
  const taskByUuid = new Map(tasks.filter(task => task?.uuid).map(task => [task.uuid, task]));
  const completedByUuid = new Map(project.completedTasks.map(completion => [completion.taskUuid, completion]));
  const unlistedEntries = _unlistedSimilarEntries(project);
  const records = unlistedEntries.map(({ matchScore, ratingKey, taskUuid }) => {
    const task = taskByUuid.get(taskUuid);
    const reason = _disqualificationReason({ completedByUuid, matchScore, minimumMatchScore, project, rankingIncomplete,
      ratingKey, task, taskUuid });
    const taskText = String(task?.content || completedByUuid.get(taskUuid)?.taskText || "").trim();
    return { matchScore, reason, taskText, taskUuid };
  });
  return records;
}

// ----------------------------------------------------------------------------------------------
// @desc The disqualified tasks a project's store section lists: every task its hash rates similar that is not among
//   its existing tasks, each with the reason the last ranking named, or a generic one when none did (the task was
//   rated by a ranking that paused before finishing, or the hash changed outside a ranking).
// @param {QuarterProject} project - Project carrying taskSimilarityScores, relatedTaskRecords, disqualifiedTaskRecords,
//   and unfinishedRankingAt.
// @returns {Array<object>} { matchScore, reason, taskText, taskUuid }, highest score first.
export function listedDisqualifiedTasks(project) {
  const namedByUuid = new Map(project.disqualifiedTaskRecords.map(record => [record.taskUuid, record]));
  const fallbackReason = project.unfinishedRankingAt ? DISQUALIFICATION_REASONS.unfinishedRanking
    : DISQUALIFICATION_REASONS.notYetRanked;
  const records = _unlistedSimilarEntries(project).map(({ matchScore, taskUuid }) => {
    const named = namedByUuid.get(taskUuid);
    return { matchScore, reason: named?.reason || fallbackReason, taskText: named?.taskText || "", taskUuid };
  });
  return records;
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Choose the first reason that keeps one similar task off a ranked project's existing tasks.
// @param {object} options - { completedByUuid, matchScore, minimumMatchScore, project, rankingIncomplete, ratingKey,
//   task, taskUuid }: task is undefined when the ranking's read did not return it.
// @returns {string} One of DISQUALIFICATION_REASONS.
function _disqualificationReason({ completedByUuid, matchScore, minimumMatchScore, project, rankingIncomplete, ratingKey,
    task, taskUuid }) {
  if (!task) return completedByUuid.has(taskUuid) ? DISQUALIFICATION_REASONS.completed : DISQUALIFICATION_REASONS.notRead;
  if (task.completedAt) return DISQUALIFICATION_REASONS.completed;
  if (task.dismissedAt) return DISQUALIFICATION_REASONS.dismissed;
  const content = task.content || "";
  if (!content.trim()) return DISQUALIFICATION_REASONS.missingText;
  const currentKeys = [content, content.trim()].map(taskText => taskRatingKey(project.summary, { taskText, taskUuid }));
  if (!currentKeys.includes(ratingKey)) return DISQUALIFICATION_REASONS.editedSinceRated;
  if (Number.isFinite(minimumMatchScore) && matchScore < minimumMatchScore) {
    return `below this project's minimum match score of ${ minimumMatchScore }`;
  }
  if (rankingIncomplete) return DISQUALIFICATION_REASONS.unfinishedRanking;
  if (minimumMatchScore === DEFAULT_MINIMUM_MATCH_SCORE) return DISQUALIFICATION_REASONS.outsideTopTasks;
  return DISQUALIFICATION_REASONS.notAccepted;
}

// ----------------------------------------------------------------------------------------------
// @desc The hash entries rated similar whose task is not among the project's existing tasks. A task the hash holds
//   under more than one key, as when its text changed between two devices' rankings, is kept once at its highest score.
// @param {QuarterProject} project - Project carrying taskSimilarityScores and relatedTaskRecords.
// @returns {Array<object>} { matchScore, ratingKey, taskUuid }, highest score first.
function _unlistedSimilarEntries(project) {
  const listedUuids = new Set(project.relatedTaskRecords.map(record => record.taskUuid));
  const entryByUuid = new Map();
  for (const [ratingKey, matchScore] of Object.entries(project.taskSimilarityScores || {})) {
    const taskUuid = taskUuidFromRatingKey(ratingKey);
    if (!Number.isFinite(matchScore) || matchScore < SIMILAR_TASK_MINIMUM_SCORE || listedUuids.has(taskUuid)) continue;
    const isHighestScore = matchScore > (entryByUuid.get(taskUuid)?.matchScore ?? -Infinity);
    if (isHighestScore) entryByUuid.set(taskUuid, { matchScore, ratingKey, taskUuid });
  }
  const sortedEntries = [...entryByUuid.values()].sort((first, second) => second.matchScore - first.matchScore);
  return sortedEntries;
}
