// [Claude-authored file]
// Created: 2026-03-14 | Model: claude-4.6-opus-high-thinking
// Task: DreamTask agentic analysis — suggests tasks aligned with quarterly/monthly goals
// Prompt summary: "Create a DreamTask widget with an agentic loop that analyzes tasks and suggests goal-aligned work"
import { getCurrentQuarter, extractMonthSectionContent, getUpcomingWeekMonday, formatWeekLabel, FULL_MONTH_NAMES } from "constants/quarters"
import { apiKeyBucketFromLlmProvider, DASHBOARD_NOTE_TAG, IS_DEV_ENVIRONMENT, SETTING_KEYS } from "constants/settings"
import { PROVIDER_DEFAULT_MODEL } from "constants/llm-providers"
import { llmPrompt } from "providers/fetch-ai-provider"
import { preferredModels, providerFromModel, providerNameFromProviderEm } from "providers/ai-provider-settings"
import { logIfEnabled } from "util/log"

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MAX_TASKS_IN_PROMPT = 50;
const MAX_PREVIOUS_ANALYSIS_CHARS = 2000;
const MAX_QUARTERLY_CONTENT_CHARS = 3000;
const MAX_MONTHLY_CONTENT_CHARS = 1000;
const MAX_WEEKLY_CONTENT_CHARS = 1000;
const MAX_GOALS_SUMMARY_CHARS = 500;

// [Claude claude-4.6-opus-high-thinking] Task: extract magic numbers into named constants
// Prompt: "change magic numbers into constants"
const SECONDS_PER_DAY = 86400;
const EPOCH_SECONDS_THRESHOLD = 1e10;
const LLM_TIMEOUT_SECONDS = 60;
const MIN_SUGGESTION_REQUEST_COUNT = 3;
const ERROR_SNIPPET_MAX_CHARS = 200;
const HTTP_STATUS_UNAUTHORIZED = 401;
const HTTP_STATUS_FORBIDDEN = 403;
const RATING_MIN = 1;
const RATING_MAX = 10;
const RATING_DEFAULT = 5;
const SUPPLEMENTAL_TASK_RATING = 7;
const DEFAULT_VALIDATED_TASK_LIMIT = 5;
const EXISTING_TASK_MIN_RATIO = 0.5;
const TOP_TASKS_RATIO = 0.1;
const MIN_TOP_TASKS = 3;
const RANK_IMPORTANT = 20;
const RANK_URGENT = 15;
const RANK_HIGH_SCORE = 15;
const RANK_MEDIUM_SCORE = 8;
const RANK_OVERDUE = 25;
const RANK_DUE_TOMORROW = 20;
const RANK_DUE_WITHIN_3_DAYS = 12;
const RANK_DUE_THIS_WEEK = 5;
const RANK_ALREADY_STARTED = 5;
const RANK_STARTING_TOMORROW = 3;
const RANK_SCORE_CAP = 15;
const SCORE_THRESHOLD_HIGH = 10;
const SCORE_THRESHOLD_MEDIUM = 5;
const DAYS_THRESHOLD_TOMORROW = 1;
const DAYS_THRESHOLD_SOON = 3;
const DAYS_THRESHOLD_WEEK = 7;

// [Claude] Task: persist DreamTask suggestions in a date-specific archived dashboard note with prepend behavior
// Prompt: "persist daily suggested tasks to a note; prepend on reseed/resize; query note before LLM call"
// Date: 2026-03-24 | Model: gpt-5.3-codex
export async function analyzeDreamTasks(app, options = {}) {
  const parsedOptions = _normalizeAnalyzeOptions(options);
  const now = new Date();
  const dayName = DAY_NAMES[now.getDay()];
  const monthName = FULL_MONTH_NAMES[now.getMonth()];
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;
  const noteContext = await _resolveDreamTaskNoteContext(app, parsedOptions);
  const taskContext = await _loadTaskContext(app);
  const cachedResult = _buildCachedAnalyzeResult(parsedOptions, noteContext, taskContext);
  if (cachedResult) return cachedResult;

  const suggestionRequest = _buildSuggestionRequest(parsedOptions, noteContext.cached.tasks.length);
  const candidateTasks = _filterCandidateTasks(taskContext.openTasks, parsedOptions.excludeUuids);
  const planningContext = await _loadPlanningContext(app, monthName, noteContext.existingContent);
  const dateHeading = _dateHeadingFromDate(now, dayName, monthName);
  // [Claude] Task: detect empty planning context and return structured error before calling LLM
  // Prompt: "if no data to submit to AI, suggest user populates quarterly/monthly plan"
  // Date: 2026-04-04 | Model: claude-opus-4-6
  const hasPlanningData = !!(planningContext.quarterlyContent || planningContext.monthlyContent || planningContext.weeklyContent);
  if (!hasPlanningData && candidateTasks.length === 0) {
    return {
      tasks: [],
      error: 'No planning data or tasks found to generate suggestions from. Populate your quarterly and/or monthly plan to receive AI-suggested tasks.',
      errorCode: 'no_planning_data',
      noteUUID: noteContext.noteHandle.uuid,
    };
  }

  const generationResult = await _generateSuggestionsFromLlm({
    app,
    candidateTasks,
    dateHeading,
    dayName,
    isWeekend,
    noteUuidFromTaskUuid: taskContext.noteUuidFromTaskUuid,
    planningContext,
    requestedSuggestionCount: suggestionRequest.requestedSuggestionCount,
  });

  if (generationResult.error) {
    return {
      tasks: [],
      error: generationResult.error,
      errorCode: generationResult.errorCode,
      errorDetail: generationResult.errorDetail,
      noteUUID: noteContext.noteHandle.uuid,
    };
  }

  await _prependGeneratedSuggestionsToNote(app, noteContext.existingContent, generationResult.goalsSummary,
      generationResult.llmAttributionFooter, noteContext.noteHandle, generationResult.enforcedTasks);
  return _buildFreshAnalyzeResult(noteContext, taskContext, generationResult);
}

