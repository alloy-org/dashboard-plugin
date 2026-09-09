// [Claude claude-opus-4-8 (1M context)-authored file]
// Prompt summary: "cache per-month energy-per-habit data in an archived note so the widget stops re-reading a
//   full year of completed tasks (a ~20s call). One table per month ('May 2026', 'June 2025', …) retaining each
//   task occurrence with its count and the mood ratings on days it was / wasn't done.
//   Look up the note before fetching tasks, stop walking months once a cached past month is reached, and keep
//   only the current month continuously refreshed via replaceNoteContent with a section specified."
import { DASHBOARD_NOTE_TAG } from "constants/settings";
import { logIfEnabled } from "util/log";
import { tableHeaderFromColumns, tableRowFromCells, tableRowsFromMarkdown } from "util/markdown-table";
import { monthKeyFromMonthLabel, monthLabelFromMonthKey } from "util/date-utility";
import { habitKeyFromLabel } from "energy-per-habit-analysis";

// Single archived note holding one month-heading section per month, each with a completion table.
export const HABIT_CACHE_NOTE_NAME = "Energy Per Habit Data";
export const HABIT_CACHE_FORMAT_VERSION = 3;

const CACHE_FORMAT_MARKER = `Cache format: ${HABIT_CACHE_FORMAT_VERSION}`;

// The month table's columns, declared once so the header written into the note and the parse that reads it back
// cannot drift apart. `key` is the property each parsed row carries.
const MONTH_TABLE_COLUMNS = [{ key: 'label', label: 'Task' }, { key: 'count', label: 'Completions' },
  { key: 'weekStreak', label: 'Weeks streak' }, { key: 'doneMoods', label: 'Mood on done days' },
  { key: 'offMoods', label: 'Mood on off days' }, { key: 'mostRecentDayKey', label: 'Last completed' }];

// "Last completed" arrived in format 3, so rows written by format 2 carry only five cells and are still read.
const MONTH_TABLE_MIN_CELL_COUNT = 5;
const NOTE_INTRO = "This archived note is maintained by the dashboard plugin's Energy Per Habit widget. Each month below lists every completed task occurrence, with its completion count and the mood ratings "
  + "recorded on the days it was (and wasn't) completed. Past months are cached here so the widget need not re-read a full year of completed tasks on every load.";

// ------------------------------------------------------------------------------------------
// @desc Parse a "[1, -0.5, 2]"-style table cell back into an array of numbers, tolerating blanks.
// @param {string} cell - Raw markdown table cell.
// @returns {Array<number>}
function moodArrayFromCell(cell) {
  if (!cell) return [];
  const inner = cell.replace(/^\s*\[?/, '').replace(/\]?\s*$/, '').trim();
  if (!inner) return [];
  return inner.split(',').map(part => Number(part.trim())).filter(value => Number.isFinite(value));
}

// ------------------------------------------------------------------------------------------
// @desc Serialize a numeric mood array into a compact "[1, -0.5, 2]" table cell.
// @param {Array<number>} values
// @returns {string}
function cellFromMoodArray(values) {
  return `[${(values || []).join(', ')}]`;
}

// ------------------------------------------------------------------------------------------
// @desc Render one month's completion table (heading NOT included — replaceNoteContent keeps the heading
//   when a section is targeted; the full-note builder adds headings itself). The table stores week streaks and
//   exact latest-completion dates so activity eligibility remains accurate when months are read from cache.
// @param {Array<{label, count, weekStreak, doneMoods, mostRecentDayKey, offMoods}>} rows
// @returns {string} Markdown table body.
// [GPT-5.6 Sol] Task: persist exact latest completion dates for 60-day habit eligibility
export function monthTableMarkdown(rows) {
  const header = tableHeaderFromColumns(MONTH_TABLE_COLUMNS);
  const body = (rows || []).map(row => tableRowFromCells([row.label, row.count, row.weekStreak || 0,
    cellFromMoodArray(row.doneMoods), cellFromMoodArray(row.offMoods), row.mostRecentDayKey || ''])).join('\n');
  return body ? `${header}\n${body}` : header;
}

