// Remember the rating Jev gave each task for a project, so a pass only pays to rate a pairing Jev has not seen. Each
// rating is keyed `checksum:taskUuid`, where the checksum digests the project's summary together with the task's
// text, so rewording either one invalidates the rating and the task is rated again. The ratings are sparse: a task
// the project accepted for good is already listed among its tasks and is not stored here. The project task store
// renders the ratings as one compact JSON line in a code block beneath the project's lists.
import { textDigest } from "util/text-digest";

// ----------------------------------------------------------------------------------------------
// @desc Split a project's pool into tasks whose rating is already known and tasks Jev still has to rate.
// @param {Array<object>} candidateRecords - The pool, as { taskText, taskUuid }.
// @param {object} params - An object with the following properties:
//   - {string} projectSummary - The project's summary, as Jev is shown it
//   - {object} [storedRatings] - The project's stored `jevRatings`
// @returns {object} An object with the following properties:
//   - {Array<object>} cachedTasks - Known ratings as { rating, taskText, taskUuid }
//   - {object} ratingKeyByUuid - Each pooled task's rating key, keyed by task UUID
//   - {Array<object>} uncachedRecords - Pool entries with no valid stored rating
export function partitionedByStoredRating(candidateRecords, { projectSummary, storedRatings }) {
  const ratings = storedRatings && typeof storedRatings === "object" ? storedRatings : {};
  const cachedTasks = [];
  const ratingKeyByUuid = {};
  const uncachedRecords = [];
  for (const record of candidateRecords) {
    const ratingKey = taskRatingKey(projectSummary, record);
    ratingKeyByUuid[record.taskUuid] = ratingKey;
    if (Number.isFinite(ratings[ratingKey])) cachedTasks.push({ rating: ratings[ratingKey], taskText: record.taskText,
      taskUuid: record.taskUuid });
    else uncachedRecords.push(record);
  }
  return { cachedTasks, ratingKeyByUuid, uncachedRecords };
}

// ----------------------------------------------------------------------------------------------
// @desc Build the ratings a project should store after a ranking: every rating its current pool has, whether read
//   from the cache or freshly rated, except for tasks the project now keeps for good. A key no pooled task produces
//   anymore is dropped, so a task that was edited or completed stops taking space in the note.
// @param {object} params - An object with the following properties:
//   - {Array<string>} keptTaskUuids - Tasks the project now keeps in relatedTasks
//   - {Array<object>} ratedTasks - Cached and freshly rated tasks, each with `rating` and `taskUuid`
//   - {object} ratingKeyByUuid - From partitionedByStoredRating
// @returns {object} Ratings keyed by rating key.
export function storableTaskRatings({ keptTaskUuids, ratedTasks, ratingKeyByUuid }) {
  const keptUuidSet = new Set(keptTaskUuids);
  const sparseTasks = ratedTasks.filter(task => ratingKeyByUuid[task.taskUuid] && !keptUuidSet.has(task.taskUuid));
  const keyedRatings = sparseTasks.map(task => [ratingKeyByUuid[task.taskUuid], task.rating]);
  return Object.fromEntries(keyedRatings);
}

// ----------------------------------------------------------------------------------------------
// @desc Collect each stored project's similarity score per task, for pages that show why a task belongs to a
//   project. A task the project kept carries its score in relatedTaskRecords; any other task Jev rated is read from
//   the sparse ratings. A task matched by name alone was never rated, so it has no score.
// @param {Array<object>} storedProjects - Records from the project task store.
// @returns {object} { [projectUuid]: { [taskUuid]: score } }.
export function taskMatchScoresByProject(storedProjects) {
  const scoresByProject = {};
  for (const project of storedProjects || []) {
    if (!project?.uuid) continue;
    const scoreByTaskUuid = {};
    for (const [ratingKey, rating] of Object.entries(project.jevRatings || {})) {
      const taskUuid = ratingKey.slice(ratingKey.indexOf(":") + 1);
      if (taskUuid && Number.isFinite(rating)) scoreByTaskUuid[taskUuid] = rating;
    }
    for (const record of project.relatedTaskRecords || []) {
      if (record?.taskUuid && Number.isFinite(record.matchScore)) scoreByTaskUuid[record.taskUuid] = record.matchScore;
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
