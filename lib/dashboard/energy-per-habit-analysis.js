import { dateKeyFromDateInput } from "util/date-utility";

// Number of trailing days the widget analyzes (matches the "365 DAYS ANALYZED" header).
export const HABIT_ANALYSIS_WINDOW_DAYS = 365;

// A habit must have been completed on at least this many distinct days to be worth charting;
// filters out one-off recurring tasks that never actually became a habit.
export const MIN_HABIT_DAYS = 3;

// ------------------------------------------------------------------------------------------
// @desc Normalize task content into a habit key by stripping emoji, markdown/footnote noise,
//   punctuation, and case so "🏃 Jog", "Jog", and "jog!" collapse to a single habit.
// @param {string} content - Raw task content (may contain emoji, markdown, footnote refs).
// @returns {string} Lowercased, whitespace-collapsed key ("" when nothing meaningful remains).
function habitKeyFromContent(content) {
  if (!content || typeof content !== 'string') return '';
  return content
    .split('\n')[0]                                   // first line only — drop footnote/image tails
    .replace(/\[\^?[^\]]*\]\([^)]*\)/g, ' ')          // markdown links / footnote refs
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, ' ') // emoji
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')      // punctuation
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ------------------------------------------------------------------------------------------
// @desc Human-facing label for a habit: the first line of the first task's content with any leading
//   emoji and markdown/footnote noise removed, so the row shows a clean text label beside the widget's
//   own habit icon (the raw content usually leads with a decorative emoji we don't want doubled).
// @param {string} content - Raw task content.
// @returns {string} Display label.
function habitLabelFromContent(content) {
  if (!content || typeof content !== 'string') return 'Untitled habit';
  const firstLine = content.split('\n')[0]
    .replace(/\[\^?([^\]]*)\]\([^)]*\)/g, '$1')       // unwrap markdown links, keep visible text
    .replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}️‍\s]+/gu, '') // leading emoji
    .replace(/\s+/g, ' ')
    .trim();
  return firstLine || 'Untitled habit';
}

// ------------------------------------------------------------------------------------------
// @desc Whether a task qualifies as a habit occurrence: it is completed and carries a recurrence
//   rule (task.repeat is a non-null RRULE string per the Amplenote task schema).
// @param {Object} task - A completed task object.
// @returns {boolean}
export function isHabitTask(task) {
  return !!task && task.completedAt != null && typeof task.repeat === 'string' && task.repeat.trim().length > 0;
}

// ------------------------------------------------------------------------------------------
// @desc Convert a unix-seconds (or ms) timestamp to a local YYYY-MM-DD date key.
// @param {number} unixSeconds - Timestamp in seconds (values >= 1e12 treated as ms).
// @returns {string|null} Date key, or null when the timestamp is missing.
function dayKeyFromTimestamp(unixSeconds) {
  if (unixSeconds == null) return null;
  const ms = unixSeconds >= 1e12 ? unixSeconds : unixSeconds * 1000;
  return dateKeyFromDateInput(new Date(ms));
}

// ------------------------------------------------------------------------------------------
// @desc Build a map of day key -> average mood rating for that day, from raw mood ratings.
//   Multiple ratings on one day are averaged so each day contributes a single mood value.
// @param {Array<Object>} moodRatings - Ratings with { rating, timestamp } (unix seconds).
// @returns {Object} Map of "YYYY-MM-DD" -> number (average rating for the day).
export function moodByDayFromRatings(moodRatings) {
  const sums = {};
  for (const mood of moodRatings || []) {
    if (!mood || mood.rating == null) continue;
    const key = dayKeyFromTimestamp(mood.timestamp);
    if (!key) continue;
    if (!sums[key]) sums[key] = { total: 0, count: 0 };
    sums[key].total += mood.rating;
    sums[key].count += 1;
  }
  const averaged = {};
  for (const key of Object.keys(sums)) {
    averaged[key] = sums[key].total / sums[key].count;
  }
  return averaged;
}

// ------------------------------------------------------------------------------------------
// @desc Compute the current consecutive-day streak for a set of completion day keys, counting
//   back from the most recent analyzed day. A day counts toward the streak only if the habit
//   was done that day; the streak ends at the first gap.
// @param {Set<string>} doneDayKeys - Day keys the habit was completed on.
// @param {Array<string>} orderedWindowKeys - Analyzed day keys, oldest-first.
// @returns {number} Length of the trailing streak ending on the most recent window day.
function currentStreak(doneDayKeys, orderedWindowKeys) {
  let streak = 0;
  for (let i = orderedWindowKeys.length - 1; i >= 0; i--) {
    if (doneDayKeys.has(orderedWindowKeys[i])) streak += 1;
    else break;
  }
  return streak;
}

