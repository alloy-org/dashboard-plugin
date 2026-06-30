// [Claude claude-opus-4-8 (1M context)-authored file]
// Prompt summary: "create a proposed-agenda component that retrieves recent task-domain tasks, submits them with
//   the quarterly plan to an LLM, and asks for an hour-by-hour schedule with >=1hr gaps; each activity gets a
//   schedule-at link and the agenda gets an approve button"
import { getCurrentQuarter } from "constants/quarters";
import { DASHBOARD_NOTE_TAG, SETTING_KEYS, apiKeyBucketFromLlmProvider,
  apiKeyFromProvider, devLlmOverride } from "constants/settings";
import { PROVIDER_DEFAULT_MODEL } from "constants/llm-providers";
import { pluginSettings } from "plugin-data";
import { loadCachedProposedAgenda, storeProposedAgenda } from "proposed-agenda-archive";
import { priorityOptionFromKey } from "proposed-agenda-priority";
import { AMPLE_AGENT_PRO_NOTE_NAME } from "providers/ai-provider-settings";
import { llmPromptWithPluginFallback } from "providers/fetch-ai-provider";
import { fetchDomainOrAllNotesTasks } from "util/all-notes-tasks";
import { logIfEnabled } from "util/log";

// Task-retrieval volume rules (see _selectRelevantTasks):
const MIN_RECENT_TASKS = 200;
const MAX_TASKS = 1_000;
const RECENT_WINDOW_DAYS = 30;
const MAX_TASK_TEXT_CHARS = 200;

const EPOCH_SECONDS_THRESHOLD = 1e10;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SECONDS_PER_MINUTE = 60;

const LLM_TIMEOUT_SECONDS = 60;
const MAX_QUARTERLY_PLAN_CHARS = 4_000;
const MIN_GAP_MINUTES = 60;
const ERROR_SNIPPET_MAX_CHARS = 200;
const HTTP_STATUS_UNAUTHORIZED = 401;
const HTTP_STATUS_FORBIDDEN = 403;

// After this local hour the working day is effectively over, so the proposed agenda targets the next day.
const NEXT_DAY_CUTOFF_HOUR = 16;

// Day-of-week indices (Date.getDay): the agenda skips these to the following Monday.
const SUNDAY = 0;
const SATURDAY = 6;

// ----------------------------------------------------------------------------------------------
// @desc Top-level entry: gather the relevant task domain, load the quarterly plan, and ask the configured
//   LLM to propose an hour-by-hour schedule that leaves at least one hour between activities.
// @param {object} app - Amplenote app bridge.
// @param {object} [options={}]
// @param {string|null} [options.aiModelOverride] - Explicit model id to send to the LLM, bypassing the
//   provider-default model resolution. Primarily a testing seam so integration tests can pin a cheap model.
// @param {string|null} [options.priorityKey] - "Today's priority" lens key; biases task selection and prompt.
// @param {Array<object>} [options.obligations] - Already-scheduled today tasks/events the schedule must work
//   around (immovable). Derived by the widget before the LLM is ever called.
// @param {string|null} [options.providerEmOverride] - LLM provider enum to use instead of dashboard selection.
// @param {boolean} [options.forceRegenerate] - When true, bypass the cached record for this date+priority+LLM
//   and call the LLM afresh (then replace the stored record). Used by "Reseed".
// @param {Date|null} [options.targetDate] - Explicit day to schedule for, bypassing auto-resolution (4pm cutoff
//   + weekend→Monday skip). Primarily a testing seam so tests can pin the scheduled day without mocking the
//   global clock. When omitted, the day is resolved from the current local time.
// @returns {Promise<{activities: Array<object>, dateLabel: string, dayWord: string, isFutureDay: boolean,
//   fromCache: boolean, providerEm: string, dismissedKeys?: Array<string>, scheduledKeys?: Array<string>,
//   llmAttributionFooter: string|null}|{activities: [], error: string, errorCode: string, errorDetail?: string}>}
// [Claude claude-opus-4-8 (1M context)] Task: build proposed-agenda generation entry point
// Prompt: "submit task array + quarterly plan to an LLM asking for an hour-by-hour schedule"
// [Claude claude-opus-4-8 (1M context)] Task: serve identical requests from the monthly archived note before the LLM
// Prompt: "Before calling to an LLM, check if the LLM+date+priority already exists within our data note"
// [Claude claude-opus-4-8 (1M context)] Task: target the next working day after the 4pm cutoff / weekends
// Prompt: "after 4pm schedule the following day; on the weekend schedule for Monday"
export async function generateProposedAgenda(app, { aiModelOverride = null, forceRegenerate = false, obligations = [],
    priorityKey = null, providerEmOverride = null, targetDate: targetDateOverride = null } = {}) {
  const targetDate = targetDateOverride ? _localMidnight(targetDateOverride) : resolveProposedAgendaDate();
  const dateLabel = targetDate.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  // The target day may be today, tomorrow, or further out (e.g. Friday-evening/weekend runs resolve to Monday),
  // so describe it relative to today rather than assuming "tomorrow".
  const dayWord = _relativeDayWord(targetDate);
  const isFutureDay = !_isSameLocalDay(targetDate, new Date());
  const priorityOption = priorityOptionFromKey(priorityKey);
  const providerEm = _resolveProviderEm(providerEmOverride);
  logIfEnabled("[proposed-agenda] generateProposedAgenda entry", { dateLabel, dayWord, isFutureDay,
    priority: priorityOption.key, obligationCount: obligations.length, providerEm, forceRegenerate });

  if (!forceRegenerate) {
    const cached = await loadCachedProposedAgenda(app, { date: targetDate, priorityKey: priorityOption.key, providerEm })
      .catch(error => { logIfEnabled("[proposed-agenda] cache lookup failed", error?.message); return null; });
    if (cached) return { activities: cached.activities, dateLabel, dayWord, isFutureDay,
      dismissedKeys: cached.dismissedKeys, fromCache: true, llmAttributionFooter: cached.llmAttributionFooter,
      providerEm, scheduledKeys: cached.scheduledKeys };
  }

  const tasks = await _selectRelevantTasks(app, priorityOption, targetDate);
  const quarterlyContent = await _loadQuarterlyPlanContent(app);
  logIfEnabled("[proposed-agenda] context loaded", { taskCount: tasks.length, quarterlyChars: quarterlyContent?.length ?? 0 });

  if (tasks.length === 0) {
    return { activities: [], error: "No tasks found available to schedule in Task Domain.", errorCode: "no_tasks" };
  }

  const result = await _generateScheduleFromLlm(app, { aiModelOverride, dateLabel, dayWord, isFutureDay, obligations,
    priorityOption, providerEmOverride, quarterlyContent, targetDate, tasks });
  if (!result.error && Array.isArray(result.activities) && result.activities.length > 0) {
    await storeProposedAgenda(app, { activities: result.activities, date: targetDate,
      llmAttributionFooter: result.llmAttributionFooter, priorityKey: priorityOption.key, providerEm }).catch(
      error => logIfEnabled("[proposed-agenda] failed to store record", error?.message));
  }
  return { ...result, fromCache: false, providerEm };
}

