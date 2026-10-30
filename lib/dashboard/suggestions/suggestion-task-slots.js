// Place a ranked task list onto the hours of a day that are free, and replace a rejected task with the next
// highest task that still fits. A free hour has nothing else scheduled within 30 minutes, and the task's own
// duration pushes the following task out past that same buffer. A crowded day, one with three or more scheduled
// obligations, instead offers every half hour and keeps no buffer, so a suggestion can sit right next to an
// obligation rather than finding no hour at all. Ranked entries may be existing tasks or generated
// ideas; each is told apart by its candidate ID, and an idea's activity has no task UUID until the user accepts it.
// A task that prepares for one of the day's meetings is placed first, in the hours before that meeting.
import { MEETING_PREPARATION_LEAD_MINUTES } from "dashboard/proposed-agenda/meeting-preparation";
import { suggestionCandidateId } from "dashboard/quarter-project-task-candidates";

export const AGENDA_MATCH_LIMIT = 15;
export const DREAM_SUGGESTION_COUNT = 2;
// Where an evening-inclusive day stops offering hours, in place of WORK_DAY_END_MINUTES.
export const EVENING_DAY_END_MINUTES = 22 * 60;
export const RECENT_SUGGESTION_MINUTES = 3 * 24 * 60;
const BUFFER_MINUTES = 30;
// Timed obligations that make a day crowded, switching it from STANDARD_DAY_SPACING to CROWDED_DAY_SPACING.
const CROWDED_DAY_OBLIGATION_COUNT = 3;
const DEFAULT_DURATION_MINUTES = 30;
const MINUTES_PER_HOUR = 60;
const CROWDED_DAY_SPACING = { bufferMinutes: 0, isCrowded: true, stepMinutes: 30 };
const STANDARD_DAY_SPACING = { bufferMinutes: BUFFER_MINUTES, isCrowded: false, stepMinutes: MINUTES_PER_HOUR };
// Most preparation tasks placed before one meeting: enough to fill the two to three hours before it.
const MAXIMUM_PREPARATION_TASKS_PER_MEETING = 3;
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
// @desc The candidates Goal Coach draws its cards and reserves from, best first. Tasks not suggested within the recent
//   window come first. When they cannot fill every card, which happens when only a few projects qualify today and the
//   agenda already showed most of their candidates, the recently suggested tasks follow, least recently suggested
//   first, so a card is repeated rather than left empty.
// @param {Array<object>} rankedTasks - Highest rating first, each carrying minutesSinceRecommended.
// @param {number} [cardCount=DREAM_SUGGESTION_COUNT] - Cards Goal Coach shows.
// @returns {Array<object>} The fresh tasks, followed by the recent ones only when the fresh tasks number fewer than cardCount.
export function goalCoachTaskPool(rankedTasks, cardCount = DREAM_SUGGESTION_COUNT) {
  const freshTasks = tasksNotRecentlySuggested(rankedTasks);
  if (freshTasks.length >= cardCount) return freshTasks;
  const freshTaskSet = new Set(freshTasks);
  const recentTasks = (rankedTasks || []).filter(task => !freshTaskSet.has(task));
  const leastRecentFirst = recentTasks.sort((first, second) => second.minutesSinceRecommended - first.minutesSinceRecommended);
  return [...freshTasks, ...leastRecentFirst];
}

