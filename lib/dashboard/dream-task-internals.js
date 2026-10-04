// =============================================================================
// [claude-opus-4-6-authored file]
// Prompt summary: "DreamTask non-UI: seen-UUID storage, service fetch, task/settings handlers"
// =============================================================================
import { DASHBOARD_NOTE_TAG } from "constants/settings";
import { analyzeDreamTasks } from "dream-task-service";
import { pluginSettings } from "plugin-data";
import { IDEA_STATUSES } from "project-idea-records";
import { existingTaskForAcceptedIdea, recordSuggestedIdeaDecisions } from "ranked-task-suggestions";

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

// [Claude claude-4.6-sonnet-medium-thinking] Task: load and prune seen-UUIDs hash from settings
// Prompt: "store a hash of { [date] => [uuid_seen_1, ...] }; filter past-7-day UUIDs when submitting to LLM"
// Reads and prunes the seen-UUIDs map from the embed-side settings cache, dropping entries
// older than the retention window.
// @returns {{ [isoDate: string]: string[] }} Date-keyed map of task UUIDs shown on each day.
export function _loadSeenUuidsMap() {
  const raw = pluginSettings()[SEEN_UUIDS_SETTING_KEY];
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
// @desc The card to act on for a suggestion: an idea card whose idea was already accepted, from another surface or an
//   earlier click, becomes a card for the task it was accepted as, so acting on it again never inserts a duplicate.
//   Any other card is returned as it is.
// @param {object} app - Amplenote app interface.
// @param {object} task - DreamTask card.
// @param {object} options - { domainName, domainUuid }: the Task Domain the card was suggested for.
// @returns {Promise<object>} The card, or an existing-task copy of it.
export async function acceptedIdeaCard(app, task, { domainName = null, domainUuid = null } = {}) {
  if (task.isExisting || !task.ideaId) return task;
  const accepted = await existingTaskForAcceptedIdea(app, { domainName, domainUuid, ideaId: task.ideaId,
    projectUuid: task.projectUuid, targetDate: new Date() });
  if (!accepted?.noteUuid) return task;
  return { ...task, isExisting: true, noteUUID: accepted.noteUuid, uuid: accepted.taskUuid };
}

// ----------------------------------------------------------------------------------------------
// @desc Navigates to an existing task in its note, or inserts an invented task into the default note. An idea card
//   whose idea was already accepted opens that task instead; one inserted now records the idea as accepted.
// @param {object} app - Amplenote app interface.
// @param {{ ideaId?: string, isExisting: boolean, projectUuid?: string, uuid: string|null, noteUUID: string|null,
//   title: string }} task
// @param {string|null} defaultNoteUUID - Note UUID used when task.isExisting is false.
// @param {object} [options] - { domainName, domainUuid }: the Task Domain the card was suggested for.
// @returns {Promise<object|null>} { noteUUID, taskUuid } of the task a non-existing card now points at, or null when the
//   card was already existing or no task could be inserted.
export async function handleTaskClick(app, task, defaultNoteUUID, { domainName = null, domainUuid = null } = {}) {
  const card = await acceptedIdeaCard(app, task, { domainName, domainUuid });
  if (card.isExisting && card.uuid && card.noteUUID) {
    await app.navigate(`https://www.amplenote.com/notes/${ card.noteUUID }?highlightTaskUUID=${ card.uuid }`);
    return task.isExisting ? null : { noteUUID: card.noteUUID, taskUuid: card.uuid };
  }
  if (!defaultNoteUUID) return null;
  const newTaskUUID = await app.insertTask({ uuid: defaultNoteUUID }, { content: task.title });
  if (!newTaskUUID) return null;
  await recordDreamIdeaDecision(app, task, { acceptedTaskUuid: newTaskUUID, domainName, domainUuid,
    status: IDEA_STATUSES.accepted });
  await app.navigate(`https://www.amplenote.com/notes/${ defaultNoteUUID }?highlightTaskUUID=${ newTaskUUID }`);
  return { noteUUID: defaultNoteUUID, taskUuid: newTaskUUID };
}

// ----------------------------------------------------------------------------------------------
// @desc Record what the user did with an idea card on the project that holds the idea. Cards that are not ideas, or
//   whose idea already became a task, record nothing.
// @param {object} app - Amplenote app interface.
// @param {object} task - DreamTask card.
// @param {object} options - { acceptedTaskUuid, domainName, domainUuid, status }: status is IDEA_STATUSES.accepted
//   with the task the idea became, or IDEA_STATUSES.dismissed.
// @returns {Promise<void>}
export async function recordDreamIdeaDecision(app, task, { acceptedTaskUuid = null, domainName = null, domainUuid = null,
    status }) {
  if (task.isExisting || !task.ideaId || !task.projectUuid) return;
  await recordSuggestedIdeaDecisions(app, { decisions: [{ acceptedTaskUuid, ideaId: task.ideaId,
    projectUuid: task.projectUuid, status }], domainName, domainUuid, targetDate: new Date() });
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
  while (insertAfter < bodyLines.length && /^<!-- (task:|suggestion:|idea:)/.test(bodyLines[insertAfter])) {
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
// @param {function|null} [params.rankingPreparer] - Forwarded to analyzeDreamTasks; prepares the day's shared ranking
//   through the Dashboard's work queue before a generation ranks the day.
// @returns {Promise<object>} analyzeDreamTasks result.
export async function fetchDreamTaskSuggestions(app, { proposedTasksNoteName, excludeUuids, options, maxTasks,
    rankingPreparer = null }) {
  const existingNoteHandle = await app.findNote({ name: proposedTasksNoteName, tags: [DASHBOARD_NOTE_TAG] });
  return analyzeDreamTasks(app, {
    excludeUuids,
    minimumTaskCount: options.minimumTaskCount || maxTasks,
    providerEmOverride: options.providerEmOverride || null,
    noteName: proposedTasksNoteName,
    existingNoteHandle,
    rankingPreparer,
  });
}

// ----------------------------------------------------------------------------------------------
// Fans out an analyzeDreamTasks result into React state setters and persists shown UUIDs.
// @param {object|null} result - analyzeDreamTasks return value.
// @param {object} ctx
// @param {object} ctx.app
// @param {string} ctx.providerName - Display name shown in error state.
// @param {Function} ctx.recordTaskUuids - `(shownUuids, currentMap) => Promise<map>` — persists seen UUIDs.
// @param {Function} ctx.setDefaultNoteUUID - React state setter for the invented-task target note UUID.
// @param {Function} ctx.setError - React state setter for the widget error object.
// @param {Function} [ctx.setLlmAttributionFooter] - Optional React state setter for the footer attribution line.
// @param {Function} ctx.setNoteUUID - React state setter for the daily note UUID.
// @param {Function} [ctx.setReserveTasks] - React state setter for suggestions held back until one is rejected.
// @param {Function} ctx.setTasks - React state setter for the tasks array.
export async function applyDreamTaskAnalysisResult(result, { app, providerName, recordTaskUuids, setDefaultNoteUUID,
    setError, setLlmAttributionFooter, setNoteUUID, setReserveTasks, setTasks }) {
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
    if (setReserveTasks) setReserveTasks(result.reserveTasks || []);
    const currentMap = _loadSeenUuidsMap();
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
export function requestDreamTaskRefreshExcludingRecent(runAnalysis, maxTasks, refreshOptions = {}) {
  const freshMap = _loadSeenUuidsMap();
  const excludeUuids = _getRecentlySeenUuids(freshMap);
  runAnalysis(excludeUuids, { minimumTaskCount: maxTasks, ...refreshOptions });
}
