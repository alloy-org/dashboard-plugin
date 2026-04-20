/**
 * [Claude-authored file]
 * Created: 2026-04-19 | Model: claude-opus-4.7
 * Task: DreamTask scheduling helpers — build available time slots and resolve startAt seconds
 * Prompt summary: "add a Schedule link that pops up a dialog to pick a time not occupied by an event or task"
 */
import { logIfEnabled } from "util/log";

const DAY_END_HOUR = 22;
const DAY_START_HOUR = 6;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SECONDS_PER_MINUTE = 60;
const SLOT_MINUTES = 30;

// ----------------------------------------------------------------------------------------------
// @desc Format a minutes-since-midnight integer as a 12-hour clock label (e.g., "1:30 PM").
// @param {number} totalMinutes - Minutes since local midnight.
// @returns {string}
// [Claude claude-opus-4.7] Task: human-readable time label for the schedule select input
// Prompt: "add a Schedule link that pops up a dialog to pick a time not occupied"
function formatSlotLabel(totalMinutes) {
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  const period = hh >= 12 ? "PM" : "AM";
  const displayHour = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
  return `${ displayHour }:${ String(mm).padStart(2, "0") } ${ period }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Iterate task domains and collect every open task that has a non-null startAt.
// @param {object} app - Amplenote app bridge.
// @returns {Promise<Array<object>>}
// [Claude claude-opus-4.7] Task: gather currently scheduled tasks to detect conflicts
// Prompt: "a time that is not occupied by an existing event or task"
async function collectScheduledTasks(app) {
  const domains = await app.getTaskDomains().catch(() => []);
  const tasks = [];
  for (const domain of (domains || [])) {
    if (!domain?.uuid) continue;
    try {
      const domainTasks = await app.getTaskDomainTasks(domain.uuid);
      for (const candidate of (domainTasks || [])) {
        if (candidate?.startAt && !candidate.completedAt && !candidate.dismissedAt) tasks.push(candidate);
      }
    } catch (err) {
      logIfEnabled("[DreamTask] getTaskDomainTasks failed for domain", domain.uuid, err);
    }
  }
  return tasks;
}

// ----------------------------------------------------------------------------------------------
// @desc Build the set of occupied 30-minute slot offsets for the day represented by `dayStartMs`.
// @param {number} dayStartMs - Local-midnight timestamp for the target day.
// @param {Array<object>} events - External calendar events (with .start/.end Date objects).
// @param {Array<object>} tasks - Scheduled tasks (with .startAt unix-seconds).
// @returns {Set<number>}
// [Claude claude-opus-4.7] Task: compute occupied-slot set by overlapping events and task startAts
// Prompt: "a time that is not occupied by an existing event or task"
function occupiedSlotMinutes(dayStartMs, events, tasks) {
  const dayEndMs = dayStartMs + MS_PER_DAY;
  const occupied = new Set();
  const markOverlap = (startMs, endMs) => {
    if (endMs <= dayStartMs || startMs >= dayEndMs) return;
    for (let m = DAY_START_HOUR * 60; m < DAY_END_HOUR * 60; m += SLOT_MINUTES) {
      const slotStart = dayStartMs + m * 60 * 1000;
      const slotEnd = slotStart + SLOT_MINUTES * 60 * 1000;
      if (slotEnd > startMs && slotStart < endMs) occupied.add(m);
    }
  };
  for (const event of (events || [])) {
    if (!event || event.allDay) continue;
    const startMs = event.start instanceof Date ? event.start.getTime()
      : event.start ? new Date(event.start).getTime() : null;
    if (startMs == null || Number.isNaN(startMs)) continue;
    const endMs = event.end instanceof Date ? event.end.getTime()
      : event.end ? new Date(event.end).getTime() : startMs + SLOT_MINUTES * 60 * 1000;
    markOverlap(startMs, endMs);
  }
  for (const task of (tasks || [])) {
    if (!task?.startAt) continue;
    const startMs = task.startAt * 1000;
    markOverlap(startMs, startMs + SLOT_MINUTES * 60 * 1000);
  }
  return occupied;
}

// ----------------------------------------------------------------------------------------------
// @desc Produce a priority-ordered list of {label, value} slot options for the given day.
//   `value` is minutes-since-midnight so it can be combined with a date input.
// @param {Date|number|string} dateInput - Any value convertible to Date.
// @param {Array<object>} events - External calendar events.
// @param {Array<object>} tasks - Tasks with startAt.
// @returns {Array<{label: string, value: number}>}
// [Claude claude-opus-4.7] Task: main entry for app.prompt's time-of-day select options
// Prompt: "add a Schedule link that pops up a dialog to pick a time not occupied"
export function buildAvailableTimeSlots(dateInput, events, tasks) {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const dayStartMs = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0).getTime();
  const occupied = occupiedSlotMinutes(dayStartMs, events, tasks);
  const slots = [];
  for (let m = DAY_START_HOUR * 60; m < DAY_END_HOUR * 60; m += SLOT_MINUTES) {
    if (occupied.has(m)) continue;
    slots.push({ label: formatSlotLabel(m), value: m });
  }
  return slots;
}

// ----------------------------------------------------------------------------------------------
// @desc Fetch external calendar events + scheduled tasks used to drive schedule-time conflict checks.
// @param {object} app - Amplenote app bridge.
// @returns {Promise<{events: Array<object>, tasks: Array<object>}>}
// [Claude claude-opus-4.7] Task: one-shot occupancy fetch triggered on Schedule click
// Prompt: "add a Schedule link that pops up a dialog to pick a time not occupied"
export async function fetchSchedulingOccupancy(app) {
  const [events, tasks] = await Promise.all([
    app.getExternalCalendarEvents({ days: 30 }).catch(() => []),
    collectScheduledTasks(app),
  ]);
  return { events: Array.isArray(events) ? events : [], tasks };
}

// ----------------------------------------------------------------------------------------------
// @desc Convert a (dateSeconds, minutesIntoDay) pair from app.prompt into a unix-seconds startAt.
// @param {number} dateSeconds - app.prompt 'date' input result (unix seconds at user-selected day).
// @param {number} minutesIntoDay - Minutes after local midnight (from the select option value).
// @returns {number}
// [Claude claude-opus-4.7] Task: combine date + minutes-into-day into unix seconds for app.updateTask
// Prompt: "add a Schedule link that pops up a dialog to pick a time not occupied"
export function startAtSecondsFromDateAndMinutes(dateSeconds, minutesIntoDay) {
  const asDate = new Date(dateSeconds * 1000);
  const localMidnight = new Date(asDate.getFullYear(), asDate.getMonth(), asDate.getDate(), 0, 0, 0);
  return Math.floor(localMidnight.getTime() / 1000) + minutesIntoDay * SECONDS_PER_MINUTE;
}
