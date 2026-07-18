// [Claude claude-opus-4-8 (1M context)-authored file]
// Prompt summary: "cache per-month energy-per-habit data in an archived note so the widget stops re-reading a
//   full year of completed tasks (a ~20s call). One table per month ('May 2026', 'June 2025', …) listing every
//   task completed more than once that month with its count and the mood ratings on days it was / wasn't done.
//   Look up the note before fetching tasks, stop walking months once a cached past month is reached, and keep
//   only the current month continuously refreshed via replaceNoteContent with a section specified."
import { DASHBOARD_NOTE_TAG } from "constants/settings";
import { logIfEnabled } from "util/log";
import { habitKeyFromContent, monthKeyFromMonthLabel, monthLabelFromMonthKey } from "energy-per-habit-analysis";

// Single archived note holding one month-heading section per month, each with a completion table.
export const HABIT_CACHE_NOTE_NAME = "Energy Per Habit Data";

const NOTE_INTRO = "This archived note is maintained by the dashboard plugin's Energy Per Habit widget. Each month below lists every task completed more than once that month, with its completion count and the mood ratings "
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
// @desc Escape a task label for safe inclusion in a markdown table cell (pipes/newlines break rows).
// @param {string} text
// @returns {string}
function escapeCell(text) {
  return String(text || '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
}

// ------------------------------------------------------------------------------------------
// @desc Render one month's completion table (heading NOT included — replaceNoteContent keeps the heading
//   when a section is targeted; the full-note builder adds headings itself).
// @param {Array<{label, count, doneMoods, offMoods}>} rows
// @returns {string} Markdown table body.
export function monthTableMarkdown(rows) {
  const header = "| Task | Completions | Mood on done days | Mood on off days |\n"
    + "| --- | --- | --- | --- |";
  const body = (rows || []).map(row =>
    `| ${escapeCell(row.label)} | ${row.count} | ${cellFromMoodArray(row.doneMoods)} | ${cellFromMoodArray(row.offMoods)} |`
  ).join('\n');
  return body ? `${header}\n${body}` : header;
}

// ------------------------------------------------------------------------------------------
// @desc Parse a single month section's table rows into cache row objects.
// @param {string} sectionBody - Markdown between a month heading and the next heading.
// @returns {Array<{label, key, count, doneMoods, offMoods}>}
function rowsFromSectionBody(sectionBody) {
  const rows = [];
  for (const line of sectionBody.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    // Split on unescaped pipes only, then unescape, so labels containing "\|" survive the round-trip.
    const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/)
      .map(c => c.trim().replace(/\\\|/g, '|'));
    if (cells.length < 4) continue;
    if (/^-+$/.test(cells[0].replace(/\s/g, '')) || cells[1].toLowerCase() === 'completions') continue; // header/sep
    const label = cells[0];
    const count = parseInt(cells[1], 10);
    if (!label || !Number.isFinite(count)) continue;
    rows.push({ label, key: habitKeyFromContent(label), count,
      doneMoods: moodArrayFromCell(cells[2]), offMoods: moodArrayFromCell(cells[3]) });
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
  return [`# ${HABIT_CACHE_NOTE_NAME}`, '', NOTE_INTRO, '', ...sections].join('\n');
}

// ------------------------------------------------------------------------------------------
// @desc Load the cache note (without creating it): its handle, parsed months, and raw content.
// @param {Object} app - Amplenote app bridge.
// @returns {Promise<{noteHandle: Object|null, monthsByKey: Map, rawContent: string}>}
export async function loadHabitCache(app) {
  const noteHandle = await app.findNote({ name: HABIT_CACHE_NOTE_NAME, tags: [DASHBOARD_NOTE_TAG] }).catch(() => null);
  if (!noteHandle?.uuid) return { noteHandle: null, monthsByKey: new Map(), rawContent: '' };
  const rawContent = await app.getNoteContent({ uuid: noteHandle.uuid }).catch(() => '') || '';
  return { noteHandle, monthsByKey: monthsFromNoteContent(rawContent), rawContent };
}

// ------------------------------------------------------------------------------------------
// @desc Find/create the cache note, returning a handle with `uuid`.
// @param {Object} app - Amplenote app bridge.
// @param {Object|null} existingHandle - Handle from loadHabitCache, if any.
// @returns {Promise<Object>}
async function ensureCacheNote(app, existingHandle) {
  if (existingHandle?.uuid) return existingHandle;
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
  const onlyCurrentChanged = changedMonthKeys.length === 1 && changedMonthKeys[0] === currentMonthKey;
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
