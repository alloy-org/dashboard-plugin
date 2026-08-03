import { FULL_MONTH_NAMES } from "constants/quarters";
import { dateFromDateInput, dateKeyFromDateInput, weekStartFromDateInput } from "util/date-utility";

// Number of trailing days the widget analyzes (matches the "365 DAYS ANALYZED" header).
export const HABIT_ANALYSIS_WINDOW_DAYS = 365;
// Thirteen calendar months are needed to cover a full trailing year near the start of a month.
export const HABIT_ANALYSIS_WINDOW_MONTHS = 13;
export const ESTABLISHED_HABIT_COMPLETIONS = 15;
export const ESTABLISHED_HABIT_RECENCY_DAYS = 60;
export const MIN_HABIT_COMPLETIONS = 5;
export const MIN_MOOD_DAYS_ON_DONE = 3;
// Retain single monthly occurrences so habits completed 10+ times across a year remain discoverable.
export const MIN_MONTHLY_COMPLETIONS = 1;
// Word threshold separating "short" habits (grouped by EXACT full content) from "phrase" habits (grouped by
// their reduced first line and eligible for fuzzy near-duplicate merging).
export const MIN_HABIT_WORDS = 3;

// ------------------------------------------------------------------------------------------
// @desc Shared key-normalization pipeline: strip markdown/footnote noise, emoji, and punctuation,
//   then collapse whitespace and lowercase. Callers choose which text slice to feed in.
// @param {string} text - Already-selected text (first line, or a full multi-line label).
// @returns {string} Lowercased, whitespace-collapsed key ("" when nothing meaningful remains).
function normalizeHabitKeyText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/\[\^?[^\]]*\]\([^)]*\)/g, ' ')          // markdown links / footnote refs
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, ' ') // emoji
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')      // punctuation
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ------------------------------------------------------------------------------------------
// @desc Normalize task content into a habit key by stripping emoji, markdown/footnote noise,
//   punctuation, and case so "🏃 Jog", "Jog", and "jog!" collapse to a single habit. Uses the
//   FIRST LINE only so footnote/image tails on raw task content do not affect the key.
// @param {string} content - Raw task content (may contain emoji, markdown, footnote refs).
// @returns {string} Lowercased, whitespace-collapsed key ("" when nothing meaningful remains).
export function habitKeyFromContent(content) {
  if (!content || typeof content !== 'string') return '';
  return normalizeHabitKeyText(content.split('\n')[0]);
}

// ------------------------------------------------------------------------------------------
// @desc Normalize a stored/grouping LABEL into a habit key. Unlike habitKeyFromContent, newlines
//   become spaces so short habits labeled by their FULL multi-line content stay distinct (bodies
//   that merely share a short first line do not collapse). Phrase-habit labels are already
//   first-line-only, so this matches habitKeyFromContent for those.
// @param {string} label - Habit grouping/display label (may be multi-line for short exact-match habits).
// @returns {string} Lowercased, whitespace-collapsed key ("" when nothing meaningful remains).
export function habitKeyFromLabel(label) {
  if (!label || typeof label !== 'string') return '';
  return normalizeHabitKeyText(label.replace(/\n+/g, ' '));
}

// ------------------------------------------------------------------------------------------
// @desc Human-facing label for a habit: the first line of the first task's content with markdown/footnote
//   noise removed but any LEADING EMOJI preserved. The leading emoji is retained (not stripped here) so it
//   survives through the cache to the widget, which uses a habit's own leading emoji as its canonical icon —
//   falling back to a keyword-derived glyph only when the habit text carries no emoji. The widget strips the
//   leading emoji at render time so the text label still reads cleanly beside that icon (see leadingEmoji /
//   stripLeadingEmoji).
// @param {string} content - Raw task content.
// @returns {string} Display label (may begin with a decorative emoji).
export function habitLabelFromContent(content) {
  if (!content || typeof content !== 'string') return 'Untitled habit';
  const firstLine = content.split('\n')[0]
    .replace(/\[\^?([^\]]*)\]\([^)]*\)/g, '$1')       // unwrap markdown links, keep visible text
    .replace(/\s+/g, ' ')
    .trim();
  return firstLine || 'Untitled habit';
}

// Leading-emoji matcher: a pictographic grapheme at the very start of the string, plus any variation-selector,
// zero-width-joiner, or skin-tone-modifier continuation, so multi-codepoint emoji (e.g. "☀️", "🏋️‍♀️") match whole.
const LEADING_EMOJI_CLASS = '\\p{Extended_Pictographic}\\p{Emoji_Presentation}\\u200d\\ufe0f\\u{1f3fb}-\\u{1f3ff}';
const LEADING_EMOJI_RE = new RegExp(`^([\\p{Extended_Pictographic}\\p{Emoji_Presentation}][${LEADING_EMOJI_CLASS}]*)`, 'u');
const STRIP_LEADING_EMOJI_RE = new RegExp(`^[${LEADING_EMOJI_CLASS}]+\\s*`, 'u');