// ----------------------------------------------------------------------------------------------
// @desc Slot the best matches onto free hours. The best few preparation tasks of each meeting join the pool ahead of
//   the rest and are placed first, in the three hours before their meeting, or at the earliest free hour that still
//   ends before it; a preparation task with no such hour stays in reserve. Tasks that do not fit, and the rest of the
//   pool, stay in reserve so a rejection can take the next one.
// @param {Array<object>} rankedTasks - Highest rating first; a preparation task carries meetingStartMinutes.
// @param {object} [options] - { dayEndMinutes, nowMinutes, obligations, targetMidnightSeconds }: dayEndMinutes is the
//   minute by which every suggestion must end, 18:00 unless evenings are offered.
// @returns {object} { activities, reserveTasks }, activities in start order.
export function slotRankedTasks(rankedTasks, { dayEndMinutes = WORK_DAY_END_MINUTES, nowMinutes = null, obligations = [],
    targetMidnightSeconds = null } = {}) {
  const pool = _poolWithPreparationFirst(rankedTasks || []);
  const occupied = _blocksFromRows(obligations);
  const spacing = _daySpacing(obligations);
  const activities = [];
  for (const task of pool) {
    const durationMinutes = task.durationMinutes || DEFAULT_DURATION_MINUTES;
    const isPreparation = Number.isFinite(task.meetingStartMinutes);
    const startMinutes = isPreparation ? _preparationStart(durationMinutes, occupied, { meetingStartMinutes: task.meetingStartMinutes,
      nowMinutes, spacing }) : _nextHourStart(durationMinutes, occupied, { dayEndMinutes, nowMinutes, spacing });
    if (startMinutes == null) continue;
    activities.push(_activityFromRanked(task, startMinutes, targetMidnightSeconds));
    occupied.push({ end: startMinutes + durationMinutes, start: startMinutes });
  }
  const placed = new Set(activities.map(activity => activity.candidateId));
  const reserveTasks = pool.filter(task => !placed.has(suggestionCandidateId(task)));
  const startOrderActivities = activities.sort((first, second) => first.startMinutes - second.startMinutes);
  return { activities: startOrderActivities, reserveTasks };
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
  const spacing = _daySpacing(obligations);
  const remaining = [...reserveTasks];
  let attempts = remaining.length;
  while (attempts > 0 && remaining.length) {
    attempts -= 1;
    const next = remaining.shift();
    const durationMinutes = next.durationMinutes || DEFAULT_DURATION_MINUTES;
    const preferredFits = preferredStartMinutes != null
      && _hourFits(preferredStartMinutes, durationMinutes, occupied, spacing.bufferMinutes);
    const startMinutes = preferredFits ? preferredStartMinutes : _nextHourStart(durationMinutes, occupied, { nowMinutes, spacing });
    if (startMinutes == null) { remaining.push(next); continue; }
    const placed = _activityFromRanked(next, startMinutes, next.targetMidnightSeconds ?? targetMidnightSeconds);
    const withPlaced = [...activities, placed].sort((first, second) => first.startMinutes - second.startMinutes);
    return { activities: withPlaced, placed, reserveTasks: remaining };
  }
  return { activities, placed: null, reserveTasks: remaining };
}

// ----------------------------------------------------------------------------------------------
// @desc The first start where a half-hour suggestion still fits around a day's obligations and the suggestions already
//   placed on it, using the same start times and buffer placement uses: on the hour with 30 minutes of space, or on
//   any half hour with no space on a crowded day.
// @param {object} [options] - { activities, nowMinutes, obligations }: activities are placed suggestions of any status,
//   and nowMinutes is the earliest minute for today, or null when the whole working day is open.
// @returns {number|null} Start minutes, or null when the working day has no open start left.
export function firstOpenSuggestionStart({ activities = [], nowMinutes = null, obligations = [] } = {}) {
  const occupied = _blocksFromRows([...obligations, ...activities]);
  return _nextHourStart(DEFAULT_DURATION_MINUTES, occupied, { nowMinutes, spacing: _daySpacing(obligations) });
}

