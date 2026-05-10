// [claude-sonnet-4-6-authored file]
// Prompt summary: "Graveyard widget service — discover aged tasks and persist candidates in a monthly archived note"

import { DASHBOARD_NOTE_TAG } from "constants/settings";
import { dateKeyFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";

const APPROX_DAYS_PER_MONTH = 30;
const CACHE_ROW_DATE_KEY_INDEX = 0;
const CACHE_ROW_MIN_CELL_COUNT = 2;
const CACHE_ROW_TASK_ENTRIES_INDEX = 2;
const CACHE_ROW_UUIDS_INDEX = 1;
const HOURS_PER_DAY = 24;
const MAX_NOTES_TO_SCAN = 100;
const MINUTES_PER_HOUR = 60;
const MIN_CANDIDATE_CUTOFF_INDEX = 1;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const OLDEST_TASK_PERCENTILE = 0.9;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const SIX_MONTHS_MS = 6 * APPROX_DAYS_PER_MONTH * HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
const THREE_MONTHS_MS = 3 * APPROX_DAYS_PER_MONTH * HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;

// =============================================================================
// Note helpers
// =============================================================================

// ----------------------------------------------------------------------------------------------
// @desc Collect all task UUIDs across all table rows (used to exclude already-suggested tasks).
// @param {Array<{dateKey: string, uuids: string[]}>} rows - Parsed table rows.
// @returns {Set<string>} Previously-suggested task UUIDs.
function excludedUuidsFromRows(rows) {
  const uuids = new Set();
  for (const row of rows) {
    for (const uuid of row.uuids) uuids.add(uuid);
  }
  return uuids;
}

// ----------------------------------------------------------------------------------------------
// @desc Find or create the current month's graveyard data note.
// @param {object} app - Amplenote app bridge.
// @returns {Promise<object>} Note handle { name, uuid }.
// [Claude claude-sonnet-4-6] Task: resolve monthly graveyard archived data note
// Prompt: "add a new graveyard.js component..."
async function findOrCreateGraveyardNote(app) {
  const noteName = graveyardNoteNameFromDate(new Date());
  const existing = await app.findNote({ name: noteName, tags: [DASHBOARD_NOTE_TAG] });
  if (existing?.uuid) return existing;
  const uuid = await app.createNote(noteName, [DASHBOARD_NOTE_TAG], { archive: true });
  await app.replaceNoteContent({ uuid }, graveyardContentFromRows([]));
  return { name: noteName, uuid };
}

// ----------------------------------------------------------------------------------------------
// @desc Serialize graveyard rows into a markdown table with newest rows first.
// @param {Array<{dateKey: string, taskEntries?: Array<object>, uuids: string[]}>} rows - Rows to serialize.
// @returns {string} Full note markdown content.
// [OpenAI gpt-5.4] Task: persist graveyard cache rows with task-to-note metadata for later hydration
// Prompt: "keep a table of which task maps to which note when we are extracting the tasks"
function graveyardContentFromRows(rows) {
  const header = '# Graveyard task candidates\n\n| Date | Task UUIDs | Task note metadata |\n|------|------------|--------------------|\n';
  const tableLines = rows.map((row) => {
    const taskEntries = Array.isArray(row.taskEntries) && row.taskEntries.length > 0
      ? row.taskEntries
      : row.uuids.map(uuid => ({ noteName: null, noteUUID: null, uuid }));
    const encodedTaskEntries = encodeURIComponent(JSON.stringify(taskEntries.map((entry) => ({
      noteName: entry.noteName || null,
      noteUUID: entry.noteUUID || null,
      uuid: entry.uuid,
    }))));
    return `| ${ row.dateKey } | ${ row.uuids.join(',') } | ${ encodedTaskEntries } |`;
  }).join('\n');
  return header + tableLines + (tableLines ? '\n' : '');
}

// ----------------------------------------------------------------------------------------------
// @desc Monthly data note name derived from a given date.
// @param {Date} date - Date within the target month.
// @returns {string} Note name, e.g. "Task graveyard data: May 2026".
// [Claude claude-sonnet-4-6] Task: derive monthly graveyard data note name from date
// Prompt: "add a new graveyard.js component..."
export function graveyardNoteNameFromDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `Task graveyard data: ${ MONTHS[d.getMonth()] } ${ d.getFullYear() }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Monthly retired-tasks note name derived from a given date.
// @param {Date} date - Date within the target month.
// @returns {string} Note name, e.g. "Successfully retired tasks: May 2026".
// [Claude claude-sonnet-4-6] Task: derive monthly retired tasks note name from date
// Prompt: "expand graveyard with confetti + retired note"
export function retiredTasksNoteNameFromDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `Successfully retired tasks: ${ MONTHS[d.getMonth()] } ${ d.getFullYear() }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Parse the markdown table from graveyard note content into row objects.
// @param {string} content - Raw note markdown.
// @returns {Array<{dateKey: string, taskEntries: Array<object>, uuids: string[]}>} Parsed rows, document order.
// [OpenAI gpt-5.4] Task: parse graveyard cache rows with persisted task-to-note metadata
// Prompt: "keep a table of which task maps to which note when we are extracting the tasks"
function rowsFromGraveyardContent(content) {
  const rows = [];
  for (const line of (content || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || trimmed.startsWith('| Date') || trimmed.startsWith('|---')) continue;
    const cells = trimmed.slice(1, -1).split('|').map(s => s.trim());
    if (cells.length < CACHE_ROW_MIN_CELL_COUNT) continue;
    const dateKey = cells[CACHE_ROW_DATE_KEY_INDEX];
    const uuids = cells[CACHE_ROW_UUIDS_INDEX].split(',').map(s => s.trim()).filter(Boolean);
    let taskEntries = uuids.map(uuid => ({ noteName: null, noteUUID: null, uuid }));
    if (cells[CACHE_ROW_TASK_ENTRIES_INDEX]) {
      try {
        const parsedEntries = JSON.parse(decodeURIComponent(cells[CACHE_ROW_TASK_ENTRIES_INDEX]));
        if (Array.isArray(parsedEntries)) {
          taskEntries = parsedEntries
            .filter(entry => entry?.uuid)
            .map(entry => ({
              noteName: entry.noteName || null,
              noteUUID: entry.noteUUID || null,
              uuid: entry.uuid,
            }));
        }
      } catch (err) {
        logIfEnabled('[Graveyard] failed to parse cached task note metadata:', err);
      }
    }
    if (dateKey && uuids.length > 0) rows.push({ dateKey, taskEntries, uuids });
  }
  return rows;
}

// =============================================================================
// Task discovery
// =============================================================================

// ----------------------------------------------------------------------------------------------
// @desc Collect all open, non-excluded tasks from a list of note handles in one scan pass.
// @param {object} app - Amplenote app bridge.
// @param {Set<string>} excludedUuids - Task UUIDs to skip.
// @param {Array<object>} noteHandles - Note handles to scan.
// @returns {Promise<Array<object>>} Open task objects (noteUUID populated from handle when absent).
// [Claude claude-sonnet-4-6] Task: fetch tasks from all notes in parallel, not sequentially
// Prompt: "not to block execution — ensure that tasks are derived asynchronously"
async function allTasksFromNotes(app, excludedUuids, noteHandles) {
  const settled = await Promise.allSettled(
    noteHandles.map(noteHandle =>
      app.getNoteTasks({ uuid: noteHandle.uuid }, { includeDone: false })
        .then(tasks => ({ noteHandle, tasks: tasks || [] }))
    )
  );
  const results = [];
  for (const outcome of settled) {
    if (outcome.status === 'rejected') {
      logIfEnabled('[Graveyard] getNoteTasks failed:', outcome.reason);
      continue;
    }
    const { noteHandle, tasks: noteTasks } = outcome.value;
    let accepted = 0;
    for (const task of noteTasks) {
      if (!task?.uuid || excludedUuids.has(task.uuid)) continue;
      if (task.completedAt || task.dismissedAt) continue;
      results.push({
        ...task,
        noteName: task.noteName || task.noteTitle || task.note?.name || noteHandle.name || null,
        noteUUID: task.noteUUID || noteHandle.uuid,
      });
      accepted++;
    }
    logIfEnabled(`[Graveyard] note "${ noteHandle.name || noteHandle.uuid }": ${ noteTasks.length } tasks, ${ accepted } accepted`);
  }
  return results;
}

// ----------------------------------------------------------------------------------------------
// @desc Multi-pass discovery: tries 6-month, 3-month, then any-age task filters in sequence.
//   Notes are iterated least-recently-opened first to maximize discovery of old tasks early.
// @param {object} app - Amplenote app bridge.
// @param {number} count - Target candidate count.
// @param {Set<string>} excludedUuids - Already-shown task UUIDs.
// @param {string|null} taskDomainUUID - Active task domain filter.
// @returns {Promise<Array<object>>} Discovered task candidates.
// [Claude claude-sonnet-4-6] Task: multi-pass graveyard task discovery across domain notes
// Prompt: "add a new graveyard.js component..."
async function discoverCandidateTasks(app, count, excludedUuids, taskDomainUUID) {
  const filterOptions = taskDomainUUID ? { taskDomainUUID } : {};
  logIfEnabled('[Graveyard] filterNotes options:', filterOptions);
  const noteHandles = [];
  try {
    for await (const handle of (await app.filterNotes(filterOptions, 'opened'))) {
      noteHandles.push(handle);
    }
  } catch (err) {
    logIfEnabled('[Graveyard] filterNotes error:', err);
  }
  logIfEnabled(`[Graveyard] filterNotes returned ${ noteHandles.length } notes`);
  // Reverse so least-recently-opened notes (more likely to have old tasks) are scanned first.
  const orderedHandles = [...noteHandles].reverse().slice(0, MAX_NOTES_TO_SCAN);
  logIfEnabled(`[Graveyard] scanning ${ orderedHandles.length } notes for tasks`);
  const allTasks = await allTasksFromNotes(app, excludedUuids, orderedHandles);
  const now = Date.now();
  const sixMonths = allTasks.filter(t => t.createdAt && (now - t.createdAt * MS_PER_SECOND) >= SIX_MONTHS_MS);
  const threeMonths = allTasks.filter(t => t.createdAt && (now - t.createdAt * MS_PER_SECOND) >= THREE_MONTHS_MS);
  logIfEnabled(`[Graveyard] task counts — total: ${ allTasks.length }, 3mo+: ${ threeMonths.length }, 6mo+: ${ sixMonths.length } (need ${ count })`);
  if (sixMonths.length >= count) return ninetiethPercentileCandidatesFromTasks(count, sixMonths);
  if (threeMonths.length >= count) return ninetiethPercentileCandidatesFromTasks(count, threeMonths);
  return ninetiethPercentileCandidatesFromTasks(count, allTasks);
}

// ----------------------------------------------------------------------------------------------
// @desc Re-hydrate cached task UUIDs into full task objects via the active task domain.
// @param {object} app - Amplenote app bridge.
// @param {string|null} taskDomainUUID - Domain to fetch tasks from.
// @param {Array<object>} taskEntries - Cached task-to-note metadata from the graveyard data note.
// @param {string[]} uuids - Cached task UUIDs to resolve.
// @returns {Promise<Array<object>>} Matching open task objects from the domain.
// [OpenAI gpt-5.4] Task: hydrate cached graveyard tasks using persisted task-to-note mappings
// Prompt: "keep a table of which task maps to which note when we are extracting the tasks"
async function hydratedTasksFromUuids(app, taskDomainUUID, taskEntries, uuids) {
  if (!uuids || uuids.length === 0) return [];
  const allTasks = await app.getTaskDomainTasks(taskDomainUUID).catch(() => []);
  const taskByUuid = new Map((allTasks || []).map(t => [t.uuid, t]));
  const taskEntryByUuid = new Map((taskEntries || []).filter(entry => entry?.uuid).map(entry => [entry.uuid, entry]));
  return uuids.map((uuid) => {
    const task = taskByUuid.get(uuid);
    if (!task || task.completedAt || task.dismissedAt) return null;
    const taskEntry = taskEntryByUuid.get(uuid);
    return {
      ...task,
      noteName: task.noteName || task.noteTitle || task.note?.name || taskEntry?.noteName || null,
      noteUUID: task.noteUUID || taskEntry?.noteUUID || null,
    };
  }).filter(Boolean);
}

// ----------------------------------------------------------------------------------------------
// @desc Return up to `count` tasks from the oldest 90% of a task array by createdAt.
// @param {number} count - Max tasks to return.
// @param {Array<object>} tasks - Task objects with createdAt timestamps.
// @returns {Array<object>} Oldest tasks up to the 90th-percentile cutoff, limited to count.
// [Claude claude-sonnet-4-6] Task: compute 90th-percentile-oldest candidates from task list
// Prompt: "add a new graveyard.js component..."
function ninetiethPercentileCandidatesFromTasks(count, tasks) {
  if (tasks.length === 0) return [];
  const sorted = [...tasks].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const cutoffIndex = Math.max(MIN_CANDIDATE_CUTOFF_INDEX, Math.floor(sorted.length * OLDEST_TASK_PERCENTILE));
  return sorted.slice(0, cutoffIndex).slice(0, count);
}

// =============================================================================
// Public API
// =============================================================================

// ----------------------------------------------------------------------------------------------
// @desc Append a retired task entry to this month's "Successfully retired tasks" archived note.
//   Creates the note if it does not yet exist. The entry is a GFM task-list item with a JSON
//   comment recording the retirement date so the list stays machine-readable.
// @param {object} app - Amplenote app bridge.
// @param {object} task - Task object with uuid, content/title, and createdAt fields.
// @returns {Promise<void>}
// [Claude claude-sonnet-4-6] Task: append retired task to monthly archived note
// Prompt: "expand graveyard with confetti + retired note"
export async function appendTaskToRetiredNote(app, task) {
  const noteName = retiredTasksNoteNameFromDate(new Date());
  let noteHandle = await app.findNote({ name: noteName, tags: [DASHBOARD_NOTE_TAG] }).catch(() => null);
  if (!noteHandle?.uuid) {
    const uuid = await app.createNote(noteName, [DASHBOARD_NOTE_TAG], { archive: true });
    noteHandle = { name: noteName, uuid };
    await app.replaceNoteContent(noteHandle, '# Successfully retired tasks\n\n').catch(() => {});
  }
  const title = task.title || task.content || 'Untitled task';
  const retiredAt = dateKeyFromDateInput(new Date());
  const line = `- [x] ${ title } <!-- {"retiredAt":"${ retiredAt }"} -->\n`;
  await app.insertNoteContent(noteHandle, line, { atEnd: true }).catch(
    err => logIfEnabled('[Graveyard] appendTaskToRetiredNote failed:', err)
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Load graveyard candidates for today, using the monthly data note as a cache.
//   Creates the note if it does not exist for the current month. When a today-keyed row
//   already exists, hydrates cached UUIDs from the domain; otherwise discovers fresh candidates
//   and writes a new row to the top of the table.
// @param {object} app - Amplenote app bridge.
// @param {number} count - Number of candidates to load.
// @param {string|null} taskDomainUUID - Active task domain UUID.
// @returns {Promise<{candidates: Array<object>, noteHandle: object}>} Loaded candidates and data note.
// [Claude claude-sonnet-4-6] Task: main graveyard candidate loader with date-keyed monthly cache
// Prompt: "add a new graveyard.js component..."
export async function loadGraveyardCandidates(app, count, taskDomainUUID) {
  const noteHandle = await findOrCreateGraveyardNote(app);
  const content = await app.getNoteContent(noteHandle).catch(() => '');
  const rows = rowsFromGraveyardContent(content);
  const todayKey = dateKeyFromDateInput(new Date());
  const todayRow = rows.find(r => r.dateKey === todayKey);
  if (todayRow?.uuids.length > 0) {
    const candidates = await hydratedTasksFromUuids(app, taskDomainUUID, todayRow.taskEntries, todayRow.uuids);
    logIfEnabled('[Graveyard] loaded cached candidates:', candidates.length);
    return { candidates, noteHandle };
  }
  const excludedUuids = excludedUuidsFromRows(rows);
  const candidates = await discoverCandidateTasks(app, count, excludedUuids, taskDomainUUID);
  if (candidates.length > 0) {
    const taskEntries = candidates.map(task => ({
      noteName: task.noteName || task.noteTitle || task.note?.name,
      noteUUID: task.noteUUID,
      uuid: task.uuid,
    }));
    const updatedRows = [{
      dateKey: todayKey,
      taskEntries,
      uuids: candidates.map(t => t.uuid),
    }, ...rows];
    await app.replaceNoteContent(noteHandle, graveyardContentFromRows(updatedRows)).catch(
      err => logIfEnabled('[Graveyard] failed to persist candidates:', err)
    );
  }
  logIfEnabled('[Graveyard] discovered fresh candidates:', candidates.length);
  return { candidates, noteHandle };
}
