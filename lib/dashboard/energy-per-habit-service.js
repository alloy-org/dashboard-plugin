// [Claude claude-opus-4-8 (1M context)-authored file]
// Prompt summary: "orchestrate the Energy Per Habit load: read the per-month cache note first, only fetch
//   completed tasks/moods back to the earliest un-cached month (stopping once a cached past month is reached),
//   recompute + persist those months, then aggregate the full year of cached months into the widget's habit rows.
//   Fixes both the 'only one habit discovered' miss (group by task text, not RRULE) and the ~20s full-year fetch."
import { logIfEnabled } from "util/log";
import {
  aggregateMonthlyHabits, computeMonthlyAggregates, habitGroupKey, habitGroupLabel, habitKeyFromContent,
  HABIT_ANALYSIS_WINDOW_DAYS, HABIT_ANALYSIS_WINDOW_MONTHS, MIN_HABIT_WORDS, monthKeyFromDate, monthStartSeconds,
  trailingMonthKeys,
} from "energy-per-habit-analysis";
import { loadHabitCache, monthTableMarkdown, persistHabitCache } from "energy-per-habit-cache";

const WIDGET_ID = 'energy-per-habit';

// ------------------------------------------------------------------------------------------
// @desc Decide the contiguous run of months to (re)compute this load: always the current month, plus every
//   more-recent-than-cached month walking backward until a cached past month is reached (older months stay
//   cached and are never re-fetched). Returns oldest-first.
// @param {Array<string>} windowMonths - Trailing month keys, oldest-first.
// @param {string} currentMonthKey - The current month's key.
// @param {Map<string, Object>} cachedMonths - Months already present in the cache note.
// @returns {Array<string>} Month keys to recompute, oldest-first.
function monthsToRecompute(windowMonths, currentMonthKey, cachedMonths) {
  const recompute = [];
  // Walk newest -> oldest; include months until we hit a cached PAST month, then stop.
  for (let i = windowMonths.length - 1; i >= 0; i--) {
    const monthKey = windowMonths[i];
    if (monthKey === currentMonthKey) { recompute.push(monthKey); continue; }
    if (cachedMonths.has(monthKey)) break;
    recompute.push(monthKey);
  }
  return recompute.sort();
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
// @desc Map each freshly-fetched habit key to its most-recently-completed task's note/task reference and full
//   text, so a displayed row can navigate to the task's note and show the complete task text on hover. Only
//   fresh (current + un-cached) tasks carry these; a habit last completed in a cached month has no reference.
// @param {Array<Object>} completedTasks - Freshly fetched completed tasks.
// @returns {Map<string, {noteUUID, taskUUID, fullText, completedAt}>}
function representativeTaskByKey(completedTasks) {
  const map = new Map();
  for (const task of completedTasks || []) {
    if (!task || task.completedAt == null || !task.content) continue;
    const key = habitGroupKey(task.content);
    if (!key) continue;
    const prev = map.get(key);
    if (!prev || task.completedAt > prev.completedAt) {
      map.set(key, { noteUUID: task.noteUUID || null, taskUUID: task.uuid || null,
        fullText: task.content, completedAt: task.completedAt });
    }
  }
  return map;
}

// ------------------------------------------------------------------------------------------
// @desc Log the content -> key -> label derivation for every distinct habit discovered among the freshly
//   fetched tasks. This is the audit trail for diagnosing anomalous habit labels (e.g. a stray "direction"
//   row): it shows exactly which raw task content produced each grouping key and display label.
// @param {Array<Object>} completedTasks - Freshly fetched completed tasks.
// @returns {void}
// [Claude claude-opus-4-8 (1M context)] Task: per-task derivation logging to debug anomalous habit labels
function logDerivedHabits(completedTasks) {
  const seen = new Map();
  for (const task of completedTasks || []) {
    if (!task || task.completedAt == null || !task.content) continue;
    const key = habitGroupKey(task.content);
    if (!key || seen.has(key)) continue;
    // firstLineWords drives the grouping strategy: below MIN_HABIT_WORDS the task is keyed by its EXACT whole
    // content (short — only identical text groups); at/above it the first line is reduced and may fuzzy-merge.
    const firstLineWords = habitKeyFromContent(task.content).split(' ').filter(Boolean).length;
    seen.set(key, { label: habitGroupLabel(task.content), firstLineWords, sample: String(task.content).slice(0, 140) });
  }
  logIfEnabled(`[${WIDGET_ID}] derived ${seen.size} distinct habit key(s) from ${(completedTasks || []).length} fresh completed task(s):`);
  for (const [key, info] of seen.entries()) {
    const grouping = info.firstLineWords < MIN_HABIT_WORDS ? ' [short first line — exact whole-content match]' : '';
    logIfEnabled(`[${WIDGET_ID}]   key="${key}" firstLineWords=${info.firstLineWords}${grouping} label="${info.label}" ⟵ content=${JSON.stringify(info.sample)}`);
  }
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

  const recomputeKeys = monthsToRecompute(windowMonths, currentMonthKey, cache.monthsByKey);
  const fetchFromSec = monthStartSeconds(recomputeKeys[0] || currentMonthKey);

  const tasksStart = performance.now();
  logIfEnabled(`[${WIDGET_ID}] fetching completed tasks from ${new Date(fetchFromSec * 1000).toISOString()} (${recomputeKeys.length} month(s) to recompute)`);
  const completedTasks = await app.getCompletedTasks(fetchFromSec, nowSec).then(r => Array.isArray(r) ? r : []);
  logIfEnabled(`[${WIDGET_ID}] completed tasks: ${completedTasks.length} in ${(performance.now() - tasksStart).toFixed(1)}ms`);
  logDerivedHabits(completedTasks);

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

  if (changedMonthKeys.length > 0 || !cache.noteHandle) {
    await persistHabitCache(app, { noteHandle: cache.noteHandle, rawContent: cache.rawContent,
      monthsByKey: merged, currentMonthKey, changedMonthKeys });
  }

  const habits = aggregateMonthlyHabits(merged);

  // Attach each displayed habit's most-recent task reference (note/task uuid + full text) for click-through
  // navigation and full-text hover titles. Habits last completed in a cached month simply have no reference.
  const refByKey = representativeTaskByKey(completedTasks);
  for (const habit of habits) {
    const ref = refByKey.get(habit.key);
    if (ref) { habit.noteUUID = ref.noteUUID; habit.taskUUID = ref.taskUUID; habit.fullText = ref.fullText; }
  }

  logIfEnabled(`[${WIDGET_ID}] loaded ${habits.length} habit(s) from ${merged.size} month(s) in ${(performance.now() - overallStart).toFixed(1)}ms (fetched ${recomputeKeys.length} month(s)):`);
  for (const habit of habits) {
    logIfEnabled(`[${WIDGET_ID}]   habit key="${habit.key}" label="${habit.label}" completions=${habit.completions} weekStreak=${habit.weekStreak} delta=${habit.delta.toFixed(2)} noteUUID=${habit.noteUUID || 'none'}`);
  }
  return { habits, windowDays: HABIT_ANALYSIS_WINDOW_DAYS, cached: changedMonthKeys.length === 0 && !!cache.noteHandle,
    monthCount: merged.size };
}