// ----------------------------------------------------------------------------------------------
// @desc Move suggestions that now overlap something scheduled on their day to the next free hour. A cached agenda
//   was slotted around the obligations that existed when it was generated, so an event or task added since can sit
//   on top of a suggestion; this re-checks against the current obligations. Suggestions that clear every obligation
//   keep their time, and an overlapping suggestion that fits nowhere else in the working day is dropped.
// @param {Array<object>} movableActivities - Suggestions that may be moved, each with startMinutes/durationMinutes.
// @param {object} [options] - An object with the following properties:
//   - {number} dayEndMinutes - Minute by which a relocated suggestion must end, 18:00 unless evenings are offered
//   - {Array<object>} fixedRows - Rows that keep their time and must be avoided, e.g. already accepted suggestions
//   - {number|null} nowMinutes - Earliest minute a relocated suggestion may start, or null for a future day
//   - {Array<object>} obligations - The day's scheduled tasks and events, each with startMinutes/durationMinutes
// @returns {object} An object with the following properties:
//   - {Array<object>} activities - Surviving suggestions with relocated ones given their new start
//   - {number} droppedCount - Overlapping suggestions with no free hour left
//   - {number} movedCount - Overlapping suggestions given a new start
export function activitiesClearOfObligations(movableActivities, { dayEndMinutes = WORK_DAY_END_MINUTES, fixedRows = [], nowMinutes = null,
    obligations = [] } = {}) {
  const obligationBlocks = _blocksFromRows(obligations);
  const spacing = _daySpacing(obligations);
  const overlapsObligation = activity => {
    const end = activity.startMinutes + (activity.durationMinutes || DEFAULT_DURATION_MINUTES);
    return obligationBlocks.some(block => activity.startMinutes < block.end && block.start < end);
  };
  const conflicting = (movableActivities || []).filter(overlapsObligation);
  if (!conflicting.length) return { activities: movableActivities || [], droppedCount: 0, movedCount: 0 };
  const unaffected = movableActivities.filter(activity => !overlapsObligation(activity));
  const occupied = [...obligationBlocks, ..._blocksFromRows(fixedRows), ..._blocksFromRows(unaffected)];
  const relocated = [];
  for (const activity of conflicting) {
    const durationMinutes = activity.durationMinutes || DEFAULT_DURATION_MINUTES;
    const startMinutes = _nextHourStart(durationMinutes, occupied, { dayEndMinutes, nowMinutes, spacing });
    if (startMinutes == null) continue;
    relocated.push({ ...activity, startMinutes, startTime: _clockFromMinutes(startMinutes) });
    occupied.push({ end: startMinutes + durationMinutes, start: startMinutes });
  }
  const activities = [...unaffected, ...relocated].sort((first, second) => first.startMinutes - second.startMinutes);
  return { activities, droppedCount: conflicting.length - relocated.length, movedCount: relocated.length };
}

// ----------------------------------------------------------------------------------------------
// @desc Report which working-day starts a suggestion could take, which starts an obligation or the current time
//   closes, which already-placed suggestions sit on a closed start, and the longest stretch of the working day no
//   obligation covers. A start is on the hour from 09:00 until 18:00, holds a half hour, and leaves 30 minutes
//   around every obligation; on a crowded day it is any half hour, with no space kept. An obligation with no
//   duration is treated as a half hour, the same assumption placement uses.
// @param {object} [options] - { activities, nowMinutes, obligations }. nowMinutes is the earliest minute for
//   today, or null when the whole working day is open. activities are placed suggestions with startMinutes.
//   obligations are { durationMinutes, source, startMinutes, title }.
// @returns {object} openHours and earliestStart first, then occupied and placed clocks, then closedHours with
//   the obligation that closed each start, counts of task versus event obligations, isCrowdedDay, and
//   largestFreeBlock as { end, minutes, start } with "HH:MM" clocks, or null when obligations cover the whole day.
export function suggestionHourAvailability({ activities = [], nowMinutes = null, obligations = [] } = {}) {
  const occupiedBlocks = _blocksFromRows(obligations);
  const spacing = _daySpacing(obligations);
  const earliestMinutes = _earliestSuggestionMinute(nowMinutes, spacing.stepMinutes);
  const closedHours = [];
  const openHours = [];
  for (let hour = WORK_DAY_START_MINUTES; hour + DEFAULT_DURATION_MINUTES <= WORK_DAY_END_MINUTES;
      hour += spacing.stepMinutes) {
    const hourLabel = _clockFromMinutes(hour);
    if (hour < earliestMinutes) {
      closedHours.push({ hour: hourLabel, reason: "beforeNow" });
      continue;
    }
    const because = _obligationsClosingHour(hour, obligations, spacing.bufferMinutes);
    if (because.length) {
      closedHours.push({ because, hour: hourLabel, reason: "occupied" });
      continue;
    }
    openHours.push(hourLabel);
  }
  const placedHours = [];
  const placedOnClosedHour = [];
  for (const activity of activities || []) {
    if (!Number.isFinite(activity?.startMinutes)) continue;
    const startTime = activity.startTime || _clockFromMinutes(activity.startMinutes);
    placedHours.push(startTime);
    const durationMinutes = activity.durationMinutes || DEFAULT_DURATION_MINUTES;
    const overlapsObligation = !_hourFits(activity.startMinutes, durationMinutes, occupiedBlocks, spacing.bufferMinutes);
    if (activity.startMinutes < earliestMinutes) placedOnClosedHour.push({ reason: "beforeNow", startTime });
    else if (overlapsObligation) placedOnClosedHour.push({ reason: "occupied", startTime });
  }
  const timedObligations = (obligations || []).filter(obligation => Number.isFinite(obligation?.startMinutes));
  const occupied = timedObligations.map(_occupiedHourLabel);
  const eventObligationCount = (obligations || []).filter(obligation => obligation?.source === "event").length;
  const taskObligationCount = (obligations || []).filter(obligation => obligation?.source === "task").length;
  const largestFreeBlock = _largestFreeBlock(occupiedBlocks, nowMinutes);
  return { openHours, earliestStart: _clockFromMinutes(earliestMinutes), occupied, placedHours, placedOnClosedHour,
    closedHours, eventObligationCount, isCrowdedDay: spacing.isCrowded, largestFreeBlock, nowMinutes, taskObligationCount };
}

