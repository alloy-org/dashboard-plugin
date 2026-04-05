// =============================================================================
// [claude-opus-4-6-authored file]
// Prompt summary: "DreamTask non-UI: seen-UUID storage, service fetch, task/settings handlers"
// =============================================================================
import { DASHBOARD_NOTE_TAG } from "constants/settings";
import { analyzeDreamTasks } from "dream-task-service";

const SEEN_UUIDS_SETTING_KEY = 'dashboard_dream-task_seen_uuids';
const SEEN_UUIDS_RETENTION_DAYS = 7;

// ----------------------------------------------------------------------------------------------
// Pure helpers (data / persistence)
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Returns the maximum number of task cards from grid width × height (at least 1).
// @param {number} gridWidthSize - Cell columns for this widget instance.
// @param {number} gridHeightSize - Cell rows for this widget instance.
// [Claude claude-4.6-sonnet-medium-thinking] Task: compute maxTasks from both grid dimensions (width × height cells)
// Prompt: "show as many tasks as it has cells (1x2 = two tasks, 2x1 = two tasks, 2x2 = four tasks)"
export function _maxTasksFromGrid(gridWidthSize, gridHeightSize) {
  return Math.max(1, (gridWidthSize || 1) * (gridHeightSize || 1));
}

// ----------------------------------------------------------------------------------------------
// @desc Load and prune seen-UUIDs from app.settings; drop entries older than the retention window.
// @param {object} app - Amplenote app bridge with settings.
// [Claude claude-4.6-sonnet-medium-thinking] Task: load and prune seen-UUIDs hash from app.settings
// Prompt: "store a hash of { [date] => [uuid_seen_1, ...] }; filter past-7-day UUIDs when submitting to LLM"
export function _loadSeenUuidsMap(app) {
  const raw = app.settings?.[SEEN_UUIDS_SETTING_KEY];
  let map = {};
  if (raw) {
    try {
      map = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      map = {};
    }
  }
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - SEEN_UUIDS_RETENTION_DAYS);
  const pruned = {};
  for (const [date, uuids] of Object.entries(map)) {
    if (new Date(date) >= cutoff) pruned[date] = uuids;
  }
  return pruned;
}

// ----------------------------------------------------------------------------------------------
// @desc Flatten seen UUIDs from the pruned map into a Set for LLM exclusion.
// @param {object} seenUuidsMap - Date-keyed map of UUID arrays.
// [Claude claude-4.6-sonnet-medium-thinking] Task: collect all seen UUIDs from the past 7 days into a flat set
// Prompt: "filter out the tasks with those UUIDs when submitting options to the LLM"
export function _getRecentlySeenUuids(seenUuidsMap) {
  const allUuids = new Set();
  for (const uuids of Object.values(seenUuidsMap)) {
    for (const uuid of uuids) allUuids.add(uuid);
  }
  return allUuids;
}

