// Convert a QuarterProject to and from the forms its two notes persist: the plain record the progress note's payload
// holds, and the section of the project task store a project owns, which pairs the lists the user reads with the
// JSON payload and similarity hash the next pass reads back. QuarterProject delegates to these functions, so the
// class keeps its fields and behavior while this file keeps the note formats.
import { SIMILAR_TASK_MINIMUM_SCORE, sortedSimilarityScores, taskRatingKey, taskUuidFromRatingKey } from "plan-wizard/stack-rank/task-rating-cache";
import { jsonPayloadMarkdown, parseJsonPayload } from "plan-wizard/vision-guide-markdown";
import { suggestionSectionsMarkdown } from "project-suggestion-log";
import { footnoteDefinitionsMarkdown, footnoteNumbering, footnoteSafeLinkMarkdown,
  linkLabelFromMarkdown } from "util/amplenote-rich-footnote-writing";
import { dateKeyFromDateInput } from "util/date-utility";

// Introduced the code block of sparse Jev ratings that records written before the similarity hash carried. It is
// still read, so those ratings fold into the hash rather than being rated again.
export const LEGACY_JEV_RATINGS_LABEL = "Jev ratings of tasks the project did not keep, by checksum:task UUID:";
// Introduces the code block holding the project's similarity hash. The block is found by this line rather than by
// its fence language, so it is never mistaken for the project's JSON payload.
export const SIMILARITY_SCORES_LABEL = "Task similarity scores, by checksum:task UUID, sorted by task UUID:";
// Each existing task renders as a link to the task, which is how its UUID is read back out of the list.
const EXISTING_TASK_LINE_PATTERN = /^ {2}- \[(.*)\]\(https:\/\/www\.amplenote\.com\/notes\/tasks\/([^)\s]+)\)/;
const EXISTING_TASKS_LINE = "- Existing tasks";
const SUGGESTED_TASKS_LINE = "- Suggested tasks";

// ----------------------------------------------------------------------------------------------
// @desc Reduce a project to the fields the progress note persists: its identity, pace choices, and task evidence.
//   Store-owned fields live in the project task store, and day evidence is recomputed for each date planned.
// @param {QuarterProject} project - Project to persist.
// @returns {object} Plain record for the progress note's JSON payload.
export function progressRecord(project) {
  const { blocksPerWeek, completedTasks, deadlineOn, focusMonths, nextAction, paceEm, preferredWeekdays, primaryNoteUuid,
    priorityEm, relatedTasks, summary, uuid } = project;
  return { blocksPerWeek, completedTasks, deadlineOn, focusMonths, nextAction, paceEm, preferredWeekdays, primaryNoteUuid,
    priorityEm, relatedTasks, summary, uuid };
}

// ----------------------------------------------------------------------------------------------
// @desc Read one project's persisted record back out of its store section, tolerating a section a human has
//   annotated with extra prose around the payload fence. The similarity block is read separately and lifted out
//   before the payload is parsed; scores that cannot be parsed are treated as none, since they only save cost. The
//   project's existing tasks are read from their rendered list rather than the payload, which no longer repeats them,
//   and each takes its score from the similarity hash. A record written before the hash existed keeps its payload's
//   task list, and its kept tasks' scores and sparse Jev ratings are folded into the hash.
// @param {string} sectionBody - Markdown between a project heading and the next sibling heading.
// @returns {object|null} The stored record with `relatedTaskRecords` and `taskSimilarityScores`, or null when the
//   section carries no readable payload.
export function storeRecordFromSection(sectionBody) {
  const similarityBlock = _labelledJsonBlock(sectionBody, SIMILARITY_SCORES_LABEL);
  const legacyBlock = _labelledJsonBlock(sectionBody, LEGACY_JEV_RATINGS_LABEL);
  const presentBlocks = [similarityBlock, legacyBlock].filter(Boolean);
  const liftedBlocks = presentBlocks.sort((first, second) => second.start - first.start);
  const payloadBody = liftedBlocks.reduce((body, block) => `${ body.slice(0, block.start) }${ body.slice(block.end) }`,
    sectionBody);
  let payload = null;
  try {
    payload = parseJsonPayload(payloadBody).payload;
  } catch {
    return null;
  }
  const legacyRecords = Array.isArray(payload.relatedTaskRecords) ? payload.relatedTaskRecords : null;
  const taskSimilarityScores = sortedSimilarityScores({ ..._legacyRecordScores(payload.summary, legacyRecords),
    ...legacyBlock?.values, ...similarityBlock?.values });
  const scoreByTaskUuid = new Map(Object.entries(taskSimilarityScores).map(([ratingKey, rating]) =>
    [taskUuidFromRatingKey(ratingKey), rating]));
  const listedRecords = legacyRecords || _existingTaskRecords(sectionBody);
  const relatedTaskRecords = listedRecords.map(record => _recordWithScore(record, scoreByTaskUuid));
  return { ...payload, relatedTaskRecords, taskSimilarityScores };
}