// ------------------------------------------------------------------------------------------
// @desc Parse a single month section's table rows into cache row objects, per MONTH_TABLE_COLUMNS. Rows written
//   before "Last completed" existed carry five cells and are still read, with no most-recent day key.
// @param {string} sectionBody - Markdown between a month heading and the next heading.
// @returns {Array<{label, key, count, weekStreak, doneMoods, mostRecentDayKey, offMoods}>}
function rowsFromSectionBody(sectionBody) {
  const rows = [];
  const parsedRows = tableRowsFromMarkdown(sectionBody, { columns: MONTH_TABLE_COLUMNS,
    requiredCellCount: MONTH_TABLE_MIN_CELL_COUNT });
  for (const parsedRow of parsedRows) {
    const label = parsedRow.label;
    const count = parseInt(parsedRow.count, 10);
    if (!label || !Number.isFinite(count)) continue;
    const weekStreak = parseInt(parsedRow.weekStreak, 10) || 0;
    const doneMoods = moodArrayFromCell(parsedRow.doneMoods);
    const offMoods = moodArrayFromCell(parsedRow.offMoods);
    const dayKeyCell = parsedRow.mostRecentDayKey;
    const mostRecentDayKey = /^\d{4}-\d{2}-\d{2}$/.test(dayKeyCell) ? dayKeyCell : null;
    rows.push({ label, key: habitKeyFromLabel(label), count, weekStreak, doneMoods, mostRecentDayKey, offMoods });
  }
  return rows;
}

// ------------------------------------------------------------------------------------------
// @desc Parse the whole cache note into a month-keyed map of rows.
// @param {string} content - Raw note markdown.
// @returns {Map<string, {monthKey, label, rows: Array}>} Keyed by "YYYY-MM".
export function monthsFromNoteContent(content) {
  const months = new Map();
  if (!content || typeof content !== 'string') return months;
  const normalized = content.replace(/\r\n/g, '\n');
  // Month sections are level-2 headings whose text parses as "Month Year".
  const headingRegex = /^##\s+(.+?)\s*$/gm;
  const matches = [...normalized.matchAll(headingRegex)];
  for (let i = 0; i < matches.length; i++) {
    const monthKey = monthKeyFromMonthLabel(matches[i][1]);
    if (!monthKey) continue;
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : normalized.length;
    const rows = rowsFromSectionBody(normalized.slice(start, end));
    months.set(monthKey, { monthKey, label: matches[i][1].trim(), rows });
  }
  return months;
}

// ------------------------------------------------------------------------------------------
// @desc Build the full cache-note markdown from a month-keyed map, newest month first.
// @param {Map<string, {rows: Array}>} monthsByKey
// @returns {string}
function noteContentFromMonths(monthsByKey) {
  const orderedKeys = [...monthsByKey.keys()].sort().reverse();
  const sections = orderedKeys.map(monthKey => {
    const month = monthsByKey.get(monthKey);
    return `## ${monthLabelFromMonthKey(monthKey)}\n\n${monthTableMarkdown(month.rows)}\n`;
  });
  return [`# ${HABIT_CACHE_NOTE_NAME}`, '', CACHE_FORMAT_MARKER, '', NOTE_INTRO, '', ...sections].join('\n');
}

// ------------------------------------------------------------------------------------------
// @desc Load the cache note (without creating it): its handle, parsed months, and raw content.
// @param {Object} app - Amplenote app bridge.
// @returns {Promise<{formatVersion: number, noteHandle: Object|null, monthsByKey: Map, rawContent: string}>}
export async function loadHabitCache(app) {
  const noteHandle = await app.findNote({ name: HABIT_CACHE_NOTE_NAME, tags: [DASHBOARD_NOTE_TAG] }).catch(() => null);
  if (!noteHandle?.uuid) {
    return { formatVersion: 0, noteHandle: null, monthsByKey: new Map(), rawContent: '' };
  }
  const rawContent = await app.getNoteContent({ uuid: noteHandle.uuid }).catch(() => '') || '';
  const formatMatch = rawContent.match(/^Cache format:\s*(\d+)\s*$/m);
  const formatVersion = formatMatch ? Number(formatMatch[1]) : 0;
  return { formatVersion, noteHandle: { uuid: noteHandle.uuid }, monthsByKey: monthsFromNoteContent(rawContent),
    rawContent };
}