// ------------------------------------------------------------------------------------------
// @desc The leading emoji of a label (a pictographic grapheme plus any variation-selector / ZWJ / skin-tone
//   continuation), or '' when the label does not begin with an emoji. Used by the widget to prefer a habit's
//   own emoji as its icon over the keyword-hint glyph.
// @param {string} label - Habit display label.
// @returns {string} The leading emoji, or '' when none.
export function leadingEmoji(label) {
  const match = String(label || '').match(LEADING_EMOJI_RE);
  return match ? match[1].trim() : '';
}

// ------------------------------------------------------------------------------------------
// @desc A label with any leading emoji (and the whitespace after it) removed, for rendering the text beside
//   the widget's icon. Falls back to the trimmed original when the label is nothing but an emoji, so a row
//   never renders an empty label.
// @param {string} label - Habit display label.
// @returns {string} Label without its leading emoji.
export function stripLeadingEmoji(label) {
  const stripped = String(label || '').replace(STRIP_LEADING_EMOJI_RE, '').trim();
  return stripped || String(label || '').trim();
}

// ------------------------------------------------------------------------------------------
// @desc The label a task is grouped and cached under. A task whose normalized FIRST LINE is a short phrase
//   (fewer than `minWords` significant words, e.g. a bare "Direction") is labeled by its FULL content, so it
//   only groups with tasks whose entire text matches — never merely their first line. A longer first line
//   keeps the first-line label (dropping footnote/image tails) as before. Both the fresh and cache-readback
//   paths derive the grouping key as habitKeyFromLabel(thisLabel), so storing this label makes the
//   exact-vs-first-line choice round-trip through the cache note unchanged.
// @param {string} content - Raw task content.
// @param {number} [minWords=MIN_HABIT_WORDS] - First-line word count at/above which the first-line label is kept.
// @returns {string} Grouping/display label.
export function habitGroupLabel(content, minWords = MIN_HABIT_WORDS) {
  // habitKeyFromContent is first-line-only, so its word count IS the normalized first-line word count.
  if (habitKeyFromContent(content).split(' ').filter(Boolean).length >= minWords) {
    return habitLabelFromContent(content);
  } else {
    return content.trim();
  }
}

// ------------------------------------------------------------------------------------------
// @desc Canonical grouping key for a completed task: the key of its grouping LABEL rather than of its raw
//   content. The cache stores only that label and re-derives its key as habitKeyFromLabel(label) when a
//   month is read back, so the fresh (task-content) path MUST key by the same label to stay consistent —
//   otherwise a habit grouped one way on first (all-fresh) load can regroup/vanish once past months are served
//   from cache. Short habits label by full content and long habits by their first line (see habitGroupLabel),
//   and either way key === habitKeyFromLabel(label), so the cache round-trips exactly.
// @param {string} content - Raw task content.
// @returns {string} Normalized habit key matching the cache's label-derived key.
// [Claude claude-opus-4-8 (1M context)] Task: unify fresh/cache grouping key to stop habits vanishing when cached
export function habitGroupKey(content) {
  return habitKeyFromLabel(habitGroupLabel(content));
}

// ------------------------------------------------------------------------------------------
// @desc Significant words of a habit label: its normalized key split into tokens (lowercased, emoji/
//   markdown/punctuation already stripped by habitKeyFromContent). Used for the "3+ words" habit floor
//   and the ">half words in common" fuzzy-merge test.
// @param {string} label - Habit display label (or any content).
// @returns {Array<string>} Distinct-order token list ("" tokens removed).
function habitWords(label) {
  return habitKeyFromContent(label).split(' ').filter(Boolean);
}

// ------------------------------------------------------------------------------------------
// @desc Whether two habits should be treated as the same habit: both must have at least `minWords`
//   significant words and share MORE than half of the smaller word set (so "Write jokes and direction for
//   video 20" and "...for video 21" merge, but a big block that merely mentions a shared word does not).
// @param {Array<string>} wordsA - Significant words of habit A.
// @param {Array<string>} wordsB - Significant words of habit B.
// @param {number} minWords - Minimum significant words each side must have to be mergeable.
// @returns {boolean}
function habitsShareMajority(wordsA, wordsB, minWords) {
  const smaller = Math.min(wordsA.length, wordsB.length);
  if (smaller < minWords) return false;
  const setB = new Set(wordsB);
  let common = 0;
  for (const word of new Set(wordsA)) if (setB.has(word)) common += 1;
  return common > smaller / 2;
}