// ---------------------------------------------------------------------------------------------
// [Claude] Task: compute a stable date heading string for the LLM prompt context
// Prompt: "refactor analyzeDreamTasks into named helper methods"
// Date: 2026-03-24 | Model: gpt-5.3-codex
// Build a user-readable date heading (e.g., "Tuesday March 24, 2026").
//
// @param {Date} now - Current date/time.
// @param {string} dayName - Weekday name from DAY_NAMES.
// @param {string} monthName - Month name from FULL_MONTH_NAMES.
// @returns {string} Formatted date heading.
function _dateHeadingFromDate(now, dayName, monthName) {
  return `${dayName} ${monthName} ${now.getDate()}, ${now.getFullYear()}`;
}

// [Claude] Task: load and parse the date-specific DreamTask note state
// Prompt: "refactor analyzeDreamTasks into named helper methods"
// Date: 2026-03-24 | Model: gpt-5.3-codex
// Resolve DreamTask note content and parsed cached tasks for today.
//
// @param {object} app - Amplenote app interface.
// @param {object} parsedOptions - Normalized analyze options.
// @returns {Promise<object>} Note context with handle, raw content, and parsed cache.
async function _resolveDreamTaskNoteContext(app, parsedOptions) {
  const noteHandle = await _resolveDreamTaskNoteHandle(
    app,
    parsedOptions.noteName,
    parsedOptions.existingNoteHandle,
  );
  const rawContent = await app.getNoteContent({ uuid: noteHandle.uuid });
  // Normalize CRLF from note store so cached task + attribution parsing is stable
  const existingContent = typeof rawContent === "string" ? rawContent.replace(/\r\n/g, "\n") : "";
  return {
    noteHandle,
    existingContent,
    cached: _parseCachedTasks(existingContent),
  };
}

// Find/create the date-specific DreamTask note tagged for dashboard usage.
//
// @param {object} app - Amplenote app interface.
// @param {string} noteName - Target note name for today's suggestions.
// @param {object|null} existingNoteHandle - Optional pre-fetched note handle.
// @returns {Promise<object>} Note handle with `uuid`.
async function _resolveDreamTaskNoteHandle(app, noteName, existingNoteHandle) {
  let noteHandle = existingNoteHandle?.uuid
    ? existingNoteHandle
    : await app.findNote({ name: noteName, tags: [DASHBOARD_NOTE_TAG] });
  if (noteHandle) return noteHandle;

  const uuid = await app.createNote(noteName, [DASHBOARD_NOTE_TAG], { archive: true });
  logIfEnabled(`[dream-task] Created daily note "${noteName}" with uuid ${uuid}`);
  return { uuid };
}

// [Claude] Task: centralize task-domain loading and mapping context for DreamTask output
// Prompt: "refactor analyzeDreamTasks into named helper methods"
// Date: 2026-03-24 | Model: gpt-5.3-codex
// Gather task-domain context used for candidate selection and task navigation.
//
// @param {object} app - Amplenote app interface.
// @returns {Promise<object>} Open tasks, UUID→note mapping, and default note UUID.
async function _loadTaskContext(app) {
  const domainUuid = await _getActiveDomainUuid(app);
  const allTasks = domainUuid ? await app.getTaskDomainTasks(domainUuid) : [];
  const openTasks = allTasks.filter(task => !task.completedAt && !task.dismissedAt);
  logIfEnabled(`[dream-task] Found ${openTasks.length} open tasks from domain ${domainUuid}`);
  const noteNameFromNoteUuid = await _noteNameFromNoteUuidMap(app, openTasks);
  const noteUuidFromTaskUuid = _noteUuidFromTaskUuidMap(openTasks);
  const defaultNoteUUID = _findBusiestNoteUUID(allTasks);
  logIfEnabled(`[dream-task] Default note for new tasks: ${defaultNoteUUID}`);
  return { allTasks, defaultNoteUUID, domainUuid, noteNameFromNoteUuid, noteUuidFromTaskUuid, openTasks };
}

// ----------------------------------------------------------------------------------------------
// @desc Resolve human-readable note titles for each note UUID referenced by open tasks (task fields, then findNote).
// [Claude claude-opus-4-6] Task: map note UUID → title for DreamTask source-note badge
// Prompt: "show first 15 characters of the note in which the task is located (existing tasks)"
async function _noteNameFromNoteUuidMap(app, openTasks) {
  const noteUuids = new Set();
  for (const t of openTasks) {
    if (t.noteUUID) noteUuids.add(t.noteUUID);
  }
  const map = new Map();
  for (const t of openTasks) {
    if (!t.noteUUID) continue;
    const fromTask = (t.noteName || t.noteTitle || "").trim();
    if (fromTask) map.set(t.noteUUID, fromTask);
  }
  await Promise.all(
    [...noteUuids].map(async (uuid) => {
      if (map.has(uuid)) return;
      try {
        const handle = await app.findNote({ uuid });
        if (handle?.name) map.set(uuid, handle.name);
      } catch (err) {
        logIfEnabled("[dream-task] findNote({ uuid }) failed:", uuid, err);
      }
    }),
  );
  return map;
}