// ----------------------------------------------------------------------------------------------
// @desc Human phrase for the target day relative to today: "today", "tomorrow", or otherwise the weekday name
//   (e.g. "on Monday") since the resolved day can be several days out after weekend/after-hours skips.
// @param {Date} targetDate - Local midnight of the day the agenda is for.
// @param {Date} [now=new Date()] - Reference "now".
// @returns {string}
// [Claude claude-opus-4-8 (1M context)] Task: describe the scheduled day correctly when it is past "tomorrow"
function _relativeDayWord(targetDate, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const dayDelta = Math.round((targetDate.getTime() - today.getTime()) / MS_PER_DAY);
  if (dayDelta <= 0) return "today";
  if (dayDelta === 1) return "tomorrow";
  return `on ${ targetDate.toLocaleDateString([], { weekday: "long" }) }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Resolve which calendar day the agenda is for: today normally, but the next day once the local time is
//   at or past NEXT_DAY_CUTOFF_HOUR (4pm), since there's no longer a meaningful working day left to schedule.
//   Any resulting Saturday/Sunday is then rolled forward to the following Monday so weekend runs schedule the
//   next working day.
// @param {Date} [now=new Date()] - Reference "now"; injectable so tests can pin the resolution without mocking
//   the global clock.
// @returns {Date} Local Date at midnight of the target working day.
// [Claude claude-opus-4-8 (1M context)] Task: target tomorrow's agenda after the 4pm cutoff, skipping weekends
// Prompt: "after 4pm schedule the following day; on the weekend schedule for Monday"
export function resolveProposedAgendaDate(now = new Date()) {
  const dayOffset = now.getHours() >= NEXT_DAY_CUTOFF_HOUR ? 1 : 0;
  const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, 0, 0, 0);
  return _skipWeekendToMonday(candidate);
}

// ----------------------------------------------------------------------------------------------
// @desc Roll a Saturday or Sunday forward to the following Monday; any weekday is returned unchanged.
// @param {Date} day - Local midnight of a candidate day.
// @returns {Date} Local midnight of the next working day (Mon–Fri).
// [Claude claude-opus-4-8 (1M context)] Task: skip weekends to Monday for the proposed agenda
function _skipWeekendToMonday(day) {
  const weekday = day.getDay();
  const advanceDays = weekday === SATURDAY ? 2 : (weekday === SUNDAY ? 1 : 0);
  if (advanceDays === 0) return day;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + advanceDays, 0, 0, 0);
}

// ----------------------------------------------------------------------------------------------
// @desc Normalize any Date to local midnight of the same calendar day (drops the time component).
// @param {Date} date - Source date.
// @returns {Date} Local Date at 00:00 of that day.
// [Claude claude-opus-4-8 (1M context)] Task: normalize an explicit target-date override to local midnight
function _localMidnight(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
}

// ----------------------------------------------------------------------------------------------
// @desc Whether two dates fall on the same local calendar day.
// @param {Date} a
// @param {Date} b
// @returns {boolean}
function _isSameLocalDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// ----------------------------------------------------------------------------------------------
// @desc Retrieve the relevant slice of the active task domain following the volume rules: prefer all tasks
//   in notes updated within the past month, but always include at least the 200 most-recent open tasks,
//   capped at 1,000 total. For the "barnacle cleanup" priority the ordering flips to surface the stalest tasks
//   in the busiest notes first. Tasks already scheduled (startAt) on the target day are always included and
//   flagged so the LLM can plan around them as fixed commitments. Returns compact records ({ ageDays, duration,
//   important, noteOpenCount, noteUuid, scheduledOnTarget, taskText, taskUuid }).
// @param {object} app - Amplenote app bridge.
// @param {object} priorityOption - Resolved priority option ({ barnacle?, key, ... }).
// @param {Date} targetDate - Local midnight of the day the agenda is being built for.
// @returns {Promise<Array<object>>} Compact task records.
// [Claude claude-opus-4-8 (1M context)] Task: gather task-domain tasks per the volume rules, priority-aware
// Prompt: "retrieve at least 200 most recent tasks ... barnacle priority prefers notes with hundreds of open tasks"
// [Claude claude-opus-4-8 (1M context)] Task: always include the target day's already-scheduled commitments
// Prompt: "look up/derive the task and events for the target day before we query the LLM"
async function _selectRelevantTasks(app, priorityOption, targetDate) {
  const domainUuid = await _activeDomainUuid(app);
  const allTasks = await fetchDomainOrAllNotesTasks(app, domainUuid);
  const openTasks = (Array.isArray(allTasks) ? allTasks : []).filter(task => task && !task.completedAt && !task.dismissedAt);
  const noteOpenCounts = _noteOpenCounts(openTasks);
  const sortedByRecency = openTasks.slice().sort((a, b) => _taskRecencySeconds(b) - _taskRecencySeconds(a));

  const cutoffSeconds = Math.floor((Date.now() - RECENT_WINDOW_DAYS * MS_PER_DAY) / 1000);
  const recentTasks = sortedByRecency.filter(task => _taskRecencySeconds(task) >= cutoffSeconds);
  // Take whichever set is larger (recent-window vs. minimum-200), then cap at MAX_TASKS.
  const targetCount = Math.min(MAX_TASKS, Math.max(recentTasks.length, MIN_RECENT_TASKS));
  const ordered = priorityOption?.barnacle ? _barnacleOrder(openTasks, noteOpenCounts) : sortedByRecency;
  // Always include tasks already scheduled on the target day, even if outside the recency/priority cut, so the
  // LLM sees the day's existing commitments ("events") and schedules around them.
  const scheduledOnTarget = sortedByRecency.filter(task => _isScheduledOnDay(task, targetDate));
  const selected = _dedupeTasks([...ordered.slice(0, targetCount), ...scheduledOnTarget]);
  logIfEnabled("[proposed-agenda] _selectRelevantTasks", { barnacle: !!priorityOption?.barnacle, domainUuid,
    openTaskCount: openTasks.length, recentWindowCount: recentTasks.length,
    scheduledOnTargetCount: scheduledOnTarget.length, selectedCount: selected.length });
  return selected.map(task => _compactTaskRecord(task, noteOpenCounts, targetDate)).filter(Boolean);
}

// ----------------------------------------------------------------------------------------------
// @desc De-duplicate tasks by uuid, preserving first-seen order.
// @param {Array<object>} tasks - Native Amplenote task objects (may contain duplicates).
// @returns {Array<object>}
// [Claude claude-opus-4-8 (1M context)] Task: avoid double-listing tasks that are both recent and scheduled
function _dedupeTasks(tasks) {
  const seen = new Set();
  return tasks.filter(task => {
    if (!task?.uuid || seen.has(task.uuid)) return false;
    seen.add(task.uuid);
    return true;
  });
}

// ----------------------------------------------------------------------------------------------
// @desc Whether a task is scheduled (has a startAt) that lands on the given local calendar day.
// @param {object} task - Native Amplenote task object.
// @param {Date} day - Local midnight of the day in question.
// @returns {boolean}
// [Claude claude-opus-4-8 (1M context)] Task: identify the target day's existing scheduled commitments
function _isScheduledOnDay(task, day) {
  if (!task?.startAt) return false;
  const startMs = task.startAt < EPOCH_SECONDS_THRESHOLD ? task.startAt * 1000 : task.startAt;
  return _isSameLocalDay(new Date(startMs), day);
}

// ----------------------------------------------------------------------------------------------
// @desc Count open tasks per owning note, so "barnacle" selection can favor tasks in high-backlog notes.
// @param {Array<object>} openTasks - Open native task objects.
// @returns {Map<string, number>} noteUUID ? open-task count.
function _noteOpenCounts(openTasks) {
  const counts = new Map();
  for (const task of openTasks) {
    const noteUuid = task.noteUUID || null;
    if (!noteUuid) continue;
    counts.set(noteUuid, (counts.get(noteUuid) || 0) + 1);
  }
  return counts;
}

// ----------------------------------------------------------------------------------------------
// @desc Order tasks for the "barnacle cleanup" focus: stalest first (oldest creation), with ties broken by
//   the owning note's open-task count so backlogs in the hundreds rise to the top.
// @param {Array<object>} openTasks - Open native task objects.
// @param {Map<string, number>} noteOpenCounts - noteUUID ? open-task count.
// @returns {Array<object>} Tasks ordered most-barnacle-like first.
// [Claude claude-opus-4-8 (1M context)] Task: rank tasks by staleness + note backlog for barnacle cleanup
function _barnacleOrder(openTasks, noteOpenCounts) {
  const score = task => (noteOpenCounts.get(task.noteUUID || "") || 0) * 1e6 - _taskRecencySeconds(task) / 1e4;
  return openTasks.slice().sort((a, b) => score(b) - score(a));
}

// ----------------------------------------------------------------------------------------------
// @desc Reduce a native Amplenote task to the compact record submitted to the LLM. Drops tasks with no text.
//   Flags tasks already scheduled on the target day so the LLM treats them as fixed commitments.
// @param {object} task - Native Amplenote task object.
// @param {Map<string, number>} noteOpenCounts - noteUUID ? open-task count (for barnacle signal).
// @param {Date} targetDate - Local midnight of the day the agenda is for.
// @returns {object|null} Compact record, or null when the task has no text/uuid.
// [Claude claude-opus-4-8 (1M context)] Task: shape compact task records with age + note-backlog signals
// [Claude claude-opus-4-8 (1M context)] Task: flag tasks already scheduled on the target day
function _compactTaskRecord(task, noteOpenCounts, targetDate) {
  const taskText = String(task.content || "").replace(/\s+/g, " ").trim().substring(0, MAX_TASK_TEXT_CHARS);
  if (!taskText || !task.uuid) return null;
  const noteUuid = task.noteUUID || null;
  return { ageDays: _taskAgeDays(task), duration: task.duration ?? null, important: !!task.important,
    noteOpenCount: noteUuid ? (noteOpenCounts.get(noteUuid) || 0) : 0, noteUuid,
    scheduledOnTarget: _isScheduledOnDay(task, targetDate), taskText, taskUuid: task.uuid };
}

// ----------------------------------------------------------------------------------------------
// @desc Whole-day age of a task from its creation time (how long it has lingered), or null when unknown.
// @param {object} task - Native Amplenote task object.
// @returns {number|null}
function _taskAgeDays(task) {
  const createdSeconds = _normalizeSeconds(task?.createdAt);
  if (!createdSeconds) return null;
  return Math.max(0, Math.floor((Date.now() / 1000 - createdSeconds) / (MS_PER_DAY / 1000)));
}

// ----------------------------------------------------------------------------------------------
// @desc Normalize a possibly-ms timestamp to Unix seconds (0 when falsy).
// @param {number|null} raw
// @returns {number}
function _normalizeSeconds(raw) {
  if (!raw) return 0;
  return raw < EPOCH_SECONDS_THRESHOLD ? raw : Math.floor(raw / 1000);
}

// ----------------------------------------------------------------------------------------------
// @desc Best-available recency timestamp (Unix seconds) for ordering: updatedAt, else startAt, else 0.
// @param {object} task - Native Amplenote task object.
// @returns {number} Unix seconds.
function _taskRecencySeconds(task) {
  const raw = task?.updatedAt ?? task?.startAt ?? task?.createdAt ?? 0;
  if (!raw) return 0;
  return raw < EPOCH_SECONDS_THRESHOLD ? raw : Math.floor(raw / 1000);
}

// ----------------------------------------------------------------------------------------------
// @desc Resolve the active task domain UUID from settings, falling back to a "Work" domain or the first one.
// @param {object} app - Amplenote app bridge.
// @returns {Promise<string|null>}
// [Claude claude-opus-4-8 (1M context)] Task: resolve active task domain (mirrors dream-task-service)
async function _activeDomainUuid(app) {
  const rawValue = pluginSettings()[SETTING_KEYS.TASK_DOMAINS];
  const parsedSettings = rawValue ? JSON.parse(rawValue) : {};
  if (parsedSettings.selectedDomainUuid) return parsedSettings.selectedDomainUuid;
  const domains = await app.getTaskDomains().catch(() => null);
  // Defensive: a CORS-degraded account-settings read can resolve getTaskDomains() to a non-array, which would
  // make `.find()` below throw "find is not a function" and crash generation. Treat anything non-array as empty.
  if (!Array.isArray(domains) || domains.length === 0) return null;
  const work = domains.find(domain => domain.name === "Work");
  return work ? work.uuid : domains[0].uuid;
}

// ----------------------------------------------------------------------------------------------
// @desc Load the current quarter's plan note content (e.g. "Q3 2026 Plan"), truncated for prompt budget.
// @param {object} app - Amplenote app bridge.
// @returns {Promise<string|null>}
// [Claude claude-opus-4-8 (1M context)] Task: load quarterly plan content for the schedule prompt
async function _loadQuarterlyPlanContent(app) {
  const planName = `${ getCurrentQuarter().label } Plan`;
  const planNotes = await app.filterNotes({ query: planName });
  const planNote = (planNotes || []).find(note => note.name === planName);
  if (!planNote) return null;
  const content = await app.getNoteContent({ uuid: planNote.uuid });
  return content ? content.substring(0, MAX_QUARTERLY_PLAN_CHARS) : null;
}

// ----------------------------------------------------------------------------------------------
// @desc Build the prompt, call the LLM (with Ample Agent Pro fallback), and validate the proposed schedule.
// @param {object} app - Amplenote app bridge.
// @param {object} params - { aiModelOverride, dateLabel, obligations, priorityOption, providerEmOverride,
//   quarterlyContent, tasks }.
// @returns {Promise<object>} Schedule payload or structured error.
// [Claude claude-opus-4-8 (1M context)] Task: request and validate an hour-by-hour schedule from the LLM
async function _generateScheduleFromLlm(app, { aiModelOverride, dateLabel, dayWord, isFutureDay, obligations = [],
    priorityOption, providerEmOverride, quarterlyContent, targetDate, tasks }) {
  const configuredProviderEm = providerEmOverride || pluginSettings()[SETTING_KEYS.LLM_PROVIDER_MODEL];
  const hasConfiguredProvider = !!configuredProviderEm && configuredProviderEm !== "none";
  if (!hasConfiguredProvider) {
    const ampleAgentNote = await app.findNote({ name: AMPLE_AGENT_PRO_NOTE_NAME });
    if (!ampleAgentNote) {
      return { activities: [], error: "No AI provider configured. Please select a provider in plugin settings.",
        errorCode: "no_provider_configured" };
    }
  }

  const prompt = _buildSchedulePrompt({ dateLabel, isFutureDay, obligations, priorityOption, quarterlyContent,
    targetDate, tasks });
  const llmStart = performance.now();
  let result;
  try {
    logIfEnabled("[proposed-agenda] sending prompt to LLM, length:", prompt.length);
    const { aiModel, apiKey, jsonResponse, timeoutSeconds } = _llmOptions(providerEmOverride, aiModelOverride);
    result = await llmPromptWithPluginFallback(app, prompt, { aiModel, apiKey, jsonResponse, timeoutSeconds });
    logIfEnabled("[proposed-agenda] LLM returned", { durationMs: Number((performance.now() - llmStart).toFixed(1)),
      activityCount: Array.isArray(result?.activities) ? result.activities.length : null });
  } catch (error) {
    logIfEnabled("[proposed-agenda] LLM call threw", { message: error?.message, status: error?.response?.status });
    const status = error.response?.status;
    if (status === HTTP_STATUS_UNAUTHORIZED || status === HTTP_STATUS_FORBIDDEN) {
      return { activities: [], error: "The API key appears to be invalid or unauthorized.",
        errorCode: "invalid_api_key" };
    }
    return { activities: [], error: `LLM request failed (${ error.message || "unknown error" }).`,
      errorCode: "llm_error", errorDetail: error.message || null };
  }

  if (!result || !Array.isArray(result.activities)) {
    const snippet = result ? JSON.stringify(result).substring(0, ERROR_SNIPPET_MAX_CHARS) : "empty response";
    return { activities: [], error: "Unable to process the AI provider's response into a schedule.",
      errorCode: "parse_error", errorDetail: snippet };
  }

  const validUuids = new Set(tasks.map(task => task.taskUuid));
  const noteUuidFromTaskUuid = new Map(tasks.map(task => [task.taskUuid, task.noteUuid]));
  const activities = _validateActivities(result.activities, validUuids, noteUuidFromTaskUuid, targetDate);
  return { activities, dateLabel, dayWord, isFutureDay,
    llmAttributionFooter: _llmAttributionFooter(providerEmOverride) };
}

// ----------------------------------------------------------------------------------------------
// @desc Compose the LLM prompt asking for an hour-by-hour schedule with at least one hour between activities,
//   biased by today's priority and worked around any already-scheduled (immovable) obligations. Tells the LLM
//   the target weekday (and whether it is a future day, when the working day is already over or the next working
//   day is past the weekend) and asks it to account for weekends/holidays and tasks already scheduled that day.
// @param {object} params - { dateLabel, isFutureDay, obligations, priorityOption, quarterlyContent, targetDate, tasks }.
// @returns {string}
// [Claude claude-opus-4-8 (1M context)] Task: write the priority-aware, obligation-aware schedule prompt
// [Claude claude-opus-4-8 (1M context)] Task: tell the LLM the weekday / future-day and to plan around scheduled tasks
// Prompt: "ask the LLM to consider the day of the week and any holidays when proposing its agenda"
function _buildSchedulePrompt({ dateLabel, isFutureDay, obligations = [], priorityOption, quarterlyContent,
    targetDate, tasks }) {
  const weekday = targetDate.toLocaleDateString([], { weekday: "long" });
  const futureDayNote = isFutureDay
    ? " This agenda is for an upcoming day rather than today, so plan it as a fresh start to that day."
    : "";
  let prompt = `You are a productivity coach. Build a realistic hour-by-hour schedule for ${ dateLabel }, which is a ${ weekday }.${ futureDayNote }

## Today's priority
${ priorityOption?.instruction || "Build a balanced, high-leverage day." }

## Scheduling rules
- Take the day of the week into account: ${ weekday } may be a weekend or carry different working hours and energy than a weekday — plan accordingly.
- Consider whether ${ dateLabel } is a public holiday or a day people commonly take off; if so, lighten the schedule or skip work-focused blocks as appropriate.
- Propose specific clock times in 24-hour "HH:MM" format, ordered chronologically across a normal working day.
- Leave AT LEAST ${ MIN_GAP_MINUTES } minutes of unscheduled buffer between the end of one activity and the start of the next.
- Work AROUND the already-scheduled obligations below: never overlap them and never re-propose them.
- A candidate task marked "scheduledOnTarget": true is already committed to ${ dateLabel } at a set time — treat it as a fixed commitment and schedule the rest of the day around it.
- ONLY propose activities for tasks that appear in the Candidate tasks JSON below.
- Every returned activity MUST use the exact "taskUuid" from one candidate task; never invent tasks or UUIDs.
- Do not propose breaks, planning, review, calendar blocks, or other supporting activities unless they are candidate tasks.
- Favor the user's "important" tasks and tasks that advance the quarterly plan, weighted by today's priority.
- Respect each task's "duration" (seconds) when present; otherwise estimate a sensible duration.
`;

  prompt += `\n## Already-scheduled obligations (immovable; do not re-propose)\n`;
  prompt += obligations.length > 0
    ? obligations.map(o => `- ${ _timeStringFromMinutes(o.startMinutes) } ${ o.title }`
        + `${ o.durationMinutes ? ` (${ o.durationMinutes }m)` : "" }`).join("\n")
    : "None.";
  prompt += "\n";

  if (quarterlyContent) {
    prompt += `\n## User's Quarterly Plan\n${ quarterlyContent }\n`;
  } else {
    prompt += `\n## User's Quarterly Plan\nNo quarterly plan found.\n`;
  }

  prompt += `\n## Candidate tasks (JSON; ${ tasks.length } total)\n`;
  prompt += tasks.length > 0
    ? tasks.map(task => JSON.stringify(task)).join("\n")
    : "No candidate tasks.";

  prompt += `

Return ONLY valid JSON (no markdown fences) in exactly this shape:
{"activities":[{"startTime":"09:00","durationMinutes":60,"title":"Activity title","taskUuid":"existing-task-uuid","reason":"One sentence on why this slot matters today"}]}
- "startTime": 24-hour "HH:MM".
- "durationMinutes": integer minutes.
- "taskUuid": the exact "taskUuid" from a candidate task. Activities without a candidate taskUuid will be discarded.
- Keep titles concise. Provide between 4 and 10 activities.`;
  return prompt;
}