// ------------------------------------------------------------------------------------------
// @desc Merge per-habit aggregates whose labels are near-duplicate phrasings (per habitsShareMajority) into a
//   single aggregate. Only multi-word ("phrase") habits — those with at least MIN_HABIT_WORDS significant
//   label words — are compared and merged; short habits (already grouped by exact whole-content key upstream)
//   pass through untouched as singletons and are never merged with anything. Determinism: keys are processed in
//   sorted order and each cluster's representative (label/streak) is its highest-completion member (ties broken
//   by smallest key), so the same label set always yields the same clusters regardless of input order —
//   important because this runs fresh on every load over a mix of cached and recomputed month rows.
// @param {Map<string, Object>} aggregateByKey - Per-habit aggregates keyed by normalized content.
// @returns {Map<string, Object>} Clustered aggregates keyed by each cluster's representative key.
function clusterHabitAggregates(aggregateByKey) {
  const keys = [...aggregateByKey.keys()].sort();
  // Short habits are exact-match singletons; only phrase habits (>= MIN_HABIT_WORDS label words) can merge.
  const phraseKeys = keys.filter(key => habitWords(aggregateByKey.get(key).label).length >= MIN_HABIT_WORDS);
  const wordsByKey = new Map(phraseKeys.map(key => [key, habitWords(aggregateByKey.get(key).label)]));

  // Union-find so transitively-similar phrasings land in one cluster (short keys stay their own root).
  const parent = new Map(keys.map(key => [key, key]));
  const find = (key) => { while (parent.get(key) !== key) { parent.set(key, parent.get(parent.get(key))); key = parent.get(key); } return key; };
  for (let i = 0; i < phraseKeys.length; i++) {
    for (let j = i + 1; j < phraseKeys.length; j++) {
      if (habitsShareMajority(wordsByKey.get(phraseKeys[i]), wordsByKey.get(phraseKeys[j]), MIN_HABIT_WORDS)) {
        parent.set(find(phraseKeys[i]), find(phraseKeys[j]));
      }
    }
  }

  const clusters = new Map();
  for (const key of keys) {
    const root = find(key);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(key);
  }

  const merged = new Map();
  for (const memberKeys of clusters.values()) {
    // Representative = most-completed member (ties -> smallest key), for the displayed label/key/streak.
    const representativeKey = memberKeys.slice().sort((a, b) =>
      (aggregateByKey.get(b).completions || 0) - (aggregateByKey.get(a).completions || 0) || (a < b ? -1 : 1))[0];
    const representative = aggregateByKey.get(representativeKey);
    const combined = { label: representative.label, sampleContent: representative.sampleContent || representative.label,
      completions: 0, doneMoods: [], mostRecentDayKey: null, offMoods: [], weekStreak: 0 };
    let sawDaysDone = false, sawDoneDayKeys = false;
    for (const key of memberKeys) {
      const aggregate = aggregateByKey.get(key);
      combined.completions += aggregate.completions || 0;
      if (Array.isArray(aggregate.doneMoods)) combined.doneMoods.push(...aggregate.doneMoods);
      if (Array.isArray(aggregate.offMoods)) combined.offMoods.push(...aggregate.offMoods);
      if (aggregate.mostRecentDayKey && (!combined.mostRecentDayKey
          || aggregate.mostRecentDayKey > combined.mostRecentDayKey)) {
        combined.mostRecentDayKey = aggregate.mostRecentDayKey;
      }
      // Show the strongest member's week streak (habitsFromAggregates recomputes day-streak from doneDayKeys).
      if (aggregate.weekStreak != null) combined.weekStreak = Math.max(combined.weekStreak, aggregate.weekStreak);
      if (aggregate.daysDone != null) {
        combined.daysDone = (combined.daysDone || 0) + aggregate.daysDone; sawDaysDone = true;
      }
      if (aggregate.doneDayKeys) {
        if (!combined.doneDayKeys) combined.doneDayKeys = new Set();
        for (const dayKey of aggregate.doneDayKeys) combined.doneDayKeys.add(dayKey);
        sawDoneDayKeys = true;
      }
    }
    if (!sawDaysDone && !sawDoneDayKeys) combined.daysDone = 0;
    merged.set(representativeKey, combined);
  }
  return merged;
}

// ------------------------------------------------------------------------------------------
// @desc Whether a task qualifies as a habit occurrence: it is completed and carries a recurrence
//   rule (task.repeat is a non-null RRULE string per the Amplenote task schema). Retained for
//   reference/tests — no longer used to gate inclusion, since re-completed non-RRULE tasks count too.
// @param {Object} task - A completed task object.
// @returns {boolean}
export function isHabitTask(task) {
  return !!task && task.completedAt != null && typeof task.repeat === 'string' && task.repeat.trim().length > 0;
}

// ------------------------------------------------------------------------------------------
// @desc Convert a unix-seconds (or ms) timestamp to a local YYYY-MM-DD date key. Delegates the
//   seconds-vs-ms disambiguation to date-utility's dateKeyFromDateInput (numbers < 1e10 are treated
//   as seconds), so no local timestamp math is needed.
// @param {number} unixSeconds - Timestamp in seconds (ms also accepted).
// @returns {string|null} Date key, or null when the timestamp is missing.
// [Claude claude-opus-4-8 (1M context)] Task: delegate timestamp→date-key to date-utility (drop local ms math)
export function dayKeyFromTimestamp(unixSeconds) {
  if (unixSeconds == null) return null;
  return dateKeyFromDateInput(unixSeconds);
}

