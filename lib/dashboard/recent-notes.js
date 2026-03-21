/**
 * [Claude-authored file]
 * Created: 2026-03-04 | Model: claude-4.6-sonnet-medium-thinking
 * Task: Recent Notes widget — notes with tasks where no task was created in the past week
 * Prompt summary: "replace AI & Plugins widget with Recent Notes showing notes whose tasks have gone stale"
 */
import { widgetConfigKey, widgetTitleFromId } from "constants/settings";
import { createElement, useEffect, useMemo, useState } from "react";
import WidgetWrapper from 'widget-wrapper';
import { logIfEnabled } from "util/log";
import "styles/recent-notes.scss"

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_NOTES = 3;
const MAX_NOTES = 5;
const MAX_SEED_SKIPS = 5;
const RECENT_NOTES_CONFIG_KEY = widgetConfigKey('recent-notes');
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// [Claude] Task: FNV-1a hash — converts a seed string to a stable 32-bit unsigned integer
// Prompt: "seed value should introduce deterministic randomness into the note selection process"
// Date: 2026-03-05 | Model: claude-4.6-sonnet-medium-thinking
function hashSeedString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

// [Claude] Task: mulberry32 PRNG — returns a closure yielding deterministic floats in [0, 1)
// Prompt: "seed value should introduce deterministic randomness into the note selection process"
// Date: 2026-03-05 | Model: claude-4.6-sonnet-medium-thinking
function makeSeededRandom(seed) {
  let s = seed >>> 0;
  return function () {
    s += 0x6D2B79F5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// [Claude] Task: derive a numeric seed from today's date string and a reseed counter
// Prompt: "on every date, or every time the user clicks to reseed, the seed value should change"
// Date: 2026-03-05 | Model: claude-4.6-sonnet-medium-thinking
function buildSeed(reseedCount) {
  const d = new Date();
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return hashSeedString(`${dateStr}-${reseedCount}`);
}

// [Claude] Task: normalize persisted recent-notes history to weekday=>UUID[] shape
// Prompt: "persist day-keyed UUID history and avoid suggesting notes shown in the past week"
// Date: 2026-03-18 | Model: gpt-5.3-codex
function normalizeRecentNotesHistory(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const normalized = {};
  for (const dayName of WEEKDAY_NAMES) {
    const dayUuids = Array.isArray(value[dayName]) ? value[dayName] : [];
    normalized[dayName] = [...new Set(dayUuids.filter(uuid => typeof uuid === 'string' && uuid.length > 0))];
  }
  return normalized;
}

// [Claude] Task: read recent-notes history from app.settings with JSON/string fallback
// Prompt: "persist day-keyed UUID history and avoid suggesting notes shown in the past week"
// Date: 2026-03-18 | Model: gpt-5.3-codex
function readRecentNotesHistory(app) {
  const raw = app?.settings?.[RECENT_NOTES_CONFIG_KEY];
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return normalizeRecentNotesHistory(JSON.parse(raw));
    } catch {
      return {};
    }
  }
  return normalizeRecentNotesHistory(raw);
}

// [Claude] Task: persist recent-notes history and mirror it in app.settings
// Prompt: "persist day-keyed UUID history and avoid suggesting notes shown in the past week"
// Date: 2026-03-18 | Model: gpt-5.3-codex
async function writeRecentNotesHistory(app, historyByDay) {
  const normalized = normalizeRecentNotesHistory(historyByDay);
  const serialized = JSON.stringify(normalized);
  await app.setSetting(RECENT_NOTES_CONFIG_KEY, serialized);
  if (app?.settings) {
    app.settings[RECENT_NOTES_CONFIG_KEY] = normalized;
  }
}

// [Claude] Task: flatten weekday history into a set of seen UUIDs
// Prompt: "persist day-keyed UUID history and avoid suggesting notes shown in the past week"
// Date: 2026-03-18 | Model: gpt-5.3-codex
function weeklySeenUuidSet(historyByDay) {
  const seen = new Set();
  WEEKDAY_NAMES.forEach(dayName => {
    (historyByDay[dayName] || []).forEach(uuid => seen.add(uuid));
  });
  return seen;
}