// ----------------------------------------------------------------------------------------------
// @desc Reduce a project to the fields the task store persists in its JSON payload, so day evidence computed for one
//   target date never reaches the note and becomes stale there. The output revision and each refresh operation's
//   last success are kept here, beside the times they qualify. The existing tasks are left to their rendered list
//   and the similarity hash to its own block. relatedTasks drops the tasks the hash already rates similar, since the
//   hash associates them and re-checks them when they change.
// @param {QuarterProject} project - Project to persist.
// @returns {object} Plain record for the store section's JSON payload.
export function storeRecord(project) {
  const { blocksPerWeek, completedTasks, focusMonths, lastAttemptedAt, lastRankedAt, lastSuggestedAt, preferredWeekdays,
    primaryNoteUuid, projectRevision, refreshState, relatedTasks, similaritySearchedTaskCount, similaritySearchPageCount,
    suggestedTasks, summary, taskSuggestions, uuid } = project;
  const similarTaskUuids = project.similarTaskUuids();
  const unscoredRelatedTasks = relatedTasks.filter(taskUuid => !similarTaskUuids.has(taskUuid));
  return { blocksPerWeek, completedTasks, focusMonths, lastAttemptedAt, lastRankedAt, lastSuggestedAt, preferredWeekdays,
    primaryNoteUuid, projectRevision, refreshState, relatedTasks: unscoredRelatedTasks, similaritySearchedTaskCount,
    similaritySearchPageCount, suggestedTasks, summary, taskSuggestions, uuid };
}