// ------------------------------------------------------------------------------------------
// @desc Local "YYYY-MM" month key for a unix-seconds (or ms) timestamp. Reuses date-utility's
//   dateFromDateInput for the seconds-vs-ms normalization.
// @param {number} unixSeconds - Timestamp in seconds (ms also accepted).
// @returns {string|null} Month key, or null when the timestamp is missing.
// [Claude claude-opus-4-8 (1M context)] Task: delegate timestamp normalization to date-utility
export function monthKeyFromTimestamp(unixSeconds) {
  if (unixSeconds == null) return null;
  return monthKeyFromDate(dateFromDateInput(unixSeconds));
}

// ------------------------------------------------------------------------------------------
// @desc Local "YYYY-MM" month key for a Date — the leading year-month of date-utility's local date key.
// @param {Date} date - Any date within the target month.
// @returns {string}
// [Claude claude-opus-4-8 (1M context)] Task: derive month key from date-utility's date key (DRY)
export function monthKeyFromDate(date) {
  return dateKeyFromDateInput(date).slice(0, 7);
}

// ------------------------------------------------------------------------------------------
// @desc Human month heading ("2026-05" -> "May 2026") used as the cache-note section heading.
// @param {string} monthKey - "YYYY-MM" key.
// @returns {string}
export function monthLabelFromMonthKey(monthKey) {
  const [year, month] = String(monthKey).split('-').map(Number);
  const name = FULL_MONTH_NAMES[(month || 1) - 1] || '';
  return `${name} ${year}`;
}

// ------------------------------------------------------------------------------------------
// @desc Parse a "May 2026"-style heading back into a "YYYY-MM" month key (null when unrecognized).
// @param {string} label - Month heading text.
// @returns {string|null}
export function monthKeyFromMonthLabel(label) {
  if (!label || typeof label !== 'string') return null;
  const match = label.trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!match) return null;
  const monthIndex = FULL_MONTH_NAMES.findIndex(name => name.toLowerCase() === match[1].toLowerCase());
  if (monthIndex < 0) return null;
  return `${match[2]}-${String(monthIndex + 1).padStart(2, '0')}`;
}

// ------------------------------------------------------------------------------------------
// @desc Ordered list of the trailing `count` month keys ending at `today`'s month (oldest-first).
// @param {Date} today - Reference "most recent" day.
// @param {number} [count=HABIT_ANALYSIS_WINDOW_MONTHS] - Number of trailing months.
// @returns {Array<string>} Month keys, oldest-first.
export function trailingMonthKeys(today = new Date(), count = HABIT_ANALYSIS_WINDOW_MONTHS) {
  const keys = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    keys.push(monthKeyFromDate(d));
  }
  return keys;
}

// ------------------------------------------------------------------------------------------
// @desc Unix-seconds timestamp for local midnight on the first day of a "YYYY-MM" month.
// @param {string} monthKey - "YYYY-MM" key.
// @returns {number} Unix seconds.
export function monthStartSeconds(monthKey) {
  const [year, month] = String(monthKey).split('-').map(Number);
  return Math.floor(new Date(year, (month || 1) - 1, 1, 0, 0, 0, 0).getTime() / 1000);
}

// ------------------------------------------------------------------------------------------
// @desc Week key for a day: the local date key of that week's Monday (weeks are Monday-start via
//   date-utility's weekStartFromDateInput). Used to bucket completions into calendar weeks for streaks.
// @param {string} dayKey - A "YYYY-MM-DD" date key.
// @returns {string} The Monday's "YYYY-MM-DD" key.
// [Claude claude-opus-4-8 (1M context)] Task: week bucketing for the consecutive-weeks streak
export function weekKeyFromDayKey(dayKey) {
  return dateKeyFromDateInput(weekStartFromDateInput(dayKey));
}

