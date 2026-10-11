// Read and write the archived ledger that records which quarterly project each completed task advanced, one note per
// domain and quarter. Each day the domain completed tasks is a `## YYYY-MM-DD` section, oldest first, holding
// readable bullets followed by a compact JSON fence; the JSON is what the Dashboard reads, and the bullets are written
// from it, so editing a bullet never changes the ledger. Days are written one section at a time, since a quarter of
// completions can outgrow the 100,000-character write limit long before a single day does.
import { DASHBOARD_NOTE_TAG } from "constants/settings";
import { guideHeadingRanges, guideSectionRange, parseJsonPayload } from "plan-wizard/vision-guide-markdown";
import { checkedAppResult, MAXIMUM_GUIDE_SECTION_CHARACTERS, replaceGuideSection } from "plan-wizard/vision-guide-notes";
import { logIfEnabled } from "util/log";

export const COMPLETED_TASK_LEDGER_SCHEMA_VERSION = 1;
export const COMPLETED_TASK_LEDGER_INTRODUCTION = "Written by the Dashboard. Each completed task is listed beneath the "
  + "day it was completed, with the quarterly project it advanced. The JSON block beneath each day is what the "
  + "Dashboard reads; the bullets are rewritten from it.";
const DATE_HEADING_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LEDGER_LOG_LABEL = "[completed-task-ledger]";
// The longest task text a bullet shows; the JSON keeps the text in full.
const BULLET_TEXT_CHARACTERS = 160;

