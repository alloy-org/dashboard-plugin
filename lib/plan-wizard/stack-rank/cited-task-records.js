// Find the tasks the Plan Builder's sources page cites for a project that still have no similarity score, so a
// ranking can rate them as required tasks and the page can show a score for each. The work queue's ranking and
// reconciliation jobs read them from here.
import { sourceProjectRows } from "dashboard/plan-wizard/project-sources-page-fields";
import { taskMatchScoresByProject } from "plan-wizard/stack-rank/task-rating-cache";

// ----------------------------------------------------------------------------------------------
// @desc The quarter's guide projects, from both of the Vision Guide's prospect envelopes.
// @param {object|null} guide - The Vision Guide, or null when it could not be read.
// @returns {Array<object>} Prospect records.
export function guideProspects(guide) {
  const envelopes = [guide?.workProspects, guide?.personalProspects].filter(Boolean);
  return envelopes.flatMap(envelope => envelope.prospects || []);
}

// ----------------------------------------------------------------------------------------------
// @desc Every task the sources page cites for one project, whatever its similarity score, which decides the low
//   scores a ranking may keep in the project's similarity hash.
// @param {object|null} guide - The Vision Guide, or null when it could not be read.
// @param {object} options - { projectUuid, quarterKey }.
// @returns {Array<string>|null} Cited task UUIDs, empty for a project the guide does not cite tasks for, or null
//   without a guide, when the cited tasks cannot be known.
export function citedTaskUuidsForProject(guide, { projectUuid, quarterKey }) {
  if (!guide) return null;
  const quarterProspects = guideProspects(guide).filter(prospect => !quarterKey || prospect?.quarterKey === quarterKey);
  const row = sourceProjectRows(quarterProspects).find(candidate => candidate.uuid === projectUuid);
  const citedTaskUuids = row?.servedTaskUuids || [];
  return citedTaskUuids;
}

// ----------------------------------------------------------------------------------------------
// @desc Add a task record for every cited task the fetched task list does not already contain, so the ranker can
//   describe a completed or evidence-only task.
// @param {Array<object>} tasks - Tasks read for the pass.
// @param {Array<object>} records - Required task records, as { noteUuid, taskText, taskUuid }.
// @returns {Array<object>} The fetched tasks plus a synthetic task for each missing UUID.
export function tasksCoveringRecords(tasks, records) {
  const coveredUuids = new Set(tasks.map(task => task.uuid));
  const addedTasks = records.filter(record => record.taskUuid && !coveredUuids.has(record.taskUuid))
    .map(record => ({ content: record.taskText, noteUUID: record.noteUuid || null, uuid: record.taskUuid }));
  return addedTasks.length ? [...tasks, ...addedTasks] : tasks;
}

// ----------------------------------------------------------------------------------------------
// @desc The tasks the sources page cites for one project that still have no similarity score, with enough text for
//   a rater to judge them. A ranking passes them as required tasks, so the page can show a score for each.
// @param {Array<object>} prospects - Guide prospects, from guideProspects.
// @param {object} options - An object with the following properties:
//   - {QuarterProject|undefined} project - The project as the store holds it, undefined when it holds none
//   - {string} projectUuid - The project's UUID
//   - {string|null} quarterKey - The quarter whose prospects count
//   - {Array<object>} tasks - Tasks read for the ranking
// @returns {Array<object>} { noteUuid, taskText, taskUuid }.
export function unscoredCitedTaskRecords(prospects, { project, projectUuid, quarterKey, tasks }) {
  const quarterProspects = prospects.filter(prospect => !quarterKey || prospect?.quarterKey === quarterKey);
  const row = sourceProjectRows(quarterProspects).find(candidate => candidate.uuid === projectUuid);
  if (!row) return [];
  const prospect = quarterProspects.find(candidate => candidate.uuid === projectUuid);
  const scores = project ? taskMatchScoresByProject([project])[projectUuid] || {} : {};
  return unscoredTaskRecords(row, { prospect, scores, tasks });
}

// ----------------------------------------------------------------------------------------------
// @desc The cited tasks that still have no stored similarity, with enough text for a rater to judge them.
// @param {object} row - Row from sourceProjectRows, carrying servedTaskUuids.
// @param {object} params - { prospect, scores, tasks }. scores is { [taskUuid]: number }.
// @returns {Array<object>} { noteUuid, taskText, taskUuid }.
export function unscoredTaskRecords(row, { prospect, scores, tasks }) {
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