// ----------------------------------------------------------------------------------------------
// @desc Validate/normalize the LLM activity list: keep only well-formed entries that reference supplied candidate
//   tasks, sort by start time, attach the owning note UUID, then enforce the >=1hr gap so the contract holds even
//   when the LLM proposes overlapping or too-close slots.
// @param {Array<object>} activities - Raw activities from the LLM.
// @param {Set<string>} validUuids - Task UUIDs that may be referenced.
// @param {Map<string,string>} noteUuidFromTaskUuid - Task UUID -> note UUID lookup.
// @param {Date} targetDate - Local midnight of the day each activity should be scheduled on.
// @returns {Array<object>} Normalized, gap-corrected activities with startMinutes for rendering/scheduling.
// [Claude claude-opus-4-8 (1M context)] Task: validate, order, and gap-enforce proposed schedule activities
// [OpenAI GPT-5.5] Task: discard and log LLM activities that do not reference candidate tasks
// [Claude claude-opus-4-8 (1M context)] Task: stamp each activity with the target day's midnight for cross-day scheduling
function _validateActivities(activities, validUuids, noteUuidFromTaskUuid, targetDate) {
  const targetMidnightSeconds = Math.floor(targetDate.getTime() / 1000);
  const normalized = activities
    .map(activity => {
      const startMinutes = _minutesFromTimeString(activity?.startTime);
      const title = String(activity?.title || "").trim();
      const taskUuid = _validatedActivityTaskUuid(activity, validUuids);
      if (startMinutes == null || !title || !taskUuid) return null;
      const durationMinutes = Math.max(0, parseInt(activity?.durationMinutes, 10) || 0);
      return { durationMinutes, isExisting: true, noteUuid: noteUuidFromTaskUuid.get(taskUuid) || null,
        reason: String(activity?.reason || "").trim(), source: "proposed", startMinutes,
        startTime: _timeStringFromMinutes(startMinutes), targetMidnightSeconds, taskUuid, title };
    })
    .filter(Boolean)
    .sort((a, b) => a.startMinutes - b.startMinutes);
  return _enforceGap(normalized);
}

