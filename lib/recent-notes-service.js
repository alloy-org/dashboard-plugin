// [GPT-5.5-authored file]
// Prompt summary: "persist Recent Notes widget state in archived daily dashboard notes"
import { DASHBOARD_NOTE_TAG } from "constants/settings";
import { dateFromDateInput, dateKeyFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_NOTES = 3;
const MAX_NOTES = 5;
const MAX_SEED_SKIPS = 5;
const MAX_STALE_CANDIDATES = 50;
const MAX_TASK_NOTES_TO_SCAN = 250;
const MAX_VISITED_UUIDS_PER_DAY = 250;
const RECENT_NOTES_LOOKBACK_DAYS = 7;
const RECENT_NOTES_STATE_VERSION = 1;

// ----------------------------------------------------------------------------------------------
// @desc Today's stable numeric seed derived from the local date and reseed counter.
// @param {number} reseedCount - User-triggered reseed counter.
// [GPT-5.5] Task: seed Recent Notes rotation by date plus reseed count
// Prompt: "store selected recent notes for the current date in an archived note"
export function buildRecentNotesSeed(reseedCount) {
  return hashSeedString(`${ dateKeyFromDateInput(new Date()) }-${ reseedCount }`);
}

// ----------------------------------------------------------------------------------------------
// @desc Fetch task-domain note handles, capped to protect mobile clients.
// @param {object} app - Amplenote app bridge.
// @param {Set<string>} excludedUuids - Note UUIDs that do not need task fetching.
// [GPT-5.5] Task: keep Recent Notes note-handle discovery bounded
// Prompt: "persist recently visited notes and selected notes in a daily archived note"
async function fetchAllDomainNotes(app, excludedUuids = new Set()) {
  let taskDomains;
  try {
    taskDomains = await app.getTaskDomains();
  } catch (err) {
    logIfEnabled('[RecentNotes] getTaskDomains failed:', err);
    return [];
  }
  if (!Array.isArray(taskDomains) || taskDomains.length === 0) return [];
  const seen = new Set();
  const notes = [];
  for (const domain of taskDomains) {
    if (!domain) continue;
    for (const noteHandle of (domain.notes || [])) {
      if (excludedUuids.has(noteHandle?.uuid)) continue;
      if (noteHandle?.uuid && !seen.has(noteHandle.uuid)) {
        seen.add(noteHandle.uuid);
        notes.push(noteHandle);
        if (notes.length >= MAX_TASK_NOTES_TO_SCAN) return notes;
      }
    }
  }
  return notes;
}

// ----------------------------------------------------------------------------------------------
// @desc Persist the current Recent Notes state in the daily archived note.
// @param {object} app - Amplenote app bridge.
// @param {object} noteHandle - Daily data note handle.
// @param {object} state - Normalized Recent Notes state.
// [GPT-5.5] Task: write Recent Notes state into the daily archived note
// Prompt: "use an archived note to store its data regarding recently visited and selected notes"
async function replaceRecentNotesState(app, noteHandle, state) {
  const date = dateFromDateInput(state.dateKey);
  const noteContent = noteContentFromRecentNotesState(state, noteDateLabelFromDate(date));
  await app.replaceNoteContent(noteHandle, noteContent);
}

// ----------------------------------------------------------------------------------------------
// @desc Main Recent Notes discovery flow backed by a daily archived note.
// @param {object} app - Amplenote app bridge.
// @param {number} seed - Deterministic selection seed.
// @param {object} options - Discovery options ({ forceRefresh, maxNotes }).
// [GPT-5.5] Task: cache Recent Notes selections and scan progress in an archived note
// Prompt: "revise recent-notes.js plugin to use an archived note for recently visited and selected notes"
// [GPT-5.5] Task: reuse saved same-day Recent Notes before scanning task domains
// Prompt: "confirm clients reuse today's found notes; update recent-notes.js to load existing first"
export async function findStaleTaskNotes(app, seed, options = {}) {
  const maxNotes = options.maxNotes || MAX_NOTES;
  const noteContext = await resolveRecentNotesNoteContext(app);
  const savedSelectedNotes = noteContext.state.selectedNotes;
  if (!options.forceRefresh && savedSelectedNotes.length >= Math.min(MIN_NOTES, maxNotes)) {
    return hydratedSelectedNoteEntriesFromState(app, savedSelectedNotes.slice(0, maxNotes));
  }

  let state = noteContext.state;
  const scanResult = await staleCandidatesFromScan(app, state);
  const staleCandidates = normalizedCandidatesFromEntries([
    ...state.staleCandidates,
    ...scanResult.staleCandidates,
  ]);
  let historyByDay = state.historyByDay;
  let filteredCandidates = staleCandidates.filter(entry => !uuidSetFromDateMap(historyByDay).has(entry.uuid));

  if (staleCandidates.length > 0 && filteredCandidates.length === 0) {
    historyByDay = {};
    filteredCandidates = staleCandidates;
  }

  const selected = selectedCandidatesFromSeed(filteredCandidates, maxNotes, seed);
  const resolvedHandles = await hydratedSelectedNoteEntriesFromState(app, selected);
  const selectedNotes = selectedNoteEntriesFromHydratedEntries(resolvedHandles);
  const shownUuids = selectedNotes.map(note => note.uuid).filter(Boolean);
  state = normalizedRecentNotesState({
    ...state,
    historyByDay: mapWithUuidsForDate(historyByDay, state.dateKey, shownUuids, MAX_VISITED_UUIDS_PER_DAY),
    selectedNotes,
    staleCandidates,
    visitedByDay: mapWithUuidsForDate(state.visitedByDay, state.dateKey, scanResult.visitedUuids, MAX_VISITED_UUIDS_PER_DAY),
  }, state.dateKey);

  try {
    await replaceRecentNotesState(app, noteContext.noteHandle, state);
  } catch (err) {
    logIfEnabled('[RecentNotes] Failed to persist recent-note state:', err);
  }
  return resolvedHandles;
}

// ----------------------------------------------------------------------------------------------
// @desc Lightweight deterministic hash without bitwise operators.
// @param {string} str - Seed string.
// [GPT-5.5] Task: simple seed hash without bitwise multiplication for iOS Safari stability
// Prompt: "simplify hashSeedString and makeSeededRandom to eliminate iOS Safari crash suspects"
function hashSeedString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash + str.charCodeAt(i) * (i + 1)) % 1000003;
  }
  return hash;
}