// ----------------------------------------------------------------------------------------------
// @desc Name the quarter's ledger note, alongside the project task store's "Project Tasks Q4 2026 Work".
// @param {object} scope - Resolved plan scope with `domainName`, `quarter`, and `year`.
// @returns {string} Note title, such as "Completed Tasks by Project Q4 2026 Work".
export function completedTaskLedgerNoteName(scope) {
  return `Completed Tasks by Project Q${ scope.quarter } ${ scope.year } ${ scope.domainName }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Read every day's entries from ledger markdown. A day whose JSON cannot be read is reported rather than treated
//   as empty, so a later write never replaces entries it could not see.
// @param {string} content - Ledger note markdown.
// @returns {object} An object with the following properties:
//   - {Map<string, Array<object>>} entriesByDate - Entries by date key, in the order the note holds them
//   - {Array<string>} unreadableDates - Date keys whose section could not be parsed
export function ledgerEntriesFromContent(content) {
  const entriesByDate = new Map();
  const unreadableDates = [];
  for (const heading of _dateHeadings(content)) {
    try {
      const { payload } = parseJsonPayload(content.slice(heading.bodyStart, heading.end));
      if (!Array.isArray(payload.entries)) throw new Error("Ledger section has no entries list");
      entriesByDate.set(heading.text, payload.entries);
    } catch (error) {
      unreadableDates.push(heading.text);
      logIfEnabled(`${ LEDGER_LOG_LABEL } unreadable day`, { dateKey: heading.text, message: error?.message });
    }
  }
  return { entriesByDate, unreadableDates };
}

// ----------------------------------------------------------------------------------------------
// @desc Name one completion within the ledger: the task on the day it was completed, so a repeating task that keeps
//   its UUID is recorded once for each day it was completed.
// @param {object} entry - { dateKey, taskUuid }; dateKey may instead be given as the section the entry sits in.
// @returns {string} Such as "2026-10-11:task-uuid".
export function ledgerEntryKey({ dateKey, taskUuid }) {
  return `${ dateKey }:${ taskUuid }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Render one day's section body: a bullet per task naming its project, then the day's JSON.
// @param {Array<object>} entries - Ledger entries as { classifiedAt, classifiedBy, completedAt, confidence, projectName,
//   projectUuid, taskText, taskUuid }, in the order they are listed.
// @returns {string} Section body markdown, without its heading.
export function ledgerDateSectionMarkdown(entries) {
  const bullets = entries.map(_entryBullet);
  const payload = { entries, schemaVersion: COMPLETED_TASK_LEDGER_SCHEMA_VERSION };
  return `${ bullets.join("\n") }\n\n\`\`\`json\n${ JSON.stringify(payload) }\n\`\`\`\n`;
}

// ----------------------------------------------------------------------------------------------
// @desc Combine a day's recorded entries with newly classified ones, one entry per task, a new entry replacing the
//   recorded one for the same task. Entries are listed by completion time.
// @param {Array<object>} recordedEntries - The day's entries as the ledger holds them.
// @param {Array<object>} incomingEntries - Entries to add or replace.
// @returns {Array<object>} The day's entries.
export function mergedLedgerEntries(recordedEntries, incomingEntries) {
  const entriesByTaskUuid = new Map(recordedEntries.map(entry => [entry.taskUuid, entry]));
  for (const entry of incomingEntries) entriesByTaskUuid.set(entry.taskUuid, entry);
  const mergedEntries = [...entriesByTaskUuid.values()];
  const chronologicalEntries = mergedEntries.sort((first, second) => String(first.completedAt).localeCompare(String(second.completedAt)));
  return chronologicalEntries;
}

// ----------------------------------------------------------------------------------------------
// @desc Open the quarter's ledger, creating it archived and tagged when it does not exist yet. The handle is a bare
//   { uuid } literal, since a write through a bridge-produced handle can silently report success.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} scope - Resolved plan scope.
// @returns {Promise<object>} { content, noteHandle }.
export async function openCompletedTaskLedger(app, scope) {
  const name = completedTaskLedgerNoteName(scope);
  const found = checkedAppResult(await app.findNote({ name }));
  let uuid = found?.uuid || null;
  if (uuid) {
    const content = checkedAppResult(await app.getNoteContent({ uuid }));
    if (typeof content !== "string") throw new Error(`Could not read completed task ledger "${ name }"`);
    if (content.trim()) return { content, noteHandle: { uuid } };
  } else {
    const created = checkedAppResult(await app.createNote(name, [DASHBOARD_NOTE_TAG], { archive: true }));
    uuid = typeof created === "string" ? created : created?.uuid;
    if (!uuid) throw new Error(`Could not create completed task ledger "${ name }"`);
  }
  const seeded = `${ COMPLETED_TASK_LEDGER_INTRODUCTION }\n`;
  checkedAppResult(await app.replaceNoteContent({ uuid }, seeded));
  return { content: seeded, noteHandle: { uuid } };
}

// ----------------------------------------------------------------------------------------------
// @desc Read the quarter's ledger without creating it.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} scope - Resolved plan scope.
// @returns {Promise<object>} { entriesByDate, unreadableDates }, both empty when the ledger does not exist yet.
export async function readCompletedTaskLedger(app, scope) {
  const found = checkedAppResult(await app.findNote({ name: completedTaskLedgerNoteName(scope) }));
  if (!found?.uuid) return { entriesByDate: new Map(), unreadableDates: [] };
  const content = checkedAppResult(await app.getNoteContent({ uuid: found.uuid }));
  if (typeof content !== "string" || !content.trim()) return { entriesByDate: new Map(), unreadableDates: [] };
  return ledgerEntriesFromContent(content);
}

// ----------------------------------------------------------------------------------------------
// @desc Write one day's section. A day the ledger holds is replaced in place. A new day is inserted after the latest
//   earlier day by rewriting only that day's section with the new one after it; a day earlier than every other needs
//   a whole-note write, and throws when the note has grown too large for one.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - An object with the following properties:
//   - {string} content - Ledger markdown as last read or written
//   - {string} dateKey - The day, as YYYY-MM-DD
//   - {Array<object>} entries - The day's complete entries
//   - {object} noteHandle - Bare { uuid } handle for the ledger
// @returns {Promise<string>} Ledger markdown as it now stands.
export async function writeLedgerDateSection(app, { content, dateKey, entries, noteHandle }) {
  if (!DATE_HEADING_PATTERN.test(dateKey)) throw new Error(`"${ dateKey }" is not a ledger date`);
  const body = ledgerDateSectionMarkdown(entries);
  const existing = guideSectionRange(content, dateKey);
  if (existing) {
    await replaceGuideSection(app, body, noteHandle, { heading: { level: existing.level, text: dateKey } });
    return `${ content.slice(0, existing.bodyStart) }${ body }${ content.slice(existing.end) }`;
  }
  const dateHeadings = _dateHeadings(content);
  const earlierHeadings = dateHeadings.filter(heading => heading.text < dateKey);
  const section = `## ${ dateKey }\n\n${ body }`;
  if (earlierHeadings.length) {
    const previous = earlierHeadings[earlierHeadings.length - 1];
    const previousBody = content.slice(previous.bodyStart, previous.end);
    const replacement = `${ previousBody }${ previousBody.endsWith("\n") ? "" : "\n" }${ section }`;
    await replaceGuideSection(app, replacement, noteHandle, { heading: { level: previous.level, text: previous.text } });
    return `${ content.slice(0, previous.bodyStart) }${ replacement }${ content.slice(previous.end) }`;
  }
  const insertAt = dateHeadings.length ? dateHeadings[0].start : content.length;
  const leading = content.slice(0, insertAt);
  const separator = leading.endsWith("\n\n") || !leading ? "" : leading.endsWith("\n") ? "\n" : "\n\n";
  const trailing = content.slice(insertAt);
  const wholeContent = `${ leading }${ separator }${ section }${ trailing ? "\n" : "" }${ trailing }`;
  if (wholeContent.length > MAXIMUM_GUIDE_SECTION_CHARACTERS) {
    throw new Error(`Completed task ledger is too large to insert ${ dateKey } before its earliest day`);
  }
  await replaceGuideSection(app, wholeContent, noteHandle, null);
  return wholeContent;
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc A task's text as one bullet line: whitespace collapsed and long text cut short.
// @param {string} taskText - The task's text.
// @returns {string} Bullet text.
function _bulletTaskText(taskText) {
  const singleLine = String(taskText || "Untitled task").replace(/\s+/g, " ").trim();
  if (singleLine.length <= BULLET_TEXT_CHARACTERS) return singleLine;
  return `${ singleLine.slice(0, BULLET_TEXT_CHARACTERS - 1).trimEnd() }…`;
}

// ----------------------------------------------------------------------------------------------
// @desc One entry as a bullet: the task's text, then the project it advanced, or "None", and the victory value its
//   potential rating raised it to, if any.
// @param {object} entry - { appliedVictoryValue, priorVictoryValue, projectName, projectUuid, taskText }.
// @returns {string} Bullet markdown.
function _entryBullet(entry) {
  const projectText = entry.projectUuid ? `**${ entry.projectName || "Unnamed project" }**` : "None";
  const raised = Number.isFinite(entry.appliedVictoryValue);
  const raiseText = raised ? ` (victory value ${ entry.priorVictoryValue ?? 0 } → ${ entry.appliedVictoryValue })` : "";
  return `- ${ _bulletTaskText(entry.taskText) } → ${ projectText }${ raiseText }`;
}

// ----------------------------------------------------------------------------------------------
// @desc The ledger's day headings, in the order the note holds them.
// @param {string} content - Ledger markdown.
// @returns {Array<object>} Heading ranges, as guideHeadingRanges reads them, whose text is a date key.
function _dateHeadings(content) {
  const headings = guideHeadingRanges(content);
  const dateHeadings = headings.filter(heading => heading.level === 2 && DATE_HEADING_PATTERN.test(heading.text));
  return dateHeadings;
}