// [Claude] Task: append shown UUIDs under today's weekday bucket
// Prompt: "persist day-keyed UUID history and avoid suggesting notes shown in the past week"
// Date: 2026-03-18 | Model: gpt-5.3-codex
function mergeShownIntoToday(historyByDay, shownUuids) {
  const dayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const current = Array.isArray(historyByDay[dayName]) ? historyByDay[dayName] : [];
  return {
    ...historyByDay,
    [dayName]: [...new Set([...current, ...shownUuids])],
  };
}

// [Claude] Task: collect note handles from all task domains, deduplicated by uuid
// Prompt: "replace AI & Plugins widget with Recent Notes showing notes whose tasks have gone stale"
// Date: 2026-03-04 | Model: claude-4.6-sonnet-medium-thinking
// [Claude] Task: guard against missing domain entries when iterating task domain notes
// Prompt: "wrap each component load in try...catch so failure to render one widget does not disrupt others"
// Date: 2026-03-21 | Model: claude-4.6-opus-high-thinking
async function fetchAllDomainNotes(app) {
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
      if (noteHandle?.uuid && !seen.has(noteHandle.uuid)) {
        seen.add(noteHandle.uuid);
        notes.push(noteHandle);
      }
    }
  }
  return notes;
}

// [Claude] Task: find stale-task notes with seed-based deterministic skipping (up to MAX_SEED_SKIPS)
// Prompt: "seed value should randomly skip up to 5 notes; fall back to skipped notes if not enough found"
// Date: 2026-03-05 | Model: claude-4.6-sonnet-medium-thinking
// [Claude] Task: accept maxNotes parameter to allow taller cells to fetch more candidates
// Prompt: "ensure more note candidates are returned when component is two units tall"
// Date: 2026-03-07 | Model: claude-4.6-opus-high-thinking
async function findStaleTaskNotes(app, seed, maxNotes = MAX_NOTES) {
  const notes = await fetchAllDomainNotes(app);
  const oneWeekAgo = Date.now() - ONE_WEEK_MS;
  const rand = makeSeededRandom(seed);
  const staleCandidates = [];
  const selected = [];
  const skipped = [];

  for (const noteHandle of notes) {
    try {
      const tasks = await app.getNoteTasks({ uuid: noteHandle.uuid }, { includeDone: false });
      if (!Array.isArray(tasks) || tasks.length === 0) continue;

      // Prefer startAt as the best available proxy for when the task was created/scheduled
      const latestTaskTimestamp = tasks.reduce((maxMs, task) => {
        const ts = task.startAt ? task.startAt * 1000 : 0;
        return Math.max(maxMs, ts);
      }, 0);

      // Include notes where either tasks exist but none have startAt (treat as stale),
      // or the most recently scheduled task is older than one week
      if (latestTaskTimestamp !== 0 && latestTaskTimestamp >= oneWeekAgo) continue;

      staleCandidates.push({ noteHandle, taskCount: tasks.length, latestTaskTimestamp });
    } catch (err) {
      logIfEnabled(`[RecentNotes] Failed to fetch tasks for note ${noteHandle.uuid}:`, err);
    }
  }

  const persistedHistory = readRecentNotesHistory(app);
  const seenThisWeek = weeklySeenUuidSet(persistedHistory);
  let filteredCandidates = staleCandidates.filter(entry => !seenThisWeek.has(entry.noteHandle.uuid));
  let historyToPersist = persistedHistory;

  // If all stale candidates were already shown this week, reset history and reuse full pool.
  if (staleCandidates.length > 0 && filteredCandidates.length === 0) {
    historyToPersist = {};
    filteredCandidates = staleCandidates;
  }

  for (const entry of filteredCandidates) {
    if (selected.length >= maxNotes) break;
    // Randomly skip qualifying notes (up to MAX_SEED_SKIPS) to rotate the visible set.
    // Skipped notes are saved as fallbacks so we never show fewer results than MIN_NOTES.
    if (skipped.length < MAX_SEED_SKIPS && rand() < 0.5) {
      skipped.push(entry);
    } else {
      selected.push(entry);
    }
  }

  // If seeded skipping left us short, backfill from the skipped pool
  const combined = selected.length >= MIN_NOTES
    ? selected
    : [...selected, ...skipped].slice(0, maxNotes);

  const resolvedHandles = await Promise.all(
    combined.map(entry =>
      app.findNote({ uuid: entry.noteHandle.uuid })
        .then(found => ({ ...entry, noteHandle: found || entry.noteHandle }))
        .catch(() => entry)
    )
  );

  const shownUuids = resolvedHandles.map(({ noteHandle }) => noteHandle?.uuid).filter(Boolean);
  if (shownUuids.length > 0) {
    try {
      await writeRecentNotesHistory(app, mergeShownIntoToday(historyToPersist, shownUuids));
    } catch (err) {
      logIfEnabled('[RecentNotes] Failed to persist recent-note UUID history:', err);
    }
  }

  return resolvedHandles;
}

