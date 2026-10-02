// Choose the open tasks a project might own but is not yet associated with. The background collection pass offers
// this pool to its generative provider and the Jev stack rank rates it, so both draw it by the same rule. Once a
// project has been ranked, a later pass can limit the pool to tasks created after that ranking.
import { millisFromDateInput } from "util/date-utility";

// ----------------------------------------------------------------------------------------------
// @desc List the open tasks not already associated with a project, most recently updated first, capped so a large
//   backlog cannot crowd the project's own context out of a prompt. A task with no text is left out, since nothing
//   could judge where it belongs. When `createdAfter` is set, only a task created strictly later than that time is
//   eligible, and a task with no readable creation time is left out: the previous ranking already covered it.
// @param {Array<object>} tasks - Every task read for this pass.
// @param {object} options - An object with the following properties:
//   - {Date|string|number|null} [createdAfter=null] - Submit only tasks created after this time
//   - {number} maximumTaskCount - How many of the most recently updated to keep
//   - {Array<object>} relatedTaskRecords - The project's associated open tasks, as { taskText, taskUuid }
// @returns {Array<object>} Candidate tasks as { taskText, taskUuid }.
export function candidateTaskRecords(tasks, { createdAfter = null, maximumTaskCount, relatedTaskRecords }) {
  const createdAfterMilliseconds = millisFromDateInput(createdAfter);
  const associatedUuids = new Set(relatedTaskRecords.map(task => task.taskUuid));
  const openTasks = tasks.filter(task => task.uuid && !task.completedAt && !task.dismissedAt
    && !associatedUuids.has(task.uuid) && (task.content || "").trim());
  const eligibleTasks = Number.isFinite(createdAfterMilliseconds)
    ? openTasks.filter(task => _createdAfter(task, createdAfterMilliseconds)) : openTasks;
  const recentFirst = eligibleTasks.sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
  const cappedTasks = recentFirst.slice(0, maximumTaskCount);
  return cappedTasks.map(task => ({ taskText: task.content, taskUuid: task.uuid }));
}

// ----------------------------------------------------------------------------------------------
// @desc Report whether a task was created strictly after a ranking. An unreadable creation time is not later.
// @param {object} task - Amplenote task, with `createdAt` in seconds, milliseconds, or an ISO string.
// @param {number} createdAfterMilliseconds - Epoch milliseconds of the previous ranking.
// @returns {boolean} True when the task's creation time is later than that ranking.
function _createdAfter(task, createdAfterMilliseconds) {
  const createdMilliseconds = millisFromDateInput(task?.createdAt);
  return Number.isFinite(createdMilliseconds) && createdMilliseconds > createdAfterMilliseconds;
}
