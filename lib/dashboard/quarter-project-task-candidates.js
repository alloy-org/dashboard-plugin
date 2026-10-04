// The candidates one project offers a day's recommendations: its open associated tasks, and its open generated ideas
// rated actionable and relevant enough to compete with them. Every candidate carries a candidate ID, `task:<uuid>` for
// an existing task and `idea:<ideaId>` for an idea, which ranking, reserves, the suggestion history, and the user's
// decisions use to tell the two apart. An idea's ID is never put where an Amplenote task UUID belongs: an idea
// candidate's uuid is null until the user accepts it and it becomes a task.
import { ideaComparisonKey } from "project-idea-records";
import { ideaRecommendable } from "project-task-idea-ratings";
import { minutesSinceIdeaRecommended, minutesSinceRecommended } from "project-suggestion-log";

// Minutes a suggested block occupies when its task records no duration, and the length an idea is offered at.
export const DEFAULT_DURATION_MINUTES = 30;
const MAXIMUM_IDEA_CANDIDATES = 2;
const MAXIMUM_TASK_CANDIDATES = 8;

// ----------------------------------------------------------------------------------------------
// @desc Build a project's candidates for one day: its open associated tasks, highest applicability score first, then
//   its recommendable ideas, most actionable first. A completed task is left out, as is an idea restating an open or
//   completed task, and any candidate the caller excludes by task UUID or candidate ID.
// @param {QuarterProject} project - Project with relatedTaskRecords, completedTasks, suggestedTasks, and taskSuggestions.
// @param {object} options - An object with the following properties:
//   - {Set<string>|null} [excludeIds] - Task UUIDs or candidate IDs already on screen or dismissed this pass
//   - {Date} now - The day being planned
//   - {Map<string, object>|null} [openTaskByUuid] - Open tasks by UUID, for duration and note identity
// @returns {Array<object>} { actionability, candidateId, durationMinutes, ideaId, isExisting, minutesSinceRecommended,
//   noteUuid, score, text, uuid }: score is a task's applicability or an idea's relevance; actionability and ideaId
//   are null for a task.
export function projectTaskCandidates(project, { excludeIds = null, now, openTaskByUuid = null }) {
  const taskCandidates = _openTaskCandidates(project, { excludeIds, now, openTaskByUuid });
  const ideaCandidates = _ideaCandidates(project, { excludeIds, now });
  return [...taskCandidates, ...ideaCandidates];
}

// ----------------------------------------------------------------------------------------------
// @desc The candidate ID of any suggestion record: one it carries, else one derived from its idea ID, else from its
//   task UUID. Records stored before candidates had IDs name only a task.
// @param {object} record - A candidate, ranked task, reserve, activity, or card.
// @returns {string|null} "idea:<ideaId>", "task:<uuid>", or null for a record naming neither.
export function suggestionCandidateId(record) {
  if (record?.candidateId) return record.candidateId;
  if (record?.ideaId) return `idea:${ record.ideaId }`;
  const taskUuid = record?.taskUuid || record?.uuid;
  return taskUuid ? `task:${ taskUuid }` : null;
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Minutes a suggested block should occupy. Amplenote stores task duration in seconds.
// @param {object|null} task - Open task, or null when the store record has no live task beside it.
// @returns {number} At least one minute, otherwise the default half hour.
function _durationMinutes(task) {
  const seconds = Number(task?.duration);
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_DURATION_MINUTES;
  return Math.max(1, Math.ceil(seconds / 60));
}

// ----------------------------------------------------------------------------------------------
// @desc Whether the caller excluded a candidate, by its task UUID or its candidate ID.
// @param {Set<string>|null} excludeIds - Excluded task UUIDs and candidate IDs.
// @param {string} candidateId - The candidate's ID.
// @param {string|null} taskUuid - The candidate's task UUID, null for an idea.
// @returns {boolean} True when excluded.
function _excluded(excludeIds, candidateId, taskUuid) {
  if (!excludeIds) return false;
  return excludeIds.has(candidateId) || Boolean(taskUuid && excludeIds.has(taskUuid));
}

// ----------------------------------------------------------------------------------------------
// @desc The project's recommendable ideas as candidates, most actionable first.
// @param {QuarterProject} project - The project.
// @param {object} options - { excludeIds, now }.
// @returns {Array<object>} Idea candidates.
function _ideaCandidates(project, { excludeIds, now }) {
  const knownSources = [...(project.relatedTaskRecords || []), ...(project.completedTasks || [])];
  const knownKeys = new Set(knownSources.map(source => ideaComparisonKey(source.taskText)).filter(Boolean));
  const recommendable = (project.suggestedTasks || []).filter(idea => ideaRecommendable(idea)
    && !knownKeys.has(ideaComparisonKey(idea.taskText)) && !_excluded(excludeIds, `idea:${ idea.ideaId }`, null));
  const mostActionable = [...recommendable].sort((first, second) => second.rating.actionability - first.rating.actionability);
  return mostActionable.slice(0, MAXIMUM_IDEA_CANDIDATES).map(idea => ({ actionability: idea.rating.actionability,
    candidateId: `idea:${ idea.ideaId }`, durationMinutes: DEFAULT_DURATION_MINUTES, ideaId: idea.ideaId, isExisting: false,
    minutesSinceRecommended: minutesSinceIdeaRecommended(project.taskSuggestions, idea.ideaId, now),
    noteUuid: project.primaryNoteUuid || null, score: idea.rating.relevance, text: idea.taskText, uuid: null }));
}

// ----------------------------------------------------------------------------------------------
// @desc The project's open associated tasks as candidates, highest applicability score first.
// @param {QuarterProject} project - The project.
// @param {object} options - { excludeIds, now, openTaskByUuid }.
// @returns {Array<object>} Task candidates.
function _openTaskCandidates(project, { excludeIds, now, openTaskByUuid }) {
  const completed = new Set((project.completedTasks || []).map(task => task.taskUuid));
  const candidates = [];
  for (const record of project.relatedTaskRecords || []) {
    const taskUuid = record?.taskUuid;
    if (!taskUuid || completed.has(taskUuid) || _excluded(excludeIds, `task:${ taskUuid }`, taskUuid)) continue;
    const openTask = openTaskByUuid?.get(taskUuid) || null;
    candidates.push({ actionability: null, candidateId: `task:${ taskUuid }`, durationMinutes: _durationMinutes(openTask),
      ideaId: null, isExisting: true, minutesSinceRecommended: minutesSinceRecommended(project.taskSuggestions, taskUuid, now),
      noteUuid: openTask?.noteUUID || openTask?.noteUuid || project.primaryNoteUuid || null,
      score: Number.isFinite(record.matchScore) ? record.matchScore : null,
      text: record.taskText || openTask?.content || openTask?.taskText || "Untitled task", uuid: taskUuid });
  }
  const byScore = candidates.sort((first, second) => (second.score ?? -1) - (first.score ?? -1));
  return byScore.slice(0, MAXIMUM_TASK_CANDIDATES);
}
