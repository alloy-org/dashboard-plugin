// [Claude claude-opus-4-8 (1M context)-authored file]
// Prompt summary: "orchestrate the Energy Per Habit load: read the per-month cache note first, only fetch
//   completed tasks/moods back to the earliest un-cached month (stopping once a cached past month is reached),
//   recompute + persist those months, then aggregate the full year of cached months into the widget's habit rows.
//   Fixes both the 'only one habit discovered' miss (group by task text, not RRULE) and the ~20s full-year fetch."
import { logIfEnabled } from "util/log";
import {
  aggregateMonthlyHabits, computeMonthlyAggregates, dayKeyFromTimestamp, habitKeyFromContent,
  HABIT_ANALYSIS_WINDOW_DAYS, HABIT_ANALYSIS_WINDOW_MONTHS, monthKeyFromDate, monthStartSeconds, trailingMonthKeys,
} from "energy-per-habit-analysis";
import { loadHabitCache, monthTableMarkdown, persistHabitCache } from "energy-per-habit-cache";
import { dateKeyFromDateInput } from "util/date-utility";

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
// @desc Build oldest-first day keys for the trailing window (streak reference axis).
// @param {Date} today
// @param {number} windowDays
// @returns {Array<string>}
function orderedWindowKeys(today, windowDays) {
  const keys = [];
  const base = new Date(today);
  base.setHours(0, 0, 0, 0);
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(d.getDate() - i);
    keys.push(dateKeyFromDateInput(d));
  }
  return keys;
}

// ------------------------------------------------------------------------------------------
// @desc Map each freshly-fetched habit key to the set of day keys it was completed on, for streaks.
// @param {Array<Object>} completedTasks
// @returns {Map<string, Set<string>>}
function doneDayKeysFromTasks(completedTasks) {
  const map = new Map();
  for (const task of completedTasks || []) {
    if (!task || task.completedAt == null) continue;
    const key = habitKeyFromContent(task.content);
    const dayKey = dayKeyFromTimestamp(task.completedAt);
    if (!key || !dayKey) continue;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(dayKey);
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

  const recomputeKeys = monthsToRecompute(windowMonths, currentMonthKey, cache.monthsByKey);
  const fetchFromSec = monthStartSeconds(recomputeKeys[0] || currentMonthKey);

  const tasksStart = performance.now();
  logIfEnabled(`[${WIDGET_ID}] fetching completed tasks from ${new Date(fetchFromSec * 1000).toISOString()} (${recomputeKeys.length} month(s) to recompute)`);
  const completedTasks = await app.getCompletedTasks(fetchFromSec, nowSec).then(r => Array.isArray(r) ? r : []);
  logIfEnabled(`[${WIDGET_ID}] completed tasks: ${completedTasks.length} in ${(performance.now() - tasksStart).toFixed(1)}ms`);

  const moodStart = performance.now();
  const moodRatings = await app.getMoodRatings(fetchFromSec).then(r => Array.isArray(r) ? r : []);
  logIfEnabled(`[${WIDGET_ID}] mood ratings: ${moodRatings.length} in ${(performance.now() - moodStart).toFixed(1)}ms`);

  const freshMonths = computeMonthlyAggregates({ completedTasks, moodRatings, monthKeys: recomputeKeys });

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

  const habits = aggregateMonthlyHabits(merged, {
    doneDayKeysByHabitKey: doneDayKeysFromTasks(completedTasks),
    orderedWindowKeys: orderedWindowKeys(today, HABIT_ANALYSIS_WINDOW_DAYS),
  });

  logIfEnabled(`[${WIDGET_ID}] loaded ${habits.length} habit(s) from ${merged.size} month(s) in ${(performance.now() - overallStart).toFixed(1)}ms (fetched ${recomputeKeys.length} month(s))`);
  return { habits, windowDays: HABIT_ANALYSIS_WINDOW_DAYS, cached: changedMonthKeys.length === 0 && !!cache.noteHandle,
    monthCount: merged.size };
}