// ----------------------------------------------------------------------------------------------
// @desc Return a candidate task UUID when the activity references one, otherwise log the discarded suggestion.
// @param {object} activity - Raw LLM activity.
// @param {Set<string>} validUuids - Task UUIDs present in the submitted candidate task array.
// @returns {string|null} Valid candidate task UUID, or null when the activity must be discarded.
// [OpenAI GPT-5.5] Task: log hallucinated proposed-agenda suggestions before discarding them
function _validatedActivityTaskUuid(activity, validUuids) {
  const taskUuid = typeof activity?.taskUuid === "string" ? activity.taskUuid.trim() : "";
  if (taskUuid && validUuids.has(taskUuid)) return taskUuid;
  logIfEnabled("[proposed-agenda] discarding LLM activity without extant taskUuid", { taskUuid: taskUuid || null,
    title: String(activity?.title || "").trim() || null });
  return null;
}

// ----------------------------------------------------------------------------------------------
// @desc Push any activity that starts sooner than MIN_GAP_MINUTES after the previous one's end to a later
//   start, so the rendered/scheduled agenda always leaves at least one hour between activities. Activities
//   pushed past the end of the day are dropped.
// @param {Array<object>} sortedActivities - Activities already sorted ascending by startMinutes.
// @returns {Array<object>} Gap-corrected activities (startTime/startMinutes updated in place on copies).
// [Claude claude-opus-4-8 (1M context)] Task: guarantee the >=1hr inter-activity gap from the spec
function _enforceGap(sortedActivities) {
  const result = [];
  let earliestNextStart = 0;
  for (const activity of sortedActivities) {
    const startMinutes = Math.max(activity.startMinutes, earliestNextStart);
    if (startMinutes >= 24 * 60) continue;
    const corrected = { ...activity, startMinutes, startTime: _timeStringFromMinutes(startMinutes) };
    result.push(corrected);
    earliestNextStart = startMinutes + corrected.durationMinutes + MIN_GAP_MINUTES;
  }
  return result;
}