// ----------------------------------------------------------------------------------------------
// @desc Zero-padded 24-hour "HH:MM" for minutes since midnight.
// @param {number} startMinutes - Minutes since midnight.
// @returns {string} e.g. "09:00".
function _clockFromMinutes(startMinutes) {
  const hours = String(Math.floor(startMinutes / MINUTES_PER_HOUR)).padStart(2, "0");
  const minutes = String(startMinutes % MINUTES_PER_HOUR).padStart(2, "0");
  return `${ hours }:${ minutes }`;
}

// ----------------------------------------------------------------------------------------------
// @desc An agenda activity at one clock time. An idea's activity is not existing and names its idea instead of a task.
//   A preparation task's activity keeps the start of the meeting it prepares for; any other has null. The ranked
//   task's actionability and score ride along so the calendar generation report can say why it was suggested.
// @param {object} task - Ranked task or idea.
// @param {number} startMinutes - Minutes since midnight.
// @param {number|null} targetMidnightSeconds - Local midnight of the planned day, in unix seconds.
// @returns {object} Activity the agenda widget and calendar suggestion adapter both accept.
function _activityFromRanked(task, startMinutes, targetMidnightSeconds) {
  const isExisting = task.isExisting !== false && !task.ideaId;
  return { actionability: task.actionability ?? null, benefit: task.benefit || null, candidateId: suggestionCandidateId(task),
    durationMinutes: task.durationMinutes || DEFAULT_DURATION_MINUTES, emphasizedWeekday: task.emphasizedWeekday,
    ideaId: task.ideaId || null, isExisting, meetingStartMinutes: Number.isFinite(task.meetingStartMinutes) ? task.meetingStartMinutes : null,
    noteUuid: task.noteUuid || null, projectSummary: task.projectSummary || null,
    projectUuid: task.projectUuid || null, rating: Number.isFinite(task.rating) ? task.rating : null, reason: task.rationale,
    score: task.score ?? null, source: "proposed", startMinutes, startTime: _clockFromMinutes(startMinutes), targetMidnightSeconds,
    taskUuid: isExisting ? task.taskUuid : null, title: task.taskText };
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
// @desc How a day's suggestions are spaced: on the hour with a 30-minute buffer, or, once the day holds
//   CROWDED_DAY_OBLIGATION_COUNT timed obligations, on any half hour with no buffer, since a crowded day spaced the
//   usual way rarely keeps a single hour open.
// @param {Array<object>} obligations - The day's scheduled tasks and events; only those with a start are counted.
// @returns {object} CROWDED_DAY_SPACING or STANDARD_DAY_SPACING: { bufferMinutes, isCrowded, stepMinutes }.
function _daySpacing(obligations) {
  const timedObligations = (obligations || []).filter(obligation => Number.isFinite(obligation?.startMinutes));
  const isCrowded = timedObligations.length >= CROWDED_DAY_OBLIGATION_COUNT;
  return isCrowded ? CROWDED_DAY_SPACING : STANDARD_DAY_SPACING;
}

// ----------------------------------------------------------------------------------------------
// @desc The earliest start, stepping by the day's spacing, at which this duration fits around other blocks.
// @param {number} durationMinutes - Length of the task to place.
// @param {Array<object>} occupied - { end, start } ranges.
// @param {object} options - An object with the following properties:
//   - {number} [dayEndMinutes=WORK_DAY_END_MINUTES] - Minute by which the task must end
//   - {number|null} nowMinutes - Earliest minute today, or null when the whole day is open
//   - {object} spacing - _daySpacing's { bufferMinutes, stepMinutes }
// @returns {number|null} Start minutes, or null when the day has no such start.
function _nextHourStart(durationMinutes, occupied, { dayEndMinutes = WORK_DAY_END_MINUTES, nowMinutes = null, spacing }) {
  let start = _earliestSuggestionMinute(nowMinutes, spacing.stepMinutes);
  for (; start + durationMinutes <= dayEndMinutes; start += spacing.stepMinutes) {
    if (_hourFits(start, durationMinutes, occupied, spacing.bufferMinutes)) return start;
  }
  return null;
}

// ----------------------------------------------------------------------------------------------
// @desc A placement conflicts when it would start or end within bufferMinutes of another block, or overlap it.
// @param {number} startMinutes - Proposed start.
// @param {number} durationMinutes - Proposed length.
// @param {Array<object>} occupied - { end, start } ranges.
// @param {number} bufferMinutes - Space to keep on either side of every block.
// @returns {boolean} True when the start is free for this duration.
function _hourFits(startMinutes, durationMinutes, occupied, bufferMinutes) {
  const end = startMinutes + durationMinutes;
  return occupied.every(block => startMinutes >= block.end + bufferMinutes || block.start >= end + bufferMinutes);
}

// ----------------------------------------------------------------------------------------------
// @desc The first minute a suggestion may start: 09:00, or the next step after now when today is already underway.
// @param {number|null} nowMinutes - Earliest minute today, or null when the whole working day is open.
// @param {number} [stepMinutes=MINUTES_PER_HOUR] - Interval starts fall on: an hour, or a half hour on a crowded day.
// @returns {number} Minutes since midnight.
function _earliestSuggestionMinute(nowMinutes, stepMinutes = MINUTES_PER_HOUR) {
  if (nowMinutes == null) return WORK_DAY_START_MINUTES;
  const nextStep = Math.ceil(nowMinutes / stepMinutes) * stepMinutes;
  return Math.max(WORK_DAY_START_MINUTES, nextStep);
}

// ----------------------------------------------------------------------------------------------
// @desc The longest stretch between the earliest suggestion minute and the end of the working day that no
//   obligation covers, ignoring the buffer and start-time rules, so a day where nothing fit shows how much room it had.
// @param {Array<object>} occupiedBlocks - { end, start } ranges of the day's obligations.
// @param {number|null} nowMinutes - The current minute today, or null when the whole working day is open.
// @returns {object|null} { end, minutes, start } with "HH:MM" clocks, or null when no minute of the day is free.
function _largestFreeBlock(occupiedBlocks, nowMinutes) {
  const dayStart = Math.max(WORK_DAY_START_MINUTES, nowMinutes ?? WORK_DAY_START_MINUTES);
  const startOrderBlocks = [...occupiedBlocks].sort((first, second) => first.start - second.start);
  let largest = null;
  let freeFrom = dayStart;
  const considerGap = gapEnd => {
    const end = Math.min(gapEnd, WORK_DAY_END_MINUTES);
    const minutes = end - freeFrom;
    if (minutes > (largest?.minutes || 0)) largest = { end, minutes, start: freeFrom };
  };
  for (const block of startOrderBlocks) {
    considerGap(block.start);
    freeFrom = Math.max(freeFrom, block.end);
  }
  considerGap(WORK_DAY_END_MINUTES);
  if (!largest) return null;
  return { end: _clockFromMinutes(largest.end), minutes: largest.minutes, start: _clockFromMinutes(largest.start) };
}

// ----------------------------------------------------------------------------------------------
// @desc Clock labels of the obligations that leave less than bufferMinutes around one candidate start.
// @param {number} hour - Candidate start, minutes since midnight.
// @param {Array<object>} obligations - Obligation records.
// @param {number} bufferMinutes - Space the day's spacing keeps around each obligation.
// @returns {Array<string>} Labels from _occupiedHourLabel.
function _obligationsClosingHour(hour, obligations, bufferMinutes) {
  const closing = (obligations || []).filter(obligation => {
    if (!Number.isFinite(obligation?.startMinutes)) return false;
    const durationMinutes = obligation.durationMinutes || DEFAULT_DURATION_MINUTES;
    const block = { end: obligation.startMinutes + durationMinutes, start: obligation.startMinutes };
    return !_hourFits(hour, DEFAULT_DURATION_MINUTES, [block], bufferMinutes);
  });
  return closing.map(_occupiedHourLabel);
}

// ----------------------------------------------------------------------------------------------
// @desc "10:00-10:30 (task) Standup", noting when the half-hour length was assumed.
// @param {object} obligation - { durationMinutes, source, startMinutes, title }.
// @returns {string} One occupied range.
function _occupiedHourLabel(obligation) {
  const durationMinutes = obligation.durationMinutes || DEFAULT_DURATION_MINUTES;
  const startLabel = _clockFromMinutes(obligation.startMinutes);
  const endLabel = _clockFromMinutes(obligation.startMinutes + durationMinutes);
  const assumed = obligation.durationMinutes ? "" : ", duration assumed";
  const source = obligation.source ? `${ obligation.source }${ assumed }` : (assumed ? "duration assumed" : "");
  const sourceLabel = source ? ` (${ source })` : "";
  const title = obligation.title ? ` ${ obligation.title }` : "";
  return `${ startLabel }-${ endLabel }${ sourceLabel }${ title }`;
}

// ----------------------------------------------------------------------------------------------
// @desc The pool slotting draws from: each meeting's best preparation tasks first, then the rest by rating, at most
//   AGENDA_MATCH_LIMIT in all.
// @param {Array<object>} rankedTasks - Highest rating first.
// @returns {Array<object>} The pool, in placement order.
function _poolWithPreparationFirst(rankedTasks) {
  const preparationCountByMeeting = new Map();
  const preparationTasks = [];
  const otherTasks = [];
  for (const task of rankedTasks) {
    const meetingStart = task.meetingStartMinutes;
    const meetingCount = preparationCountByMeeting.get(meetingStart) || 0;
    if (Number.isFinite(meetingStart) && meetingCount < MAXIMUM_PREPARATION_TASKS_PER_MEETING) {
      preparationCountByMeeting.set(meetingStart, meetingCount + 1);
      preparationTasks.push(task);
    } else {
      otherTasks.push(task);
    }
  }
  const pool = [...preparationTasks, ...otherTasks].slice(0, AGENDA_MATCH_LIMIT);
  return pool;
}

// ----------------------------------------------------------------------------------------------
// @desc Where a meeting's preparation task starts: the first free hour in the three hours before the meeting, else the
//   earliest free hour of the day that still ends a buffer before it.
// @param {number} durationMinutes - Length of the task to place.
// @param {Array<object>} occupied - { end, start } ranges, the meeting among them.
// @param {object} options - An object with the following properties:
//   - {number} meetingStartMinutes - When the meeting starts
//   - {number|null} nowMinutes - Earliest minute today, or null when the whole day is open
//   - {object} spacing - _daySpacing's { bufferMinutes, stepMinutes }
// @returns {number|null} Start minutes, or null when no start before the meeting is free.
function _preparationStart(durationMinutes, occupied, { meetingStartMinutes, nowMinutes, spacing }) {
  const { bufferMinutes, stepMinutes } = spacing;
  const latestStart = meetingStartMinutes - bufferMinutes - durationMinutes;
  const windowStart = Math.ceil((meetingStartMinutes - MEETING_PREPARATION_LEAD_MINUTES) / stepMinutes) * stepMinutes;
  const earliestStart = _earliestSuggestionMinute(nowMinutes, stepMinutes);
  for (const firstHour of [Math.max(windowStart, earliestStart), earliestStart]) {
    for (let hour = firstHour; hour <= latestStart; hour += stepMinutes) {
      if (_hourFits(hour, durationMinutes, occupied, bufferMinutes)) return hour;
    }
  }
  return null;
}
