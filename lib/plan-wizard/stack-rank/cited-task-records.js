// Find the tasks the Plan Builder's sources page cites for a project that still have no similarity score, so a
// ranking can rate them as required tasks and the page can show a score for each. The work queue's ranking and
// reconciliation jobs read them from here.
import { sourceProjectRows } from "dashboard/plan-wizard/project-sources-page-fields";
import { taskMatchScoresByProject } from "plan-wizard/stack-rank/task-rating-cache";
import { logIfEnabled } from "util/log";

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
// @desc Read the unscored cited tasks one project is missing from the fetched task list, and return its unscored
//   cited task records with their text. A citation stores only task and note UUIDs, and the domain read returns only
//   open tasks, so a completed cited task has no text until it is read on its own. Only unscored tasks are read, so a
//   cited task costs one lookup until its first score is stored. A task that cannot be read is left out.
// @param {object} app - Host-compatible Amplenote API; only getTask is called.
// @param {Array<object>} prospects - Guide prospects, from guideProspects.
// @param {object} options - The options unscoredCitedTaskRecords takes: { project, projectUuid, quarterKey, tasks }.
// @returns {Promise<object>} An object with the following properties:
//   - {Array<object>} records - { noteUuid, taskText, taskUuid } for each unscored cited task with text
//   - {Array<object>} tasks - The fetched tasks, plus each cited task read here
export async function readUnscoredCitedTaskRecords(app, prospects, { project, projectUuid, quarterKey, tasks }) {
  const options = { project, projectUuid, quarterKey };
  const fetchedTaskUuids = new Set(tasks.map(task => task.uuid));
  const unscoredTaskUuids = _unscoredCitedTaskUuids(prospects, options);
  const unreadTaskUuids = unscoredTaskUuids.filter(taskUuid => !fetchedTaskUuids.has(taskUuid));
  const readTasks = await _readTasks(app, unreadTaskUuids);
  const coveredTasks = readTasks.length ? [...tasks, ...readTasks] : tasks;
  const records = unscoredCitedTaskRecords(prospects, { ...options, tasks: coveredTasks });
  return { records, tasks: coveredTasks };
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

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Read tasks one at a time by UUID, dropping any the host cannot find or fails to read, and log how many were
//   requested and found and the milliseconds the reads took together.
// @param {object} app - Host-compatible Amplenote API.
// @param {Array<string>} taskUuids - Tasks to read.
// @returns {Promise<Array<object>>} The tasks found, in input order.
async function _readTasks(app, taskUuids) {
  if (!taskUuids.length || typeof app?.getTask !== "function") return [];
  const readStart = performance.now();
  const readResults = await Promise.all(taskUuids.map(taskUuid => app.getTask(taskUuid).catch(error => {
    logIfEnabled("[cited-task-records] could not read cited task", { message: error?.message, taskUuid });
    return null;
  })));
  const foundTasks = readResults.filter(task => task?.uuid);
  logIfEnabled("[cited-task-records] read cited task text by UUID", { foundCount: foundTasks.length, readMs: Number((performance.now() - readStart).toFixed(1)), requestedCount: taskUuids.length });
  return foundTasks;
}

// ----------------------------------------------------------------------------------------------
// @desc The task UUIDs one project cites that have no stored similarity score, whether or not their text is known.
// @param {Array<object>} prospects - Guide prospects, from guideProspects.
// @param {object} options - { project, projectUuid, quarterKey }.
// @returns {Array<string>} Unscored cited task UUIDs, in citation order.
function _unscoredCitedTaskUuids(prospects, { project, projectUuid, quarterKey }) {
  const quarterProspects = prospects.filter(prospect => !quarterKey || prospect?.quarterKey === quarterKey);
  const row = sourceProjectRows(quarterProspects).find(candidate => candidate.uuid === projectUuid);
  if (!row) return [];
  const scores = project ? taskMatchScoresByProject([project])[projectUuid] || {} : {};
  const unscoredTaskUuids = row.servedTaskUuids.filter(taskUuid => !Number.isFinite(scores[taskUuid]));
  return unscoredTaskUuids;
}
