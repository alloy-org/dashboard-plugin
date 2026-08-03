// [Claude claude-opus-4-8 (1M context)-authored file]
// Prompt summary: "orchestrate the Energy Per Habit load: read the per-month cache note first, only fetch
//   completed tasks/moods for complete months covering at least four weeks (or back to the earliest un-cached
//   month), recompute + persist them, then aggregate the full year of cached months into the widget's habit rows.
//   Fixes both the 'only one habit discovered' miss (group by task text, not RRULE) and the ~20s full-year fetch."
import { logIfEnabled } from "util/log";
import {
  aggregateMonthlyHabits, computeMonthlyAggregates, habitGroupKey,
  HABIT_ANALYSIS_WINDOW_DAYS, HABIT_ANALYSIS_WINDOW_MONTHS, monthKeyFromDate, monthStartSeconds,
  trailingMonthKeys,
} from "energy-per-habit-analysis";
import { HABIT_CACHE_FORMAT_VERSION, loadHabitCache, monthTableMarkdown, persistHabitCache } from "energy-per-habit-cache";

const MIN_RECENT_HISTORY_DAYS = 28;
const WIDGET_ID = 'energy-per-habit';

// ------------------------------------------------------------------------------------------
// @desc Decide the contiguous run of months to recompute. It always includes every complete calendar month
//   touched by the recent-history floor, so a new month still analyzes at least four weeks of completions.
//   Legacy lossy caches force a one-time full-window backfill; otherwise traversal stops at older cached data.
// @param {Map<string, Object>} cachedMonths - Months already present in the cache note.
// @param {string} currentMonthKey - The current month's key.
// @param {boolean} forceFullWindow - Whether every month must be rebuilt.
// @param {string} recentHistoryStartMonthKey - Month containing the start of the recent-history floor.
// @param {Array<string>} windowMonths - Trailing month keys, oldest-first.
// @returns {Array<string>} Month keys to recompute, oldest-first.
function monthsToRecompute(cachedMonths, currentMonthKey, forceFullWindow, recentHistoryStartMonthKey, windowMonths) {
  const recompute = [];
  // Walk newest -> oldest; include months until we hit a cached PAST month, then stop.
  for (let i = windowMonths.length - 1; i >= 0; i--) {
    const monthKey = windowMonths[i];
    if (forceFullWindow || monthKey === currentMonthKey || monthKey >= recentHistoryStartMonthKey) {
      recompute.push(monthKey);
      continue;
    }
    if (cachedMonths.has(monthKey)) break;
    recompute.push(monthKey);
  }
  return recompute.sort();
}

// ------------------------------------------------------------------------------------------
// @desc Effective analyzed-window length in days: the full HABIT_ANALYSIS_WINDOW_DAYS, but capped so it never
//   exceeds the span from the oldest month that contributed a completion (behind the derived habits) up to now.
//   A user with only a few months of habit history then sees a realistic "N of <window> days" denominator
//   instead of a fixed 365. Off-day moods are aggregated per whole month, so anchoring the window at the oldest
//   data-bearing month's start (rather than an intra-month completion date) matches how the analysis is scoped.
// @param {Map<string, {rows: Array}>} merged - Month-keyed cache rows behind the derived habits.
// @param {number} nowSec - Reference "now" in unix seconds.
// @returns {number} Window length in days, in [1, HABIT_ANALYSIS_WINDOW_DAYS].
// [Claude claude-opus-4-8 (1M context)] Task: cap the analyzed window at the age of the oldest habit completion
function effectiveWindowDays(merged, nowSec) {
  let oldestStartSec = null;
  for (const [monthKey, month] of merged.entries()) {
    if (!month.rows || month.rows.length === 0) continue;
    const startSec = monthStartSeconds(monthKey);
    if (oldestStartSec == null || startSec < oldestStartSec) oldestStartSec = startSec;
  }
  if (oldestStartSec == null) return HABIT_ANALYSIS_WINDOW_DAYS;
  const spanDays = Math.floor((nowSec - oldestStartSec) / 86400) + 1;
  return Math.max(1, Math.min(HABIT_ANALYSIS_WINDOW_DAYS, spanDays));
}

