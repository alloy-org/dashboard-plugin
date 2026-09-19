// Guarantee due projects receive an actionable suggestion with an evidence-based explanation.
import { projectMatchesTask } from "project-progress-model";

// ----------------------------------------------------------------------------------------------
// @desc Fill omissions from the model with project tasks, keeping all obligations fixed and the required hour gap.
// @param {Array<object>} activities - Validated model suggestions.
// @param {object} options - { nowMinutes, obligations, projects, targetDate, tasks }.
// @returns {object} { activities, unscheduledProjects }; full days retain due projects as untimed note suggestions.
export function ensureDueProjectSuggestions(activities, { nowMinutes, obligations, projects, targetDate, tasks }) {
  const result = [...activities];
  const unscheduledProjects = [];
  for (const project of projects.filter(project => project.due)) {
    const relatedTasks = tasks.filter(task => projectMatchesTask(project, task));
    const taskUuids = new Set(relatedTasks.map(task => task.taskUuid));
    if (obligations.some(row => taskUuids.has(row.taskUuid))) continue;
    const existing = result.find(row => taskUuids.has(row.taskUuid));
    if (existing) { existing.projectUuid = project.uuid; existing.reason = project.reason; continue; }
    const task = relatedTasks.find(candidate => !candidate.scheduledOnTarget);
    const durationMinutes = task?.duration ? Math.ceil(task.duration / 60) : 30;
    const startMinutes = projectSuggestionStart(durationMinutes, nowMinutes, obligations, result);
    const suggestion = { durationMinutes, isExisting: !!task, noteUuid: task?.noteUuid || project.primaryNoteUuid || null,
      projectUuid: project.uuid, reason: project.reason, source: "proposed", targetMidnightSeconds: targetDate.getTime() / 1000,
      taskUuid: task?.taskUuid || null, title: task?.taskText || project.nextAction || `Advance ${ project.summary }: complete the next concrete step` };
    if (startMinutes === null) { unscheduledProjects.push(suggestion); continue; }
    const startTime = `${ String(Math.floor(startMinutes / 60)).padStart(2, "0") }:${ String(startMinutes % 60).padStart(2, "0") }`;
    result.push({ ...suggestion, startMinutes, startTime });
  }
  const orderedActivities = result.sort((first, second) => first.startMinutes - second.startMinutes);
  return { activities: orderedActivities, unscheduledProjects };
}

// ----------------------------------------------------------------------------------------------
// @desc Locate a free working-day slot, allowing one hour around other proposals and avoiding existing obligations.
// @param {number} durationMinutes - Proposed duration.
// @param {number|null} nowMinutes - Earliest time today, or null for a whole selected day.
// @param {Array<object>} obligations - Fixed task/calendar rows.
// @param {Array<object>} proposals - Other proposed rows.
// @returns {number|null} Start minutes or null when no slot is available before 18:00.
function projectSuggestionStart(durationMinutes, nowMinutes, obligations, proposals) {
  const occupied = obligations.map(row => ({ end: row.startMinutes + (row.durationMinutes || 30), start: row.startMinutes }));
  const buffered = proposals.map(row => ({ end: row.startMinutes + row.durationMinutes + 60, start: row.startMinutes - 60 }));
  const blocks = [...occupied, ...buffered].sort((first, second) => first.start - second.start);
  let start = Math.max(9 * 60, nowMinutes || 0);
  for (const block of blocks) {
    if (start < block.end && start + durationMinutes > block.start) start = block.end;
  }
  return start + durationMinutes <= 18 * 60 ? start : null;
}
