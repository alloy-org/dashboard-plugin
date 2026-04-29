// =============================================================================
// [claude-opus-4-6-authored file]
// Prompt summary: "DreamTask non-UI: seen-UUID storage, service fetch, task/settings handlers"
// =============================================================================
import { DASHBOARD_NOTE_TAG } from "constants/settings";
import { analyzeDreamTasks } from "dream-task-service";

const SEEN_UUIDS_SETTING_KEY = 'dashboard_dream-task_seen_uuids';
const SEEN_UUIDS_RETENTION_DAYS = 7;
const META_PRESERVE_THROUGH_TOMORROW = "preserveThroughTomorrow";
const META_COMPLETED_AT = "completedAt";
const META_REMOVED_AT = "removedAt";

// ----------------------------------------------------------------------------------------------
// Pure helpers (data / persistence)
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Returns the number of task cards to display: (widthCells × heightCells).
// @param {number} gridWidthSize - Cell columns for this widget instance.
// @param {number} gridHeightSize - Cell rows for this widget instance.
// [Claude gpt-5.3-codex] Task: split visible-card count from generation count
// Prompt: "separate _maxTasksFromGrid with _taskGenerateCount so removals can draw from extra tasks"
export function _maxTasksFromGrid(gridWidthSize, gridHeightSize) {
  return (gridWidthSize || 1) * (gridHeightSize || 1);
}

// ----------------------------------------------------------------------------------------------
// @desc Returns generation count with one extra suggestion to support replacement after removals.
// @param {number} gridWidthSize - Cell columns for this widget instance.
// @param {number} gridHeightSize - Cell rows for this widget instance.
// [Claude gpt-5.3-codex] Task: expose task-generation count helper separate from visible-card count
// Prompt: "separate _maxTasksFromGrid with _taskGenerateCount so removals can draw from extra tasks"
export function _taskGenerateCount(gridWidthSize, gridHeightSize) {
  return (gridWidthSize || 1) * (gridHeightSize || 1) + 1;
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
// @desc Persist per-suggestion metadata (preserve/complete/remove) into today's DreamTask note.
// @param {object} app - Amplenote app bridge.
// @param {string|null} noteUUID - Daily proposed-tasks note UUID.
// @param {object} task - Dream task payload from the service/cache.
// @param {object} metadataPatch - Partial metadata updates.
// [Claude gpt-5.3-codex] Task: persist DreamTask card metadata updates to note entries
// Prompt: "add preserve/complete/remove links and store metadata in the note used for persistence"
export async function updateDreamTaskTaskMetadata(app, noteUUID, task, metadataPatch) {
  if (!noteUUID || !task || !metadataPatch || typeof metadataPatch !== "object") return false;
  const rawContent = await app.getNoteContent({ uuid: noteUUID });
  if (!rawContent || typeof rawContent !== "string") return false;
  const normalized = rawContent.replace(/\r\n/g, "\n");
  const sectionUpdate = _updatedSectionForTaskMetadata(normalized, task, metadataPatch);
  if (!sectionUpdate) return false;
  const replaced = await app.replaceNoteContent(
    { uuid: noteUUID },
    sectionUpdate.sectionBody,
    { section: { heading: { text: sectionUpdate.sectionHeading } } },
  );
  if (!replaced) return false;
  return true;
}

function _updatedSectionForTaskMetadata(noteContent, task, metadataPatch) {
  const sectionPattern = /(^##\s+(.+?)\n)([\s\S]*?)(?=^##\s+.+?\n|(?![\s\S]))/gm;
  let sectionMatch;
  while ((sectionMatch = sectionPattern.exec(noteContent)) !== null) {
    const sectionHeading = (sectionMatch[2] || "").trim();
    const sectionBody = sectionMatch[3] || "";
    const updatedSectionBody = _updateTaskBlockWithinSection(sectionBody, task, metadataPatch);
    if (!updatedSectionBody) continue;
    return { sectionBody: updatedSectionBody, sectionHeading };
  }
  return null;
}

function _updateTaskBlockWithinSection(sectionBody, task, metadataPatch) {
  let didUpdate = false;
  const updatedSectionBody = sectionBody.replace(
    /(### \d+\.\s+.+?\s+\(Rating:\s*\d+\/10\)\n[\s\S]*?)(?=\n### |\n---|$)/g,
    (taskBlock) => {
      if (didUpdate) return taskBlock;
      if (!_taskBlockMatches(taskBlock, task)) return taskBlock;
      didUpdate = true;
      return _withTaskBlockMetadata(taskBlock, metadataPatch);
    },
  );
  return didUpdate ? updatedSectionBody : null;
}

function _taskBlockMatches(taskBlock, task) {
  if (task.suggestionId && taskBlock.includes(`<!-- suggestion:${task.suggestionId} -->`)) return true;
  if (task.uuid && taskBlock.includes(`<!-- task:${task.uuid} -->`)) return true;
  if (!task.title) return false;
  const titleRegex = new RegExp(`^### \\d+\\.\\s+${_escapeRegExp(task.title)}\\s+\\(Rating:\\s*\\d+\\/10\\)$`, "m");
  return titleRegex.test(taskBlock);
}

function _withTaskBlockMetadata(taskBlock, metadataPatch) {
  const lines = taskBlock.split("\n");
  const headerLine = lines[0] || "";
  const bodyLines = lines.slice(1).filter(line => !/^<!-- dream-(preserve:through-tomorrow|completed-at:|removed-at:)/.test(line));
  let insertAfter = 0;
  while (insertAfter < bodyLines.length && /^<!-- (task:|suggestion:)/.test(bodyLines[insertAfter])) {
    insertAfter += 1;
  }
  const metaLines = [];
  const preserveThroughTomorrow = metadataPatch[META_PRESERVE_THROUGH_TOMORROW];
  const completedAt = metadataPatch[META_COMPLETED_AT];
  const removedAt = metadataPatch[META_REMOVED_AT];
  if (preserveThroughTomorrow) metaLines.push("<!-- dream-preserve:through-tomorrow -->");
  if (completedAt) metaLines.push(`<!-- dream-completed-at:${completedAt} -->`);
  if (removedAt) metaLines.push(`<!-- dream-removed-at:${removedAt} -->`);
  const mergedBodyLines = [
    ...bodyLines.slice(0, insertAfter),
    ...metaLines,
    ...bodyLines.slice(insertAfter),
  ];
  return `${headerLine}\n${mergedBodyLines.join("\n")}`;
}

function _escapeRegExp(input) {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    providerEmOverride: options.providerEmOverride || null,
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
export function requestDreamTaskRefreshExcludingRecent(app, runAnalysis, maxTasks, refreshOptions = {}) {
  const freshMap = _loadSeenUuidsMap(app);
  const excludeUuids = _getRecentlySeenUuids(freshMap);
  runAnalysis(excludeUuids, { forceRefresh: true, minimumTaskCount: maxTasks, ...refreshOptions });
}
