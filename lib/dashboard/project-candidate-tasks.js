// Choose the open tasks a project might own but is not yet associated with. The background collection pass offers
// this pool to its generative provider and the Jev stack rank rates it, so both draw it by the same rule.

// ----------------------------------------------------------------------------------------------
// @desc List the open tasks not already associated with a project, most recently updated first, capped so a large
//   backlog cannot crowd the project's own context out of a prompt. A task with no text is left out, since nothing
//   could judge where it belongs.
// @param {Array<object>} tasks - Every task read for this pass.
// @param {object} options - An object with the following properties:
//   - {number} maximumTaskCount - How many of the most recently updated to keep
//   - {Array<object>} relatedTaskRecords - The project's associated open tasks, as { taskText, taskUuid }
// @returns {Array<object>} Candidate tasks as { taskText, taskUuid }.
export function candidateTaskRecords(tasks, { maximumTaskCount, relatedTaskRecords }) {
  const associatedUuids = new Set(relatedTaskRecords.map(task => task.taskUuid));
  const openTasks = tasks.filter(task => task.uuid && !task.completedAt && !task.dismissedAt
    && !associatedUuids.has(task.uuid) && (task.content || "").trim());
  const recentFirst = openTasks.sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
  const cappedTasks = recentFirst.slice(0, maximumTaskCount);
  return cappedTasks.map(task => ({ taskText: task.content, taskUuid: task.uuid }));
}
