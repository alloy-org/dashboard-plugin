// Remember each project's task similarity scores, so a pass can show and reuse a rating without sending the task
// again. Each score is keyed `checksum:taskUuid`, where the checksum digests the project's summary together with the
// task's text: when either changes the key no longer matches, and the task is rated again. A project stores one
// such hash, sorted by task UUID, holding every task rated at or above SIMILAR_TASK_MINIMUM_SCORE plus the tasks the
// sources page cites, whatever their score. The pool of tasks a project did not keep is not stored here: a later
// pass skips those by their creation time against `lastRankedAt`. The project task store renders the hash as one
// compact JSON line.
import { DEFAULT_MINIMUM_MATCH_SCORE } from "plan-wizard/stack-rank/project-match-scores";
import { textDigest } from "util/text-digest";

// A task rated this high belongs to the project; it is kept in the similarity hash and shown on the sources page.
export const SIMILAR_TASK_MINIMUM_SCORE = DEFAULT_MINIMUM_MATCH_SCORE;

// ----------------------------------------------------------------------------------------------
// @desc Split a project's pool into tasks whose rating is already known and tasks the rater still has to rate. A
//   task whose text changed since it was rated produces a new key, so it lands among the uncached records.
// @param {Array<object>} candidateRecords - The pool, as { taskText, taskUuid }.
// @param {object} params - An object with the following properties:
//   - {string} projectSummary - The project's summary, as the rater is shown it
//   - {Set<string>} [rescoredTaskUuids] - Tasks to rate again whatever is stored, such as those mentioning a term whose
//     definition changed; their new rating replaces the stored one under the same key
//   - {object} [storedRatings] - The project's stored `taskSimilarityScores`
// @returns {object} An object with the following properties:
//   - {Array<object>} cachedTasks - Known ratings as { rating, taskText, taskUuid }
//   - {object} ratingKeyByUuid - Each pooled task's rating key, keyed by task UUID
//   - {Array<object>} uncachedRecords - Pool entries with no valid stored rating
export function partitionedByStoredRating(candidateRecords, { projectSummary, rescoredTaskUuids = new Set(), storedRatings }) {
  const ratings = storedRatings && typeof storedRatings === "object" ? storedRatings : {};
  const cachedTasks = [];
  const ratingKeyByUuid = {};
  const uncachedRecords = [];
  for (const record of candidateRecords) {
    const ratingKey = taskRatingKey(projectSummary, record);
    ratingKeyByUuid[record.taskUuid] = ratingKey;
    const isCached = Number.isFinite(ratings[ratingKey]) && !rescoredTaskUuids.has(record.taskUuid);
    if (isCached) cachedTasks.push({ rating: ratings[ratingKey], taskText: record.taskText, taskUuid: record.taskUuid });
    else uncachedRecords.push(record);
  }
  return { cachedTasks, ratingKeyByUuid, uncachedRecords };
}

// ----------------------------------------------------------------------------------------------
// @desc Keep the stored scores worth their space: every similar task, and any task the sources page cites. A low
//   score for an uncited task only recorded that the pool had been judged, which lastRankedAt now records.
// @param {object} [similarityScores] - Scores keyed `checksum:taskUuid`.
// @param {Array<string>} citedTaskUuids - Task UUIDs the sources page cites for the project.
// @returns {object} The retained scores, sorted by task UUID.
export function retainedSimilarityScores(similarityScores, citedTaskUuids) {
  const citedUuidSet = new Set(citedTaskUuids);
  const keptEntries = Object.entries(similarityScores || {}).filter(([ratingKey, rating]) => Number.isFinite(rating)
    && (rating >= SIMILAR_TASK_MINIMUM_SCORE || citedUuidSet.has(taskUuidFromRatingKey(ratingKey))));
  return sortedSimilarityScores(Object.fromEntries(keptEntries));
}

// ----------------------------------------------------------------------------------------------
// @desc Fold one ranking's ratings into the scores a project already stores. A freshly rated task replaces every
//   older key for the same task, since an edit changes its checksum; it is kept when it is similar or required
//   (a cited task the sources page needs a score for) or its score was read from the hash, and otherwise dropped.
//   Stored scores for tasks this ranking did not rate are left as they were.
// @param {object} params - An object with the following properties:
//   - {Array<object>} ratedTasks - Cached and freshly rated tasks, each with `rating` and `taskUuid`
//   - {object} ratingKeyByUuid - From partitionedByStoredRating
//   - {Array<string>} requiredTaskUuids - Tasks whose score is stored whatever it is
//   - {object} [storedScores] - The project's scores before this ranking
// @returns {object} Scores keyed `checksum:taskUuid`, sorted by task UUID.
export function similarityScoresAfterRanking({ ratedTasks, ratingKeyByUuid, requiredTaskUuids, storedScores }) {
  const ratedUuidSet = new Set(ratedTasks.map(task => task.taskUuid));
  const requiredUuidSet = new Set(requiredTaskUuids);
  const untouchedEntries = Object.entries(storedScores || {}).filter(([ratingKey, rating]) => Number.isFinite(rating)
    && !ratedUuidSet.has(taskUuidFromRatingKey(ratingKey)));
  const isWorthKeeping = task => task.rating >= SIMILAR_TASK_MINIMUM_SCORE || requiredUuidSet.has(task.taskUuid)
    || Number.isFinite(storedScores?.[ratingKeyByUuid[task.taskUuid]]);
  const keptTasks = ratedTasks.filter(task => ratingKeyByUuid[task.taskUuid] && isWorthKeeping(task));
  const ratedEntries = keptTasks.map(task => [ratingKeyByUuid[task.taskUuid], task.rating]);
  return sortedSimilarityScores(Object.fromEntries([...untouchedEntries, ...ratedEntries]));
}