// ----------------------------------------------------------------------------------------------
// @desc Resolve current note handles for persisted selected-note entries.
// @param {object} app - Amplenote app bridge.
// @param {Array<object>} selectedNotes - Persisted selected-note entries.
// [GPT-5.5] Task: hydrate persisted Recent Notes selections before rendering
// Prompt: "store selected notes to be shown for the current date"
async function hydratedSelectedNoteEntriesFromState(app, selectedNotes) {
  const entries = Array.isArray(selectedNotes) ? selectedNotes : [];
  return Promise.all(entries.map(entry =>
    app.findNote({ uuid: entry.uuid })
      .then(found => ({ latestTaskTimestamp: entry.latestTaskTimestamp, noteHandle: found || {
        name: entry.name,
        uuid: entry.uuid,
      }, taskCount: entry.taskCount }))
      .catch(() => ({ latestTaskTimestamp: entry.latestTaskTimestamp, noteHandle: {
        name: entry.name,
        uuid: entry.uuid,
      }, taskCount: entry.taskCount }))
  ));
}

// ----------------------------------------------------------------------------------------------
// @desc Deterministic PRNG without bitwise operators or Math.imul.
// @param {number} seed - Numeric seed.
// [GPT-5.5] Task: lightweight deterministic PRNG without bitwise ops or Math.imul
// Prompt: "simplify hashSeedString and makeSeededRandom to eliminate iOS Safari crash suspects"
function makeSeededRandom(seed) {
  let value = Number.isFinite(seed) ? Math.abs(Math.floor(seed)) : 1;
  return function () {
    value = (value * 9301 + 49297) % 233280;
    return value / 233280;
  };
}

