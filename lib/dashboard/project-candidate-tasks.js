// Choose the open tasks a project might own but is not yet associated with. The background collection pass offers
// this pool to its generative provider and the Jev stack rank rates it, so both draw it by the same rule. Once a
// project has been ranked, a later pass can limit the pool to tasks created after that ranking.
import { millisFromDateInput } from "util/date-utility";

// ----------------------------------------------------------------------------------------------
// @desc Build the candidate pool, and count the open tasks a createdAfter cutoff left out. Tasks created at or
//   before that time are one count; tasks whose creation time cannot be read are another, since both are omitted
//   and a missing timestamp is the less obvious of the two.
// @param {Array<object>} tasks - Every task read for this pass.
// @param {object} options - An object with the following properties:
//   - {Date|string|number|null} [createdAfter=null] - Submit only tasks created after this time
//   - {number} maximumTaskCount - How many of the most recently updated to keep
//   - {Array<object>} relatedTaskRecords - The project's associated open tasks, as { taskText, taskUuid }
// @returns {object} { excludedBeforeCreatedAfter, excludedWithoutCreatedAt, records }. The exclusion counts are 0
//   when createdAfter is unset. records are the capped candidates, as { taskText, taskUuid }.
export function candidateTaskPool(tasks, { createdAfter = null, maximumTaskCount, relatedTaskRecords }) {
  const createdAfterMilliseconds = millisFromDateInput(createdAfter);
  const createdAfterApplies = Number.isFinite(createdAfterMilliseconds);
  const associatedUuids = new Set(relatedTaskRecords.map(task => task.taskUuid));
  const openTasks = tasks.filter(task => task.uuid && !task.completedAt && !task.dismissedAt
    && !associatedUuids.has(task.uuid) && (task.content || "").trim());
  const eligibleTasks = [];
  let excludedBeforeCreatedAfter = 0;
  let excludedWithoutCreatedAt = 0;
  for (const task of openTasks) {
    if (!createdAfterApplies) {
      eligibleTasks.push(task);
      continue;
    }
    const createdMilliseconds = millisFromDateInput(task?.createdAt);
    if (!Number.isFinite(createdMilliseconds)) excludedWithoutCreatedAt += 1;
    else if (createdMilliseconds <= createdAfterMilliseconds) excludedBeforeCreatedAfter += 1;
    else eligibleTasks.push(task);
  }
  const recentFirst = eligibleTasks.sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
  const cappedTasks = recentFirst.slice(0, maximumTaskCount);
  const records = cappedTasks.map(task => ({ taskText: task.content, taskUuid: task.uuid }));
  return { excludedBeforeCreatedAfter, excludedWithoutCreatedAt, records };
}

// ----------------------------------------------------------------------------------------------
// @desc List the open tasks not already associated with a project, most recently updated first, capped so a large
//   backlog cannot crowd the project's own context out of a prompt. A task with no text is left out, since nothing
//   could judge where it belongs. When `createdAfter` is set, only a task created strictly later than that time is
//   eligible, and a task with no readable creation time is left out: the previous ranking already covered it.
// @param {Array<object>} tasks - Every task read for this pass.
// @param {object} options - Same options as candidateTaskPool.
// @returns {Array<object>} Candidate tasks as { taskText, taskUuid }.
export function candidateTaskRecords(tasks, options) {
  return candidateTaskPool(tasks, options).records;
}

