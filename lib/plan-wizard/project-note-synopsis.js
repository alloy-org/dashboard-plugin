// Read the note that defines a project and reduce it to what the project card shows under "How it gets done": the
// note's opening prose as a synopsis, the most recently finished task, the next few open ones, and how many of its
// tasks are done. Kept free of React so the reduction can be tested without rendering; host-compatible since it
// only reads through the app interface.

import { plainTaskText } from "plan-wizard/stack-rank/prospective-task-details";
import { readNoteContentWithinLength } from "util/bounded-note-content";
import { stripMarkdown } from "util/utility";

// Notes longer than this are not read for a synopsis; their name and tasks are still shown.
const MAXIMUM_NOTE_CHARACTERS = 200000;
export const MAXIMUM_OPEN_TASKS_LISTED = 3;
export const MAXIMUM_SYNOPSIS_CHARACTERS = 280;
// A first paragraph shorter than this rarely says how the work gets done, so the next one is added to it.
const MINIMUM_SYNOPSIS_CHARACTERS = 80;

// ----------------------------------------------------------------------------------------------
// @desc Convert a task timestamp to milliseconds, accepting the seconds the task API stores and milliseconds alike.
// @param {number|string|null|undefined} value - Timestamp from a task record.
// @returns {number|null} Milliseconds since the epoch, or null when absent or unreadable.
function millisecondsFromTaskTime(value) {
  if (value == null || value === "") return null;
  const numericValue = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(numericValue)) return numericValue < 1e12 ? numericValue * 1000 : numericValue;
  const parsedMilliseconds = new Date(value).getTime();
  return Number.isFinite(parsedMilliseconds) ? parsedMilliseconds : null;
}

// ----------------------------------------------------------------------------------------------
// @desc Describe one task as the card lists it.
// @param {object} task - Task record from getNoteTasks.
// @returns {object} { dueLabel, isDone, text, uuid }; dueLabel is a short month and day, or "" without a date.
function listedTaskFromRecord(task) {
  const dueMilliseconds = millisecondsFromTaskTime(task.deadline ?? task.startAt);
  const dueLabel = dueMilliseconds ? new Date(dueMilliseconds).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "";
  return { dueLabel, isDone: Boolean(task.completedAt), text: stripMarkdown(plainTaskText(task.content)) || "Untitled task",
    uuid: task.uuid };
}

// ----------------------------------------------------------------------------------------------
// @desc Choose the tasks the card lists: the most recently finished one, so the user sees the project moving, then
//   the open tasks in the order the note holds them. Dismissed tasks are neither listed nor counted.
// @param {Array<object>} tasks - Task records from getNoteTasks with includeDone.
// @returns {object} { doneCount, listedTasks, taskCount }; listedTasks from listedTaskFromRecord.
export function noteTaskSummary(tasks = []) {
  const liveTasks = tasks.filter(task => task && !task.dismissedAt);
  const doneTasks = liveTasks.filter(task => task.completedAt);
  const openTasks = liveTasks.filter(task => !task.completedAt);
  const newestDoneTasks = [...doneTasks].sort((first, second) => (millisecondsFromTaskTime(second.completedAt) ?? 0)
    - (millisecondsFromTaskTime(first.completedAt) ?? 0));
  const shownTasks = newestDoneTasks.slice(0, 1).concat(openTasks.slice(0, MAXIMUM_OPEN_TASKS_LISTED));
  return { doneCount: doneTasks.length, listedTasks: shownTasks.map(listedTaskFromRecord), taskCount: liveTasks.length };
}

// ----------------------------------------------------------------------------------------------
// @desc Read a project's note and summarize it for the card.
// @param {object} app - Host-compatible Amplenote API.
// @param {string} noteUuid - The note defining the project.
// @param {Date} [now=new Date()] - When the read happened, recorded so the card can say how fresh it is.
// @returns {Promise<object|null>} null when the note no longer exists; otherwise an object with the following
//   properties:
//   - {number} doneCount - Finished tasks in the note.
//   - {Array<object>} listedTasks - Tasks to list, from noteTaskSummary.
//   - {string} noteName - The note's current name, which the project takes as its own.
//   - {string} noteUuid - The note read.
//   - {string} readAt - ISO timestamp of the read.
//   - {string} synopsisText - Opening prose of the note, or "" when it has none or was too long to read.
//   - {number} taskCount - Tasks in the note, finished ones included.
export async function readProjectNoteSynopsis(app, noteUuid, now = new Date()) {
  const noteHandle = await app.findNote({ uuid: noteUuid });
  if (!noteHandle?.uuid) return null;
  const [content, tasks] = await Promise.all([
    readNoteContentWithinLength(app, { uuid: noteUuid }, MAXIMUM_NOTE_CHARACTERS).catch(() => null),
    Promise.resolve(app.getNoteTasks({ uuid: noteUuid }, { includeDone: true })).catch(() => []) ]);
  const synopsisText = typeof content === "string" ? synopsisFromNoteContent(content) : "";
  const taskSummary = noteTaskSummary(Array.isArray(tasks) ? tasks : []);
  return { ...taskSummary, noteName: noteHandle.name || "Untitled note", noteUuid, readAt: now.toISOString(), synopsisText };
}

// ----------------------------------------------------------------------------------------------
// @desc Take the opening prose of a note as its synopsis. Headings, tasks, list items, quotes, tables, code, rules,
//   and footnote definitions are passed over, since those are structure rather than a statement of the plan. A
//   short first paragraph is joined with the next, and the result is cut at a word boundary.
// @param {string} content - Note markdown.
// @returns {string} Plain-text synopsis of at most MAXIMUM_SYNOPSIS_CHARACTERS plus an ellipsis, or "".
export function synopsisFromNoteContent(content) {
  const withoutComments = String(content ?? "").replace(/<!--[\s\S]*?-->/g, "");
  const withoutCode = withoutComments.replace(/```[\s\S]*?```/g, "");
  const paragraphs = withoutCode.split(/\n\s*\n/).map(paragraph => paragraph.trim()).filter(Boolean);
  const structuralPattern = /^(#|[-*+] |\d+[.)] |>|\||\[\^|---|\*\*\*|___)/;
  const proseParagraphs = paragraphs.filter(paragraph => !structuralPattern.test(paragraph));
  const plainParagraphs = proseParagraphs.map(paragraph => stripMarkdown(paragraph.replace(/\s*\n\s*/g, " ")));
  const usableParagraphs = plainParagraphs.filter(Boolean);
  let synopsis = usableParagraphs[0] ?? "";
  if (synopsis && synopsis.length < MINIMUM_SYNOPSIS_CHARACTERS && usableParagraphs[1]) synopsis = `${ synopsis } ${ usableParagraphs[1] }`;
  if (synopsis.length <= MAXIMUM_SYNOPSIS_CHARACTERS) return synopsis;
  const clippedText = synopsis.slice(0, MAXIMUM_SYNOPSIS_CHARACTERS);
  const lastSpaceIndex = clippedText.lastIndexOf(" ");
  const wholeWordsText = lastSpaceIndex > 0 ? clippedText.slice(0, lastSpaceIndex) : clippedText;
  return `${ wholeWordsText.replace(/[\s,;:.–—-]+$/, "") }…`;
}
