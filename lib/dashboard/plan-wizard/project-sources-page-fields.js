// Shape what the projects page's sources page lists: each live project with the number of tasks it was drawn from
// and whether the user has already settled its cadence, and whether the evidence behind the projects is too thin to
// support specific suggestions. Kept apart from the component so these rules can be tested without rendering.

import { PACE_OPTIONS } from "dashboard/plan-wizard/pace-cards-step-fields";
import { isDeclinedActionProspect } from "plan-wizard/plan-models";
import { SIMILAR_TASK_MINIMUM_SCORE } from "plan-wizard/stack-rank/task-rating-cache";

// Below this many notes and tasks combined, projects are drawn from too little to be specific, and the page says so.
export const MINIMUM_CONSIDERED_SOURCES = 10;

// ----------------------------------------------------------------------------------------------
// @desc Decide whether a task's similarity score rules it out of the project it was cited for.
// @param {number|undefined} score - The task's 1–10 similarity to the project, if rated.
// @returns {boolean} True when the task was rated and fell below SIMILAR_TASK_MINIMUM_SCORE.
function isDissimilarScore(score) {
  return Number.isFinite(score) && score < SIMILAR_TASK_MINIMUM_SCORE;
}

// ----------------------------------------------------------------------------------------------
// @desc List the distinct tasks a project cites as its evidence, which are the tasks it would serve.
// @param {object} prospect - ActionProspect record.
// @returns {Array<string>} Distinct cited task UUIDs in citation order; empty for a project the user named.
function servedTaskUuids(prospect) {
  const evidence = Array.isArray(prospect.evidence) ? prospect.evidence : [];
  const evidenceTaskUuids = evidence.map(item => item?.taskUuid).filter(Boolean);
  const citedTaskUuids = evidenceTaskUuids.length ? evidenceTaskUuids : prospect.relatedTasks ?? [];
  return [...new Set(citedTaskUuids)];
}

// ----------------------------------------------------------------------------------------------
// @desc List the projects the sources page shows: every named project the user has not declined, with the most
//   tasks served first, so the projects the evidence most supports lead. When similarity scores are supplied, a
//   cited task rated below SIMILAR_TASK_MINIMUM_SCORE is not counted as served, so the row's count matches the list
//   it opens to; a task not yet rated is still counted.
// @param {Array<object>} prospects - Live ActionProspect records for the quarter.
// @param {object|null} [matchScoresByProjectUuid=null] - { [projectUuid]: { [taskUuid]: score } }, or null to count
//   every cited task.
// @returns {Array<object>} Rows, each with the following properties:
//   - {number} citedTaskCount - Distinct tasks the project cites, before any are left out for a low score.
//   - {string|null} paceLabel - The chosen cadence's name, or null before one is chosen.
//   - {number} servedTaskCount - Cited tasks not left out for a low score.
//   - {Array<string>} servedTaskUuids - Those tasks' UUIDs, in citation order.
//   - {string} summary - The project's name.
//   - {string} userCategoryEm - work or personal.
//   - {string} uuid - The project's identity.
// A project with a cadence chosen has been ratified by the user, which paceLabel lets the page mark.
export function sourceProjectRows(prospects = [], matchScoresByProjectUuid = null) {
  const namedProspects = prospects.filter(prospect => prospect.summary?.trim());
  const keptProspects = namedProspects.filter(prospect => !isDeclinedActionProspect(prospect));
  const projectRows = keptProspects.map(prospect => {
    const paceOption = PACE_OPTIONS.find(option => option.value === prospect.paceEm);
    const citedUuids = servedTaskUuids(prospect);
    const scoreByTaskUuid = matchScoresByProjectUuid?.[prospect.uuid] ?? {};
    const taskUuids = citedUuids.filter(taskUuid => !isDissimilarScore(scoreByTaskUuid[taskUuid]));
    return { citedTaskCount: citedUuids.length, paceLabel: paceOption?.label ?? null, servedTaskCount: taskUuids.length,
      servedTaskUuids: taskUuids, summary: prospect.summary, userCategoryEm: prospect.userCategoryEm,
      uuid: prospect.uuid };
  });
  const rankedRows = projectRows.sort((first, second) => second.servedTaskCount - first.servedTaskCount);
  return rankedRows;
}

// ----------------------------------------------------------------------------------------------
// @desc Resolve the tasks a project row cites into what its expanded list shows, important and open work first.
// @param {object} projectRow - Row from sourceProjectRows.
// @param {object|null} projectSources - Summary from projectSourcesFromEvidence, or null before one is collected.
// @returns {object} An object with the following properties:
//   - {Array<object>} tasks - { completedAt, isImportant, matchScore, noteName, noteUuid, text, uuid } for each cited
//     task found among the considered tasks; matchScore is Jev's 1–10 similarity to the project, or null when unrated.
//   - {number} unreadTaskCount - Cited tasks not among them, such as tasks since deleted or no longer recent enough
//     to be read; their text is not stored with the project, so the page can only count them.
export function projectTaskItems(projectRow, projectSources) {
  const taskByUuid = projectSources?.taskByUuid ?? {};
  const foundTaskUuids = projectRow.servedTaskUuids.filter(taskUuid => taskByUuid[taskUuid]);
  const scoreByTaskUuid = projectSources?.matchScoresByProjectUuid?.[projectRow.uuid] ?? {};
  const foundTasks = foundTaskUuids.map(taskUuid => ({ ...taskByUuid[taskUuid], matchScore: scoreByTaskUuid[taskUuid] ?? null,
    uuid: taskUuid }));
  const taskRank = task => (task.isImportant ? 0 : 2) + (task.completedAt ? 1 : 0);
  const rankedTasks = foundTasks.sort((first, second) => taskRank(first) - taskRank(second));
  return { tasks: rankedTasks, unreadTaskCount: projectRow.servedTaskUuids.length - foundTaskUuids.length };
}

// ----------------------------------------------------------------------------------------------
// @desc Decide whether discovery had too little to read for its projects to be specific to the user.
// @param {object|null} projectSources - Summary from projectSourcesFromEvidence, or null before one is collected.
// @returns {boolean} True when fewer than MINIMUM_CONSIDERED_SOURCES notes and tasks were considered in total.
export function hasThinSources(projectSources) {
  if (!projectSources) return false;
  return projectSources.consideredNoteCount + projectSources.consideredTaskCount < MINIMUM_CONSIDERED_SOURCES;
}
