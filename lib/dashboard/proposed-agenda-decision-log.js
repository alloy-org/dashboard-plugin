import { DASHBOARD_NOTE_TAG } from "constants/settings";
import { PROPOSED_TASK_STATUS } from "proposed-agenda-archive";
import { priorityOptionFromKey } from "proposed-agenda-priority";
import { dateFromDateInput, formatDateKey, monthKeyFromDateInput, monthKeyFromMonthLabel, monthLabelFromMonthKey,
  monthStartFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";
import { plainCellFromText, tableHeaderFromColumns, tableRowFromCells, tableRowsFromMarkdown } from "util/markdown-table";

// The two decisions a suggestion can reach. These strings are written verbatim into the note's second column,
// so they double as the human-readable label and the persisted value.
export const AGENDA_DECISION = { APPROVED: "Approved", REJECTED: "Rejected" };

// How many trailing calendar months of decisions are replayed to the LLM (the current month plus the one before
// it when DECISION_HISTORY_MONTHS is 2).
export const DECISION_HISTORY_MONTHS = 2;

const NOTE_NAME_SUFFIX = "Dashboard Proposed Agenda Decisions";

const NOTE_INTRO = "This archived note is maintained by the dashboard plugin's Proposed Agenda widget. Every "
  + "suggestion you approve (scheduled from the widget or from the calendar) or reject (dismissed) is appended to "
  + "the table for the month it was decided in, newest first. The most recent months are replayed to the AI when "
  + "it drafts a new agenda, so it can learn which kinds of suggestions you accept.";

// The table's columns, declared once so the header written into the note and the parse that reads it back
// cannot drift apart. `key` is the property each parsed row carries.
const DECISION_COLUMNS = [{ key: "decidedAtLabel", label: "DateTime" },
  { key: "decisionLabel", label: "Approved/rejected" }, { key: "taskTitle", label: "Task suggested" },
  { key: "themeLabel", label: "Proposed agenda theme or prompt" }];

// Ceiling on the rows sent to the LLM, so a heavily-used month cannot crowd the candidate tasks out of the
// prompt. Rows are newest-first, so the trimmed rows are always the least relevant ones.
const MAX_PROMPT_ROWS = 150;

// ----------------------------------------------------------------------------------------------
// @desc Turn agenda rows that just reached a lifecycle status into the decisions the log records. A row moving
//   to "scheduled" is an approval and one moving to "dismissed" is a rejection; any other status (a row falling
//   back to pending) is not a decision and yields nothing.
// @param {Array<object>} rows - Proposed-activity rows the user just decided on (each carries a `title`).
// @param {object} params - { decidedAt, priorityKey, scheduledEm }.
//   - {Date|string|number} [decidedAt=new Date()] - When the decision was made.
//   - {string|null} priorityKey - "Today's priority" key the suggestions were generated under.
//   - {string} scheduledEm - The PROPOSED_TASK_STATUS the rows moved to.
// @returns {Array<object>} Decisions ready for recordAgendaDecisions (empty for a non-decision status).
export function agendaDecisionsFromRows(rows, { decidedAt = new Date(), priorityKey = null, scheduledEm }) {
  const decisionLabel = _decisionLabelFromStatus(scheduledEm);
  if (!decisionLabel) return [];
  const themeLabel = priorityOptionFromKey(priorityKey).label;
  return (rows || []).map(row => ({ decidedAt, decisionLabel, taskTitle: row.title, themeLabel }));
}

// ----------------------------------------------------------------------------------------------
// @desc Archived note holding one Task Domain's approve/reject history, e.g. "Work Dashboard Proposed Agenda
//   Decisions". Domain-scoped like the monthly proposal records, so one domain's decisions never steer another
//   domain's agenda.
// @param {string} domainName - Task Domain display name, or "All Notes".
// @returns {string}
export function decisionLogNoteName(domainName) {
  return `${ domainName || "All Notes" } ${ NOTE_NAME_SUFFIX }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Append approve/reject decisions to the log note, filing each under the month heading for the moment it
//   was decided (creating the note and the month's table on first use). Decisions already present — same
//   timestamp, decision, task, and theme — are skipped so a repeated status write cannot duplicate a row.
// @param {object} app - Amplenote app bridge.
// @param {object} params - { decisions, domainName }.
//   - {Array<object>} decisions - Rows to append, each { decidedAt, decisionLabel, taskTitle, themeLabel }:
//     - {Date|string|number} decidedAt - When the user made the decision.
//     - {string} decisionLabel - One of AGENDA_DECISION.
//     - {string} taskTitle - The suggested task's title.
//     - {string} themeLabel - "Today's priority" theme (or the specific prompt) that produced the suggestion.
//   - {string} domainName - Task Domain display name selecting the note.
// @returns {Promise<number>} How many rows were actually appended.
export async function recordAgendaDecisions(app, { decisions, domainName }) {
  const rows = (decisions || []).map(_rowFromDecision).filter(Boolean);
  if (rows.length === 0) return 0;
  const { monthsByKey, noteHandle } = await _resolveDecisionNote(app, domainName);
  let appended = 0;
  for (const row of rows) {
    const monthRows = monthsByKey.get(row.monthKey)?.rows || [];
    if (monthRows.some(existing => _rowSignature(existing) === _rowSignature(row))) continue;
    monthsByKey.set(row.monthKey, { rows: [row, ...monthRows] });
    appended += 1;
  }
  if (appended === 0) return 0;
  await app.replaceNoteContent(noteHandle, _noteContentFromMonths(domainName, monthsByKey));
  logIfEnabled("[proposed-agenda-decision-log] appended decisions", { appended, domainName });
  return appended;
}

// ----------------------------------------------------------------------------------------------
// @desc Read back the trailing months of decisions as the markdown the schedule prompt embeds: a month heading
//   and table per month, newest month first. Returns an empty string when nothing has been decided yet (or when
//   the note cannot be read), so a missing history never blocks generation.
// @param {object} app - Amplenote app bridge.
// @param {object} params - { date, domainName, monthCount }.
//   - {Date|string|number} date - The day being generated for; the window ends with its month.
//   - {string} domainName - Task Domain display name selecting the note.
//   - {number} [monthCount=DECISION_HISTORY_MONTHS] - How many trailing calendar months to include.
// @returns {Promise<string>} Markdown month sections, or "".
export async function recentAgendaDecisionsMarkdown(app, { date, domainName, monthCount = DECISION_HISTORY_MONTHS }) {
  const monthsByKey = await _monthsFromDecisionNote(app, domainName);
  if (monthsByKey.size === 0) return "";
  const windowMonthKeys = _trailingMonthKeys(date, monthCount);
  const includedKeys = windowMonthKeys.filter(monthKey => (monthsByKey.get(monthKey)?.rows || []).length > 0);
  if (includedKeys.length === 0) return "";
  let remainingRows = MAX_PROMPT_ROWS;
  const sections = [];
  for (const monthKey of includedKeys) {
    const monthRows = monthsByKey.get(monthKey).rows.slice(0, remainingRows);
    remainingRows -= monthRows.length;
    if (monthRows.length > 0) sections.push(_monthSectionMarkdown(monthKey, monthRows));
    if (remainingRows <= 0) break;
  }
  return sections.join("\n");
}

// ----------------------------------------------------------------------------------------------
// @desc The log's decision label for a lifecycle status, or null when the status records no user decision.
// @param {string} scheduledEm - One of PROPOSED_TASK_STATUS.
// @returns {string|null}
function _decisionLabelFromStatus(scheduledEm) {
  if (scheduledEm === PROPOSED_TASK_STATUS.SCHEDULED) return AGENDA_DECISION.APPROVED;
  if (scheduledEm === PROPOSED_TASK_STATUS.DISMISSED) return AGENDA_DECISION.REJECTED;
  return null;
}

// ----------------------------------------------------------------------------------------------
// @desc Render one month's heading plus its decision table. Cells are escaped here, at serialization time, so a
//   value that round-trips through the note is never escaped twice.
// @param {string} monthKey - Local "YYYY-MM" month key.
// @param {Array<object>} rows - The month's decision rows, newest first.
// @returns {string}
function _monthSectionMarkdown(monthKey, rows) {
  const rowLines = rows.map(row => tableRowFromCells(DECISION_COLUMNS.map(column => row[column.key])));
  const table = [tableHeaderFromColumns(DECISION_COLUMNS), ...rowLines].join("\n");
  return `## ${ monthLabelFromMonthKey(monthKey) }\n\n${ table }\n`;
}

// ----------------------------------------------------------------------------------------------
// @desc Parse the whole log note into a month-keyed map of decision rows, tolerating an absent/corrupt note.
// @param {string|null} content - Raw note markdown.
// @returns {Map<string, {rows: Array<object>}>} Keyed by local "YYYY-MM" month key.
function _monthsFromNoteContent(content) {
  const monthsByKey = new Map();
  if (!content || typeof content !== "string") return monthsByKey;
  const normalized = content.replace(/\r\n/g, "\n");
  const headingMatches = [...normalized.matchAll(/^##\s+(.+?)\s*$/gm)];
  for (let index = 0; index < headingMatches.length; index += 1) {
    const monthKey = monthKeyFromMonthLabel(headingMatches[index][1]);
    if (!monthKey) continue;
    const sectionStart = headingMatches[index].index + headingMatches[index][0].length;
    const sectionEnd = index + 1 < headingMatches.length ? headingMatches[index + 1].index : normalized.length;
    monthsByKey.set(monthKey, { rows: _rowsFromSectionBody(normalized.slice(sectionStart, sectionEnd), monthKey) });
  }
  return monthsByKey;
}

// ----------------------------------------------------------------------------------------------
// @desc Read the log note's months without creating it, so consulting history stays side-effect free.
// @param {object} app - Amplenote app bridge.
// @param {string} domainName - Task Domain display name selecting the note.
// @returns {Promise<Map<string, {rows: Array<object>}>>} Empty map when the note is absent or unreadable.
async function _monthsFromDecisionNote(app, domainName) {
  const noteName = decisionLogNoteName(domainName);
  const noteHandle = await app.findNote({ name: noteName, tags: [DASHBOARD_NOTE_TAG] }).catch(() => null);
  if (!noteHandle?.uuid) return new Map();
  const content = await app.getNoteContent({ uuid: noteHandle.uuid }).catch(() => "");
  return _monthsFromNoteContent(content);
}

// ----------------------------------------------------------------------------------------------
// @desc Serialize every month back into the note, newest month first.
// @param {string} domainName - Task Domain the note represents.
// @param {Map<string, {rows: Array<object>}>} monthsByKey - Months to write.
// @returns {string}
function _noteContentFromMonths(domainName, monthsByKey) {
  const orderedMonthKeys = [...monthsByKey.keys()].sort().reverse();
  const sections = orderedMonthKeys.map(monthKey => _monthSectionMarkdown(monthKey, monthsByKey.get(monthKey).rows));
  return [`# Proposed agenda decisions for ${ domainName }`, "", NOTE_INTRO, "", ...sections].join("\n");
}

// ----------------------------------------------------------------------------------------------
// @desc Find (or create, archived) the decision-log note and parse its current months.
// @param {object} app - Amplenote app bridge.
// @param {string} domainName - Task Domain display name selecting the note.
// @returns {Promise<{monthsByKey: Map<string, {rows: Array<object>}>, noteHandle: object}>}
async function _resolveDecisionNote(app, domainName) {
  const noteName = decisionLogNoteName(domainName);
  const existingHandle = await app.findNote({ name: noteName, tags: [DASHBOARD_NOTE_TAG] }).catch(() => null);
  if (existingHandle?.uuid) {
    const content = await app.getNoteContent({ uuid: existingHandle.uuid }).catch(() => "");
    return { monthsByKey: _monthsFromNoteContent(content), noteHandle: { uuid: existingHandle.uuid } };
  }
  const created = await app.createNote(noteName, [DASHBOARD_NOTE_TAG], { archive: true });
  const noteHandle = { name: noteName, uuid: typeof created === "object" ? created.uuid : created };
  logIfEnabled(`[proposed-agenda-decision-log] created note "${ noteName }" uuid ${ noteHandle.uuid }`);
  return { monthsByKey: new Map(), noteHandle };
}

// ----------------------------------------------------------------------------------------------
// @desc Normalize one caller-supplied decision into the row shape persisted in a month's table.
// @param {object} decision - { decidedAt, decisionLabel, taskTitle, themeLabel }.
// @returns {object|null} Row ({ decidedAtLabel, decisionLabel, monthKey, taskTitle, themeLabel }), or null when
//   the decision names no task.
function _rowFromDecision(decision) {
  const taskTitle = plainCellFromText(decision?.taskTitle);
  if (!taskTitle) return null;
  const decidedAt = dateFromDateInput(decision.decidedAt ?? new Date(), { throwOnInvalid: false }) || new Date();
  const clockLabel = `${ String(decidedAt.getHours()).padStart(2, "0") }:`
    + `${ String(decidedAt.getMinutes()).padStart(2, "0") }`;
  return { decidedAtLabel: `${ formatDateKey(decidedAt) } ${ clockLabel }`,
    decisionLabel: decision.decisionLabel || AGENDA_DECISION.APPROVED, monthKey: monthKeyFromDateInput(decidedAt),
    taskTitle, themeLabel: plainCellFromText(decision.themeLabel) };
}

// ----------------------------------------------------------------------------------------------
// @desc Identity of a stored row, used to skip re-appending a decision the note already carries.
// @param {object} row - Decision row.
// @returns {string}
function _rowSignature(row) {
  return `${ row.decidedAtLabel }::${ row.decisionLabel }::${ row.taskTitle }::${ row.themeLabel }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Parse one month section's table rows back into decision rows, skipping the header and separator lines.
// @param {string} sectionBody - Markdown between a month heading and the next heading.
// @param {string} monthKey - The section's month key, stamped onto each parsed row.
// @returns {Array<object>} Decision rows in the order the note lists them (newest first).
function _rowsFromSectionBody(sectionBody, monthKey) {
  const parsedRows = tableRowsFromMarkdown(sectionBody, { columns: DECISION_COLUMNS });
  const namedRows = parsedRows.filter(row => row.taskTitle);
  return namedRows.map(row => ({ ...row, monthKey }));
}

// ----------------------------------------------------------------------------------------------
// @desc The trailing `monthCount` month keys ending with `date`'s month, newest first.
// @param {Date|string|number} date - Reference day.
// @param {number} monthCount - How many months to list.
// @returns {Array<string>} Local "YYYY-MM" keys, newest first.
function _trailingMonthKeys(date, monthCount) {
  const monthKeys = [];
  for (let monthsBack = 0; monthsBack < Math.max(monthCount, 1); monthsBack += 1) {
    monthKeys.push(monthKeyFromDateInput(monthStartFromDateInput(date, -monthsBack)));
  }
  return monthKeys;
}
