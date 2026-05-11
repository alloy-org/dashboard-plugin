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
const META_TASK_UUID = "taskUuid";

// ----------------------------------------------------------------------------------------------
// Pure helpers (data / persistence)
// ----------------------------------------------------------------------------------------------

// [Claude gpt-5.3-codex] Task: split visible-card count from generation count
// Prompt: "separate _maxTasksFromGrid with _taskGenerateCount so removals can draw from extra tasks"
// @returns {number} widthCells × heightCells — number of visible task cards.
export function _maxTasksFromGrid(gridWidthSize, gridHeightSize) {
  return (gridWidthSize || 1) * (gridHeightSize || 1);
}

// [Claude gpt-5.3-codex] Task: expose task-generation count helper separate from visible-card count
// Prompt: "separate _maxTasksFromGrid with _taskGenerateCount so removals can draw from extra tasks"
// @returns {number} widthCells × heightCells + 1 — one extra suggestion held in reserve for post-removal replacement.
export function _taskGenerateCount(gridWidthSize, gridHeightSize) {
  return (gridWidthSize || 1) * (gridHeightSize || 1) + 1;
}

// [Claude claude-4.6-sonnet-medium-thinking] Task: load and prune seen-UUIDs hash from app.settings
// Prompt: "store a hash of { [date] => [uuid_seen_1, ...] }; filter past-7-day UUIDs when submitting to LLM"
// Reads and prunes the seen-UUIDs map from app settings, dropping entries older than the retention window.
// @returns {{ [isoDate: string]: string[] }} Date-keyed map of task UUIDs shown on each day.
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

// @param {{ [isoDate: string]: string[] }} seenUuidsMap - As returned by _loadSeenUuidsMap.
// @returns {Set<string>} All task UUIDs seen within the retention window, for LLM exclusion.
export function _getRecentlySeenUuids(seenUuidsMap) {
  const allUuids = new Set();
  for (const uuids of Object.values(seenUuidsMap)) {
    for (const uuid of uuids) allUuids.add(uuid);
  }
  return allUuids;
}

// [Claude claude-4.6-sonnet-medium-thinking] Task: compute today's ISO date string
export function _todayKey() {
  return new Date().toISOString().slice(0, 10);
}

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

// Merges task UUIDs shown today into the pruned seen-UUIDs map and persists it via app.setSetting.
// @param {{ [isoDate: string]: string[] }} currentMap - As returned by _loadSeenUuidsMap.
// @param {string[]} taskUuids - UUIDs to record as shown today.
// @returns {Promise<{ [isoDate: string]: string[] }>} Updated map after merge.
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
// Navigates to an existing task in its note, or inserts an invented task into the default note.
// @param {{ isExisting: boolean, uuid: string|null, noteUUID: string|null, title: string }} task
// @param {string|null} defaultNoteUUID - Note UUID used when task.isExisting is false.
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
// Writes per-suggestion lifecycle metadata into the matching task block in today's DreamTask note.
// The target block is located by `task.suggestionId`, then `task.uuid`, then `task.title`.
//
// @param {string|null} noteUUID - Daily proposed-tasks note UUID.
// @param {{ suggestionId?: string, uuid?: string, title?: string }} task - Identifies the note block to update.
// @param {{ preserveThroughTomorrow?: boolean, completedAt?: string|null,
//   removedAt?: string|null, taskUuid?: string|null }} metadataPatch
// @returns {Promise<boolean>} True when the note block was located and updated.
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
  const taskUuid = metadataPatch[META_TASK_UUID];
  const bodyLines = lines.slice(1).filter(line => {
    if (/^<!-- dream-(preserve:through-tomorrow|completed-at:|removed-at:)/.test(line)) return false;
    if (taskUuid && /^<!-- task:/.test(line)) return false;
    return true;
  });
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
  const taskLines = taskUuid ? [`<!-- task:${taskUuid} -->`] : [];
  const mergedBodyLines = [
    ...taskLines,
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
export function handleOpenSettings(onOpenSettings) {
  if (onOpenSettings) onOpenSettings();
}

// ----------------------------------------------------------------------------------------------
// Service orchestration
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// Resolves today's proposed-tasks note handle then delegates to analyzeDreamTasks.
// @param {object} params
// @param {string} params.proposedTasksNoteName
// @param {Set<string>|null} params.excludeUuids - Forwarded to analyzeDreamTasks for LLM candidate exclusion.
// @param {{ minimumTaskCount?: number, providerEmOverride?: string|null }} params.options
// @param {number} params.maxTasks - Used as minimumTaskCount when options.minimumTaskCount is absent.
// @returns {Promise<object>} analyzeDreamTasks result.
export async function fetchDreamTaskSuggestions(app, { proposedTasksNoteName, excludeUuids, options, maxTasks }) {
  const existingNoteHandle = await app.findNote({ name: proposedTasksNoteName, tags: [DASHBOARD_NOTE_TAG] });
  return analyzeDreamTasks(app, {
    excludeUuids,
    minimumTaskCount: options.minimumTaskCount || maxTasks,
    providerEmOverride: options.providerEmOverride || null,
    noteName: proposedTasksNoteName,
    existingNoteHandle,
  });
}

// ----------------------------------------------------------------------------------------------
// Fans out an analyzeDreamTasks result into React state setters and persists shown UUIDs.
// @param {object|null} result - analyzeDreamTasks return value.
// @param {object} ctx
// @param {string} ctx.providerName - Display name shown in error state.
// @param {object} ctx.app
// @param {Function} ctx.recordTaskUuids - `(shownUuids, currentMap) => Promise<map>` — persists seen UUIDs.
// @param {Function} ctx.setError - React state setter for the widget error object.
// @param {Function} ctx.setTasks - React state setter for the tasks array.
// @param {Function} ctx.setNoteUUID - React state setter for the daily note UUID.
// @param {Function} ctx.setDefaultNoteUUID - React state setter for the invented-task target note UUID.
// @param {Function} [ctx.setLlmAttributionFooter] - Optional React state setter for the footer attribution line.
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
// Returns true when the grid grew and the current task list is too short to fill the new cell count.
// @param {number} maxTasks - New (current) cell count.
// @param {number} previousMaxTasks - Cell count before the resize.
// @param {object[]|null} tasks - Current displayed tasks.
export function shouldFetchMoreTasksAfterGridGrowth({ maxTasks, previousMaxTasks, tasks }) {
  if (maxTasks <= previousMaxTasks) return false;
  if (!tasks) return false;
  if (tasks.length >= maxTasks) return false;
  return true;
}

// ----------------------------------------------------------------------------------------------
// Kicks off a new analysis run, excluding task UUIDs seen in the last retention window.
// @param {Function} runAnalysis - Widget callback with signature `(excludeUuids, options) => void`.
// @param {number} maxTasks - Passed as `minimumTaskCount` to the new analysis run.
// @param {object} [refreshOptions={}] - Merged into the options arg (e.g. `{ providerEmOverride }`).
export function requestDreamTaskRefreshExcludingRecent(app, runAnalysis, maxTasks, refreshOptions = {}) {
  const freshMap = _loadSeenUuidsMap(app);
  const excludeUuids = _getRecentlySeenUuids(freshMap);
  runAnalysis(excludeUuids, { minimumTaskCount: maxTasks, ...refreshOptions });
}