// ----------------------------------------------------------------------------------------------
// @desc Merge UUIDs into a date-keyed UUID map and prune old date buckets.
// @param {object} map - Existing date-keyed map.
// @param {string} dateKey - Local date key receiving UUIDs.
// @param {Array<string>} uuids - UUIDs to merge.
// @param {number} maxUuids - Per-day UUID cap.
// [GPT-5.5] Task: track recently visited and shown Recent Notes by date
// Prompt: "store data regarding which notes have been recently visited"
function mapWithUuidsForDate(map, dateKey, uuids, maxUuids) {
  const normalized = normalizedDateUuidMap(map, dateKey);
  const current = normalized[dateKey] || [];
  const validUuids = (Array.isArray(uuids) ? uuids : [])
    .filter(uuid => typeof uuid === 'string' && uuid.length > 0);
  const mergedUuids = [...new Set([...current, ...validUuids])].slice(-maxUuids);
  return normalizedDateUuidMap({ ...normalized, [dateKey]: mergedUuids }, dateKey);
}

// ----------------------------------------------------------------------------------------------
// @desc Normalize stale-candidate entries, dedupe by UUID, and cap stored candidates.
// @param {Array<object>} entries - Candidate note entries.
// [GPT-5.5] Task: persist reusable Recent Notes stale candidates in daily note state
// Prompt: "start with data persisted from the previous day to accelerate discovery of new notes"
function normalizedCandidatesFromEntries(entries) {
  const seen = new Set();
  const normalized = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const uuid = entry?.uuid || entry?.noteHandle?.uuid;
    if (!uuid || seen.has(uuid)) continue;
    seen.add(uuid);
    normalized.push({
      latestTaskTimestamp: Number(entry.latestTaskTimestamp) || 0,
      name: entry.name || entry.noteHandle?.name || 'Untitled',
      taskCount: Number(entry.taskCount) || 0,
      uuid,
    });
    if (normalized.length >= MAX_STALE_CANDIDATES) break;
  }
  return normalized;
}

// ----------------------------------------------------------------------------------------------
// @desc Normalize a date-keyed UUID map to recent date buckets only.
// @param {object} map - Date-keyed UUID map.
// @param {string} todayKey - Local today key used for retention pruning.
// [GPT-5.5] Task: prune Recent Notes date-keyed state
// Prompt: "persist recently visited notes in a daily archived note"
function normalizedDateUuidMap(map, todayKey) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return {};
  const cutoffDate = dateFromDateInput(todayKey);
  cutoffDate.setDate(cutoffDate.getDate() - RECENT_NOTES_LOOKBACK_DAYS + 1);
  const cutoffKey = dateKeyFromDateInput(cutoffDate);
  const normalized = {};
  for (const [dateKey, uuids] of Object.entries(map)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || dateKey < cutoffKey) continue;
    const validUuids = Array.isArray(uuids)
      ? uuids.filter(uuid => typeof uuid === 'string' && uuid.length > 0)
      : [];
    normalized[dateKey] = [...new Set(validUuids)].slice(-MAX_VISITED_UUIDS_PER_DAY);
  }
  return normalized;
}

// ----------------------------------------------------------------------------------------------
// @desc Normalize raw note JSON into the Recent Notes state schema.
// @param {object} value - Parsed state object.
// @param {string} dateKey - State date key.
// [GPT-5.5] Task: normalize Recent Notes archived-note state
// Prompt: "use an archived note to store data for recently visited and selected notes"
function normalizedRecentNotesState(value, dateKey) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    dateKey,
    historyByDay: normalizedDateUuidMap(source.historyByDay, dateKey),
    schemaVersion: RECENT_NOTES_STATE_VERSION,
    selectedNotes: normalizedCandidatesFromEntries(source.selectedNotes),
    staleCandidates: normalizedCandidatesFromEntries(source.staleCandidates),
    visitedByDay: normalizedDateUuidMap(source.visitedByDay, dateKey),
  };
}

// ----------------------------------------------------------------------------------------------
// @desc Human-readable label used in the daily data note title/content.
// @param {Date} date - Date to label.
// [GPT-5.5] Task: format Recent Notes daily note date label
// Prompt: "create archived daily note with a name that demarcates data for the current day"
function noteDateLabelFromDate(date) {
  return date.toLocaleString([], { day: "numeric", month: "long", year: "numeric" });
}

