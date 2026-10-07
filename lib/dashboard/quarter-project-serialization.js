// Convert a QuarterProject to and from the forms its two notes persist: the plain record the progress note's payload
// holds, and the section of the project task store a project owns, which pairs the lists the user reads with the
// JSON payload, similarity hash, and suggestion log the next pass reads back. The lists are themselves read back: the
// existing tasks, with each one's similarity score and link reason, are written only there. QuarterProject delegates
// to these functions, so the class keeps its fields and behavior while this file keeps the note formats.
import { SIMILAR_TASK_MINIMUM_SCORE, sortedSimilarityScores, taskRatingKey,
  taskUuidFromRatingKey } from "plan-wizard/stack-rank/task-rating-cache";
import { jsonPayloadMarkdown, parseJsonPayload } from "plan-wizard/vision-guide-markdown";
import { openIdeas } from "project-idea-records";
import { suggestionLogFromSection, suggestionSectionsMarkdown } from "project-suggestion-log";
import { isSuggestableTaskRecord, linkReasonFromLabel, linkReasonLabel, TASK_LINK_REASONS } from "project-task-evidence";
import { footnoteDefinitionsMarkdown, footnoteNumbering, footnoteSafeLinkMarkdown,
  linkLabelFromMarkdown } from "util/amplenote-rich-footnote-writing";
import { dateKeyFromDateInput } from "util/date-utility";

// Introduced the code block of sparse Jev ratings that records written before the similarity hash carried. It is
// still read, so those ratings fold into the hash rather than being rated again.
export const LEGACY_JEV_RATINGS_LABEL = "Jev ratings of tasks the project did not keep, by checksum:task UUID:";
// Introduces the code block holding the project's similarity hash. The block is found by this line rather than by
// its fence language, so it is never mistaken for the project's JSON payload.
export const SIMILARITY_SCORES_LABEL = "Task similarity scores, by checksum:task UUID, sorted by task UUID:";
// Each existing task renders as a link to the task, which is how its UUID is read back out of the list, followed by
// its annotation: its similarity score and how it is linked, separated by semicolons.
const EXISTING_TASK_LINE_PATTERN = /^ {2}- \[(.*)\]\(https:\/\/www\.amplenote\.com\/notes\/tasks\/([^)\s]+)\)(?: — (.*))?$/;
const ANNOTATION_SEPARATOR = "; ";
const SIMILARITY_CLAUSE_PATTERN = /^similarity (\d+(?:\.\d+)?)$/;
// The lists existing tasks are written to: the tasks a day's suggestions may offer, and the ones they may not. The
// line written before the two lists were split is still read.
export const SUGGESTABLE_TASKS_LINE = "- Existing tasks eligible for suggestion";
export const UNSUGGESTABLE_TASKS_LINE = `- Existing tasks not suggested (similarity below ${ SIMILAR_TASK_MINIMUM_SCORE })`;
const LEGACY_EXISTING_TASKS_LINE = "- Existing tasks";
const EXISTING_TASK_LIST_LINES = new Set([LEGACY_EXISTING_TASKS_LINE, SUGGESTABLE_TASKS_LINE, UNSUGGESTABLE_TASKS_LINE]);
const TASK_IDEAS_LINE = "- Generated task ideas";

// ----------------------------------------------------------------------------------------------
// @desc Reduce a project to the fields the progress note persists: its identity, pace choices, the intents it advances,
//   and task evidence. Store-owned fields live in the project task store, and day evidence is recomputed for each date
//   planned.
// @param {QuarterProject} project - Project to persist.
// @returns {object} Plain record for the progress note's JSON payload.
export function progressRecord(project) {
  const { blocksPerWeek, completedTasks, deadlineOn, focusMonths, linkedGoalUuids, nextAction, paceEm, preferredWeekdays,
    primaryNoteUuid, priorityEm, relatedTasks, summary, uuid } = project;
  return { blocksPerWeek, completedTasks, deadlineOn, focusMonths, linkedGoalUuids, nextAction, paceEm, preferredWeekdays,
    primaryNoteUuid, priorityEm, relatedTasks, summary, uuid };
}