// ----------------------------------------------------------------------------------------------
// @desc Parse an "HH:MM" 24-hour string into minutes since midnight.
// @param {string} timeString - e.g. "09:30".
// @returns {number|null} Minutes since midnight, or null when unparseable.
function _minutesFromTimeString(timeString) {
  if (typeof timeString !== "string") return null;
  const match = timeString.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

// ----------------------------------------------------------------------------------------------
// @desc Format minutes-since-midnight as a zero-padded "HH:MM" string.
// @param {number} totalMinutes - Minutes since midnight.
// @returns {string}
function _timeStringFromMinutes(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${ String(hours).padStart(2, "0") }:${ String(minutes).padStart(2, "0") }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Convert a proposed activity's start time into a Unix-seconds startAt on its target day. Falls back to
//   today's local midnight when no target day is supplied (e.g. legacy callers).
// @param {number} startMinutes - Minutes since local midnight.
// @param {number|null} [targetMidnightSeconds=null] - Unix-seconds local midnight of the activity's day.
// @returns {number} Unix seconds.
// [Claude claude-opus-4-8 (1M context)] Task: derive an approved activity's startAt on its (possibly future) day
export function startAtSecondsFromMinutesToday(startMinutes, targetMidnightSeconds = null) {
  if (targetMidnightSeconds != null) return targetMidnightSeconds + startMinutes * SECONDS_PER_MINUTE;
  const now = new Date();
  const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  return Math.floor(localMidnight.getTime() / 1000) + startMinutes * SECONDS_PER_MINUTE;
}

// ----------------------------------------------------------------------------------------------
// @desc Schedule a single proposed activity at its start time: update an existing task's startAt, or insert
//   a new task with startAt into the activity's note (falling back to the provided default note).
// @param {object} app - Amplenote app bridge.
// @param {object} activity - Validated activity record from generateProposedAgenda.
// @param {string|null} defaultNoteUuid - Fallback note UUID for newly-created activities.
// @returns {Promise<{reason?: string, startAt?: number, taskUuid?: string}>}
// [Claude claude-opus-4-8 (1M context)] Task: persist an approved activity to a scheduled task
// Prompt: "link to approve scheduling the task at a particular time"
export async function scheduleProposedActivity(app, activity, defaultNoteUuid) {
  const startAt = startAtSecondsFromMinutesToday(activity.startMinutes, activity.targetMidnightSeconds ?? null);
  if (activity.isExisting && activity.taskUuid) {
    const updated = await app.updateTask(activity.taskUuid, { startAt });
    return updated ? { startAt, taskUuid: activity.taskUuid } : { reason: "update_failed", taskUuid: activity.taskUuid };
  }
  const targetNoteUuid = activity.noteUuid || defaultNoteUuid;
  if (!targetNoteUuid) return { reason: "missing_note" };
  const taskUuid = await app.insertTask({ uuid: targetNoteUuid }, { content: activity.title, startAt });
  return taskUuid ? { noteUuid: targetNoteUuid, startAt, taskUuid } : { reason: "insert_failed" };
}

// ----------------------------------------------------------------------------------------------
// @desc Approve the full schedule by sequentially scheduling every activity that is not already scheduled.
// @param {object} app - Amplenote app bridge.
// @param {Array<object>} activities - Validated activity records.
// @param {string|null} defaultNoteUuid - Fallback note UUID for newly-created activities.
// @returns {Promise<{failed: number, scheduled: number}>}
// [Claude claude-opus-4-8 (1M context)] Task: approve the whole agenda at once
// Prompt: "add a button to approve the schedule"
export async function approveProposedAgenda(app, activities, defaultNoteUuid) {
  let failed = 0;
  let scheduled = 0;
  for (const activity of activities) {
    const result = await scheduleProposedActivity(app, activity, defaultNoteUuid).catch(() => ({ reason: "threw" }));
    if (result.taskUuid) scheduled += 1; else failed += 1;
  }
  logIfEnabled("[proposed-agenda] approveProposedAgenda complete", { failed, scheduled });
  return { failed, scheduled };
}

// ----------------------------------------------------------------------------------------------
// @desc Resolve the concrete provider enum that a generation will use, for use as the cache-record's "LLM"
//   dimension: an explicit override wins, else the dashboard-configured provider, else "default" (the
//   Ample-Agent-Pro fallback path, which has no per-provider key).
// @param {string|null} providerEmOverride - Optional provider enum override.
// @returns {string}
function _resolveProviderEm(providerEmOverride = null) {
  return providerEmOverride || pluginSettings()[SETTING_KEYS.LLM_PROVIDER_MODEL] || "default";
}

// ----------------------------------------------------------------------------------------------
// @desc Build the llmPrompt options object, honoring a provider override and the dev OpenAI token override.
// @param {string|null} providerEmOverride - Optional provider enum override.
// @param {string|null} aiModelOverride - Optional explicit model id; when set it replaces the resolved model
//   while keeping the resolved API key. Primarily a testing seam to pin a cheap model.
// @returns {object} Options for llmPromptWithPluginFallback.
// [Claude claude-opus-4-8 (1M context)] Task: resolve LLM model/key options (mirrors dream-task-service)
// [Claude claude-opus-4-8 (1M context)] Task: honor any provider's dev token (first available), not just OpenAI
// Prompt: "dev environment isn't showing suggestions in spite of having GROK_AI_ACCESS_TOKEN present"
function _llmOptions(providerEmOverride = null, aiModelOverride = null) {
  const settings = pluginSettings();
  const llmOptions = { jsonResponse: true, timeoutSeconds: LLM_TIMEOUT_SECONDS };
  const applyModelOverride = () => { if (aiModelOverride) llmOptions.aiModel = aiModelOverride; };
  if (providerEmOverride) {
    const overrideModel = PROVIDER_DEFAULT_MODEL[providerEmOverride] || null;
    const overrideApiSetting = apiKeyFromProvider(providerEmOverride);
    const overrideApiKey = overrideApiSetting ? (settings?.[overrideApiSetting] || "").trim() : "";
    if (overrideModel && overrideApiKey) {
      llmOptions.aiModel = overrideModel;
      llmOptions.apiKey = overrideApiKey;
      applyModelOverride();
      return llmOptions;
    }
  }
  const providerEm = settings[SETTING_KEYS.LLM_PROVIDER_MODEL];
  const dashboardBucket = apiKeyBucketFromLlmProvider(providerEm);
  const devOverride = devLlmOverride(PROVIDER_DEFAULT_MODEL);
  if (devOverride) {
    llmOptions.aiModel = devOverride.model;
    llmOptions.apiKey = devOverride.apiKey;
    logIfEnabled(`[proposed-agenda] Dev mode: using ${devOverride.provider} dev token (model ${devOverride.model})`);
  } else if (providerEm && PROVIDER_DEFAULT_MODEL[providerEm]) {
    llmOptions.aiModel = PROVIDER_DEFAULT_MODEL[providerEm];
    const apiSetting = apiKeyFromProvider(dashboardBucket);
    const apiKey = apiSetting ? (settings[apiSetting] || "").trim() : "";
    if (apiKey) llmOptions.apiKey = apiKey;
  }
  applyModelOverride();
  return llmOptions;
}

// ----------------------------------------------------------------------------------------------
// @desc Short provider/model attribution string shown beneath the agenda.
// @param {string|null} providerEmOverride - Optional provider enum override.
// @returns {string|null}
// [Claude claude-opus-4-8 (1M context)] Task: surface which LLM produced the schedule
function _llmAttributionFooter(providerEmOverride = null) {
  const model = _llmOptions(providerEmOverride).aiModel;
  return model ? `Schedule proposed by ${ model }` : null;
}
