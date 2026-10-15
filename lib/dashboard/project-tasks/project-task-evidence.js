// Name why an existing task belongs to a project, and decide from that and its similarity score whether the task may
// be offered as a calendar suggestion. The project task store writes each reason beside its task in the Existing tasks
// lists and reads it back from there, and the day's candidates apply the same rule, so the note shows exactly which
// tasks can be suggested.
import { SIMILAR_TASK_MINIMUM_SCORE } from "plan-wizard/stack-rank/task-rating-cache";

// How a task is linked to a project other than by similarity. A direct link is read from the task itself: it sits in
// the project's primary note, links to the project, or names it. An assignment is a task UUID the project was given:
// cited by Plan Builder, or attributed by the idea generator.
export const TASK_LINK_REASONS = Object.freeze({ assigned: "assigned", primaryNote: "primaryNote",
  projectLink: "projectLink", projectName: "projectName" });

// The words each link reason is written as beside its task.
const LINK_REASON_LABELS = Object.freeze({ assigned: "assigned to project", primaryNote: "in primary note",
  projectLink: "links to project", projectName: "names project" });
const DIRECT_LINK_REASONS = new Set([TASK_LINK_REASONS.primaryNote, TASK_LINK_REASONS.projectLink,
  TASK_LINK_REASONS.projectName]);

// ----------------------------------------------------------------------------------------------
// @desc Decide whether an existing task may be offered as a suggestion. A direct link always qualifies. Otherwise a
//   task rated below SIMILAR_TASK_MINIMUM_SCORE does not, including an assigned task, matching the sources page,
//   which leaves out cited tasks rated that low. A task not yet rated qualifies, since it was associated by evidence.
// @param {object} record - { linkedBy?, matchScore? }.
// @returns {boolean} True when the task may be suggested.
export function isSuggestableTaskRecord(record) {
  if (DIRECT_LINK_REASONS.has(record?.linkedBy)) return true;
  const isRatedBelowMinimum = Number.isFinite(record?.matchScore) && record.matchScore < SIMILAR_TASK_MINIMUM_SCORE;
  return !isRatedBelowMinimum;
}

// ----------------------------------------------------------------------------------------------
// @desc The words written beside a task for its link reason.
// @param {string|null} linkedBy - One of TASK_LINK_REASONS, or null.
// @returns {string|null} The label, or null for no or an unknown reason.
export function linkReasonLabel(linkedBy) {
  return LINK_REASON_LABELS[linkedBy] || null;
}

// ----------------------------------------------------------------------------------------------
// @desc Read a link reason back from the words written beside a task.
// @param {string} label - One clause of a task line's annotation.
// @returns {string|null} One of TASK_LINK_REASONS, or null when the clause names none.
export function linkReasonFromLabel(label) {
  const matchingEntry = Object.entries(LINK_REASON_LABELS).find(([, reasonLabel]) => reasonLabel === label.trim());
  return matchingEntry ? matchingEntry[0] : null;
}