// ------------------------------------------------------------------------------------------
// @desc Ordered (ascending) week keys "belonging to" a month: every Monday-week whose Monday falls within
//   the month, capped at the current week so a partial current month never counts weeks that haven't begun.
//   Attributing each week to the month of its Monday partitions weeks across months with no overlap, so a
//   running streak can be carried month-to-month without double-counting a boundary week.
// @param {string} monthKey - "YYYY-MM".
// @param {Date} [today] - Reference "now"; weeks after today's week are excluded.
// @returns {Array<string>} Monday keys, oldest-first.
// [Claude claude-opus-4-8 (1M context)] Task: enumerate a month's weeks for streak carry
export function weekStartsInMonth(monthKey, today = new Date()) {
  const [year, month] = String(monthKey).split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const capKey = weekKeyFromDayKey(dateKeyFromDateInput(today));
  const starts = [];
  const seen = new Set();
  for (let day = 1; day <= lastDay; day++) {
    const weekKey = weekKeyFromDayKey(dateKeyFromDateInput(new Date(year, month - 1, day)));
    if (weekKey.slice(0, 7) !== monthKey) continue; // week's Monday is in an adjacent month — counted there
    if (seen.has(weekKey) || weekKey > capKey) continue;
    seen.add(weekKey);
    starts.push(weekKey);
  }
  return starts;
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
// @desc Mean of a numeric array, or 0 when empty.
// @param {Array<number>} values
// @returns {number}
function mean(values) {
  if (!values || values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// ------------------------------------------------------------------------------------------
// @desc Shared aggregation core: turn per-habit aggregates (completions + done/off mood samples)
//   into the sorted, eligibility-filtered habit rows the widget renders. Used by both the direct
//   single-shot analysis and the cache-backed monthly aggregation so their deltas stay identical.
// @param {Map<string, {label, completions, doneMoods:Array<number>, offMoods:Array<number>,
//   doneDayKeys?:Set<string>}>} aggregateByKey - Per-habit aggregates keyed by normalized content.
// @param {Object} options
//   - {Array<string>} [orderedWindowKeys] - Day keys oldest-first, for streak computation.
//   - {number} [minCompletions] - Minimum window completions for eligibility.
//   - {number} [minMoodDays] - Minimum done-days-with-mood for eligibility.
// @returns {Array<Object>} Sorted habit rows (delta descending).
// [Cursor Grok 4.5] Task: expand abbreviated aggregate parameter/locals for readability
export function habitsFromAggregates(aggregateByKey, { orderedWindowKeys = [], minCompletions = MIN_HABIT_COMPLETIONS,
    minMoodDays = MIN_MOOD_DAYS_ON_DONE } = {}) {
  // Merge near-duplicate phrasings of the same phrase habit (short habits pass through as exact-match singletons).
  const clustered = clusterHabitAggregates(aggregateByKey);
  const habits = [];
  for (const [key, aggregate] of clustered.entries()) {
    const doneWithMood = aggregate.doneMoods.length;
    const offWithMood = aggregate.offMoods.length;
    // Eligible when the task recurs enough and has mood coverage on both sides of the comparison.
    if (aggregate.completions < minCompletions || doneWithMood < minMoodDays || offWithMood === 0) continue;

    const avgMoodOnDone = mean(aggregate.doneMoods);
    const avgMoodOnOff = mean(aggregate.offMoods);
    habits.push({
      key,
      label: aggregate.label,
      sampleContent: aggregate.sampleContent || aggregate.label,
      completions: aggregate.completions,
      // Prefer an explicit window-wide days count (cache path) so the meta stays stable regardless of how
      // many months were freshly fetched; fall back to distinct fresh done-days for the direct analysis.
      daysDone: aggregate.daysDone != null ? aggregate.daysDone
        : (aggregate.doneDayKeys ? aggregate.doneDayKeys.size : doneWithMood),
      streak: aggregate.doneDayKeys ? currentStreak(aggregate.doneDayKeys, orderedWindowKeys) : 0,
      // Consecutive-weeks streak (cache path). 0 for the direct day-based analysis, which has no month carry.
      weekStreak: aggregate.weekStreak != null ? aggregate.weekStreak : 0,
      delta: avgMoodOnDone - avgMoodOnOff,
      doneWithMood,
      offWithMood,
      avgMoodOnDone,
      avgMoodOnOff,
      mostRecentDayKey: aggregate.mostRecentDayKey || null,
    });
  }
  habits.sort((a, b) => b.delta - a.delta);
  return habits;
}

// ------------------------------------------------------------------------------------------
// @desc Build per-habit window aggregates directly from raw completed tasks + mood ratings, grouping
//   every completed task by normalized content (recurrence rule NOT required). Off-day moods are all
//   mood-rated window days on which the habit was not completed.
// @param {Object} params - { completedTasks, moodRatings, today, windowDays }
// @returns {{ aggregateByKey: Map, orderedWindowKeys: Array<string>, moodDayCount: number, totalCompletions: number }}
function windowAggregates({ completedTasks, moodRatings, today, windowDays }) {
  const orderedWindowKeys = windowDayKeys(today, windowDays);
  const windowKeySet = new Set(orderedWindowKeys);
  const moodByDay = moodByDayFromRatings(moodRatings);
  const moodDaysWithinWindow = orderedWindowKeys.filter(key => moodByDay[key] != null);

  const grouped = new Map();
  let totalCompletions = 0;
  for (const task of completedTasks || []) {
    if (!task || task.completedAt == null) continue;
    const dayKey = dayKeyFromTimestamp(task.completedAt);
    if (!dayKey || !windowKeySet.has(dayKey)) continue;
    const key = habitGroupKey(task.content);
    if (!key) continue;
    totalCompletions += 1;
    if (!grouped.has(key)) {
      grouped.set(key, { label: habitGroupLabel(task.content), sampleContent: task.content,
        completions: 0, doneDayKeys: new Set() });
    }
    const entry = grouped.get(key);
    entry.completions += 1;
    entry.doneDayKeys.add(dayKey);
    if (!entry.mostRecentDayKey || dayKey > entry.mostRecentDayKey) entry.mostRecentDayKey = dayKey;
  }

  const aggregateByKey = new Map();
  for (const [key, entry] of grouped.entries()) {
    const doneMoods = [], offMoods = [];
    for (const dayKey of moodDaysWithinWindow) {
      const moodValue = moodByDay[dayKey];
      if (entry.doneDayKeys.has(dayKey)) doneMoods.push(moodValue);
      else offMoods.push(moodValue);
    }
    aggregateByKey.set(key, { label: entry.label, sampleContent: entry.sampleContent, completions: entry.completions,
      doneMoods, mostRecentDayKey: entry.mostRecentDayKey, offMoods, doneDayKeys: entry.doneDayKeys });
  }
  return { aggregateByKey, orderedWindowKeys, moodDayCount: moodDaysWithinWindow.length, totalCompletions };
}

// ------------------------------------------------------------------------------------------
// @desc Analyze completed tasks + mood ratings into per-habit mood deltas over the trailing
//   window. For each habit (tasks grouped by normalized content) the delta is the average mood on
//   days the habit was completed minus the average mood on all other analyzed days that have a
//   mood rating. Eligibility: completed >= minCompletions times with mood on >= minMoodDays done-days.
// @param {Object} params
//   - {Array<Object>} completedTasks - All completed tasks (grouped by content; repeat not required).
//   - {Array<Object>} moodRatings - Mood ratings over (at least) the analysis window.
//   - {Date} [today] - Reference "most recent" day; defaults to now.
//   - {number} [windowDays] - Trailing window length; defaults to HABIT_ANALYSIS_WINDOW_DAYS.
//   - {number} [minCompletions] - Minimum window completions for a habit to be included.
//   - {number} [minMoodDays] - Minimum done-days-with-mood for a habit to be included.
// @returns {Object} { habits, windowDays, daysWithMood, moodDaysWithinWindow, totalHabitTasks }
// [Claude claude-opus-4-8 (1M context)] Task: group completed tasks by content (drop RRULE gate) so
//   repeatedly-completed non-recurring tasks surface; eligibility by completion count + mood coverage
export function analyzeHabitMoodDeltas({ completedTasks, moodRatings, today = new Date(),
    windowDays = HABIT_ANALYSIS_WINDOW_DAYS, minCompletions = MIN_HABIT_COMPLETIONS,
    minMoodDays = MIN_MOOD_DAYS_ON_DONE }) {
  const { aggregateByKey, orderedWindowKeys, moodDayCount, totalCompletions } =
    windowAggregates({ completedTasks, moodRatings, today, windowDays });
  const habits = habitsFromAggregates(aggregateByKey, { orderedWindowKeys, minCompletions, minMoodDays });
  return { habits, windowDays, daysWithMood: moodDayCount, moodDaysWithinWindow: moodDayCount,
    totalHabitTasks: totalCompletions };
}

// ------------------------------------------------------------------------------------------
// @desc End-of-month consecutive-weeks-completed streak for one habit: continue `seed` (the prior month's
//   end value) across this month's calendar weeks (oldest-first), +1 for each week the habit was completed
//   at least once, reset to 0 on a week with no completion. The in-progress current week is "pending" — a
//   not-yet-completed current week neither increments nor resets, so a live streak isn't zeroed mid-week.
// @param {Array<string>} monthWeekKeys - This month's Monday-week keys, oldest-first (from weekStartsInMonth).
// @param {Set<string>} completedWeekKeys - Monday-week keys the habit was completed in (this month).
// @param {number} seed - Prior month's end-of-month streak (0 when none).
// @param {string} currentWeekKey - The Monday key of the week containing "today".
// @returns {number} The streak as of the end of the month.
function monthEndWeekStreak(monthWeekKeys, completedWeekKeys, seed, currentWeekKey) {
  let running = seed || 0;
  for (const weekKey of monthWeekKeys) {
    if (completedWeekKeys.has(weekKey)) running += 1;
    else if (weekKey !== currentWeekKey) running = 0; // a fully-elapsed week with no completion breaks it
  }
  return running;
}

// ------------------------------------------------------------------------------------------
// @desc Compute the per-month, per-habit cache rows for one or more months: for each requested month,
//   every habit completed at least MIN_MONTHLY_COMPLETIONS times that month, with its completion count,
//   the consecutive-weeks streak as of the end of that month, and the mood ratings on days it was / wasn't
//   completed within that month. This is the shape persisted to the archived cache note (one table per month).
//   Months are processed oldest-first so each month's week streak continues from the previous month's — with
//   the oldest requested month seeded from `priorStreakByKey` (the last cached month before this run), which
//   is how streaks are retained beyond the fetched window.
// @param {Object} params
//   - {Array<Object>} completedTasks - Completed tasks covering (at least) the requested months.
//   - {Array<Object>} moodRatings - Mood ratings covering (at least) the requested months.
//   - {Array<string>} monthKeys - "YYYY-MM" keys to compute.
//   - {number} [minMonthlyCompletions] - Minimum in-month completions to store a row.
//   - {Date} [today] - Reference "now" for the current (partial) week/month.
//   - {Map<string, number>} [priorStreakByKey] - Habit key -> streak at the end of the month before the
//     oldest requested month (seeds the streak carry across the cache boundary).
// @returns {Map<string, {monthKey, label, rows: Array<{label, key, count, weekStreak, doneMoods,
//   mostRecentDayKey, offMoods}>}>}
// [Claude claude-opus-4-8 (1M context)] Task: per-month completion tables + carried consecutive-weeks streak
export function computeMonthlyAggregates({ completedTasks, moodRatings, monthKeys,
    minMonthlyCompletions = MIN_MONTHLY_COMPLETIONS, today = new Date(), priorStreakByKey = new Map() }) {
  const wantedMonths = new Set(monthKeys || []);
  const moodByDay = moodByDayFromRatings(moodRatings);
  const currentWeekKey = weekKeyFromDayKey(dateKeyFromDateInput(today));

  // month -> Map(habitKey -> { label, sampleContent, count, doneDayKeys })
  const perMonth = new Map();
  for (const monthKey of wantedMonths) perMonth.set(monthKey, new Map());
  // Per-habit set of completed week keys, GLOBAL across months: a week's Monday can fall in a different month
  // than some of that week's days, so a completion is bucketed by its week (not its day's month) for streaks —
  // otherwise a boundary-week completion would be missed by both months and wrongly break the streak.
  const completedWeeksByKey = new Map();

  for (const task of completedTasks || []) {
    if (!task || task.completedAt == null) continue;
    const monthKey = monthKeyFromTimestamp(task.completedAt);
    if (!monthKey || !wantedMonths.has(monthKey)) continue;
    const key = habitGroupKey(task.content);
    if (!key) continue;
    const monthHabits = perMonth.get(monthKey);
    if (!monthHabits.has(key)) {
      monthHabits.set(key, { label: habitGroupLabel(task.content), sampleContent: task.content,
        count: 0, doneDayKeys: new Set() });
    }
    const entry = monthHabits.get(key);
    entry.count += 1;
    const dayKey = dayKeyFromTimestamp(task.completedAt);
    if (dayKey) {
      entry.doneDayKeys.add(dayKey);
      if (!completedWeeksByKey.has(key)) completedWeeksByKey.set(key, new Set());
      completedWeeksByKey.get(key).add(weekKeyFromDayKey(dayKey));
    }
  }

  // Mood-rated day keys grouped by month, so off-day moods are month-scoped.
  const moodDaysByMonth = new Map();
  for (const dayKey of Object.keys(moodByDay)) {
    const monthKey = `${dayKey.slice(0, 7)}`;
    if (!wantedMonths.has(monthKey)) continue;
    if (!moodDaysByMonth.has(monthKey)) moodDaysByMonth.set(monthKey, []);
    moodDaysByMonth.get(monthKey).push(dayKey);
  }

  // Carry the consecutive-weeks streak forward month-to-month (oldest-first), seeded from the cache boundary.
  const streakByKey = new Map();
  const result = new Map();
  for (const monthKey of [...wantedMonths].sort()) {
    const monthHabits = perMonth.get(monthKey);
    const monthMoodDays = moodDaysByMonth.get(monthKey) || [];
    const monthWeekKeys = weekStartsInMonth(monthKey, today);
    const rows = [];
    for (const [key, entry] of monthHabits.entries()) {
      // Streak continues even in months where the habit is too sparse to store a row, so compute it for all.
      const seed = streakByKey.has(key) ? streakByKey.get(key) : (priorStreakByKey.get(key) || 0);
      const completedWeeks = completedWeeksByKey.get(key) || new Set();
      const weekStreak = monthEndWeekStreak(monthWeekKeys, completedWeeks, seed, currentWeekKey);
      streakByKey.set(key, weekStreak);
      if (entry.count < minMonthlyCompletions) continue;
      const doneMoods = [], offMoods = [];
      for (const dayKey of monthMoodDays) {
        const moodValue = moodByDay[dayKey];
        if (entry.doneDayKeys.has(dayKey)) doneMoods.push(round2(moodValue));
        else offMoods.push(round2(moodValue));
      }
      const mostRecentDayKey = [...entry.doneDayKeys].sort().at(-1) || null;
      rows.push({ label: entry.label, key, count: entry.count, weekStreak, doneMoods, mostRecentDayKey, offMoods });
    }
    rows.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    result.set(monthKey, { monthKey, label: monthLabelFromMonthKey(monthKey), rows });
  }
  return result;
}

// ------------------------------------------------------------------------------------------
// @desc Merge stored/fresh monthly cache rows into per-habit window aggregates and produce sorted habit rows.
//   When activity eligibility is enabled, habits below the established-completion threshold require a positive
//   streak plus a completion in the current or previous week; established habits require a completion within
//   the recent-day window. This prevents stale cached streaks and old one-off task clusters from surfacing.
// @param {Map<string, {rows: Array}>} monthsByKey - Per-month cache rows (from cache or computeMonthlyAggregates).
// @param {Object} options
//   - {Map<string, Set<string>>} [doneDayKeysByHabitKey] - Fresh completion day keys for streak computation.
//   - {Array<string>} [orderedWindowKeys] - Day keys oldest-first for streak computation.
//   - {boolean} [enforceActivityEligibility] - Apply active-streak / established-recent eligibility.
//   - {number} [minCompletions] - Minimum yearly completions for eligibility.
//   - {number} [minMoodDays] - Minimum done-days-with-mood for eligibility.
//   - {Date} [today] - Reference date for activity eligibility.
// @returns {Array<Object>} Sorted habit rows.
// [Claude claude-opus-4-8 (1M context)] Task: aggregate cached monthly tables into the widget's habit rows
export function aggregateMonthlyHabits(monthsByKey, { enforceActivityEligibility = false, orderedWindowKeys = [],
    minCompletions = MIN_HABIT_COMPLETIONS, minMoodDays = MIN_MOOD_DAYS_ON_DONE, today = new Date() } = {}) {
  const aggregateByKey = new Map();
  const latestMonthByKey = new Map();
  for (const month of monthsByKey.values()) {
    for (const row of month.rows || []) {
      const key = row.key || habitKeyFromLabel(row.label);
      if (!key) continue;
      if (!aggregateByKey.has(key)) {
        aggregateByKey.set(key, { label: row.label, sampleContent: row.label, completions: 0,
          doneMoods: [], mostRecentDayKey: null, offMoods: [], weekStreak: 0 });
      }
      const aggregate = aggregateByKey.get(key);
      aggregate.completions += row.count || 0;
      if (Array.isArray(row.doneMoods)) aggregate.doneMoods.push(...row.doneMoods);
      if (Array.isArray(row.offMoods)) aggregate.offMoods.push(...row.offMoods);
      aggregate.label = row.label || aggregate.label;
      if (row.mostRecentDayKey && (!aggregate.mostRecentDayKey
          || row.mostRecentDayKey > aggregate.mostRecentDayKey)) {
        aggregate.mostRecentDayKey = row.mostRecentDayKey;
      }
      // The displayed streak is the running value from the newest month the habit appears in.
      const latest = latestMonthByKey.get(key);
      if (!latest || (month.monthKey || '') > latest) {
        latestMonthByKey.set(key, month.monthKey || '');
        aggregate.weekStreak = row.weekStreak || 0;
      }
    }
  }
  // Window-wide days-done proxy from summed completions, so the widget's "N/365 days" meta doesn't shrink
  // once past months are served from cache rather than re-fetched.
  for (const aggregate of aggregateByKey.values()) aggregate.daysDone = aggregate.completions;
  const habits = habitsFromAggregates(aggregateByKey, { orderedWindowKeys, minCompletions, minMoodDays });
  if (!enforceActivityEligibility) return habits;

  const todayKey = dateKeyFromDateInput(today);
  const currentWeekKey = weekKeyFromDayKey(todayKey);
  const previousWeekDate = dateFromDateInput(currentWeekKey);
  previousWeekDate.setDate(previousWeekDate.getDate() - 7);
  const previousWeekKey = dateKeyFromDateInput(previousWeekDate);
  const recentFloorDate = dateFromDateInput(todayKey);
  recentFloorDate.setDate(recentFloorDate.getDate() - (ESTABLISHED_HABIT_RECENCY_DAYS - 1));
  const recentFloorKey = dateKeyFromDateInput(recentFloorDate);
  const eligibleHabits = habits.filter(habit => {
    if (habit.completions > ESTABLISHED_HABIT_COMPLETIONS) {
      return habit.mostRecentDayKey >= recentFloorKey;
    }
    const recentEnoughForActiveStreak = habit.mostRecentDayKey >= previousWeekKey;
    return habit.weekStreak > 0 && recentEnoughForActiveStreak;
  });
  return eligibleHabits;
}

// ------------------------------------------------------------------------------------------
// @desc Round to two decimals (mood ratings can carry sub-integer resolution; keep note tables compact).
// @param {number} value
// @returns {number}
function round2(value) {
  return Math.round((value || 0) * 100) / 100;
}

// ------------------------------------------------------------------------------------------
// @desc Format a mood delta as a signed two-decimal string (e.g. 0.35 -> "+0.35", -0.19 -> "−0.19").
// @param {number} delta - Mood delta value.
// @returns {string}
export function formatDelta(delta) {
  const rounded = Math.round((delta || 0) * 100) / 100;
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
  return `${sign}${Math.abs(rounded).toFixed(2)}`;
}