// ------------------------------------------------------------------------------------------
// @desc Find/create the cache note, returning a handle with `uuid`.
// @param {Object} app - Amplenote app bridge.
// @param {Object|null} existingHandle - Handle from loadHabitCache, if any.
// @returns {Promise<Object>}
async function ensureCacheNote(app, existingHandle) {
  // Rebuild as a bare { uuid }: a findNote handle does not survive the embed's postMessage bridge as a
  //   writable reference, and the host answers such a write with an unearned true. See doc/code_conventions.md.
  if (existingHandle?.uuid) return { uuid: existingHandle.uuid };
  const uuid = await app.createNote(HABIT_CACHE_NOTE_NAME, [DASHBOARD_NOTE_TAG], { archive: true });
  const noteHandle = { name: HABIT_CACHE_NOTE_NAME, uuid: typeof uuid === 'object' ? uuid.uuid : uuid };
  logIfEnabled(`[energy-per-habit-cache] created cache note "${HABIT_CACHE_NOTE_NAME}" uuid ${noteHandle.uuid}`);
  return noteHandle;
}

// ------------------------------------------------------------------------------------------
// @desc Persist the merged month map to the cache note. When only the current month changed and its
//   section already exists, that single section is replaced in place (replaceNoteContent with a section
//   specified); otherwise the whole note is rewritten (first population, backfill, or month rollover).
// @param {Object} app - Amplenote app bridge.
// @param {Object} params
//   - {Object|null} noteHandle - Existing handle (created here when null).
//   - {string} rawContent - Existing raw note content (empty when the note is new).
//   - {Map<string, {rows: Array}>} monthsByKey - Full merged month map to persist.
//   - {string} currentMonthKey - Month key whose section is refreshed on every load.
//   - {Array<string>} changedMonthKeys - Month keys whose rows changed this load.
// @returns {Promise<Object>} The note handle used.
export async function persistHabitCache(app, { noteHandle, rawContent, monthsByKey, currentMonthKey,
    changedMonthKeys }) {
  const handle = await ensureCacheNote(app, noteHandle);
  const hasCurrentFormat = (rawContent || '').includes(CACHE_FORMAT_MARKER);
  const onlyCurrentChanged = changedMonthKeys.length === 1 && changedMonthKeys[0] === currentMonthKey
    && hasCurrentFormat;
  const currentMonthLabel = monthLabelFromMonthKey(currentMonthKey);
  const currentSectionExists = new RegExp(`^##\\s+${currentMonthLabel}\\s*$`, 'm').test(rawContent || '');

  if (noteHandle?.uuid && onlyCurrentChanged && currentSectionExists) {
    const table = monthTableMarkdown(monthsByKey.get(currentMonthKey)?.rows || []);
    try {
      await app.replaceNoteContent(handle, `\n${table}\n`, { section: { heading: { text: currentMonthLabel } } });
      logIfEnabled(`[energy-per-habit-cache] refreshed section "${currentMonthLabel}" in place`);
      return handle;
    } catch (err) {
      logIfEnabled('[energy-per-habit-cache] section replace failed, rewriting whole note:', err);
    }
  }

  await app.replaceNoteContent(handle, noteContentFromMonths(monthsByKey)).catch(
    err => logIfEnabled('[energy-per-habit-cache] failed to write cache note:', err));
  logIfEnabled(`[energy-per-habit-cache] wrote ${monthsByKey.size} month section(s) to cache note`);
  return handle;
}