// ----------------------------------------------------------------------------------------------
// @desc Build a lookup map from task UUID to owning note UUID.
// @param {Array<object>} tasks - Open tasks from the active task domain.
// @returns {Map<string, string>} Task UUID → note UUID map.
function _noteUuidFromTaskUuidMap(tasks) {
  const uuidMap = new Map();
  for (const task of tasks) {
    if (task.uuid && task.noteUUID) uuidMap.set(task.uuid, task.noteUUID);
  }
  return uuidMap;
}

// [Claude] Task: return cached suggestion payload when note already has enough entries
// Prompt: "refactor analyzeDreamTasks into named helper methods"
// Date: 2026-03-24 | Model: gpt-5.3-codex
// Return cached suggestions when force-refresh is disabled and count is sufficient.
//
// @param {object} parsedOptions - Normalized analyze options.
// @param {object} noteContext - Note context with cached entries.
// @param {object} taskContext - Task context with UUID→note mapping.
// @returns {object|null} Analyze response object or null when regeneration is needed.
// [Claude claude-opus-4-6] Task: include llmAttributionFooter for widget attribution line
// Prompt: "print which LLM provider generated the suggestions at the bottom of the widget"
function _buildCachedAnalyzeResult(parsedOptions, noteContext, taskContext) {
  const minimumSuggestionCount = Math.max(1, parsedOptions.minimumTaskCount || 1);
  if (parsedOptions.forceRefresh) return null;
  if (noteContext.cached.tasks.length < minimumSuggestionCount) return null;

  logIfEnabled(`[dream-task] Using ${noteContext.cached.tasks.length} cached daily suggestions from note`);
  const { noteNameFromNoteUuid, noteUuidFromTaskUuid } = taskContext;
  const tasks = noteContext.cached.tasks.map(task => _enrichTaskWithNoteContext(noteNameFromNoteUuid, task,
    noteUuidFromTaskUuid));
  return {
    tasks,
    goalsSummary: noteContext.cached.goalsSummary,
    cached: true,
    noteUUID: noteContext.noteHandle.uuid,
    defaultNoteUUID: taskContext.defaultNoteUUID,
    shownUuids: [],
    llmAttributionFooter: _extractLlmAttributionFromNewestNoteBatch(noteContext.existingContent),
  };
}

// Enrich a suggestion task with noteUUID/isExisting metadata.
//
// @param {Map<string, string>} noteNameFromNoteUuid - Note UUID → note title for badge.
// @param {object} task - Suggested task item.
// @param {Map<string, string>} noteUuidFromTaskUuid - Task UUID → note UUID.
// @returns {object} Enriched task.
// [Claude claude-opus-4-6] Task: add source note title for existing-task note badge
// Prompt: "show note title in the existing-task badge and rely on CSS truncation"
function _enrichTaskWithNoteContext(noteNameFromNoteUuid, task, noteUuidFromTaskUuid) {
  const noteUUID = task.uuid ? (noteUuidFromTaskUuid.get(task.uuid) || null) : null;
  const isExisting = task.isExisting !== undefined ? task.isExisting : !!task.uuid;
  const sourceNoteName = noteUUID && noteNameFromNoteUuid
    ? (noteNameFromNoteUuid.get(noteUUID) || null)
    : null;
  return {
    ...task,
    noteUUID,
    isExisting,
    sourceNoteName,
  };
}

// Calculate how many new suggestions the next generation should request.
//
// @param {object} parsedOptions - Normalized analyze options.
// @param {number} cachedTaskCount - Number of cached tasks currently in note.
// @returns {{ requestedSuggestionCount: number }} Generation count request.
function _buildSuggestionRequest(parsedOptions, cachedTaskCount) {
  const minimumSuggestionCount = Math.max(1, parsedOptions.minimumTaskCount || 1);
  const missingSuggestionCount = Math.max(0, minimumSuggestionCount - cachedTaskCount);
  return {
    requestedSuggestionCount: parsedOptions.forceRefresh
      ? Math.max(MIN_SUGGESTION_REQUEST_COUNT, minimumSuggestionCount)
      : Math.max(MIN_SUGGESTION_REQUEST_COUNT, missingSuggestionCount),
  };
}

// Apply seen-UUID exclusion filtering to open tasks.
//
// @param {Array<object>} openTasks - Open tasks from active task domain.
// @param {Set<string>|null} excludeUuids - UUIDs that should be excluded.
// @returns {Array<object>} Candidate tasks to score and submit to LLM.
function _filterCandidateTasks(openTasks, excludeUuids) {
  const candidateTasks = excludeUuids && excludeUuids.size > 0
    ? openTasks.filter(task => !excludeUuids.has(task.uuid))
    : openTasks;
  logIfEnabled(`[dream-task] After exclusion: ${candidateTasks.length} candidate tasks (${openTasks.length - candidateTasks.length} excluded)`);
  return candidateTasks;
}