// ----------------------------------------------------------------------------------------------
// @desc Today's ISO date string (YYYY-MM-DD) for keying the seen-UUIDs map.
// [Claude claude-4.6-sonnet-medium-thinking] Task: compute today's ISO date string
export function _todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// ----------------------------------------------------------------------------------------------
// @desc Human-readable note title for persisting today's proposed tasks.
// [Claude gpt-5.3-codex] Task: derive the date-specific DreamTask note name for today's suggestions
// Prompt: "persist suggested tasks in a date-specific dashboard note instead of plugin settings"
export function _todayProposedTasksNoteName() {
  const todayLabel = (new Date()).toLocaleString([], {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return `Dashboard proposed tasks for ${ todayLabel }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Merge new task UUIDs into today's seen-UUID entry and persist via app.setSetting.
// @param {object} app - Amplenote app bridge.
// @param {object} currentMap - Pruned seen-UUID map.
// @param {Array<string>} taskUuids - UUIDs to record as shown.
// [Claude claude-4.6-sonnet-medium-thinking] Task: merge new task UUIDs into today's seen-UUIDs entry
// Prompt: "store a hash of { [date] => [uuid_seen_1, ...] }"
export async function _recordSeenUuids(app, currentMap, taskUuids) {
  const today = _todayKey();
  const existing = currentMap[today] || [];
  const merged = Array.from(new Set([...existing, ...taskUuids]));
  const updated = { ...currentMap, [today]: merged };
  await app.setSetting(SEEN_UUIDS_SETTING_KEY, JSON.stringify(updated));
  return updated;
}

// ----------------------------------------------------------------------------------------------
// Event handlers (module scope)
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Open an existing task in its note, or create an invented task in the default note.
// @param {object} app - Amplenote app bridge.
// @param {object} task - Dream task payload from the service.
// @param {string|null} defaultNoteUUID - Busiest note for new tasks.
// [Claude claude-4.6-opus-high-thinking] Task: navigate to existing task or create invented task via insertTask
// Prompt: "clicking on an existing task navigates to it; clicking on an invented task creates it via app.insertTask"
export async function handleTaskClick(app, task, defaultNoteUUID) {
  if (task.isExisting && task.uuid && task.noteUUID) {
    await app.navigate(`https://www.amplenote.com/notes/${ task.noteUUID }?highlightTaskUUID=${ task.uuid }`);
  } else if (defaultNoteUUID) {
    const newTaskUUID = await app.insertTask({ uuid: defaultNoteUUID }, { content: task.title });
    if (newTaskUUID) {
      await app.navigate(`https://www.amplenote.com/notes/${ defaultNoteUUID }?highlightTaskUUID=${ newTaskUUID }`);
    }
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Invoke the parent settings callback when present.
// @param {Function|undefined} onOpenSettings - Dashboard settings opener.
export function handleOpenSettings(onOpenSettings) {
  if (onOpenSettings) onOpenSettings();
}

// ----------------------------------------------------------------------------------------------
// Service orchestration
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Resolve today's proposed-tasks note handle and invoke analyzeDreamTasks.
// @param {object} app - Amplenote app bridge.
// @param {object} params - proposedTasksNoteName, excludeUuids, options, maxTasks.
// [Claude claude-opus-4-6] Task: resolve today's proposed-tasks note and run the dream-task service in one call
// Prompt: "Break apart DreamTask main component into local functions for maintainability"
export async function fetchDreamTaskSuggestions(app, { proposedTasksNoteName, excludeUuids, options, maxTasks }) {
  const existingNoteHandle = await app.findNote({ name: proposedTasksNoteName, tags: [DASHBOARD_NOTE_TAG] });
  return analyzeDreamTasks(app, {
    excludeUuids,
    forceRefresh: !!options.forceRefresh,
    minimumTaskCount: options.minimumTaskCount || maxTasks,
    noteName: proposedTasksNoteName,
    existingNoteHandle,
  });
}

// ----------------------------------------------------------------------------------------------
// @desc Apply analyzeDreamTasks result to React state setters and persist seen UUIDs.
// @param {object|null} result - Service result object.
// @param {object} ctx - providerName, app, recordTaskUuids, setError, setTasks, setNoteUUID, setDefaultNoteUUID,
//   setLlmAttributionFooter.
// [Claude claude-opus-4-6] Task: map service result into widget error / tasks / note handles and persist seen UUIDs
// Prompt: "Break apart DreamTask main component into local functions for maintainability"
// [Claude claude-opus-4-6] Task: pass through llmAttributionFooter for widget footer line
// Prompt: "print which LLM provider generated the suggestions at the bottom of the widget"
export async function applyDreamTaskAnalysisResult(result, { providerName, app, recordTaskUuids, setError, setTasks,
    setNoteUUID, setDefaultNoteUUID, setLlmAttributionFooter }) {
  if (result?.error) {
    if (setLlmAttributionFooter) setLlmAttributionFooter(null);
    setError({
      error: result.error,
      errorCode: result.errorCode,
      errorDetail: result.errorDetail,
      providerName,
    });
    return;
  }
  if (result?.tasks) {
    setTasks(result.tasks);
    if (setLlmAttributionFooter) {
      setLlmAttributionFooter(result.llmAttributionFooter ?? null);
    }
    const currentMap = _loadSeenUuidsMap(app);
    await recordTaskUuids(result.shownUuids || [], currentMap);
  }
  if (result?.noteUUID) setNoteUUID(result.noteUUID);
  if (result?.defaultNoteUUID) setDefaultNoteUUID(result.defaultNoteUUID);
}

// ----------------------------------------------------------------------------------------------
// @desc Whether the grid grew and we still need more suggestions to fill the new cell count.
// @param {object} args - maxTasks, previousMaxTasks, tasks.
// [Claude claude-opus-4-6] Task: decide whether grid resize warrants a forced refresh with more suggestions
// Prompt: "Break apart DreamTask main component into local functions for maintainability"
export function shouldFetchMoreTasksAfterGridGrowth({ maxTasks, previousMaxTasks, tasks }) {
  if (maxTasks <= previousMaxTasks) return false;
  if (!tasks) return false;
  if (tasks.length >= maxTasks) return false;
  return true;
}

// ----------------------------------------------------------------------------------------------
// @desc Force-refresh analysis excluding UUIDs seen in the last retention window.
// @param {object} app - Amplenote app bridge.
// @param {Function} runAnalysis - Widget analysis runner.
// @param {number} maxTasks - Minimum tasks to request.
// [Claude claude-opus-4-6] Task: load seen-UUID map, refresh analysis excluding recently shown task ids
// Prompt: "Break apart DreamTask main component into local functions for maintainability"
export function requestDreamTaskRefreshExcludingRecent(app, runAnalysis, maxTasks) {
  const freshMap = _loadSeenUuidsMap(app);
  const excludeUuids = _getRecentlySeenUuids(freshMap);
  runAnalysis(excludeUuids, { forceRefresh: true, minimumTaskCount: maxTasks });
}