// ----------------------------------------------------------------------------------------------
// @desc Read one project's persisted record back out of its store section, tolerating a section a human has
//   annotated with extra prose around the payload fence. The similarity block is read separately and lifted out
//   before the payload is parsed; scores that cannot be parsed are treated as none, since they only save cost. The
//   project's existing tasks are read from their rendered lists rather than the payload, each taking its score from
//   the similarity hash, else from its line, and the tasks listed as assigned restore the project's assigned task
//   UUIDs. The suggestion log is read from its headings. A record written before the hash existed keeps its
//   payload's task list, and its kept tasks' scores and sparse Jev ratings are folded into the hash; a payload
//   written before the lists and headings carried them still contributes its relatedTasks and taskSuggestions.
// @param {string} sectionBody - Markdown between a project heading and the next sibling heading.
// @returns {object|null} The stored record with `relatedTaskRecords`, `relatedTasks`, `taskSimilarityScores`, and
//   `taskSuggestions`, or null when the section carries no readable payload.
export function storeRecordFromSection(sectionBody) {
  const similarityBlock = _labelledScoresBlock(sectionBody, SIMILARITY_SCORES_LABEL);
  const legacyBlock = _labelledScoresBlock(sectionBody, LEGACY_JEV_RATINGS_LABEL);
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
  const assignedRecords = relatedTaskRecords.filter(record => record.linkedBy === TASK_LINK_REASONS.assigned);
  const payloadTaskUuids = Array.isArray(payload.relatedTasks) ? payload.relatedTasks : [];
  const relatedTasks = [...new Set([...payloadTaskUuids, ...assignedRecords.map(record => record.taskUuid)])];
  const taskSuggestions = _mergedSuggestionLog(payload.taskSuggestions, suggestionLogFromSection(sectionBody));
  return { ...payload, relatedTaskRecords, relatedTasks, taskSimilarityScores, taskSuggestions };
}

// ----------------------------------------------------------------------------------------------
// @desc Reduce a project to the fields the task store persists in its JSON payload, so day evidence computed for one
//   target date never reaches the note and becomes stale there. The output revision and each refresh operation's
//   last success are kept here, beside the times they qualify. Ideas are kept whole, decided ones included, since the
//   rendered list shows only the open ones. The existing tasks and the tasks assigned to the project are left to their
//   rendered lists, the similarity hash to its own block, and the suggestion log to its headings.
// @param {QuarterProject} project - Project to persist.
// @returns {object} Plain record for the store section's JSON payload.
export function storeRecord(project) {
  const { blocksPerWeek, completedTasks, focusMonths, lastAttemptedAt, lastRankedAt, lastSuggestedAt, linkedGoalUuids,
    preferredWeekdays, primaryNoteUuid, projectRevision, refreshState, similaritySearchedTaskCount,
    similaritySearchPageCount, suggestedTasks, summary, uuid } = project;
  return { blocksPerWeek, completedTasks, focusMonths, lastAttemptedAt, lastRankedAt, lastSuggestedAt, linkedGoalUuids,
    preferredWeekdays, primaryNoteUuid, projectRevision, refreshState, similaritySearchedTaskCount,
    similaritySearchPageCount, suggestedTasks, summary, uuid };
}

