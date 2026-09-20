// Render and parse the per-project sections of the quarterly project task store, so each project can be
// rewritten independently through a section-scoped replaceNoteContent rather than a whole-note rewrite.
import { jsonPayloadMarkdown, parseJsonPayload } from "plan-wizard/vision-guide-markdown";
import { footnoteDefinitionsMarkdown, footnoteNumbering, footnoteSafeLinkMarkdown,
  linkLabelFromMarkdown } from "util/amplenote-rich-footnote-writing";
import { dateKeyFromDateInput } from "util/date-utility";

export const ACTIVE_PROJECTS_HEADING = "Active projects";
export const PAST_PROJECTS_HEADING = "Past projects";
export const STORE_PREAMBLE_TEXT = "Maintained by the Dashboard. Task associations and ideas are collected in the "
  + "background after each dashboard load, so calendar suggestions can be produced without waiting for discovery.";

// ----------------------------------------------------------------------------------------------
// @desc Compose the two root headings a new store note begins with, so every later write targets a section
//   that already exists rather than appending to the end of the note.
// @returns {string} Initial note markdown carrying both project roots and no projects.
export function initialProjectTaskStoreMarkdown() {
  return `${ STORE_PREAMBLE_TEXT }\n\n# ${ ACTIVE_PROJECTS_HEADING }\n\n# ${ PAST_PROJECTS_HEADING }\n`;
}

// ----------------------------------------------------------------------------------------------
// @desc Read one project's persisted record back out of its rendered section, tolerating a section a human
//   has annotated with extra prose around the payload fence.
// @param {string} sectionBody - Markdown between a project heading and the next sibling heading.
// @returns {object|null} The stored record, or null when the section carries no readable payload.
export function projectRecordFromSection(sectionBody) {
  try {
    return parseJsonPayload(sectionBody).payload;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Build the heading text identifying one project's section. The UUID is carried in the heading so a
//   renamed project keeps its section, and so two projects sharing a summary remain distinguishable.
//   A summary carrying its own markdown link would split the heading in two, so it is flattened the same way
//   task text is. Footnote references are dropped rather than renumbered, because a heading cannot carry the
//   definitions they would need; the same flattening runs when the heading is looked up, so existing sections
//   still match.
// @param {object} project - Project record with `summary` and `uuid`.
// @returns {string} Heading text, without its leading hashes.
export function projectSectionHeadingText(project) {
  return `${ linkLabelFromMarkdown(project.summary, null, "Untitled project") } (project:${ project.uuid })`;
}

// ----------------------------------------------------------------------------------------------
// @desc Render one project's whole section body: the human-readable three lists the user reads, followed by
//   the exact machine payload the next pass reads back. Prose is a projection of the payload here (unlike the
//   Vision Guide), because every line of it is generated and no part of it is user-authored.
// @param {object} project - Project record with the following properties:
//   - {string} uuid - Stable project identity
//   - {string} summary - Project display name
//   - {string|null} lastAttemptedAt - ISO timestamp of the last association pass, or null when never attempted
//   - {Array<object>} relatedTaskRecords - Open tasks as { taskText, taskUuid }
//   - {Array<object>} suggestedTasks - Generated ideas as { generatedAt, taskText }
//   - {Array<object>} completedTasks - Completions as { completedAt, taskUuid }
// @returns {string} Section body to place beneath the project's heading.
export function projectSectionMarkdown(project) {
  const numbering = footnoteNumbering();
  const attemptedLine = `- Last attempted: ${ project.lastAttemptedAt || "never" }`;
  const existingLines = _taskListMarkdown((project.relatedTaskRecords || []).map(
    task => footnoteSafeLinkMarkdown(task.taskText, _taskUrl(task.taskUuid), numbering, "Untitled task")));
  const suggestedLines = _taskListMarkdown((project.suggestedTasks || []).map(
    task => linkLabelFromMarkdown(task.taskText, numbering, "Untitled task")));
  const completedLines = _taskListMarkdown((project.completedTasks || []).map(
    task => `${ task.taskUuid } — completed ${ dateKeyFromDateInput(task.completedAt) }`));
  const payload = _storedProjectPayload(project);
  return `${ attemptedLine }\n\n- Existing tasks\n${ existingLines }\n- Suggested tasks\n${ suggestedLines }\n`
    + `- Completed tasks\n${ completedLines }\n${ jsonPayloadMarkdown(payload) }`
    + footnoteDefinitionsMarkdown(numbering);
}

// ----------------------------------------------------------------------------------------------
// @desc Build the URL that addresses one task directly, so a reader can jump from the store to the task itself.
// @param {string} taskUuid - Task identity.
// @returns {string} Amplenote task URL.
function _taskUrl(taskUuid) {
  return `https://www.amplenote.com/notes/tasks/${ taskUuid }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Indent a set of task descriptions as a nested bullet list, naming the empty case explicitly so an
//   unattempted project reads as "not yet looked at" rather than as a rendering failure.
// @param {Array<string>} entries - Already-formatted bullet texts.
// @returns {string} Nested markdown bullets, newline-terminated.
function _taskListMarkdown(entries) {
  if (!entries.length) return "  - (none yet)\n";
  return `${ entries.map(entry => `  - ${ entry }`).join("\n") }\n`;
}

// ----------------------------------------------------------------------------------------------
// @desc Reduce a project to the fields the store persists, so unrelated in-memory evidence computed for one
//   target date (due, reason, completedThisWeek) never reaches the note and become stale there.
// @param {object} project - Project record, possibly carrying derived evidence fields.
// @returns {object} The persisted subset of the record.
function _storedProjectPayload(project) {
  const { blocksPerWeek = null, completedTasks = [], focusMonths = null, lastAttemptedAt = null,
    lastSuggestedAt = null, preferredWeekdays = null, primaryNoteUuid = null, relatedTaskRecords = [],
    relatedTasks = [], suggestedTasks = [], summary, uuid } = project;
  return { blocksPerWeek, completedTasks, focusMonths, lastAttemptedAt, lastSuggestedAt, preferredWeekdays,
    primaryNoteUuid, relatedTaskRecords, relatedTasks, suggestedTasks, summary, uuid };
}
