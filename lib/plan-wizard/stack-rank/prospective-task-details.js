// Gather what a rater needs to judge a prospective task beyond its own words: the note it lives in, that note's
// tags, and where it sits in a task outline. A one-line task such as "Write the tooltip copy" is unrateable alone
// and obvious once its parent task says "Ship Diff Digest onboarding".
//
// The task API reports only `isParent`; nothing points from a child to its parent. The outline is therefore read
// from the note's markdown, where each task line carries its UUID in a `<!-- {...} -->` comment and a subtask is
// indented beneath its parent. Indentation is taken from an `indent` field in that comment when one is present and
// from leading whitespace otherwise, and only relative depth is compared, so either encoding yields the same tree.
import { checkedAppResult } from "plan-wizard/vision-guide-notes";
import { dateFromDateInput, dateKeyFromDateInput } from "util/date-utility";

// How many of a parent's children are described; enough to show what the parent spans without crowding the batch.
const MAXIMUM_DESCRIBED_CHILDREN = 5;
const LIST_ITEM_PATTERN = /^([ \t]*)(?:[-*+]|\d+[.)])\s+(.*)$/;
const TASK_BODY_PATTERN = /^\[[ xX]?\]\s?(.*)$/;
const TASK_METADATA_PATTERN = /<!--\s*(\{[\s\S]*?\})\s*-->/;

// ----------------------------------------------------------------------------------------------
// @desc Strip the metadata comment and markdown link targets from a task's markdown, leaving the words a person
//   reads. A link keeps its label, since a label such as "Diff Digest spec" is often the task's subject.
// @param {string} markdown - Task content or a task line's body.
// @returns {string} Plain task text.
export function plainTaskText(markdown) {
  const withoutComments = String(markdown || "").replace(/<!--[\s\S]*?-->/g, "");
  const withoutLinkTargets = withoutComments.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1");
  return withoutLinkTargets.replace(/\s+/g, " ").trim();
}

// ----------------------------------------------------------------------------------------------
// @desc Collect the details for each prospective task: note name and tags, outline position, and the flags and
//   dates the user set. Notes are read once each, however many candidates they hold. A note that cannot be read
//   leaves its tasks described by what the task record itself carries rather than failing the whole batch.
// @param {object} app - Host-compatible Amplenote API.
// @param {Array<object>} tasks - Native task records for the candidates, each with uuid, content, and noteUUID.
// @returns {Promise<Array<object>>} One detail object per task, in input order, shaped { childTasks, createdOn,
//   deadlineOn, important, isParent, noteName, noteTags, noteUuid, parentTask, taskText, taskUuid, urgent }.
export async function prospectiveTaskDetails(app, tasks) {
  const noteUuids = [...new Set(tasks.map(task => task.noteUUID).filter(Boolean))];
  const noteContexts = await Promise.all(noteUuids.map(noteUuid => _noteContext(app, noteUuid)));
  const noteContextByUuid = new Map(noteUuids.map((noteUuid, index) => [noteUuid, noteContexts[index]]));
  const details = tasks.map(task => _taskDetail(task, noteContextByUuid.get(task.noteUUID)));
  return details;
}

// ----------------------------------------------------------------------------------------------
// @desc Build the task outline of one note. A plain bullet takes part in nesting, so a task indented under a
//   bullet that sits beside a task is not mistaken for that task's child; any other unindented line, such as a
//   heading or paragraph, ends the outline above it.
// @param {string} content - Note markdown.
// @returns {Map<string, object>} Per task UUID: { childTaskUuids, parentTaskUuid, taskText }.
export function taskOutlineFromNoteContent(content) {
  const outline = new Map();
  let openItems = [];
  for (const line of String(content || "").split("\n")) {
    const listMatch = line.match(LIST_ITEM_PATTERN);
    if (!listMatch) {
      if (line.trim() && !/^\s/.test(line)) openItems = [];
      continue;
    }
    const taskMatch = listMatch[2].match(TASK_BODY_PATTERN);
    const metadata = taskMatch ? _taskMetadata(listMatch[2]) : null;
    const depth = Number.isInteger(metadata?.indent) ? metadata.indent : _whitespaceDepth(listMatch[1]);
    while (openItems.length && openItems[openItems.length - 1].depth >= depth) openItems.pop();
    if (!metadata?.uuid) {
      openItems.push({ depth, taskUuid: null });
      continue;
    }
    const enclosing = openItems.length ? openItems[openItems.length - 1] : null;
    const parentTaskUuid = enclosing?.taskUuid || null;
    outline.set(metadata.uuid, { childTaskUuids: [], parentTaskUuid, taskText: plainTaskText(taskMatch[1]) });
    if (parentTaskUuid) outline.get(parentTaskUuid)?.childTaskUuids.push(metadata.uuid);
    openItems.push({ depth, taskUuid: metadata.uuid });
  }
  return outline;
}