// [Claude] Task: render Recent Notes widget with reseed header action and seed-based note rotation
// Prompt: "component should have a link in the top bar to reseed; seed changes daily or on reseed click"
// Date: 2026-03-05 | Model: claude-4.6-sonnet-medium-thinking
// [Claude] Task: accept gridHeightSize to fetch more candidates when widget is 2 vertical cells
// Prompt: "ensure more note candidates are returned when component is two units tall"
// Date: 2026-03-07 | Model: claude-4.6-opus-high-thinking
export default function RecentNotesWidget({ app, gridHeightSize = 1 }) {
  const h = createElement;
  const [reseedCount, setReseedCount] = useState(0);
  const [staleNotes, setStaleNotes] = useState(null);
  const [error, setError] = useState(null);
  const maxNotes = gridHeightSize >= 2 ? 10 : MAX_NOTES;

  const seed = useMemo(() => buildSeed(reseedCount), [reseedCount]);

  useEffect(() => {
    setStaleNotes(null);
    setError(null);
    findStaleTaskNotes(app, seed, maxNotes)
      .then(results => {
        setStaleNotes(results);
        logIfEnabled("[RecentNotes] staleNotes:", results, "seed:", seed, "reseedCount:", reseedCount);
      })
      .catch(err => {
        logIfEnabled('[RecentNotes] fetch error:', err);
        setError(err.message || 'Failed to load notes');
      });
  }, [seed, maxNotes]);

  const handleReseed = () => setReseedCount(c => c + 1);

  const reseedButton = h('button', {
    className: 'widget-header-action',
    type: 'button',
    onClick: handleReseed,
    title: 'Show a different set of notes',
  }, '↻ Reseed');

  const renderBody = () => {
    if (error) {
      return h('p', { className: 'note-error' }, `Error: ${error}`);
    }
    if (staleNotes === null) {
      return h('p', { className: 'note-loading' }, 'Loading…');
    }
    if (staleNotes.length < MIN_NOTES) {
      return h('p', { className: 'note-empty' }, 'No notes with stale tasks found.');
    }
    return h('ul', { className: 'note-list' },
      staleNotes.map(({ noteHandle, taskCount }) =>
        h('li', { key: noteHandle.uuid, className: 'note-item' },
          h('button', {
            className: 'note-link',
            type: 'button',
            onClick: () => app.navigate(`https://www.amplenote.com/notes/${noteHandle.uuid}`),
            title: `Open "${noteHandle.name || 'Untitled'}"`,
          },
            h('span', { className: 'note-name' }, noteHandle.name || 'Untitled'),
            h('span', { className: 'note-count' }, `${taskCount} open task${taskCount !== 1 ? 's' : ''}`)
          )
        )
      )
    );
  };

  return h(WidgetWrapper, { title: widgetTitleFromId('recent-notes'), icon: '📝', widgetId: 'recent-notes', headerActions: reseedButton },
    renderBody()
  );
}