// Load quarterly/monthly/weekly planning context used by DreamTask prompting.
//
// @param {object} app - Amplenote app interface.
// @param {string} monthName - Current month display name.
// @param {string} existingContent - Existing note content for prior analyses context.
// @returns {Promise<object>} Plan slices and previous analyses text.
async function _loadPlanningContext(app, monthName, existingContent) {
  const quarter = getCurrentQuarter();
  const planName = `${quarter.label} Plan`;
  const planNotes = await app.filterNotes({ query: planName });
  const planNote = planNotes.find(note => note.name === planName);

  let quarterlyContent = null;
  let monthlyContent = null;
  let weeklyContent = null;
  if (planNote) {
    const fullPlanContent = await app.getNoteContent({ uuid: planNote.uuid });
    if (fullPlanContent) {
      quarterlyContent = fullPlanContent;
      monthlyContent = extractMonthSectionContent(fullPlanContent, monthName);
      const weekLabel = formatWeekLabel(getUpcomingWeekMonday());
      weeklyContent = extractMonthSectionContent(fullPlanContent, weekLabel);
    }
  }

  const previousAnalyses = existingContent
    ? existingContent.substring(0, MAX_PREVIOUS_ANALYSIS_CHARS)
    : null;
  return { quarterlyContent, monthlyContent, weeklyContent, previousAnalyses };
}

// [Claude] Task: isolate LLM request/validation path for DreamTask generation
// Prompt: "refactor analyzeDreamTasks into named helper methods"
// Date: 2026-03-24 | Model: gpt-5.3-codex
// Build prompt, call LLM, and normalize generated tasks.
//
// @param {object} params - Prompt inputs and generation options.
// @returns {Promise<object>} Generated tasks/goals summary or an error payload.
async function _generateSuggestionsFromLlm(params) {
  const {
    app,
    candidateTasks,
    dateHeading,
    dayName,
    isWeekend,
    noteUuidFromTaskUuid,
    planningContext,
    requestedSuggestionCount,
  } = params;
  const topTasks = _rankAndSelectTopTasks(candidateTasks);
  const taskJsonObjects = topTasks.map(task => _buildTaskJsonObject(task));
  logIfEnabled(`[dream-task] Selected ${taskJsonObjects.length} top tasks from ${candidateTasks.length} candidate tasks for LLM analysis`);
  const prompt = _buildPrompt({
    dateHeading, dayName, isWeekend, taskJsonObjects,
    quarterlyContent: planningContext.quarterlyContent,
    monthlyContent: planningContext.monthlyContent,
    weeklyContent: planningContext.weeklyContent,
    previousAnalyses: planningContext.previousAnalyses,
    openTaskCount: candidateTasks.length,
    requestedSuggestionCount,
  });
  let result;
  try {
    logIfEnabled("[dream-task] Sending prompt to LLM, length:", prompt.length);
    result = await llmPrompt(app, null, prompt, _buildLlmOptions(app));
  } catch (error) {
    logIfEnabled("[dream-task] LLM call failed:", error);
    const status = error.response?.status;
    if (status === HTTP_STATUS_UNAUTHORIZED || status === HTTP_STATUS_FORBIDDEN) {
      return {
        error: 'The API key appears to be invalid or unauthorized.',
        errorCode: 'invalid_api_key',
      };
    }
    return {
      error: `LLM request failed (${error.message || 'unknown error'}). Please try again later.`,
      errorCode: 'llm_error',
      errorDetail: error.message || null,
    };
  }
  if (!result || !result.tasks) {
    logIfEnabled("[dream-task] LLM returned invalid response:", result);
    const snippet = result ? JSON.stringify(result).substring(0, ERROR_SNIPPET_MAX_CHARS) : 'empty response';
    return {
      error: 'Unable to process the AI provider\'s response into task suggestions.',
      errorCode: 'parse_error',
      errorDetail: snippet,
    };
  }
  const validUuids = new Set(candidateTasks.map(t => t.uuid).filter(Boolean));
  const validated = _validateTasks(result.tasks, validUuids, requestedSuggestionCount);
  const enforcedTasks = _enforceExistingTaskMinimum(noteUuidFromTaskUuid, validated, topTasks);
  const goalsSummary = _validateGoalsSummary(result.goalsSummary);
  return {
    enforcedTasks,
    goalsSummary,
    llmAttributionFooter: _llmAttributionFooterFresh(app),
  };
}

// Construct LLM request options, including dev-token override behavior.
//
// @param {object} app - App bridge (reads LLM provider from settings).
// @returns {object} Options object for llmPrompt.
// [Claude claude-opus-4-6] Task: scope dev OPEN_AI_ACCESS_TOKEN override to OpenAI-only dashboard selection
// Prompt: "DreamTask uses OpenAI in spite of Sonnet being selected"
function _buildLlmOptions(app) {
  const llmOptions = { jsonResponse: true, timeoutSeconds: LLM_TIMEOUT_SECONDS };
  const providerEm = app.settings?.[SETTING_KEYS.LLM_PROVIDER_MODEL];
  const dashboardBucket = apiKeyBucketFromLlmProvider(providerEm);
  const devMayForceOpenAi = IS_DEV_ENVIRONMENT && process.env.OPEN_AI_ACCESS_TOKEN && dashboardBucket === "openai";
  if (devMayForceOpenAi) {
    llmOptions.aiModel = PROVIDER_DEFAULT_MODEL.openai;
    llmOptions.apiKey = process.env.OPEN_AI_ACCESS_TOKEN;
    logIfEnabled("[dream-task] Dev mode: using OPEN_AI_ACCESS_TOKEN with OpenAI (dashboard provider is OpenAI)");
  }
  return llmOptions;
}

