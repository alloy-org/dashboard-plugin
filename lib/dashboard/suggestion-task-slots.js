// Place a ranked task list onto the hours of a day that are free, and replace a rejected task with the next
// highest task that still fits. A free hour has nothing else scheduled within 30 minutes, and the task's own
// duration pushes the following task out past that same buffer.
export const AGENDA_MATCH_LIMIT = 15;
export const DREAM_SUGGESTION_COUNT = 2;
export const RECENT_SUGGESTION_MINUTES = 3 * 24 * 60;
const BUFFER_MINUTES = 30;
const DEFAULT_DURATION_MINUTES = 30;
const MINUTES_PER_HOUR = 60;
const WORK_DAY_END_MINUTES = 18 * MINUTES_PER_HOUR;
const WORK_DAY_START_MINUTES = 9 * MINUTES_PER_HOUR;

// ----------------------------------------------------------------------------------------------
// @desc Drop tasks suggested within the recent window. A task never suggested (null) stays eligible.
// @param {Array<object>} rankedTasks - Highest rating first.
// @param {number} [withinMinutes=RECENT_SUGGESTION_MINUTES] - Tasks suggested more recently than this are dropped.
// @returns {Array<object>} The tasks still eligible to show.
export function tasksNotRecentlySuggested(rankedTasks, withinMinutes = RECENT_SUGGESTION_MINUTES) {
  return (rankedTasks || []).filter(task => task.minutesSinceRecommended == null
    || task.minutesSinceRecommended >= withinMinutes);
}

// ----------------------------------------------------------------------------------------------
// @desc Slot the best matches onto free hours. Tasks that do not fit, and the rest of the pool, stay in reserve
//   so a rejection can take the next one.
// @param {Array<object>} rankedTasks - Highest rating first.
// @param {object} [options] - { nowMinutes, obligations, targetMidnightSeconds }.
// @returns {object} { activities, reserveTasks }.
export function slotRankedTasks(rankedTasks, { nowMinutes = null, obligations = [], targetMidnightSeconds = null } = {}) {
  const pool = (rankedTasks || []).slice(0, AGENDA_MATCH_LIMIT);
  const occupied = _blocksFromRows(obligations);
  const activities = [];
  for (const task of pool) {
    const durationMinutes = task.durationMinutes || DEFAULT_DURATION_MINUTES;
    const startMinutes = _nextHourStart(durationMinutes, occupied, nowMinutes);
    if (startMinutes == null) continue;
    activities.push(_activityFromRanked(task, startMinutes, targetMidnightSeconds));
    occupied.push({ end: startMinutes + durationMinutes, start: startMinutes });
  }
  const placed = new Set(activities.map(activity => activity.taskUuid));
  const reserveTasks = pool.filter(task => !placed.has(task.taskUuid));
  return { activities, reserveTasks };
}

// ----------------------------------------------------------------------------------------------
// @desc Fill one freed slot with the next ranked task whose duration still fits. A task that fits nowhere is
//   kept at the end of the reserve so a later, larger opening can use it.
// @param {object} options - { activities, nowMinutes, obligations, preferredStartMinutes, reserveTasks,
//   targetMidnightSeconds }.
// @returns {object} { activities, placed, reserveTasks }.
export function refillRejectedSuggestion({ activities = [], nowMinutes = null, obligations = [],
    preferredStartMinutes = null, reserveTasks = [], targetMidnightSeconds = null }) {
  const occupied = _blocksFromRows([...obligations, ...activities]);
  const remaining = [...reserveTasks];
  let attempts = remaining.length;
  while (attempts > 0 && remaining.length) {
    attempts -= 1;
    const next = remaining.shift();
    const durationMinutes = next.durationMinutes || DEFAULT_DURATION_MINUTES;
    const preferredFits = preferredStartMinutes != null && _hourFits(preferredStartMinutes, durationMinutes, occupied);
    const startMinutes = preferredFits ? preferredStartMinutes : _nextHourStart(durationMinutes, occupied, nowMinutes);
    if (startMinutes == null) { remaining.push(next); continue; }
    const placed = _activityFromRanked(next, startMinutes, next.targetMidnightSeconds ?? targetMidnightSeconds);
    const withPlaced = [...activities, placed].sort((first, second) => first.startMinutes - second.startMinutes);
    return { activities: withPlaced, placed, reserveTasks: remaining };
  }
  return { activities, placed: null, reserveTasks: remaining };
}

// ----------------------------------------------------------------------------------------------
// @desc An agenda activity at one clock time.
// @param {object} task - Ranked task.
// @param {number} startMinutes - Minutes since midnight.
// @param {number|null} targetMidnightSeconds - Local midnight of the planned day, in unix seconds.
// @returns {object} Activity the agenda widget and calendar suggestion adapter both accept.
function _activityFromRanked(task, startMinutes, targetMidnightSeconds) {
  const hours = String(Math.floor(startMinutes / MINUTES_PER_HOUR)).padStart(2, "0");
  const minutes = String(startMinutes % MINUTES_PER_HOUR).padStart(2, "0");
  return { durationMinutes: task.durationMinutes || DEFAULT_DURATION_MINUTES, isExisting: true,
    noteUuid: task.noteUuid || null, projectUuid: task.projectUuid || null, reason: task.rationale,
    source: "proposed", startMinutes, startTime: `${ hours }:${ minutes }`, targetMidnightSeconds,
    taskUuid: task.taskUuid, title: task.taskText };
}

// ----------------------------------------------------------------------------------------------
// @desc Occupied ranges from obligations or activities that already have a start.
// @param {Array<object>} rows - Records with startMinutes and durationMinutes.
// @returns {Array<object>} { end, start } ranges.
function _blocksFromRows(rows) {
  const blocks = [];
  for (const row of rows || []) {
    if (!Number.isFinite(row?.startMinutes)) continue;
    const duration = row.durationMinutes || DEFAULT_DURATION_MINUTES;
    blocks.push({ end: row.startMinutes + duration, start: row.startMinutes });
  }
  return blocks;
}

// ----------------------------------------------------------------------------------------------
// @desc The earliest clock hour at which this duration fits, leaving 30 minutes around other blocks.
// @param {number} durationMinutes - Length of the task to place.
// @param {Array<object>} occupied - { end, start } ranges.
// @param {number|null} nowMinutes - Earliest minute today, or null when the whole day is open.
// @returns {number|null} Start minutes, or null when the working day has no such hour.
function _nextHourStart(durationMinutes, occupied, nowMinutes) {
  let hour = WORK_DAY_START_MINUTES;
  if (nowMinutes != null) hour = Math.max(hour, Math.ceil(nowMinutes / MINUTES_PER_HOUR) * MINUTES_PER_HOUR);
  for (; hour + durationMinutes <= WORK_DAY_END_MINUTES; hour += MINUTES_PER_HOUR) {
    if (_hourFits(hour, durationMinutes, occupied)) return hour;
  }
  return null;
}

// ----------------------------------------------------------------------------------------------
// @desc A placement conflicts when it would start or end within 30 minutes of another block.
// @param {number} startMinutes - Proposed start.
// @param {number} durationMinutes - Proposed length.
// @param {Array<object>} occupied - { end, start } ranges.
// @returns {boolean} True when the hour is free for this duration.
function _hourFits(startMinutes, durationMinutes, occupied) {
  const end = startMinutes + durationMinutes;
  return occupied.every(block => startMinutes >= block.end + BUFFER_MINUTES || block.start >= end + BUFFER_MINUTES);
}
