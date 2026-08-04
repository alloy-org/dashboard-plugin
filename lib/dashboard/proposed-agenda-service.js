// [Claude claude-opus-4-8 (1M context)-authored file]
// Prompt summary: "create a proposed-agenda component that retrieves recent task-domain tasks, submits them with
//   the quarterly plan to an LLM, and asks for an hour-by-hour schedule with >=1hr gaps; each activity gets a
//   schedule-at link and the agenda gets an approve button"
import { getCurrentQuarter } from "constants/quarters";
import { DASHBOARD_NOTE_TAG, SETTING_KEYS, apiKeyBucketFromLlmProvider,
  apiKeyFromProvider, devLlmOverride } from "constants/settings";
import { PROVIDER_DEFAULT_MODEL } from "constants/llm-providers";
import { pluginSettings } from "plugin-data";
import { loadCachedProposedAgenda, PROPOSED_TASK_STATUS, proposedTaskKey,
  recentProposedTaskHistory, storeProposedAgenda } from "proposed-agenda-archive";
import { priorityOptionFromKey } from "proposed-agenda-priority";
import { AMPLE_AGENT_PRO_NOTE_NAME } from "providers/ai-provider-settings";
import { llmPromptWithPluginFallback } from "providers/fetch-ai-provider";
import { buildDayRecommendationContext } from "recommendation-context/day-recommendation-context";
import { recommendationContextHasTravelOverride, recommendationInstructionsFromContext } from "recommendation-context/recommendation-instructions";
import { fetchDomainOrAllNotesTasks } from "util/all-notes-tasks";
import { dateKeyFromDateInput, localMidnightFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";
import { resolveQuarterlyPlanNote } from "util/quarterly-plan-notes";
import { activeTaskDomainInfo } from "util/task-domain-utility";

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

// The working day ends at 6pm. When the agenda is for today, we only propose the remaining part of the day
// (now → 18:00); anything past 18:00 is proposed only when today's priority calls for after-hours activities.
const WORK_DAY_END_HOUR = 18;
const MINUTES_PER_HOUR = 60;

// Preferred (soft) buffer the LLM is asked to leave between the user's obligations and its suggestions.
const OBLIGATION_BUFFER_MINUTES = 30;
const TRAVEL_RECOMMENDATIONS_NOTE_NAME = "Dashboard travel recommendations";

// Day-of-week indices (Date.getDay): the agenda skips these to the following Monday.
const SUNDAY = 0;
const SATURDAY = 6;

// Recency de-duplication rules, applied against the previous week of proposal history (see recentProposedTaskHistory):
//   1. A task suggested on the immediately preceding day is not suggested again (no two days in a row).
//   2. A task already suggested on 2 distinct days inside the trailing (MAX_PROPOSALS_WINDOW_DAYS - 1) days is
//      not suggested again, since a further suggestion would be its 3rd within a MAX_PROPOSALS_WINDOW_DAYS span
//      ("more than twice in any 5 day period").
const MAX_PROPOSALS_WINDOW_DAYS = 5;
const MAX_PROPOSALS_IN_WINDOW = 2;

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
// @param {Date|null} [options.now] - Reference "now" used to derive the current time-of-day the agenda starts
//   from (so today's schedule omits the past). Injectable for tests; defaults to the real clock.
// @returns {Promise<{activities: Array<object>, dateLabel: string, dayWord: string, isFutureDay: boolean,
//   fromCache: boolean, providerEm: string, dismissedKeys?: Array<string>, scheduledKeys?: Array<string>,
//   llmAttributionFooter: string|null}|{activities: [], error: string, errorCode: string, errorDetail?: string}>}
export async function generateProposedAgenda(app, { aiModelOverride = null, calendarEvents = null,
    forceRegenerate = false, now = null, obligations = [], priorityKey = null, providerEmOverride = null,
    targetDate: targetDateOverride = null } = {}) {
  const nowDate = now || new Date();
  const targetDate = targetDateOverride ? localMidnightFromDateInput(targetDateOverride) : resolveProposedAgendaDate(nowDate);
  const dateLabel = targetDate.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  // The target day may be today, tomorrow, or further out (e.g. Friday-evening/weekend runs resolve to Monday),
  // so describe it relative to today rather than assuming "tomorrow".
  const dayWord = _relativeDayWord(targetDate, nowDate);
  const isFutureDay = !_isSameLocalDay(targetDate, nowDate);
  // Only clamp to the current time-of-day when the agenda is for today; a future day is planned as a fresh start.
  const nowMinutes = isFutureDay ? null : nowDate.getHours() * MINUTES_PER_HOUR + nowDate.getMinutes();
  const priorityOption = priorityOptionFromKey(priorityKey);
  const providerEm = _resolveProviderEm(providerEmOverride);
  const { domainUuid } = await activeTaskDomainInfo(app);
  const recommendationContext = await buildDayRecommendationContext(app, { calendarEvents, domainUuid, targetDate });
  logIfEnabled("[proposed-agenda] generateProposedAgenda entry", { dateLabel, dayWord, isFutureDay, nowMinutes,
    priority: priorityOption.key, obligationCount: obligations.length, providerEm, forceRegenerate,
    recommendationFingerprint: recommendationContext.fingerprint });

  if (!forceRegenerate) {
    const cached = await loadCachedProposedAgenda(app, { recommendationContextKey: recommendationContext.cacheKey,
      date: targetDate, priorityKey: priorityOption.key, providerEm })
      .catch(error => { logIfEnabled("[proposed-agenda] cache lookup failed", error?.message); return null; });
    if (cached) return _reconcileCachedAgenda(app, { aiModelOverride, cached, dateLabel, dayWord, isFutureDay,
      domainUuid, nowMinutes, obligations, priorityOption,
      providerEm, providerEmOverride, recommendationContext, targetDate });
  }

  const result = await _generateFreshSchedule(app, { aiModelOverride, dateLabel, dayWord, isFutureDay, nowMinutes,
    domainUuid, obligations, priorityOption, providerEmOverride, recommendationContext, targetDate });
  if (!result.error && Array.isArray(result.activities) && result.activities.length > 0) {
    await storeProposedAgenda(app, { activities: result.activities, date: targetDate,
      llmAttributionFooter: result.llmAttributionFooter, priorityKey: priorityOption.key, providerEm,
      recommendationContextKey: recommendationContext.cacheKey }).catch(
      error => logIfEnabled("[proposed-agenda] failed to store record", error?.message));
  }
  return { ...result, fromCache: false, providerEm };
}

// ----------------------------------------------------------------------------------------------
// @desc Gather the candidate task domain + quarterly plan and ask the LLM for a fresh hour-by-hour schedule,
//   WITHOUT persisting it (callers decide whether/how to store). Shared by the cache-miss path and by cached-
//   agenda reconciliation when completed suggestions must be replaced.
// @param {object} app - Amplenote app bridge.
// @param {object} params - { aiModelOverride, dateLabel, dayWord, domainUuid, isFutureDay, nowMinutes,
//   obligations, priorityOption, providerEmOverride, recommendationContext, targetDate }.
// @returns {Promise<object>} Schedule payload ({ activities, dateLabel, ... }) or a structured error.
// [Claude claude-opus-4-8 (1M context)] Task: factor the fresh-generation core so reconciliation can reuse it
async function _generateFreshSchedule(app, { aiModelOverride, dateLabel, dayWord, domainUuid, isFutureDay, nowMinutes,
    obligations, priorityOption, providerEmOverride, recommendationContext, targetDate }) {
  const tasks = await _selectRelevantTasks(app, priorityOption, targetDate, domainUuid);
  const { domainName, migrationDomainName } = await activeTaskDomainInfo(app);
  const allowLegacyMigration = domainName && migrationDomainName && domainName === migrationDomainName;
  const planNote = await resolveQuarterlyPlanNote(app, allowLegacyMigration, domainName, getCurrentQuarter().label);
  let quarterlyContent = null;
  if (planNote) {
    const content = await app.getNoteContent({ uuid: planNote.uuid });
    quarterlyContent = content ? content.substring(0, MAX_QUARTERLY_PLAN_CHARS) : null;
  }
  logIfEnabled("[proposed-agenda] context loaded", { taskCount: tasks.length, quarterlyChars: quarterlyContent?.length ?? 0 });
  if (tasks.length === 0 && !recommendationContextHasTravelOverride(recommendationContext)) {
    return { activities: [], error: "No tasks found available to schedule in Task Domain.", errorCode: "no_tasks" };
  }
  return _generateScheduleFromLlm(app, { aiModelOverride, dateLabel, dayWord, isFutureDay, nowMinutes, obligations,
    priorityOption, providerEmOverride, quarterlyContent, recommendationContext, targetDate, tasks });
}

// ----------------------------------------------------------------------------------------------
// @desc Serve a cached agenda, but first confirm each still-pending suggestion's backing task still exists and
//   is incomplete. Any suggestion whose task has been completed/dismissed/deleted is dropped, and the LLM is
//   re-queried to fill each vacated slot with a fresh suggestion; the patched set is written back to the note so
//   the stale entries never resurface. Already scheduled/dismissed cached entries are left untouched.
// @param {object} app - Amplenote app bridge.
// @param {object} params - { aiModelOverride, cached, dateLabel, dayWord, domainUuid, isFutureDay, nowMinutes,
//   obligations, priorityOption, providerEm, providerEmOverride, recommendationContext,
//   targetDate }. `cached` is loadCachedProposedAgenda()'s payload.
// @returns {Promise<object>} Agenda payload with fromCache:true and the reconciled activities/keys.
async function _reconcileCachedAgenda(app, { aiModelOverride, cached, dateLabel, dayWord, isFutureDay, nowMinutes,
    domainUuid, obligations, priorityOption, providerEm, providerEmOverride, recommendationContext, targetDate }) {
  const staleUuids = await _staleCachedTaskUuids(app, cached.activities);
  if (staleUuids.size === 0) {
    return { activities: cached.activities, dateLabel, dayWord, isFutureDay, dismissedKeys: cached.dismissedKeys,
      fromCache: true, llmAttributionFooter: cached.llmAttributionFooter, providerEm, scheduledKeys: cached.scheduledKeys };
  }
  const keptActivities = cached.activities.filter(activity => !(activity.taskUuid && staleUuids.has(activity.taskUuid)));
  const staleSlots = cached.activities.filter(activity => activity.taskUuid && staleUuids.has(activity.taskUuid));
  logIfEnabled("[proposed-agenda] reconcile: dropping completed/removed suggestions, re-querying replacements",
    { staleCount: staleSlots.length, keptCount: keptActivities.length });
  const fresh = await _generateFreshSchedule(app, { aiModelOverride, dateLabel, dayWord, isFutureDay, nowMinutes,
    domainUuid, obligations, priorityOption, providerEmOverride, recommendationContext, targetDate });
  const replacements = _replacementsForStaleSlots(fresh, keptActivities, staleUuids, staleSlots);
  const mergedActivities = [...keptActivities, ...replacements].sort((a, b) => a.startMinutes - b.startMinutes);
  const llmAttributionFooter = cached.llmAttributionFooter || fresh.llmAttributionFooter || null;
  await storeProposedAgenda(app, { activities: mergedActivities, date: targetDate, llmAttributionFooter,
    priorityKey: priorityOption.key, providerEm, recommendationContextKey: recommendationContext.cacheKey });
  return { activities: mergedActivities, dateLabel, dayWord, isFutureDay, fromCache: true, llmAttributionFooter, providerEm,
    dismissedKeys: mergedActivities.filter(a => a.scheduledEm === PROPOSED_TASK_STATUS.DISMISSED).map(proposedTaskKey),
    scheduledKeys: mergedActivities.filter(a => a.scheduledEm === PROPOSED_TASK_STATUS.SCHEDULED).map(proposedTaskKey) };
}

// ----------------------------------------------------------------------------------------------
// @desc Identify which still-pending cached suggestions no longer point at an actionable task — because the
//   backing task was completed, dismissed, or deleted — by looking each up individually via app.getTask. Only
//   pending suggestions referencing an existing task are checked; already scheduled/dismissed entries and
//   invented (uuid-less) activities are left alone. Returns an empty set when the app cannot look up tasks, so a
//   missing getTask never turns a cache hit into a spurious regeneration.
// @param {object} app - Amplenote app bridge.
// @param {Array<object>} activities - Re-hydrated cached activities (carry scheduledEm/isExisting/taskUuid).
// @returns {Promise<Set<string>>} Task UUIDs whose suggestions must be dropped and replaced.
// [Claude claude-opus-4-8 (1M context)] Task: per-uuid getTask lookups to weed out completed/missing suggestions
async function _staleCachedTaskUuids(app, activities) {
  if (typeof app.getTask !== "function") return new Set();
  const checkable = (activities || []).filter(activity => activity.taskUuid && activity.isExisting
    && (activity.scheduledEm || PROPOSED_TASK_STATUS.PENDING) === PROPOSED_TASK_STATUS.PENDING);
  const flags = await Promise.all(checkable.map(async activity => {
    const task = await Promise.resolve(app.getTask(activity.taskUuid));
    const stale = !task || !!task.completedAt || !!task.dismissedAt;
    return stale ? activity.taskUuid : null;
  }));
  return new Set(flags.filter(Boolean));
}

// ----------------------------------------------------------------------------------------------
// @desc Build replacement suggestions for the vacated (stale) slots from a freshly-generated schedule. Each
//   replacement adopts its stale slot's time and duration (keeping the day's shape and >=1hr gaps intact) while
//   taking the task identity from a fresh suggestion not already present or itself stale. Fewer replacements than
//   stale slots is fine — the surplus slots simply drop out. Returns [] when no fresh schedule is available.
// @param {object} fresh - Payload from _generateFreshSchedule (activities or a structured error).
// @param {Array<object>} keptActivities - Surviving cached activities (their task UUIDs must not be reused).
// @param {Set<string>} staleUuids - Task UUIDs being replaced (never reuse a still-stale one).
// @param {Array<object>} staleSlots - The cached activities being replaced, in time order, donating their slots.
// @returns {Array<object>} Pending replacement activities.
// [Claude claude-opus-4-8 (1M context)] Task: slot fresh suggestions into the times freed by completed tasks
function _replacementsForStaleSlots(fresh, keptActivities, staleUuids, staleSlots) {
  if (fresh.error || !Array.isArray(fresh.activities) || fresh.activities.length === 0) return [];
  const usedUuids = new Set(keptActivities.filter(activity => activity.taskUuid).map(activity => activity.taskUuid));
  const replacements = [];
  for (const slot of staleSlots) {
    const pick = fresh.activities.find(activity => activity.taskUuid && !usedUuids.has(activity.taskUuid)
      && !staleUuids.has(activity.taskUuid));
    if (!pick) break;
    usedUuids.add(pick.taskUuid);
    replacements.push({ durationMinutes: slot.durationMinutes || 0, isExisting: true, noteUuid: pick.noteUuid || null,
      reason: pick.reason || "", scheduledEm: PROPOSED_TASK_STATUS.PENDING, source: "proposed",
      startMinutes: slot.startMinutes, startTime: slot.startTime, targetMidnightSeconds: slot.targetMidnightSeconds ?? null,
      taskUuid: pick.taskUuid, title: pick.title });
  }
  return replacements;
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
// @desc Whether two dates fall on the same local calendar day.
// @param {Date} a
// @param {Date} b
// @returns {boolean}
function _isSameLocalDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// ----------------------------------------------------------------------------------------------
// @desc Apply the recency de-duplication rules to a prior-proposal log, returning the task UUIDs that must be
//   kept out of today's candidate pool: (1) any task proposed on the immediately preceding day (would be two
//   days in a row), and (2) any task already proposed on MAX_PROPOSALS_IN_WINDOW distinct days within the
//   trailing (MAX_PROPOSALS_WINDOW_DAYS - 1) days (a further proposal would exceed twice in a 5-day span).
// @param {Map<string, Set<string>>} history - taskUuid -> set of prior YYYY-MM-DD day-keys it was proposed on.
// @param {Date} targetDate - Local midnight of the day being generated for.
// @returns {Set<string>} Task UUIDs to exclude from the candidate pool.
// [Claude claude-opus-4-8 (1M context)] Task: turn the prior-week proposal log into a candidate-exclusion set
function _recentlyOverproposedTaskUuids(history, targetDate) {
  const yesterdayKey = _dateKeyOffsetDays(targetDate, -1);
  const priorWindowKeys = [];
  for (let daysBack = 1; daysBack < MAX_PROPOSALS_WINDOW_DAYS; daysBack += 1) {
    priorWindowKeys.push(_dateKeyOffsetDays(targetDate, -daysBack));
  }
  const excluded = new Set();
  for (const [taskUuid, dayKeys] of history) {
    if (dayKeys.has(yesterdayKey)) { excluded.add(taskUuid); continue; }
    if (priorWindowKeys.filter(dayKey => dayKeys.has(dayKey)).length >= MAX_PROPOSALS_IN_WINDOW) {
      excluded.add(taskUuid);
    }
  }
  return excluded;
}

// ----------------------------------------------------------------------------------------------
// @desc The YYYY-MM-DD local day-key for a day a whole number of days offset from the given date.
// @param {Date} date - Reference date.
// @param {number} deltaDays - Days to add (negative for earlier days).
// @returns {string} Local day-key.
// [Claude claude-opus-4-8 (1M context)] Task: derive prior day-keys for the recency window
function _dateKeyOffsetDays(date, deltaDays) {
  return dateKeyFromDateInput(new Date(date.getFullYear(), date.getMonth(), date.getDate() + deltaDays, 0, 0, 0));
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
// @param {string|null} domainUuid - Already-resolved active task domain UUID.
// @returns {Promise<Array<object>>} Compact task records.
// [Claude claude-opus-4-8 (1M context)] Task: gather task-domain tasks per the volume rules, priority-aware
// Prompt: "retrieve at least 200 most recent tasks ... barnacle priority prefers notes with hundreds of open tasks"
// [Claude claude-opus-4-8 (1M context)] Task: always include the target day's already-scheduled commitments
// Prompt: "look up/derive the task and events for the target day before we query the LLM"
// [OpenAI GPT-5.5] Task: accept caller-resolved domain UUID so recommendation context and tasks share scope
async function _selectRelevantTasks(app, priorityOption, targetDate, domainUuid = null) {
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
// @desc Build the prompt, call the LLM (with Ample Agent Pro fallback), and validate the proposed schedule.
//   Tasks already committed to the target day (present in the obligations, or flagged scheduledOnTarget) are
//   dropped from the candidate pool first so the LLM cannot re-propose an already-scheduled task; they remain
//   listed in the immovable obligations section so the schedule is still planned around them.
// @param {object} app - Amplenote app bridge.
// @param {object} params - { aiModelOverride, dateLabel, obligations, priorityOption, providerEmOverride,
//   quarterlyContent, recommendationContext, tasks }.
// @returns {Promise<object>} Schedule payload or structured error.
// [Claude claude-opus-4-8 (1M context)] Task: request and validate an hour-by-hour schedule from the LLM
// [Claude claude-opus-4-8 (1M context)] Task: drop already-scheduled tasks from the candidate pool before prompting
// [OpenAI GPT-5.5] Task: include shared recommendation context and travel-mode invented activities
async function _generateScheduleFromLlm(app, { aiModelOverride, dateLabel, dayWord, isFutureDay, nowMinutes = null,
    obligations = [], priorityOption, providerEmOverride, quarterlyContent, recommendationContext, targetDate, tasks }) {
  const configuredProviderEm = providerEmOverride || pluginSettings()[SETTING_KEYS.LLM_PROVIDER_MODEL];
  const hasConfiguredProvider = !!configuredProviderEm && configuredProviderEm !== "none";
  if (!hasConfiguredProvider) {
    const ampleAgentNote = await app.findNote({ name: AMPLE_AGENT_PRO_NOTE_NAME });
    if (!ampleAgentNote) {
      return { activities: [], error: "No AI provider configured. Please select a provider in plugin settings.",
        errorCode: "no_provider_configured" };
    }
  }

  // Exclude tasks already committed to the target day so the LLM cannot re-propose them (the observed bug where a
  // proposal duplicates a "Scheduled" row). A task is already-scheduled when it appears in the day's obligation
  // records (matched by uuid) or when the domain query flagged it scheduledOnTarget. The excluded tasks stay
  // visible to the LLM in the immovable "Already-scheduled obligations" section, so it still plans around them.
  // [Claude claude-opus-4-8 (1M context)] Task: keep already-scheduled tasks out of the candidate pool
  // Prompt: "ensure that the LLM does *not* suggest tasks that are already scheduled"
  const scheduledTaskUuids = new Set([...obligations.map(o => o.taskUuid).filter(Boolean),
    ...tasks.filter(task => task.scheduledOnTarget).map(task => task.taskUuid)]);

  // Also drop tasks the previous week's proposal log shows were suggested too recently, so the same task is not
  // re-proposed two days running or more than twice in any 5-day window. History read failures degrade to "no
  // recent history" (empty map) so this never blocks generation.
  // [Claude claude-opus-4-8 (1M context)] Task: exclude recently-proposed tasks from the candidate pool
  // Prompt: "not suggest the same task two days in a row; not more than twice in any 5 day period"
  const recentHistory = await recentProposedTaskHistory(app, { date: targetDate }).catch(error => {
    logIfEnabled("[proposed-agenda] recent-history lookup failed", error?.message); return new Map(); });
  const recentlyProposedUuids = _recentlyOverproposedTaskUuids(recentHistory, targetDate);
  const excludedUuids = new Set([...scheduledTaskUuids, ...recentlyProposedUuids]);
  let proposableTasks = tasks.filter(task => !excludedUuids.has(task.taskUuid));
  // Safety valve: never let the recency rules starve the day of every candidate. When they would empty the pool,
  // relax back to the already-scheduled exclusion only so a schedule can still be built (logged for visibility).
  if (proposableTasks.length === 0 && recentlyProposedUuids.size > 0) {
    proposableTasks = tasks.filter(task => !scheduledTaskUuids.has(task.taskUuid));
    logIfEnabled("[proposed-agenda] recency exclusions emptied the candidate pool; relaxed to scheduled-only");
  }
  logIfEnabled("[proposed-agenda] excluded already-scheduled + recently-proposed tasks from candidates",
    { candidateCount: tasks.length, proposableCount: proposableTasks.length,
      alreadyScheduledCount: scheduledTaskUuids.size, recentlyProposedCount: recentlyProposedUuids.size });

  const allowInventedTravelActivities = recommendationContextHasTravelOverride(recommendationContext);
  const prompt = _buildSchedulePrompt({ dateLabel, isFutureDay, nowMinutes, obligations, priorityOption,
    quarterlyContent, recommendationContext, targetDate, tasks: proposableTasks, allowInventedTravelActivities });
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

  const validUuids = new Set(proposableTasks.map(task => task.taskUuid));
  const noteUuidFromTaskUuid = new Map(proposableTasks.map(task => [task.taskUuid, task.noteUuid]));
  const inventedNoteUuid = _noteUuidForInventedActivity(recommendationContext);
  const activities = _validateActivities(result.activities, validUuids, noteUuidFromTaskUuid, targetDate,
    { allowInventedTravelActivities, inventedNoteUuid, nowMinutes, obligations });
  return { activities, dateLabel, dayWord, isFutureDay,
    llmAttributionFooter: _llmAttributionFooter(providerEmOverride) };
}

// ----------------------------------------------------------------------------------------------
// @desc Compose the LLM prompt asking for an hour-by-hour schedule with at least one hour between activities,
//   biased by today's priority and worked around any already-scheduled (immovable) obligations. Tells the LLM
//   the target weekday (and whether it is a future day, when the working day is already over or the next working
//   day is past the weekend) and asks it to account for weekends/holidays. The `tasks` passed here are only the
//   proposable candidates — already-scheduled tasks are excluded upstream — so the prompt states the candidates
//   are not yet scheduled and directs the LLM to the obligations section for anything already committed.
// @param {object} params - { allowInventedTravelActivities, dateLabel, isFutureDay, nowMinutes, obligations,
//   priorityOption, quarterlyContent, recommendationContext, targetDate, tasks }.
// @returns {string}
// [Claude claude-opus-4-8 (1M context)] Task: write the priority-aware, obligation-aware schedule prompt
// [Claude claude-opus-4-8 (1M context)] Task: tell the LLM the weekday / future-day and to plan around scheduled tasks
// Prompt: "ask the LLM to consider the day of the week and any holidays when proposing its agenda"
// [Claude claude-opus-4-8 (1M context)] Task: send the occupied-times array + only-schedule-the-remaining-day rules
// Prompt: "submit an array of already-occupied times; do not propose tasks in the past; work day ends at 6pm"
// [OpenAI GPT-5.5] Task: add shared recommendation instructions and travel-mode invented activity rules
function _buildSchedulePrompt({ allowInventedTravelActivities = false, dateLabel, isFutureDay, nowMinutes = null,
    obligations = [], priorityOption, quarterlyContent, recommendationContext, targetDate, tasks }) {
  const weekday = targetDate.toLocaleDateString([], { weekday: "long" });
  const futureDayNote = isFutureDay
    ? " This agenda is for an upcoming day rather than today, so plan it as a fresh start to that day."
    : "";
  const workDayEnd = _timeStringFromMinutes(WORK_DAY_END_HOUR * MINUTES_PER_HOUR);
  let prompt = `You are a productivity coach. Build a realistic hour-by-hour schedule for ${ dateLabel }, which is a ${ weekday }.${ futureDayNote }

## Today's priority
${ priorityOption?.instruction || "Build a balanced, high-leverage day." }

## Scheduling rules
- Take the day of the week into account: ${ weekday } may be a weekend or carry different working hours and energy than a weekday — plan accordingly.
- Consider whether ${ dateLabel } is a public holiday or a day people commonly take off; if so, lighten the schedule or skip work-focused blocks as appropriate.
- Propose specific clock times in 24-hour "HH:MM" format, ordered chronologically across a normal working day.
- Leave AT LEAST ${ MIN_GAP_MINUTES } minutes of unscheduled buffer between the end of one activity and the start of the next.
- Work AROUND the already-scheduled obligations below: never overlap them and never re-propose them.
- The Candidate tasks below are NOT yet scheduled for ${ dateLabel }; anything already committed to the day appears only in the obligations section and must not be proposed again.
- ${ allowInventedTravelActivities ? "Travel/vacation/conference all-day context is active: prefer useful trip-appropriate activities, and you may return null taskUuid for invented local recommendations." : "ONLY propose activities for tasks that appear in the Candidate tasks JSON below." }
- ${ allowInventedTravelActivities ? "For existing tasks, use the exact taskUuid from one candidate task. For invented travel activities, set taskUuid to null." : "Every returned activity MUST use the exact \"taskUuid\" from one candidate task; never invent tasks or UUIDs." }
- ${ allowInventedTravelActivities ? "Do not propose generic breaks, planning, or review blocks; invented null-UUID items should be concrete local/travel activities." : "Do not propose breaks, planning, review, calendar blocks, or other supporting activities unless they are candidate tasks." }
- Favor the user's "important" tasks and tasks that advance the quarterly plan, weighted by today's priority.
- Respect each task's "duration" (seconds) when present; otherwise estimate a sensible duration.
`;
  // When the agenda is for today, the day has already partly elapsed: only schedule the remaining part of the
  // working day (now → 18:00), never the past. After-hours blocks are proposed only when the priority calls for
  // activities that naturally happen outside work hours.
  if (nowMinutes != null) {
    prompt += `- The current local time is ${ _timeStringFromMinutes(nowMinutes) }. Do NOT propose any activity that starts before this time — only schedule the remaining part of the day.\n`;
    prompt += `- The working day ends at ${ workDayEnd } (6pm). Keep proposed activities between the current time and ${ workDayEnd }. Only propose activities after ${ workDayEnd } if today's priority explicitly calls for activities that naturally happen outside of work hours.\n`;
  }

  // The occupied-times array (tasks AND events already committed to the day) plus the do-not-intrude rule with a
  // preferred buffer. This mirrors the immovable-obligations list below but in the compact clock-range form the
  // request specifies, so the LLM has an at-a-glance view of every slot it must avoid.
  const occupiedTimes = _occupiedTimeSlots(obligations);
  prompt += `\n## Already occupied times\n`;
  prompt += `Already occupied times: [ ${ occupiedTimes.join(", ") || "none" } ]. Ensure that your suggestions do NOT include any task that would fall in these already-scheduled time slots for the day. Attempt to leave at least a ${ OBLIGATION_BUFFER_MINUTES } minute buffer between the user's events and your suggestions.\n`;

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

  prompt += recommendationInstructionsFromContext(recommendationContext, { allowInventedTravelActivities,
    scheduleMode: true });

  prompt += `\n## Candidate tasks (JSON; ${ tasks.length } total)\n`;
  prompt += tasks.length > 0
    ? tasks.map(task => JSON.stringify(task)).join("\n")
    : "No candidate tasks.";

  prompt += `

Return ONLY valid JSON (no markdown fences) in exactly this shape:
{"activities":[{"startTime":"09:00","durationMinutes":60,"title":"Activity title","taskUuid":"existing-task-uuid","reason":"One sentence on why this slot matters today"}]}
- "startTime": 24-hour "HH:MM".
- "durationMinutes": integer minutes.
- "taskUuid": ${ allowInventedTravelActivities ? "the exact \"taskUuid\" from a candidate task, or null only for an invented travel/vacation/conference activity." : "the exact \"taskUuid\" from a candidate task. Activities without a candidate taskUuid will be discarded." }
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
// @param {object} [options] - { allowInventedTravelActivities, inventedNoteUuid, nowMinutes, obligations }: the
//   current time-of-day to clamp today's schedule to, and committed obligations the schedule must never overlap.
// @returns {Array<object>} Normalized, gap-corrected activities with startMinutes for rendering/scheduling.
// [Claude claude-opus-4-8 (1M context)] Task: validate, order, and gap-enforce proposed schedule activities
// [OpenAI GPT-5.5] Task: discard and log LLM activities that do not reference candidate tasks
// [Claude claude-opus-4-8 (1M context)] Task: stamp each activity with the target day's midnight for cross-day scheduling
// [Claude claude-opus-4-8 (1M context)] Task: drop past activities and guarantee non-overlap with obligations
// [OpenAI GPT-5.5] Task: allow null-UUID invented activities only when travel context authorizes them
function _validateActivities(activities, validUuids, noteUuidFromTaskUuid, targetDate, {
    allowInventedTravelActivities = false, inventedNoteUuid = null, nowMinutes = null, obligations = [] } = {}) {
  const targetMidnightSeconds = Math.floor(targetDate.getTime() / 1000);
  const normalized = activities
    .map(activity => {
      const startMinutes = _minutesFromTimeString(activity?.startTime);
      const title = String(activity?.title || "").trim();
      const taskUuid = _validatedActivityTaskUuid(activity, validUuids, { allowInventedTravelActivities });
      if (startMinutes == null || !title || taskUuid === undefined) return null;
      const durationMinutes = Math.max(0, parseInt(activity?.durationMinutes, 10) || 0);
      const isExisting = !!taskUuid;
      return { durationMinutes, isExisting, noteUuid: isExisting ? (noteUuidFromTaskUuid.get(taskUuid) || null) : inventedNoteUuid,
        reason: String(activity?.reason || "").trim(), source: "proposed", startMinutes,
        startTime: _timeStringFromMinutes(startMinutes), targetMidnightSeconds, taskUuid: taskUuid || null, title };
    })
    .filter(Boolean)
    .sort((a, b) => a.startMinutes - b.startMinutes);
  return _enforceGap(normalized, { earliestStart: nowMinutes || 0, occupiedBlocks: _occupiedBlocks(obligations) });
}

// ----------------------------------------------------------------------------------------------
// @desc Return a candidate task UUID when the activity references one, otherwise log the discarded suggestion.
// @param {object} activity - Raw LLM activity.
// @param {Set<string>} validUuids - Task UUIDs present in the submitted candidate task array.
// @param {object} [options={}] - { allowInventedTravelActivities }.
// @returns {string|null|undefined} Valid UUID, null for allowed invented activity, undefined to discard.
// [OpenAI GPT-5.5] Task: log hallucinated proposed-agenda suggestions before discarding them
// [OpenAI GPT-5.5] Task: keep invented travel-mode suggestions with null taskUuid
function _validatedActivityTaskUuid(activity, validUuids, { allowInventedTravelActivities = false } = {}) {
  const taskUuid = typeof activity?.taskUuid === "string" ? activity.taskUuid.trim() : "";
  if (taskUuid && validUuids.has(taskUuid)) return taskUuid;
  if (!taskUuid && allowInventedTravelActivities) return null;
  logIfEnabled("[proposed-agenda] discarding LLM activity without extant taskUuid", { taskUuid: taskUuid || null,
    title: String(activity?.title || "").trim() || null });
  return undefined;
}

// ----------------------------------------------------------------------------------------------
// @desc Push any activity that starts sooner than MIN_GAP_MINUTES after the previous one's end to a later
//   start, so the rendered/scheduled agenda always leaves at least one hour between activities. Also clamps the
//   earliest start to `earliestStart` (so today's schedule never lands in the past) and pushes any activity that
//   would overlap a committed obligation past that obligation's end, hard-guaranteeing the schedule never
//   intrudes into an existing task/event. Activities pushed past the end of the day are dropped.
// @param {Array<object>} sortedActivities - Activities already sorted ascending by startMinutes.
// @param {object} [options] - { earliestStart, occupiedBlocks }.
// @returns {Array<object>} Gap-corrected activities (startTime/startMinutes updated in place on copies).
// [Claude claude-opus-4-8 (1M context)] Task: guarantee the >=1hr inter-activity gap from the spec
// [Claude claude-opus-4-8 (1M context)] Task: clamp to the current time and never overlap obligations
function _enforceGap(sortedActivities, { earliestStart = 0, occupiedBlocks = [] } = {}) {
  const result = [];
  let earliestNextStart = earliestStart;
  for (const activity of sortedActivities) {
    let startMinutes = Math.max(activity.startMinutes, earliestNextStart);
    startMinutes = _pushPastObligations(startMinutes, activity.durationMinutes, occupiedBlocks);
    if (startMinutes >= 24 * 60) continue;
    const corrected = { ...activity, startMinutes, startTime: _timeStringFromMinutes(startMinutes) };
    result.push(corrected);
    earliestNextStart = startMinutes + corrected.durationMinutes + MIN_GAP_MINUTES;
  }
  return result;
}

// ----------------------------------------------------------------------------------------------
// @desc Advance a proposed start time until the [start, start+duration) span clears every occupied obligation
//   block, so no portion of a proposed activity intrudes into an already-scheduled task/event. Each time the
//   span overlaps a block, the start is bumped to that block's end and the scan restarts (a later block may now
//   be in range). A zero-length activity is treated as occupying its start instant.
// @param {number} startMinutes - Candidate start (already clamped for prior activities / current time).
// @param {number} durationMinutes - The activity's duration.
// @param {Array<{endMinutes: number, startMinutes: number}>} occupiedBlocks - Obligation blocks.
// @returns {number} A start time whose span overlaps no obligation block.
// [Claude claude-opus-4-8 (1M context)] Task: shift proposals out of committed obligation slots
function _pushPastObligations(startMinutes, durationMinutes, occupiedBlocks) {
  if (!occupiedBlocks.length) return startMinutes;
  const span = Math.max(durationMinutes, 1);
  let start = startMinutes;
  let moved = true;
  while (moved) {
    moved = false;
    for (const block of occupiedBlocks) {
      if (start < block.endMinutes && block.startMinutes < start + span) {
        start = block.endMinutes;
        moved = true;
      }
    }
  }
  return start;
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
// @desc Format minutes-since-midnight as a 12-hour "h:mmam"/"h:mmpm" clock string (e.g. 495 -> "8:15am"),
//   matching the human occupied-times array the prompt sends.
// @param {number} totalMinutes - Minutes since midnight.
// @returns {string}
function _amPmClockFromMinutes(totalMinutes) {
  const hours24 = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  const suffix = hours24 < 12 ? "am" : "pm";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${ hours12 }:${ String(minutes).padStart(2, "0") }${ suffix }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Turn the day's obligations (tasks AND events already committed) into the compact clock-range strings
//   that make up the "Already occupied times" array — e.g. "8:15am-9:15am" when a duration is known, or a bare
//   "4:00pm" start when it is not. Obligations without a parseable start are skipped.
// @param {Array<object>} obligations - Obligation records ({ durationMinutes, startMinutes, ... }).
// @returns {Array<string>} Occupied-time labels in ascending start order.
function _occupiedTimeSlots(obligations) {
  return (obligations || []).filter(o => o && typeof o.startMinutes === "number")
    .slice().sort((a, b) => a.startMinutes - b.startMinutes)
    .map(o => o.durationMinutes
      ? `${ _amPmClockFromMinutes(o.startMinutes) }-${ _amPmClockFromMinutes(o.startMinutes + o.durationMinutes) }`
      : _amPmClockFromMinutes(o.startMinutes));
}

// ----------------------------------------------------------------------------------------------
// @desc Reduce the day's obligations to occupied [startMinutes, endMinutes) blocks the schedule must not
//   overlap. A task/event with a known duration occupies its whole span; one without a duration occupies just
//   its start instant. Used to hard-guarantee proposed activities never intrude into a committed slot.
// @param {Array<object>} obligations - Obligation records.
// @returns {Array<{endMinutes: number, startMinutes: number}>} Blocks in ascending start order.
function _occupiedBlocks(obligations) {
  return (obligations || []).filter(o => o && typeof o.startMinutes === "number")
    .map(o => ({ endMinutes: o.startMinutes + (o.durationMinutes || 0), startMinutes: o.startMinutes }))
    .sort((a, b) => a.startMinutes - b.startMinutes);
}

// ----------------------------------------------------------------------------------------------
// @desc Choose the best note for invented travel activities: first matching research note, otherwise null so
//   scheduling can lazily create the shared travel-recommendations note.
// @param {object|null} recommendationContext - Shared recommendation context.
// @returns {string|null}
// [OpenAI GPT-5.5] Task: attach invented travel ideas to the most relevant research note when possible
function _noteUuidForInventedActivity(recommendationContext) {
  const researchNote = (recommendationContext?.researchNotes || []).find(note => note?.uuid);
  return researchNote?.uuid || null;
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
  const localMidnight = localMidnightFromDateInput(new Date());
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
  const targetNoteUuid = activity.noteUuid || defaultNoteUuid || await _travelRecommendationsNoteUuid(app);
  if (!targetNoteUuid) return { reason: "missing_note" };
  const taskUuid = await app.insertTask({ uuid: targetNoteUuid }, { content: activity.title, startAt });
  return taskUuid ? { noteUuid: targetNoteUuid, startAt, taskUuid } : { reason: "insert_failed" };
}

// ----------------------------------------------------------------------------------------------
// @desc Resolve or create the fallback note used when scheduling an invented travel/vacation recommendation.
// @param {object} app - Amplenote app bridge.
// @returns {Promise<string|null>} Note UUID, or null when the note cannot be resolved.
// [OpenAI GPT-5.5] Task: lazily create a destination note for invented travel recommendations
async function _travelRecommendationsNoteUuid(app) {
  if (typeof app.findNote !== "function" || typeof app.createNote !== "function") return null;
  const existing = await app.findNote({ name: TRAVEL_RECOMMENDATIONS_NOTE_NAME, tags: [DASHBOARD_NOTE_TAG] })
    .catch(() => null);
  if (existing?.uuid) return existing.uuid;
  const created = await app.createNote(TRAVEL_RECOMMENDATIONS_NOTE_NAME, [DASHBOARD_NOTE_TAG], { archive: false })
    .catch(() => null);
  return typeof created === "object" ? (created?.uuid || null) : created || null;
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
    const result = await scheduleProposedActivity(app, activity, defaultNoteUuid);
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