// ----------------------------------------------------------------------------------------------
// @desc Serialize state into readable note content with JSON as the machine-readable source.
// @param {object} state - Normalized Recent Notes state.
// @param {string} dateLabel - Human-readable note date label.
// [GPT-5.5] Task: format Recent Notes daily note content
// Prompt: "use an archived note to store recent-note data"
function noteContentFromRecentNotesState(state, dateLabel) {
  return [
    `# Recent Notes data for ${ dateLabel }`,
    "",
    "This archived note is maintained by the dashboard plugin.",
    "",
    "```json",
    JSON.stringify(state, null, 2),
    "```",
    "",
  ].join("\n");
}

// ----------------------------------------------------------------------------------------------
// @desc Daily archived note title for Recent Notes state.
// @param {Date} date - Date represented by the note.
// [GPT-5.5] Task: name Recent Notes data note by date
// Prompt: "create a note with a name that demarcates data for the current day"
function recentNotesDataNoteNameFromDate(date) {
  return `Dashboard recent notes for ${ noteDateLabelFromDate(date) }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Parse Recent Notes state from a note's fenced JSON block.
// @param {string} content - Raw note content.
// @param {string} dateKey - Expected state date key.
// [GPT-5.5] Task: parse Recent Notes archived-note JSON state
// Prompt: "store selected notes and recently visited notes in an archived note"
function recentNotesStateFromNoteContent(content, dateKey) {
  if (!content || typeof content !== 'string') return normalizedRecentNotesState({}, dateKey);
  const match = content.match(/```json\s*([\s\S]*?)```/i);
  const jsonText = match ? match[1] : content;
  try {
    return normalizedRecentNotesState(JSON.parse(jsonText), dateKey);
  } catch {
    return normalizedRecentNotesState({}, dateKey);
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Create or find today's archived Recent Notes data note, seeded from recent prior state.
// @param {object} app - Amplenote app bridge.
// [GPT-5.5] Task: resolve Recent Notes daily archived note context
// Prompt: "when creating a new day's note, start with data persisted from the previous day"
async function resolveRecentNotesNoteContext(app) {
  const today = new Date();
  const dateKey = dateKeyFromDateInput(today);
  const noteName = recentNotesDataNoteNameFromDate(today);
  let noteHandle = await app.findNote({ name: noteName, tags: [DASHBOARD_NOTE_TAG] });
  if (noteHandle?.uuid) {
    const content = await app.getNoteContent({ uuid: noteHandle.uuid });
    return { noteHandle, state: recentNotesStateFromNoteContent(content, dateKey) };
  }

  const seedState = await seedStateFromPreviousRecentNotesNote(app, today);
  const state = normalizedRecentNotesState({ ...seedState, selectedNotes: [] }, dateKey);
  const uuid = await app.createNote(noteName, [DASHBOARD_NOTE_TAG], { archive: true });
  noteHandle = { uuid: typeof uuid === "object" ? uuid.uuid : uuid };
  await replaceRecentNotesState(app, noteHandle, state);
  logIfEnabled(`[RecentNotes] Created daily note "${ noteName }" with uuid ${ noteHandle.uuid }`);
  return { noteHandle, state };
}

// ----------------------------------------------------------------------------------------------
// @desc Find the most recent prior daily note state, looking back over the retention window.
// @param {object} app - Amplenote app bridge.
// @param {Date} today - Current date.
// [GPT-5.5] Task: seed Recent Notes state from the prior daily archived note
// Prompt: "start with data persisted from the previous day to accelerate discovery of new notes"
async function seedStateFromPreviousRecentNotesNote(app, today) {
  for (let daysBack = 1; daysBack <= RECENT_NOTES_LOOKBACK_DAYS; daysBack++) {
    const priorDate = new Date(today);
    priorDate.setDate(priorDate.getDate() - daysBack);
    const noteHandle = await app.findNote({ name: recentNotesDataNoteNameFromDate(priorDate),
      tags: [DASHBOARD_NOTE_TAG] });
    if (!noteHandle?.uuid) continue;
    const content = await app.getNoteContent({ uuid: noteHandle.uuid });
    return recentNotesStateFromNoteContent(content, dateKeyFromDateInput(today));
  }
  return {};
}

// ----------------------------------------------------------------------------------------------
// @desc Select candidate notes using deterministic seeded skipping.
// @param {Array<object>} candidates - Normalized candidate entries.
// @param {number} maxNotes - Max notes to select.
// @param {number} seed - Numeric seed.
// [GPT-5.5] Task: select Recent Notes candidates from persisted and newly scanned entries
// Prompt: "store selected notes to be shown for the current date"
function selectedCandidatesFromSeed(candidates, maxNotes, seed) {
  const rand = makeSeededRandom(seed);
  const selected = [];
  const skipped = [];
  for (const entry of candidates) {
    if (selected.length >= maxNotes) break;
    if (skipped.length < MAX_SEED_SKIPS && rand() < 0.5) {
      skipped.push(entry);
    } else {
      selected.push(entry);
    }
  }
  return selected.length >= MIN_NOTES ? selected : [...selected, ...skipped].slice(0, maxNotes);
}

// ----------------------------------------------------------------------------------------------
// @desc Convert hydrated render entries back into persisted selected-note entries.
// @param {Array<object>} entries - Hydrated render entries.
// [GPT-5.5] Task: persist today's selected Recent Notes with display metadata
// Prompt: "store selected notes to be shown for the current date"
function selectedNoteEntriesFromHydratedEntries(entries) {
  return normalizedCandidatesFromEntries((Array.isArray(entries) ? entries : []).map(entry => ({
    latestTaskTimestamp: entry.latestTaskTimestamp,
    name: entry.noteHandle?.name || 'Untitled',
    taskCount: entry.taskCount,
    uuid: entry.noteHandle?.uuid,
  })));
}

// ----------------------------------------------------------------------------------------------
// @desc Scan unvisited domain notes and return newly discovered stale-task candidates.
// @param {object} app - Amplenote app bridge.
// @param {object} state - Current Recent Notes state.
// [GPT-5.5] Task: scan only recently unvisited notes for stale-task candidates
// Prompt: "store which notes have been recently visited and seed new days from prior data"
async function staleCandidatesFromScan(app, state) {
  const recentlyVisited = uuidSetFromDateMap(state.visitedByDay);
  const notes = await fetchAllDomainNotes(app, recentlyVisited);
  const staleCandidates = [];
  const visitedUuids = [];
  const knownCandidates = new Set(state.staleCandidates.map(entry => entry.uuid));
  for (const noteHandle of notes) {
    if (!noteHandle?.uuid || recentlyVisited.has(noteHandle.uuid)) continue;
    try {
      const tasks = await app.getNoteTasks({ uuid: noteHandle.uuid }, { includeDone: false });
      visitedUuids.push(noteHandle.uuid);
      if (!Array.isArray(tasks) || tasks.length === 0) continue;
      const latestTaskTimestamp = tasks.reduce((maxMs, task) => {
        const ts = task.startAt ? task.startAt * 1000 : 0;
        return Math.max(maxMs, ts);
      }, 0);
      if (latestTaskTimestamp !== 0 && latestTaskTimestamp >= Date.now() - ONE_WEEK_MS) continue;
      if (!knownCandidates.has(noteHandle.uuid)) {
        staleCandidates.push({
          latestTaskTimestamp,
          name: noteHandle.name,
          taskCount: tasks.length,
          uuid: noteHandle.uuid,
        });
        knownCandidates.add(noteHandle.uuid);
      }
      if (state.staleCandidates.length + staleCandidates.length >= MAX_STALE_CANDIDATES) break;
    } catch (err) {
      logIfEnabled(`[RecentNotes] Failed to fetch tasks for note ${ noteHandle.uuid }:`, err);
    }
  }
  return { staleCandidates, visitedUuids };
}

// ----------------------------------------------------------------------------------------------
// @desc Flatten all UUID arrays in a date-keyed map into a Set.
// @param {object} map - Date-keyed UUID map.
// [GPT-5.5] Task: flatten Recent Notes date-keyed UUID state
// Prompt: "store recently visited notes and selected notes in archived note state"
function uuidSetFromDateMap(map) {
  const seen = new Set();
  for (const uuids of Object.values(map || {})) {
    if (!Array.isArray(uuids)) continue;
    uuids.forEach(uuid => seen.add(uuid));
  }
  return seen;
}