// ----------------------------------------------------------------------------------------------
// @desc The open tasks a project's stored hash calls similar, as records a ranking re-checks. Each one's current
//   text is digested against its stored key: an unchanged task is read from the cache, an edited one is rated again.
// @param {object} [similarityScores] - Scores keyed `checksum:taskUuid`.
// @param {Map<string, object>} taskByUuid - Tasks read for this pass.
// @returns {Array<object>} { taskText, taskUuid } for each similar task that is still open and has text.
export function similarTaskRecords(similarityScores, taskByUuid) {
  const records = [];
  for (const [ratingKey, rating] of Object.entries(similarityScores || {})) {
    if (!Number.isFinite(rating) || rating < SIMILAR_TASK_MINIMUM_SCORE) continue;
    const task = taskByUuid.get(taskUuidFromRatingKey(ratingKey));
    const taskText = String(task?.content || "").trim();
    if (!task || task.completedAt || task.dismissedAt || !taskText) continue;
    records.push({ taskText, taskUuid: task.uuid });
  }
  return records;
}

// ----------------------------------------------------------------------------------------------
// @desc Count the tasks a project's hash calls similar, which decides whether its search should go a page deeper.
// @param {object} [similarityScores] - Scores keyed `checksum:taskUuid`.
// @returns {number} Scores at or above SIMILAR_TASK_MINIMUM_SCORE.
export function similarTaskCount(similarityScores) {
  const ratings = Object.values(similarityScores || {});
  return ratings.filter(rating => Number.isFinite(rating) && rating >= SIMILAR_TASK_MINIMUM_SCORE).length;
}

// ----------------------------------------------------------------------------------------------
// @desc Order a similarity hash by task UUID, so a project's line in the note changes only where its tasks changed.
// @param {object} similarityScores - Scores keyed `checksum:taskUuid`.
// @returns {object} The same scores with their keys sorted by task UUID, then by checksum.
export function sortedSimilarityScores(similarityScores) {
  const entries = Object.entries(similarityScores || {});
  const sortedEntries = entries.sort(([firstKey], [secondKey]) => {
    const uuidOrder = taskUuidFromRatingKey(firstKey).localeCompare(taskUuidFromRatingKey(secondKey));
    return uuidOrder || firstKey.localeCompare(secondKey);
  });
  return Object.fromEntries(sortedEntries);
}

// ----------------------------------------------------------------------------------------------
// @desc Collect each stored project's similarity score per task, for pages that show why a task belongs to a
//   project. Scores come from the project's similarity hash; a record written before the hash existed may still
//   carry its score on relatedTaskRecords. A task matched by name alone was never rated, so it has no score.
// @param {Array<object>} storedProjects - Records from the project task store.
// @returns {object} { [projectUuid]: { [taskUuid]: score } }.
export function taskMatchScoresByProject(storedProjects) {
  const scoresByProject = {};
  for (const project of storedProjects || []) {
    if (!project?.uuid) continue;
    const scoreByTaskUuid = {};
    for (const record of project.relatedTaskRecords || []) {
      if (record?.taskUuid && Number.isFinite(record.matchScore)) scoreByTaskUuid[record.taskUuid] = record.matchScore;
    }
    for (const [ratingKey, rating] of Object.entries(project.taskSimilarityScores || {})) {
      const taskUuid = taskUuidFromRatingKey(ratingKey);
      if (taskUuid && Number.isFinite(rating)) scoreByTaskUuid[taskUuid] = rating;
    }
    scoresByProject[project.uuid] = scoreByTaskUuid;
  }
  return scoresByProject;
}

// ----------------------------------------------------------------------------------------------
// @desc Key one project-and-task pairing. A separator keeps "ab" + "c" distinct from "a" + "bc" in the checksum, and
//   the task UUID keeps two tasks with the same text apart.
// @param {string} projectSummary - The project's summary.
// @param {object} record - The task, as { taskText, taskUuid }.
// @returns {string} `checksum:taskUuid`, the checksum eight hex characters.
export function taskRatingKey(projectSummary, record) {
  return `${ textDigest(`${ projectSummary || "" }\u0000${ record.taskText || "" }`) }:${ record.taskUuid }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Read the task UUID out of a `checksum:taskUuid` key.
// @param {string} ratingKey - Key from the similarity hash.
// @returns {string} The task UUID, empty when the key has no separator.
export function taskUuidFromRatingKey(ratingKey) {
  const separatorIndex = ratingKey.indexOf(":");
  return separatorIndex < 0 ? "" : ratingKey.slice(separatorIndex + 1);
}