// ----------------------------------------------------------------------------------------------
// @desc Render one project's whole store section body: the three lists the user reads, followed by the machine
//   payload the next pass reads back and the project's similarity hash. Every line is generated and no part of it is
//   user-authored (unlike the Vision Guide). The existing tasks are written only as their list, which is read back for
//   their UUIDs, so the note holds each task's text once. They render as plain-text links without their Rich
//   Footnotes: the link already leads to the task, where the footnotes (captions, images) remain intact, so copying
//   them here would only duplicate them.
// @param {QuarterProject} project - Project to render.
// @returns {string} Section body to place beneath the project's heading.
export function storeSectionMarkdown(project) {
  const numbering = footnoteNumbering();
  const attemptedLine = `- Last attempted: ${ project.lastAttemptedAt || "never" }${ _searchedLine(project) }`;
  const existingLines = _taskListMarkdown(project.relatedTaskRecords.map(
    task => footnoteSafeLinkMarkdown(task.taskText, _taskUrl(task.taskUuid), null, "Untitled task")));
  const suggestedLines = _taskListMarkdown(project.suggestedTasks.map(
    task => linkLabelFromMarkdown(task.taskText, numbering, "Untitled task")));
  const completedLines = _taskListMarkdown(project.completedTasks.map(
    task => `${ task.taskUuid } — completed ${ dateKeyFromDateInput(task.completedAt) }`));
  const suggestionSections = suggestionSectionsMarkdown(project.taskSuggestions);
  return `${ attemptedLine }\n\n${ EXISTING_TASKS_LINE }\n${ existingLines }\n`
    + `${ SUGGESTED_TASKS_LINE }\n${ suggestedLines }\n`
    + `- Completed tasks\n${ completedLines }\n${ suggestionSections }${ jsonPayloadMarkdown(storeRecord(project)) }`
    + `${ _similarityScoresMarkdown(project.taskSimilarityScores) }${ footnoteDefinitionsMarkdown(numbering) }`;
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Read the existing tasks list back into task records. Only lines linking to a task are read, so the
//   "(none yet)" placeholder and any prose a human added are skipped. The text is the list's flattened label.
// @param {string} sectionBody - Markdown of one project section.
// @returns {Array<object>} { taskText, taskUuid } in list order.
function _existingTaskRecords(sectionBody) {
  const lines = sectionBody.split("\n");
  const listStart = lines.indexOf(EXISTING_TASKS_LINE);
  if (listStart < 0) return [];
  const records = [];
  for (const line of lines.slice(listStart + 1)) {
    if (line === SUGGESTED_TASKS_LINE || /^\S/.test(line)) break;
    const match = line.match(EXISTING_TASK_LINE_PATTERN);
    if (match) records.push({ taskText: match[1], taskUuid: match[2] });
  }
  return records;
}

// ----------------------------------------------------------------------------------------------
// @desc Find a labelled JSON block: the label line and the code fence that follows it.
// @param {string} sectionBody - Markdown of one project section.
// @param {string} label - The line introducing the block.
// @returns {object|null} { end, start, values } spanning the label through the closing fence, or null when absent.
//   values is the parsed object, or {} when the fence does not hold one.
function _labelledJsonBlock(sectionBody, label) {
  const labelStart = sectionBody.indexOf(label);
  if (labelStart < 0) return null;
  const fenceMatch = sectionBody.slice(labelStart).match(/\n```[^\n]*\n([\s\S]*?)\n```[^\n]*(?:\n|$)/);
  if (!fenceMatch) return null;
  let values = {};
  try {
    const parsed = JSON.parse(fenceMatch[1]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) values = parsed;
  } catch {
    values = {};
  }
  return { end: labelStart + fenceMatch.index + fenceMatch[0].length, start: labelStart, values };
}

// ----------------------------------------------------------------------------------------------
// @desc Fold the scores a pre-hash payload kept on its task records into hash entries, so the project's similar
//   tasks survive the move to the hash without being rated again.
// @param {string} projectSummary - The project's summary, which the hash keys digest.
// @param {Array<object>|null} legacyRecords - The payload's relatedTaskRecords, when it still has them.
// @returns {object} Scores keyed `checksum:taskUuid` for records scored at or above the similar-task minimum.
function _legacyRecordScores(projectSummary, legacyRecords) {
  const scoredRecords = (legacyRecords || []).filter(record => record?.taskUuid && Number.isFinite(record.matchScore)
    && record.matchScore >= SIMILAR_TASK_MINIMUM_SCORE);
  return Object.fromEntries(scoredRecords.map(record => [taskRatingKey(projectSummary, record), record.matchScore]));
}

// ----------------------------------------------------------------------------------------------
// @desc Give a task record the score its project's hash holds for it, or none.
// @param {object} record - { taskText, taskUuid }, possibly with a legacy matchScore.
// @param {Map<string, number>} scoreByTaskUuid - Hash scores keyed by task UUID.
// @returns {object} { matchScore, taskText, taskUuid } when scored, else { taskText, taskUuid }.
function _recordWithScore(record, scoreByTaskUuid) {
  const { taskText, taskUuid } = record;
  const matchScore = scoreByTaskUuid.has(taskUuid) ? scoreByTaskUuid.get(taskUuid) : record.matchScore;
  return Number.isFinite(matchScore) ? { matchScore, taskText, taskUuid } : { taskText, taskUuid };
}

// ----------------------------------------------------------------------------------------------
// @desc Say how far the project's similarity search has reached, as a bullet under the last-attempted line.
// @param {QuarterProject} project - Project, possibly carrying similaritySearchedTaskCount.
// @returns {string} "\n- Searched N tasks for similarity", or an empty string before any search is recorded.
function _searchedLine(project) {
  const searchedCount = project.similaritySearchedTaskCount;
  if (!Number.isFinite(searchedCount)) return "";
  return `\n- Searched ${ searchedCount } task${ searchedCount === 1 ? "" : "s" } for similarity`;
}

// ----------------------------------------------------------------------------------------------
// @desc Render the similarity hash as one compact JSON line in a plain code block, sorted by task UUID, so a
//   project's scores take one line of the note instead of one apiece.
// @param {object} similarityScores - Scores keyed `checksum:taskUuid`.
// @returns {string} The labelled block, or an empty string when there are no scores.
function _similarityScoresMarkdown(similarityScores) {
  if (!Object.keys(similarityScores).length) return "";
  const scoresLine = JSON.stringify(sortedSimilarityScores(similarityScores));
  return `\n${ SIMILARITY_SCORES_LABEL }\n\n\`\`\`\n${ scoresLine }\n\`\`\`\n`;
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