// ----------------------------------------------------------------------------------------------
// @desc Express a task timestamp as a calendar date, or null when absent or unreadable.
// @param {*} value - Task timestamp in any form dateFromDateInput accepts.
// @returns {string|null} YYYY-MM-DD.
function _calendarDate(value) {
  if (!value) return null;
  const date = dateFromDateInput(value, { throwOnInvalid: false });
  return date ? dateKeyFromDateInput(date) : null;
}

// ----------------------------------------------------------------------------------------------
// @desc Read one note's name, tags, and task outline.
// @param {object} app - Host-compatible Amplenote API.
// @param {string} noteUuid - Note to read.
// @returns {Promise<object>} { noteName, noteTags, outline }, with an empty outline when the note is unreadable.
async function _noteContext(app, noteUuid) {
  let noteHandle = null;
  let content = "";
  try { noteHandle = checkedAppResult(await app.findNote({ uuid: noteUuid })); } catch (_error) { noteHandle = null; }
  try { content = checkedAppResult(await app.getNoteContent({ uuid: noteUuid })); } catch (_error) { content = ""; }
  const noteTags = Array.isArray(noteHandle?.tags) ? noteHandle.tags : [];
  return { noteName: noteHandle?.name ?? null, noteTags, outline: taskOutlineFromNoteContent(content) };
}

// ----------------------------------------------------------------------------------------------
// @desc Combine a task record with its note's context into the detail object a rater receives.
// @param {object} task - Native task record.
// @param {object|undefined} noteContext - From _noteContext.
// @returns {object} Task detail.
function _taskDetail(task, noteContext) {
  const outlineEntry = noteContext?.outline.get(task.uuid) || null;
  const parentEntry = outlineEntry?.parentTaskUuid ? noteContext.outline.get(outlineEntry.parentTaskUuid) : null;
  const parentTask = parentEntry ? { taskText: parentEntry.taskText, taskUuid: outlineEntry.parentTaskUuid } : null;
  const childUuids = (outlineEntry?.childTaskUuids || []).slice(0, MAXIMUM_DESCRIBED_CHILDREN);
  const childTasks = childUuids.map(childUuid => ({ taskText: noteContext.outline.get(childUuid).taskText,
    taskUuid: childUuid }));
  return { childTasks, createdOn: _calendarDate(task.createdAt), deadlineOn: _calendarDate(task.deadline),
    important: !!task.important, isParent: !!task.isParent || childTasks.length > 0,
    noteName: noteContext?.noteName ?? task.noteName ?? null, noteTags: noteContext?.noteTags || [],
    noteUuid: task.noteUUID || null, parentTask, taskText: plainTaskText(task.content), taskUuid: task.uuid,
    urgent: !!task.urgent };
}

// ----------------------------------------------------------------------------------------------
// @desc Parse a task line's metadata comment.
// @param {string} lineBody - The list item's text after its bullet.
// @returns {object|null} The comment's JSON, or null when absent or malformed.
function _taskMetadata(lineBody) {
  const match = lineBody.match(TASK_METADATA_PATTERN);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch (_error) { return null; }
}

// ----------------------------------------------------------------------------------------------
// @desc Measure indentation as nesting depth: a tab or two spaces is one level.
// @param {string} whitespace - Leading whitespace of a list line.
// @returns {number} Depth.
function _whitespaceDepth(whitespace) {
  const tabCount = (whitespace.match(/\t/g) || []).length;
  const spaceCount = whitespace.length - tabCount;
  return tabCount + Math.floor(spaceCount / 2);
}