// ----------------------------------------------------------------------------------------------
// @desc Render one project's whole store section body: the lists the user reads, the machine payload and similarity
//   hash the next pass reads back, and last the suggestion log. The existing tasks are split by whether a day's
//   suggestions may offer them (see isSuggestableTaskRecord), and each line carries the task's similarity score and
//   how it is linked, so the list alone says why a task is or is not offered; a task the project was assigned is
//   written as assigned even when its record does not say so, since that line is where the assignment persists. The
//   not-suggested list is written only
//   when it holds a task. Generated task ideas lists only the ideas awaiting a decision, and a completion is listed by
//   its text when it was recorded with it. Every line is generated and no part of it is user-authored (unlike the
//   Vision Guide). The existing tasks render as plain-text links without their Rich Footnotes: the link already leads
//   to the task, where the footnotes (captions, images) remain intact, so copying them here would only duplicate them.
//   The suggestion log comes last so each of its headings holds only its own bullets, which lets a shown suggestion
//   be appended by a write scoped to that heading.
// @param {QuarterProject} project - Project to render.
// @returns {string} Section body to place beneath the project's heading.
export function storeSectionMarkdown(project) {
  const numbering = footnoteNumbering();
  const attemptedLine = `- Last attempted: ${ project.lastAttemptedAt || "never" }${ _searchedLine(project) }`;
  const scoreByTaskUuid = new Map(Object.entries(project.taskSimilarityScores).map(([ratingKey, rating]) =>
    [taskUuidFromRatingKey(ratingKey), rating]));
  const assignedUuids = new Set(project.relatedTasks);
  const scoredRecords = project.relatedTaskRecords.map(record => _recordWithScore(_recordWithLinkReason(record,
    assignedUuids), scoreByTaskUuid));
  const suggestableRecords = scoredRecords.filter(record => isSuggestableTaskRecord(record));
  const unsuggestableRecords = scoredRecords.filter(record => !isSuggestableTaskRecord(record));
  const suggestableLines = _taskListMarkdown(suggestableRecords.map(record => _existingTaskLine(record)));
  const unsuggestableSection = unsuggestableRecords.length
    ? `${ UNSUGGESTABLE_TASKS_LINE }\n${ _taskListMarkdown(unsuggestableRecords.map(record => _existingTaskLine(record))) }`
    : "";
  const ideaLines = _taskListMarkdown(openIdeas(project.suggestedTasks).map(
    task => linkLabelFromMarkdown(task.taskText, numbering, "Untitled task")));
  const completedLines = _taskListMarkdown(project.completedTasks.map(task => {
    const label = task.taskText ? linkLabelFromMarkdown(task.taskText, numbering, task.taskUuid) : task.taskUuid;
    return `${ label } — completed ${ dateKeyFromDateInput(task.completedAt) }`;
  }));
  const suggestionSections = suggestionSectionsMarkdown(project.taskSuggestions);
  const listsMarkdown = `${ SUGGESTABLE_TASKS_LINE }\n${ suggestableLines }${ unsuggestableSection }`
    + `${ TASK_IDEAS_LINE }\n${ ideaLines }- Completed tasks\n${ completedLines }`;
  return `${ attemptedLine }\n\n${ listsMarkdown }\n${ jsonPayloadMarkdown(storeRecord(project)) }`
    + `${ _similarityScoresMarkdown(project.taskSimilarityScores) }${ footnoteDefinitionsMarkdown(numbering) }`
    + `${ suggestionSections ? `\n${ suggestionSections }` : "" }`;
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Read the existing tasks lists back into task records, whichever list each sits in, since a task's eligibility
//   follows from its score and link reason. Only lines linking to a task are read, so the "(none yet)" placeholder and
//   any prose a human added are skipped. The text is the list's flattened label.
// @param {string} sectionBody - Markdown of one project section.
// @returns {Array<object>} { linkedBy?, matchScore?, taskText, taskUuid } in list order.
function _existingTaskRecords(sectionBody) {
  const records = [];
  let isInExistingList = false;
  for (const line of sectionBody.split("\n")) {
    if (/^\S/.test(line)) {
      isInExistingList = EXISTING_TASK_LIST_LINES.has(line.trim());
      continue;
    }
    const match = isInExistingList ? line.match(EXISTING_TASK_LINE_PATTERN) : null;
    if (match) records.push({ ..._annotationFields(match[3] || ""), taskText: match[1], taskUuid: match[2] });
  }
  return records;
}

// ----------------------------------------------------------------------------------------------
// @desc Read an existing task line's annotation: its similarity score and how it is linked. A clause naming neither
//   is ignored.
// @param {string} annotation - Text after the task link's em dash.
// @returns {object} { linkedBy?, matchScore? } for the clauses present.
function _annotationFields(annotation) {
  const fields = {};
  for (const clause of annotation.split(ANNOTATION_SEPARATOR)) {
    const similarityMatch = clause.trim().match(SIMILARITY_CLAUSE_PATTERN);
    if (similarityMatch) fields.matchScore = Number(similarityMatch[1]);
    const linkedBy = similarityMatch ? null : linkReasonFromLabel(clause);
    if (linkedBy) fields.linkedBy = linkedBy;
  }
  return fields;
}

// ----------------------------------------------------------------------------------------------
// @desc Render one existing task as a link to the task, annotated with its similarity score and how it is linked.
// @param {object} record - { linkedBy?, matchScore?, taskText, taskUuid }.
// @returns {string} The bullet text, without its leading dash.
function _existingTaskLine(record) {
  const link = footnoteSafeLinkMarkdown(record.taskText, _taskUrl(record.taskUuid), null, "Untitled task");
  const similarityClause = Number.isFinite(record.matchScore) ? `similarity ${ _formattedScore(record.matchScore) }` : null;
  const clauses = [similarityClause, linkReasonLabel(record.linkedBy)].filter(Boolean);
  return clauses.length ? `${ link } — ${ clauses.join(ANNOTATION_SEPARATOR) }` : link;
}

// ----------------------------------------------------------------------------------------------
// @desc Write a similarity score compactly: Jev's ratings can fall between whole numbers, so up to two decimals are
//   kept, with trailing zeros dropped.
// @param {number} score - 1–10 similarity.
// @returns {string} The score as written.
function _formattedScore(score) {
  return String(Math.round(score * 100) / 100);
}

// ----------------------------------------------------------------------------------------------
// @desc Find a labelled scores block: the label line and the code fence that follows it. The fence holds one
//   `checksum:taskUuid score` entry per line; a block written before that holds one JSON object, which is still read.
// @param {string} sectionBody - Markdown of one project section.
// @param {string} label - The line introducing the block.
// @returns {object|null} { end, start, values } spanning the label through the closing fence, or null when absent.
//   values maps each rating key to its score, or is {} when the fence holds nothing readable.
function _labelledScoresBlock(sectionBody, label) {
  const labelStart = sectionBody.indexOf(label);
  if (labelStart < 0) return null;
  const fenceMatch = sectionBody.slice(labelStart).match(/\n```[^\n]*\n([\s\S]*?)\n```[^\n]*(?:\n|$)/);
  if (!fenceMatch) return null;
  const values = _scoresFromFence(fenceMatch[1]);
  return { end: labelStart + fenceMatch.index + fenceMatch[0].length, start: labelStart, values };
}

// ----------------------------------------------------------------------------------------------
// @desc Parse a scores fence's text: one JSON object, or one `checksum:taskUuid score` entry per line. A line that
//   does not hold a key and a finite score is skipped.
// @param {string} fenceText - Text between the fence lines.
// @returns {object} Scores keyed `checksum:taskUuid`, {} when nothing is readable.
function _scoresFromFence(fenceText) {
  const trimmedText = fenceText.trim();
  if (trimmedText.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmedText);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  const values = {};
  for (const line of trimmedText.split("\n")) {
    const entryMatch = line.trim().match(/^(\S+)\s+(-?\d+(?:\.\d+)?)$/);
    if (entryMatch) values[entryMatch[1]] = Number(entryMatch[2]);
  }
  return values;
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
// @desc Combine a suggestion log a payload carried before the log moved to headings with the one read from the
//   headings, each shown time of each task or idea once.
// @param {*} payloadLog - The payload's taskSuggestions, when it still has them.
// @param {Array<object>} headingLog - Entries read from the section's suggestion log headings.
// @returns {Array<object>} { suggestedAt, taskUuid } or { ideaId, suggestedAt } entries.
function _mergedSuggestionLog(payloadLog, headingLog) {
  const legacyLog = Array.isArray(payloadLog) ? payloadLog : [];
  const entriesByKey = new Map();
  for (const entry of [...legacyLog, ...headingLog]) {
    const identity = entry?.taskUuid || entry?.ideaId;
    if (!identity || !entry.suggestedAt) continue;
    entriesByKey.set(`${ identity }\n${ entry.suggestedAt }`, entry);
  }
  return [...entriesByKey.values()];
}

// ----------------------------------------------------------------------------------------------
// @desc Mark a record that names no link reason as assigned when the project was assigned its task.
// @param {object} record - { linkedBy?, matchScore?, taskText, taskUuid }.
// @param {Set<string>} assignedUuids - The project's assigned task UUIDs.
// @returns {object} The record, with linkedBy set when it was missing and the task is assigned.
function _recordWithLinkReason(record, assignedUuids) {
  if (record.linkedBy || !assignedUuids.has(record.taskUuid)) return record;
  return { ...record, linkedBy: TASK_LINK_REASONS.assigned };
}

// ----------------------------------------------------------------------------------------------
// @desc Give a task record the score its project's hash holds for it, else the score it was listed or stored with,
//   keeping how it is linked.
// @param {object} record - { linkedBy?, matchScore?, taskText, taskUuid }.
// @param {Map<string, number>} scoreByTaskUuid - Hash scores keyed by task UUID.
// @returns {object} { linkedBy?, matchScore?, taskText, taskUuid }, each optional field present only when known.
function _recordWithScore(record, scoreByTaskUuid) {
  const { linkedBy, taskText, taskUuid } = record;
  const matchScore = scoreByTaskUuid.has(taskUuid) ? scoreByTaskUuid.get(taskUuid) : record.matchScore;
  const scoredRecord = Number.isFinite(matchScore) ? { matchScore, taskText, taskUuid } : { taskText, taskUuid };
  return linkedBy ? { linkedBy, ...scoredRecord } : scoredRecord;
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
// @desc Render the similarity hash in a plain code block, one `checksum:taskUuid score` entry per line, sorted by task
//   UUID. Two devices that change different tasks' scores then edit different lines, which merge cleanly, where a
//   single JSON line would conflict.
// @param {object} similarityScores - Scores keyed `checksum:taskUuid`.
// @returns {string} The labelled block, or an empty string when there are no scores.
function _similarityScoresMarkdown(similarityScores) {
  const sortedEntries = Object.entries(sortedSimilarityScores(similarityScores));
  if (!sortedEntries.length) return "";
  const scoreLines = sortedEntries.map(([ratingKey, rating]) => `${ ratingKey } ${ rating }`);
  return `\n${ SIMILARITY_SCORES_LABEL }\n\n\`\`\`\n${ scoreLines.join("\n") }\n\`\`\`\n`;
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