// ------------------------------------------------------------------------------------------
// @desc Produce the ordered list of analyzed day keys (oldest-first) covering the trailing
//   window ending on `today`.
// @param {Date} today - The most recent analyzed day.
// @param {number} windowDays - Number of trailing days to include.
// @returns {Array<string>} Day keys, oldest-first, length === windowDays.
function windowDayKeys(today, windowDays) {
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
// @desc Analyze completed tasks + mood ratings into per-habit mood deltas over the trailing
//   window. For each habit (recurring task grouped by normalized content) the delta is the
//   average mood on days the habit was completed minus the average mood on all other analyzed
//   days that have a mood rating.
// @param {Object} params
//   - {Array<Object>} completedTasks - All completed tasks (only recurring ones are used).
//   - {Array<Object>} moodRatings - Mood ratings over (at least) the analysis window.
//   - {Date} [today] - Reference "most recent" day; defaults to now.
//   - {number} [windowDays] - Trailing window length; defaults to HABIT_ANALYSIS_WINDOW_DAYS.
//   - {number} [minDays] - Minimum distinct done-days for a habit to be included.
// @returns {Object} {
//     habits: Array<{ key, label, sampleContent, daysDone, streak, delta, doneWithMood,
//                     avgMoodOnDone, avgMoodOnOff }>,   // sorted by delta descending
//     windowDays, daysWithMood, moodDaysWithinWindow, totalHabitTasks
//   }
export function analyzeHabitMoodDeltas({ completedTasks, moodRatings, today = new Date(),
    windowDays = HABIT_ANALYSIS_WINDOW_DAYS, minDays = MIN_HABIT_DAYS }) {
  const orderedWindowKeys = windowDayKeys(today, windowDays);
  const windowKeySet = new Set(orderedWindowKeys);
  const moodByDay = moodByDayFromRatings(moodRatings);

  // Days within the window that actually have a mood rating — the universe over which deltas
  // are computed (a day with no mood contributes to neither the "done" nor "off" average).
  const moodDaysWithinWindow = orderedWindowKeys.filter(key => moodByDay[key] != null);
  const moodDayCount = moodDaysWithinWindow.length;

  const habitsByKey = new Map();
  let totalHabitTasks = 0;

  for (const task of completedTasks || []) {
    if (!isHabitTask(task)) continue;
    const dayKey = dayKeyFromTimestamp(task.completedAt);
    if (!dayKey || !windowKeySet.has(dayKey)) continue;
    const key = habitKeyFromContent(task.content);
    if (!key) continue;
    totalHabitTasks += 1;

    if (!habitsByKey.has(key)) {
      habitsByKey.set(key, { key, sampleContent: task.content, doneDayKeys: new Set() });
    }
    habitsByKey.get(key).doneDayKeys.add(dayKey);
  }

  const habits = [];
  for (const habit of habitsByKey.values()) {
    const daysDone = habit.doneDayKeys.size;
    if (daysDone < minDays) continue;

    let doneSum = 0, doneCount = 0, offSum = 0, offCount = 0;
    for (const key of moodDaysWithinWindow) {
      const mood = moodByDay[key];
      if (habit.doneDayKeys.has(key)) { doneSum += mood; doneCount += 1; }
      else { offSum += mood; offCount += 1; }
    }

    // Need mood coverage on both sides of the comparison for the delta to be meaningful.
    if (doneCount === 0 || offCount === 0) continue;

    const avgMoodOnDone = doneSum / doneCount;
    const avgMoodOnOff = offSum / offCount;
    habits.push({
      key: habit.key,
      label: habitLabelFromContent(habit.sampleContent),
      sampleContent: habit.sampleContent,
      daysDone,
      streak: currentStreak(habit.doneDayKeys, orderedWindowKeys),
      delta: avgMoodOnDone - avgMoodOnOff,
      doneWithMood: doneCount,
      avgMoodOnDone,
      avgMoodOnOff,
    });
  }

  habits.sort((a, b) => b.delta - a.delta);

  return { habits, windowDays, daysWithMood: moodDayCount, moodDaysWithinWindow: moodDayCount, totalHabitTasks };
}

// ------------------------------------------------------------------------------------------
// @desc Format a mood delta as a signed one-decimal string (e.g. 0.35 -> "+0.35", -0.19 -> "-0.19").
// @param {number} delta - Mood delta value.
// @returns {string}
export function formatDelta(delta) {
  const rounded = Math.round((delta || 0) * 100) / 100;
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
  return `${sign}${Math.abs(rounded).toFixed(2)}`;
}