// ------------------------------------------------------------------------------------------
// @desc The calendar month key immediately preceding a "YYYY-MM" key (Jan wraps to prior December).
// @param {string} monthKey - "YYYY-MM".
// @returns {string}
function previousMonthKey(monthKey) {
  const [year, month] = String(monthKey).split('-').map(Number);
  return monthKeyFromDate(new Date(year, (month || 1) - 2, 1));
}

// ------------------------------------------------------------------------------------------
// @desc Seed the week-streak carry from the cached month just before the oldest recomputed month: habit key
//   -> that month's stored end-of-month streak. This is how a streak persists across the fetch boundary (and
//   beyond the past year) without re-reading old completions.
// @param {Map<string, {rows: Array}>} cachedMonths - Parsed cache months.
// @param {string} oldestRecomputeKey - Oldest month being recomputed this load.
// @returns {Map<string, number>}
function priorStreakSeed(cachedMonths, oldestRecomputeKey) {
  const seed = new Map();
  const prev = cachedMonths.get(previousMonthKey(oldestRecomputeKey));
  for (const row of prev?.rows || []) seed.set(row.key, row.weekStreak || 0);
  return seed;
}

// ------------------------------------------------------------------------------------------
// @desc Map each freshly-fetched habit key to its most-recently-completed task's note/task reference, full
//   text, and the full `task` object itself, so a displayed row can navigate to the task's note and show the
//   complete task text on hover, and the load can log the exact most-recent task processed for each habit.
//   Only fresh (current + un-cached) tasks carry these; a habit last completed in a cached month has none.
// @param {Array<Object>} completedTasks - Freshly fetched completed tasks.
// @returns {Map<string, {noteUUID, taskUUID, fullText, completedAt, task}>}
function representativeTaskByKey(completedTasks) {
  const map = new Map();
  for (const task of completedTasks || []) {
    if (!task || task.completedAt == null || !task.content) continue;
    const key = habitGroupKey(task.content);
    if (!key) continue;
    const prev = map.get(key);
    if (!prev || task.completedAt > prev.completedAt) {
      map.set(key, { noteUUID: task.noteUUID || null, taskUUID: task.uuid || null,
        fullText: task.content, completedAt: task.completedAt, task });
    }
  }
  return map;
}

