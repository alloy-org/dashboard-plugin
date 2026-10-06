// Guarantee due projects receive an actionable suggestion with an evidence-based explanation.

const WEEKDAY_ENUMS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// ----------------------------------------------------------------------------------------------
// @desc Fill omissions from the model with project tasks, keeping all obligations fixed and the required hour gap.
//   A suggestion the model already made keeps its reason and records the project it serves. A project the model
//   left out keeps its pace sentence for the agenda and is flagged so the calendar can ask for a benefit sentence.
//   Either way, a project whose chosen weekdays include the target day names that day as emphasizedWeekday.
// @param {Array<object>} activities - Validated model suggestions.
// @param {object} options - { nowMinutes, obligations, projects, targetDate, tasks }; projects are QuarterProjects
//   carrying day evidence from setProgressEvidence.
// @returns {object} { activities, unscheduledProjects }; full days retain due projects as untimed note suggestions.
export function ensureDueProjectSuggestions(activities, { nowMinutes, obligations, projects, targetDate, tasks }) {
  const result = [...activities];
  const unscheduledProjects = [];
  for (const project of projects.filter(project => project.due)) {
    const emphasizedWeekday = _emphasizedWeekday(project, targetDate);
    const relatedTasks = tasks.filter(task => project.matchesTask(task));
    const taskUuids = new Set(relatedTasks.map(task => task.taskUuid));
    if (obligations.some(row => taskUuids.has(row.taskUuid))) continue;
    const existing = result.find(row => taskUuids.has(row.taskUuid));
    if (existing) {
      existing.emphasizedWeekday = emphasizedWeekday;
      existing.projectSummary = project.summary || null;
      existing.projectUuid = project.uuid;
      continue;
    }
    const task = relatedTasks.find(candidate => !candidate.scheduledOnTarget);
    const durationMinutes = task?.duration ? Math.ceil(task.duration / 60) : 30;
    const startMinutes = projectSuggestionStart(durationMinutes, nowMinutes, obligations, result);
    const suggestion = { durationMinutes, emphasizedWeekday, isExisting: !!task, needsBenefitRationale: true,
      noteUuid: task?.noteUuid || project.primaryNoteUuid || null, projectSummary: project.summary || null,
      projectUuid: project.uuid, reason: project.reason, source: "proposed",
      targetMidnightSeconds: targetDate.getTime() / 1000, taskUuid: task?.taskUuid || null,
      title: task?.taskText || project.nextAction || `Advance ${ project.summary }: complete the next concrete step` };
    if (startMinutes === null) { unscheduledProjects.push(suggestion); continue; }
    const startTime = `${ String(Math.floor(startMinutes / 60)).padStart(2, "0") }:${ String(startMinutes % 60).padStart(2, "0") }`;
    result.push({ ...suggestion, startMinutes, startTime });
  }
  const orderedActivities = result.sort((first, second) => first.startMinutes - second.startMinutes);
  return { activities: orderedActivities, unscheduledProjects };
}

// ----------------------------------------------------------------------------------------------
// @desc The target day's name when the user chose it as one of the project's weekdays.
// @param {object} project - Project with preferredWeekdays as lowercase weekday enums.
// @param {Date} targetDate - The day being planned.
// @returns {string|null} e.g. "Tuesday", or null when the day was not chosen for the project.
function _emphasizedWeekday(project, targetDate) {
  const weekday = WEEKDAY_ENUMS[targetDate.getDay()];
  if (!(project.preferredWeekdays || []).includes(weekday)) return null;
  return `${ weekday.charAt(0).toUpperCase() }${ weekday.slice(1) }`;
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