// ----------------------------------------------------------------------------------------------
// @desc Same model string `llmPrompt` uses for DreamTask (keep aligned with fetch-ai-provider `llmPrompt`).
// [Claude claude-opus-4-6] Task: resolve model for attribution footer
// Prompt: "print which LLM provider generated the suggestions at the bottom of the widget"
function _dreamTaskResolvedModel(app) {
  const opts = _buildLlmOptions(app);
  let modelCandidates = preferredModels(app);
  const aiModel = opts.aiModel ?? null;
  if (aiModel) {
    modelCandidates = modelCandidates.filter(m => m !== aiModel);
    modelCandidates.unshift(aiModel);
  }
  return modelCandidates[0] ?? null;
}

// ----------------------------------------------------------------------------------------------
// @desc Footer line after a fresh LLM generation (provider display name + model id).
function _llmAttributionFooterFresh(app) {
  const model = _dreamTaskResolvedModel(app);
  if (!model) return null;
  try {
    const providerEm = providerFromModel(model);
    const name = providerNameFromProviderEm(providerEm);
    return `Generated by ${ name } · ${ model }`;
  } catch {
    return `Generated by ${ model }`;
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Parse `> Generated by …` line after the first batch separator (newest prepended batch is at top of file).
// Returns null when the note predates persisted attribution or the blockquote is missing.
// [Claude claude-opus-4-6] Task: normalize CRLF so attribution parses when the note store uses Windows line endings
function _extractLlmAttributionFromNewestNoteBatch(content) {
  if (!content || typeof content !== 'string') return null;
  const normalized = content.replace(/\r\n/g, '\n');
  const m = normalized.match(/\n---\s*\n\n>\s*([^\n]+)/);
  return m ? m[1].trim() : null;
}

// Prepend the latest generated batch to the persisted daily DreamTask note.
//
// @param {object} app - Amplenote app interface.
// @param {string} existingContent - Existing note markdown.
// @param {string|null} goalsSummary - Goals summary text.
// @param {string|null} llmAttributionFooter - Provider/model line persisted for cross-client display.
// @param {object} noteHandle - Note handle to update.
// @param {Array<object>} tasks - Newly generated tasks.
// @returns {Promise<void>}
async function _prependGeneratedSuggestionsToNote(app, existingContent, goalsSummary, llmAttributionFooter, noteHandle,
    tasks) {
  const suggestionBatchHeading = `DreamTask suggestions generated ${(new Date()).toLocaleString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })}`;
  const entryContent = _formatTasksForNote(suggestionBatchHeading, goalsSummary, llmAttributionFooter, tasks);
  const noteContent = _prependToNoteContent(entryContent, existingContent);
  try {
    await app.replaceNoteContent(noteHandle, noteContent);
    logIfEnabled("[dream-task] Prepended generated suggestions to daily note");
    logIfEnabled("[dream-task] Persisted LLM attribution in daily note (data store):", llmAttributionFooter ?? "(none)");
  } catch (error) {
    logIfEnabled("[dream-task] Failed to write to daily note:", error);
  }
}

// Build final analyze response after successful generation/prepend.
//
// @param {object} noteContext - Existing note context.
// @param {object} taskContext - Task mapping/default-note context.
// @param {object} generationResult - LLM generation result.
// @returns {object} Standard DreamTask analyze response payload.
function _buildFreshAnalyzeResult(noteContext, taskContext, generationResult) {
  const shownUuids = generationResult.enforcedTasks.filter(task => task.uuid).map(task => task.uuid);
  const { noteNameFromNoteUuid, noteUuidFromTaskUuid } = taskContext;
  const combinedTasks = [...generationResult.enforcedTasks, ...noteContext.cached.tasks]
    .map(task => _enrichTaskWithNoteContext(noteNameFromNoteUuid, task, noteUuidFromTaskUuid));
  return {
    tasks: combinedTasks,
    goalsSummary: generationResult.goalsSummary,
    cached: false,
    noteUUID: noteContext.noteHandle.uuid,
    defaultNoteUUID: taskContext.defaultNoteUUID,
    shownUuids,
    llmAttributionFooter: generationResult.llmAttributionFooter ?? null,
  };
}

// [Claude] Task: normalize DreamTask analyze options for backward compatibility
// Prompt: "switch analyze flow to options-based note persistence and reseed/resize behavior"
// Date: 2026-03-24 | Model: gpt-5.3-codex
function _normalizeAnalyzeOptions(options) {
  if (options instanceof Set) {
    return {
      excludeUuids: options,
      forceRefresh: false,
      minimumTaskCount: 1,
      noteName: `Dashboard proposed tasks for ${(new Date()).toLocaleString([], {
        year: "numeric",
        month: "long",
        day: "numeric",
      })}`,
      existingNoteHandle: null,
    };
  }

  const normalizedOptions = options && typeof options === "object" ? options : {};
  return {
    excludeUuids: normalizedOptions.excludeUuids instanceof Set ? normalizedOptions.excludeUuids : null,
    forceRefresh: !!normalizedOptions.forceRefresh,
    minimumTaskCount: Math.max(1, parseInt(normalizedOptions.minimumTaskCount, 10) || 1),
    noteName: normalizedOptions.noteName || `Dashboard proposed tasks for ${(new Date()).toLocaleString([], {
      year: "numeric",
      month: "long",
      day: "numeric",
    })}`,
    existingNoteHandle: normalizedOptions.existingNoteHandle || null,
  };
}

// [Claude] Task: prepend newly-generated suggestion block ahead of historical entries
// Prompt: "reseed and resize should prepend new suggestions while keeping previous suggestions lower"
// Date: 2026-03-24 | Model: gpt-5.3-codex
function _prependToNoteContent(entryContent, existingContent) {
  if (!existingContent || !existingContent.trim()) return entryContent;
  return `${entryContent}\n${existingContent.trim()}\n`;
}

// [Claude] Task: resolve active domain UUID from settings, falling back to app.getTaskDomains()
// Prompt: "domain is null because settings haven't been populated; fall back to getTaskDomains"
// Date: 2026-03-16 | Model: claude-4.6-opus-high-thinking
async function _getActiveDomainUuid(app) {
  const rawValue = app.settings[SETTING_KEYS.TASK_DOMAINS];
  const parsedSettings = rawValue ? JSON.parse(rawValue) : {};
  if (parsedSettings.selectedDomainUuid) return parsedSettings.selectedDomainUuid;

  const domains = await app.getTaskDomains();
  if (!domains || domains.length === 0) return null;
  const work = domains.find(d => d.name === "Work");
  return work ? work.uuid : domains[0].uuid;
}

// ---------------------------------------------------------------------------
// [Claude] Task: find the note with the most tasks for inserting invented tasks
// Prompt: "clicking on a non-existing task should create it in the note with the most tasks"
// Date: 2026-03-16 | Model: claude-4.6-opus-high-thinking
function _findBusiestNoteUUID(tasks) {
  const countByNote = {};
  for (const task of tasks) {
    if (task.noteUUID) {
      countByNote[task.noteUUID] = (countByNote[task.noteUUID] || 0) + 1;
    }
  }
  let maxCount = 0;
  let busiestUUID = null;
  for (const [uuid, count] of Object.entries(countByNote)) {
    if (count > maxCount) {
      maxCount = count;
      busiestUUID = uuid;
    }
  }
  return busiestUUID;
}

// [Claude] Task: parse goals summary and task entries from cached note section
// Prompt: "begin the date's content by summarizing quarter/month/week goals before the task list"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
// [Claude] Task: parse cached tasks including optional UUID metadata for existing tasks
// Prompt: "at least 50% of suggested tasks should be existing tasks from getTaskDomainTasks"
// Date: 2026-03-16 | Model: claude-4.6-opus-high-thinking
function _parseCachedTasks(sectionContent) {
  const tasks = [];
  const taskRegex = /### \d+\.\s+(.+?)\s+\(Rating:\s*(\d+)\/10\)\n([\s\S]*?)(?=\n### |\n---|$)/g;
  let regexMatch;
  while ((regexMatch = taskRegex.exec(sectionContent)) !== null) {
    const body = regexMatch[3];
    const uuidMatch = body.match(/<!-- task:(\S+) -->/) || body.match(/\*\[task:([^\]]+)\]\*/);
    const uuid = uuidMatch ? uuidMatch[1] : null;
    const explanation = body
      .replace(/<!-- task:\S+ -->\n?/g, '')
      .replace(/\*\[task:[^\]]+\]\*\n?/g, '')
      .trim();
    tasks.push({
      title: regexMatch[1].trim(),
      rating: parseInt(regexMatch[2], 10),
      uuid,
      isExisting: !!uuid,
      explanation,
    });
  }

  let goalsSummary = null;
  const firstTaskIndex = sectionContent.search(/### \d+\./);
  if (firstTaskIndex > 0) {
    const preamble = sectionContent.substring(0, firstTaskIndex).trim();
    const summaryMatch = preamble.match(/\*\*Your goals this quarter\/month\/week:\*\*\s*([\s\S]*)/);
    if (summaryMatch) {
      goalsSummary = summaryMatch[1].trim();
    }
  }

  return { tasks, goalsSummary };
}

// ---------------------------------------------------------------------------
// [Claude] Task: validate LLM task results and mark existing tasks by UUID
// Prompt: "at least 50% of suggested tasks should be existing tasks from getTaskDomainTasks"
// Date: 2026-03-16 | Model: claude-4.6-opus-high-thinking
function _validateTasks(tasks, validUuids, maxTaskCount = DEFAULT_VALIDATED_TASK_LIMIT) {
  if (!Array.isArray(tasks)) return [];
  return tasks
    .filter(task => task && typeof task.title === 'string' && task.title.trim().length > 0)
    .map(task => {
      const uuid = task.uuid && validUuids && validUuids.has(task.uuid) ? task.uuid : null;
      return {
        title: String(task.title).trim(),
        explanation: String(task.explanation || '').trim(),
        rating: Math.min(RATING_MAX, Math.max(RATING_MIN, parseInt(task.rating, 10) || RATING_DEFAULT)),
        uuid,
        isExisting: !!uuid,
      };
    })
    .slice(0, Math.max(1, maxTaskCount));
}

// ---------------------------------------------------------------------------
function _validateGoalsSummary(summary) {
  if (!summary || typeof summary !== 'string') return null;
  const trimmed = summary.trim();
  if (!trimmed) return null;
  return trimmed.substring(0, MAX_GOALS_SUMMARY_CHARS);
}

// ---------------------------------------------------------------------------
// [Claude] Task: ensure at least 50% of suggested tasks are existing tasks from the task domain
// Prompt: "at least 50% of suggested tasks should be existing tasks from getTaskDomainTasks"
// Date: 2026-03-16 | Model: claude-4.6-opus-high-thinking
function _enforceExistingTaskMinimum(noteUuidFromTaskUuid, tasks, topTasks) {
  const existingCount = tasks.filter(t => t.isExisting).length;
  const requiredExisting = Math.ceil(tasks.length * EXISTING_TASK_MIN_RATIO);

  if (existingCount >= requiredExisting) {
    return tasks.map(t => ({
      ...t,
      noteUUID: t.uuid ? (noteUuidFromTaskUuid.get(t.uuid) || null) : null,
    }));
  }

  const usedUuids = new Set(tasks.filter(t => t.uuid).map(t => t.uuid));
  const supplementalTasks = topTasks
    .filter(t => t.uuid && !usedUuids.has(t.uuid))
    .slice(0, requiredExisting - existingCount)
    .map(t => ({
      title: t.content || 'Untitled task',
      explanation: 'Highly-ranked task from your task list that aligns with your current priorities.',
      rating: SUPPLEMENTAL_TASK_RATING,
      uuid: t.uuid,
      isExisting: true,
      noteUUID: noteUuidFromTaskUuid.get(t.uuid) || null,
    }));

  const result = [...tasks].map(t => ({
    ...t,
    noteUUID: t.uuid ? (noteUuidFromTaskUuid.get(t.uuid) || null) : null,
  }));

  const inventedIndices = result
    .map((t, i) => ({ index: i, rating: t.rating, isExisting: t.isExisting }))
    .filter(entry => !entry.isExisting)
    .sort((a, b) => a.rating - b.rating);

  for (let i = 0; i < supplementalTasks.length && i < inventedIndices.length; i++) {
    result[inventedIndices[i].index] = supplementalTasks[i];
  }

  return result;
}

// ---------------------------------------------------------------------------
// [Claude] Task: rank open tasks by urgency/importance/score/deadline to select top candidates for LLM
// Prompt: "consider all task attributes, send top 10% or 50 (whichever smaller) as JSON to LLM"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
function _rankAndSelectTopTasks(openTasks) {
  const scored = openTasks.map(task => {
    let rank = 0;
    const taskScore = task.score ?? task.victoryValue ?? 0;

    if (task.important) rank += RANK_IMPORTANT;
    if (task.urgent) rank += RANK_URGENT;
    if (taskScore > SCORE_THRESHOLD_HIGH) rank += RANK_HIGH_SCORE;
    else if (taskScore > SCORE_THRESHOLD_MEDIUM) rank += RANK_MEDIUM_SCORE;

    if (task.deadline) {
      const nowSeconds = Date.now() / 1000;
      const deadlineSeconds = task.deadline < EPOCH_SECONDS_THRESHOLD ? task.deadline : task.deadline / 1000;
      const daysUntil = (deadlineSeconds - nowSeconds) / SECONDS_PER_DAY;
      if (daysUntil < 0) rank += RANK_OVERDUE;
      else if (daysUntil <= DAYS_THRESHOLD_TOMORROW) rank += RANK_DUE_TOMORROW;
      else if (daysUntil <= DAYS_THRESHOLD_SOON) rank += RANK_DUE_WITHIN_3_DAYS;
      else if (daysUntil <= DAYS_THRESHOLD_WEEK) rank += RANK_DUE_THIS_WEEK;
    }

    if (task.startAt) {
      const nowSeconds = Date.now() / 1000;
      const startSeconds = task.startAt < EPOCH_SECONDS_THRESHOLD ? task.startAt : task.startAt / 1000;
      if (startSeconds <= nowSeconds) rank += RANK_ALREADY_STARTED;
      else if ((startSeconds - nowSeconds) / SECONDS_PER_DAY <= DAYS_THRESHOLD_TOMORROW) rank += RANK_STARTING_TOMORROW;
    }

    rank += Math.min(taskScore, RANK_SCORE_CAP);

    return { task, rank };
  });

  scored.sort((first, second) => second.rank - first.rank);
  const limit = Math.min(Math.ceil(openTasks.length * TOP_TASKS_RATIO), MAX_TASKS_IN_PROMPT);
  return scored.slice(0, Math.max(limit, MIN_TOP_TASKS)).map(scoredEntry => scoredEntry.task);
}

// ---------------------------------------------------------------------------
// [Claude] Task: build a JSON representation of a task for LLM evaluation per Amplenote task type
// Prompt: "send a JSON for each task to the LLM — https://www.amplenote.com/help/developing_amplenote_plugins/appendix_i#task"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
// [Claude] Task: expand abbreviated variable/method names for clarity
// Date: 2026-03-14
function _buildTaskJsonObject(task) {
  const taskJsonObject = { content: task.content, uuid: task.uuid };
  if (task.important) taskJsonObject.important = true;
  if (task.urgent) taskJsonObject.urgent = true;
  const score = task.score ?? task.victoryValue;
  if (score != null) taskJsonObject.score = score;
  if (task.deadline) {
    taskJsonObject.deadline = task.deadline;
    taskJsonObject.deadlineFormatted = new Date(task.deadline < EPOCH_SECONDS_THRESHOLD ? task.deadline * 1000 : task.deadline)
      .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }
  if (task.startAt) {
    taskJsonObject.startAt = task.startAt;
    taskJsonObject.startAtFormatted = new Date(task.startAt < EPOCH_SECONDS_THRESHOLD ? task.startAt * 1000 : task.startAt)
      .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }
  if (task.hideUntil) {
    taskJsonObject.hiddenUntilFormatted = new Date(task.hideUntil < EPOCH_SECONDS_THRESHOLD ? task.hideUntil * 1000 : task.hideUntil)
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  if (task.isRepeating) taskJsonObject.isRepeating = true;
  return taskJsonObject;
}

// ---------------------------------------------------------------------------
function _buildPrompt({ dateHeading, dayName, isWeekend, taskJsonObjects,
    quarterlyContent, monthlyContent, weeklyContent, previousAnalyses, openTaskCount, requestedSuggestionCount }) {
  let prompt = `You are a productivity coach analyzing a user's task list and goals to suggest the most impactful tasks for today.

Today is ${dateHeading}.`;

  if (isWeekend) {
    prompt += `\nIt is ${dayName} — a weekend day. Lean toward creative, exploratory, or enjoyable tasks that still advance the user's goals. Fun side-projects, learning, and reflection are great weekend picks.`;
  } else {
    prompt += `\nIt is ${dayName} — a weekday. Prioritize high-impact, goal-advancing work that moves important projects forward.`;
  }

  if (quarterlyContent) {
    prompt += `\n\n## User's Quarterly Plan\n${quarterlyContent.substring(0, MAX_QUARTERLY_CONTENT_CHARS)}`;
  } else {
    prompt += `\n\n## User's Quarterly Plan\nNo quarterly plan found.`;
  }

  if (monthlyContent) {
    prompt += `\n\n## User's Monthly Focus\n${monthlyContent.substring(0, MAX_MONTHLY_CONTENT_CHARS)}`;
  }

  if (weeklyContent) {
    prompt += `\n\n## User's Weekly Plan\n${weeklyContent.substring(0, MAX_WEEKLY_CONTENT_CHARS)}`;
  }

  if (previousAnalyses) {
    prompt += `\n\n## Previous Task Suggestions This Month (avoid repeating these verbatim)\n${previousAnalyses}`;
  }

  prompt += `\n\n## Top Candidate Tasks (${openTaskCount} open total, ${taskJsonObjects.length} highest-ranked shown as JSON)\n`;
  if (taskJsonObjects.length > 0) {
    prompt += `Each task object follows the Amplenote task type schema. The "score" field reflects how long the task has been accumulating value — higher scores indicate tasks that have been waiting longer or are overdue. Tasks marked "important" or "urgent" deserve special consideration.\n\n`;
    prompt += taskJsonObjects.map(task => JSON.stringify(task)).join('\n');
  } else {
    prompt += 'No open tasks found.';
  }

  prompt += `

Your response must include two parts:

1. **goalsSummary**: A concise summary of the user's known goals for this quarter, month, and week. Write at least one sentence per time horizon that has content available (quarter, month, week). Maximum 5 sentences and ${MAX_GOALS_SUMMARY_CHARS} characters total. If a time horizon has no plan, note that briefly. This summary captures the essence of what the user is seeking to accomplish in the near term.

2. **tasks**: exactly ${requestedSuggestionCount} tasks that are especially well-aligned with those goals. **At least half of the tasks MUST be existing tasks chosen from the candidate list above** — include their exact "uuid" from the JSON objects. The remaining tasks should be your own invented suggestions inspired by the user's quarterly, monthly, and weekly goals and appropriate for ${dayName}. For each task provide:
   - A clear, actionable task title (for existing tasks, you may rephrase the content for clarity)
   - A 2-3 sentence explanation of why this task deserves attention today, referencing specific goals and the day of the week
   - A rating from 1-10 for how relevant and impactful this task is right now
   - "uuid": the exact UUID string from the candidate list if this is an existing task, or null if this is a new suggestion

Return ONLY valid JSON in this exact format (no markdown fences):
{"goalsSummary":"Summary of quarter/month/week goals...","tasks":[{"title":"Task title","explanation":"Why this task matters today...","rating":8,"uuid":"existing-task-uuid-or-null"}]}`;

  return prompt;
}

// ---------------------------------------------------------------------------
// [Claude] Task: format note content with goals summary preceding the task list
// [Claude] Task: append LLM attribution after batch separator so parsers and other apps can show it
// Prompt: "write the LLM that was used in the note for cross-platform attribution"
function _formatTasksForNote(batchHeading, goalsSummary, llmAttributionFooter, tasks) {
  let content = `## ${batchHeading}\n\n`;
  if (goalsSummary) {
    content += `**Your goals this quarter/month/week:**\n${goalsSummary}\n\n`;
  }
  tasks.forEach((task, index) => {
    content += `### ${index + 1}. ${task.title} (Rating: ${task.rating}/10)\n`;
    if (task.uuid) {
      content += `<!-- task:${task.uuid} -->\n`;
    }
    content += `${task.explanation}\n\n`;
  });
  content += '---\n\n';
  if (llmAttributionFooter) {
    content += `> ${ llmAttributionFooter }\n\n`;
  }
  return content;
}