// ------------------------------------------------------------------------------------------
// @desc Load the Energy Per Habit analysis, cache-first. Reads the per-month cache note, fetches only the
//   completed tasks + moods needed to (re)compute the current and any un-cached recent months, persists them,
//   then aggregates the full year of cached + fresh months into the widget's sorted habit rows.
// @param {Object} app - Amplenote app bridge.
// @param {Object} [options] - { today } (test hook).
// @returns {Promise<{habits: Array, windowDays: number, cached: boolean, monthCount: number}>}
export async function loadEnergyPerHabit(app, { today = new Date() } = {}) {
  const overallStart = performance.now();
  const nowSec = Math.floor(today.getTime() / 1000);
  const currentMonthKey = monthKeyFromDate(today);
  const windowMonths = trailingMonthKeys(today, HABIT_ANALYSIS_WINDOW_MONTHS);
  const windowMonthSet = new Set(windowMonths);

  const cache = await loadHabitCache(app);
  logIfEnabled(`[${WIDGET_ID}] cache note ${cache.noteHandle ? 'found' : 'absent'} with ${cache.monthsByKey.size} cached month(s)`);

  const recentHistoryStart = new Date(today);
  recentHistoryStart.setDate(recentHistoryStart.getDate() - (MIN_RECENT_HISTORY_DAYS - 1));
  const recentHistoryStartMonthKey = monthKeyFromDate(recentHistoryStart);
  const forceFullWindow = !!cache.noteHandle && cache.formatVersion !== HABIT_CACHE_FORMAT_VERSION;
  const recomputeKeys = monthsToRecompute(cache.monthsByKey, currentMonthKey, forceFullWindow,
    recentHistoryStartMonthKey, windowMonths);
  const fetchFromSec = monthStartSeconds(recomputeKeys[0] || currentMonthKey);

  const tasksStart = performance.now();
  logIfEnabled(`[${WIDGET_ID}] fetching completed tasks from ${new Date(fetchFromSec * 1000).toISOString()} (${recomputeKeys.length} month(s) to recompute)`);
  const completedTasks = await app.getCompletedTasks(fetchFromSec, nowSec).then(r => Array.isArray(r) ? r : []);
  logIfEnabled(`[${WIDGET_ID}] completed tasks: ${completedTasks.length} in ${(performance.now() - tasksStart).toFixed(1)}ms`);

  const moodStart = performance.now();
  const moodRatings = await app.getMoodRatings(fetchFromSec).then(r => Array.isArray(r) ? r : []);
  logIfEnabled(`[${WIDGET_ID}] mood ratings: ${moodRatings.length} in ${(performance.now() - moodStart).toFixed(1)}ms`);

  const priorStreakByKey = priorStreakSeed(cache.monthsByKey, recomputeKeys[0] || currentMonthKey);
  const freshMonths = computeMonthlyAggregates({ completedTasks, moodRatings, monthKeys: recomputeKeys,
    today, priorStreakByKey });

  // Merge: keep cached months in the window, overwrite with freshly-computed months, drop out-of-window months.
  const merged = new Map();
  for (const [monthKey, month] of cache.monthsByKey.entries()) {
    if (windowMonthSet.has(monthKey)) merged.set(monthKey, month);
  }
  const changedMonthKeys = [];
  for (const [monthKey, month] of freshMonths.entries()) {
    const previous = merged.get(monthKey);
    if (!previous || monthTableMarkdown(previous.rows) !== monthTableMarkdown(month.rows)) {
      changedMonthKeys.push(monthKey);
    }
    merged.set(monthKey, month);
  }

  if (changedMonthKeys.length > 0 || forceFullWindow || !cache.noteHandle) {
    await persistHabitCache(app, { noteHandle: cache.noteHandle, rawContent: cache.rawContent,
      monthsByKey: merged, currentMonthKey, changedMonthKeys });
  }

  const habits = aggregateMonthlyHabits(merged, { enforceActivityEligibility: true, today });

  // Attach each displayed habit's most-recent task reference (note/task uuid + full text) for click-through
  // navigation and full-text hover titles. Habits last completed in a cached month simply have no reference.
  const refByKey = representativeTaskByKey(completedTasks);
  for (const habit of habits) {
    const ref = refByKey.get(habit.key);
    if (ref) { habit.noteUUID = ref.noteUUID; habit.taskUUID = ref.taskUUID; habit.fullText = ref.fullText; }
  }

  // Per output habit, log the most-recent `task` object that was processed for it (the representative fresh
  // task), so the derivation is auditable from the actual task rather than a per-task firehose. A habit last
  // completed in a cached month has no fresh task to show.
  logIfEnabled(`[${WIDGET_ID}] loaded ${habits.length} habit(s) from ${merged.size} month(s) in ${(performance.now() - overallStart).toFixed(1)}ms (fetched ${recomputeKeys.length} month(s)):`);
  for (const habit of habits) {
    const recentTask = refByKey.get(habit.key)?.task || null;
    logIfEnabled(`[${WIDGET_ID}]   habit key="${habit.key}" label="${habit.label}" completions=${habit.completions} weekStreak=${habit.weekStreak} delta=${habit.delta.toFixed(2)} most-recent task:`, recentTask);
  }
  return { habits, windowDays: effectiveWindowDays(merged, nowSec), cached: changedMonthKeys.length === 0 && !!cache.noteHandle,
    monthCount: merged.size };
}
