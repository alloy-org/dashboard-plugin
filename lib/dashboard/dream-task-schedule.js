/**
 * [Claude-authored file]
 * Created: 2026-04-19 | Model: claude-opus-4.7
 * Task: DreamTask scheduling helpers — build available time slots and resolve startAt seconds
 * Prompt summary: "add a Schedule link that pops up a dialog to pick a time not occupied by an event or task"
 */
import { fetchDomainOrAllNotesTasks } from "util/all-notes-tasks";
import { dateFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";

const DAY_END_HOUR = 22;
const DAY_START_HOUR = 6;
const FUTURE_DAY_END_HOUR = 20;
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
  const domains = await app.getTaskDomains();
  if (!Array.isArray(domains) || domains.length === 0) {
    const allTasks = await fetchDomainOrAllNotesTasks(app, null);
    return allTasks.filter(candidate => candidate?.startAt && !candidate.completedAt && !candidate.dismissedAt);
  }
  const tasks = [];
  for (const domain of domains) {
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
// @desc Produce a priority-ordered list of {label, value} slot options for the given day, omitting
//   slots occupied by an event/task and — when the day is today — slots that start at or before the
//   current time (only times still ahead are offered).
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
  const now = new Date();
  const todayStartMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).getTime();
  const nowMinutes = dayStartMs === todayStartMs ? now.getHours() * 60 + now.getMinutes() : -1;
  const occupied = occupiedSlotMinutes(dayStartMs, events, tasks);
  const slots = [];
  for (let m = DAY_START_HOUR * 60; m < DAY_END_HOUR * 60; m += SLOT_MINUTES) {
    if (m <= nowMinutes) continue;
    if (occupied.has(m)) continue;
    slots.push({ label: formatSlotLabel(m), value: m });
  }
  return slots;
}

// ----------------------------------------------------------------------------------------------
// @desc Build every 30-minute slot between 6am and 8pm inclusive, without occupancy/time filtering.
//   Used by the "future date" prompt, where the target day is unknown so no conflict data applies.
// @returns {Array<{label: string, value: number}>}
// [Claude claude-opus-4-8 (1M context)] Task: full-day slot options for the future-date schedule prompt
// Prompt: "create a new prompt that includes all times between 6am and 8pm in 30 minute intervals"
export function buildFullDaySlots() {
  const slots = [];
  for (let m = DAY_START_HOUR * 60; m <= FUTURE_DAY_END_HOUR * 60; m += SLOT_MINUTES) {
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
// @desc True when the suggestion is not yet an Amplenote task, so scheduling must insert it into a note.
// @param {object|null} task - DreamTask suggestion.
// @returns {boolean}
function destinationNoteRequiredFromTask(task) {
  return !(task?.isExisting && task.uuid);
}

// ----------------------------------------------------------------------------------------------
// @desc Read a note UUID from an app.prompt `type: "note"` value (a noteHandle, or a UUID string).
// @param {*} value - Prompt result for the note input.
// @returns {string|null}
function noteUuidFromPromptValue(value) {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && typeof value.uuid === "string" && value.uuid) return value.uuid;
  return null;
}

// ----------------------------------------------------------------------------------------------
// @desc Build the ordered schedule-dialog inputs: optional note selector first, then date, then time.
// @param {object} dateInput - The date field (`string` for Today, `date` for a future day).
// @param {string|null} defaultNoteUUID - Prefill for the note selector when creating a task.
// @param {boolean} includeNoteSelector - Whether this suggestion still needs a destination note.
// @param {Array<{label: string, value: number}>} timeSlots - Time-of-day options for the select.
// @returns {Array<object>}
function schedulePromptInputs({ dateInput, defaultNoteUUID, includeNoteSelector, timeSlots }) {
  const inputs = [];
  if (includeNoteSelector) {
    const noteInput = { label: "Note", type: "note" };
    if (defaultNoteUUID) noteInput.value = { uuid: defaultNoteUUID };
    inputs.push(noteInput);
  }
  inputs.push(dateInput);
  inputs.push({ label: "Time", options: timeSlots, type: "select", value: timeSlots[0].value });
  return inputs;
}

// ----------------------------------------------------------------------------------------------
// @desc Validate a chosen startAt (and destination note, when creating) or alert and return null.
// @param {object} app - Amplenote app bridge.
// @param {boolean} includeNoteSelector - Whether a destination note is required.
// @param {string|null} noteUUID - Note chosen in the prompt, if any.
// @param {number|null} startAt - Unix seconds, or null when the date/time could not be parsed.
// @returns {Promise<{noteUUID: string|null, startAt: number}|null>}
async function scheduleSelectionFromPromptValues(app, { includeNoteSelector, noteUUID, startAt }) {
  if (startAt == null) {
    logIfEnabled("[DreamTask] Schedule: invalid date/time returned by prompt", { noteUUID, startAt });
    await app.alert("Could not schedule: the selected date or time was invalid.");
    return null;
  }
  if (includeNoteSelector && !noteUUID) {
    await app.alert("Could not schedule: please choose a note to create this task in.");
    return null;
  }
  return { noteUUID, startAt };
}

// ----------------------------------------------------------------------------------------------
// @desc Future-date schedule prompt: date picker (default tomorrow) plus every 30-minute slot from
//   6am to 8pm. Includes a note selector above the time when the suggestion still needs a destination note.
// @param {object} app - Amplenote app bridge.
// @param {string|null} defaultNoteUUID - Prefill / fallback destination note.
// @param {boolean} includeNoteSelector - Whether to ask which note to create the task in.
// @param {Date} localMidnight - Local midnight of the current day, used to derive tomorrow.
// @returns {Promise<{noteUUID: string|null, startAt: number}|null>}
async function resolveFutureScheduleSelection(app, { defaultNoteUUID, includeNoteSelector, localMidnight }) {
  const tomorrow = new Date(localMidnight.getFullYear(), localMidnight.getMonth(), localMidnight.getDate() + 1, 0, 0, 0);
  const timeSlots = buildFullDaySlots();
  const futureResult = await app.prompt("Pick a future date and time to schedule this task.", {
    inputs: schedulePromptInputs({
      dateInput: { label: "Date", type: "date", value: Math.floor(tomorrow.getTime() / 1000) },
      defaultNoteUUID, includeNoteSelector, timeSlots,
    }),
  });
  if (!futureResult) return null;
  const dateIndex = includeNoteSelector ? 1 : 0;
  const timeIndex = includeNoteSelector ? 2 : 1;
  const noteUUID = includeNoteSelector ? noteUuidFromPromptValue(futureResult[0]) : defaultNoteUUID;
  const startAt = startAtSecondsFromDateAndMinutes(futureResult[dateIndex], futureResult[timeIndex]);
  return scheduleSelectionFromPromptValues(app, { includeNoteSelector, noteUUID, startAt });
}

// ----------------------------------------------------------------------------------------------
// @desc Today-first schedule prompt. Pins the date to Today, lists free slots still ahead, and offers
//   a "Schedule for a future date" action. Invented suggestions get a note selector above the time.
// @param {object} app - Amplenote app bridge.
// @param {string|null} defaultNoteUUID - Prefill for the note selector, and fallback for existing tasks.
// @param {Date} now - Current local time, the basis for "Today".
// @param {object} task - DreamTask suggestion, existing or invented.
// @param {Array<{label: string, value: number}>} todaySlots - Free-and-future slots for today.
// @returns {Promise<{noteUUID: string|null, startAt: number}|null>}
export async function resolveDreamTaskScheduleSelection(app, { defaultNoteUUID, now, task, todaySlots }) {
  const includeNoteSelector = destinationNoteRequiredFromTask(task);
  const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const todayDateSec = Math.floor(localMidnight.getTime() / 1000);
  let selectedNoteUUID = includeNoteSelector ? (defaultNoteUUID || null) : (task?.noteUUID || null);

  if (todaySlots.length > 0) {
    const todayResult = await app.prompt("Pick when to schedule this task. Only free times still ahead today "
      + "are listed — use the button below to choose a future date instead.", {
      actions: [{ icon: "event", label: "Schedule for a future date", value: "future" }],
      inputs: schedulePromptInputs({
        dateInput: { label: "Date", type: "string", value: "Today" },
        defaultNoteUUID: selectedNoteUUID, includeNoteSelector, timeSlots: todaySlots,
      }),
    });
    if (!todayResult) return null;
    if (includeNoteSelector) selectedNoteUUID = noteUuidFromPromptValue(todayResult[0]) || selectedNoteUUID;
    if (todayResult[todayResult.length - 1] !== "future") {
      const timeIndex = includeNoteSelector ? 2 : 1;
      const startAt = startAtSecondsFromDateAndMinutes(todayDateSec, todayResult[timeIndex]);
      return scheduleSelectionFromPromptValues(app, { includeNoteSelector, noteUUID: selectedNoteUUID, startAt });
    }
  }

  return resolveFutureScheduleSelection(app, { defaultNoteUUID: selectedNoteUUID, includeNoteSelector, localMidnight });
}

// ----------------------------------------------------------------------------------------------
// @desc Apply a DreamTask schedule time, creating invented tasks with startAt in the insert payload.
// @param {object} app - Amplenote app bridge.
// @param {string|null} defaultNoteUUID - Fallback note UUID for new invented tasks.
// @param {number} startAt - Unix seconds start time for the scheduled task.
// @param {object} task - DreamTask suggestion, existing or invented. `task.noteUUID` is the chosen
//   destination note when the suggestion still needs to be created.
// @returns {Promise<{reason?: string, taskUuid?: string}>}
// [OpenAI GPT-5.5] Task: schedule invented DreamTasks with startAt at creation
// Prompt: "ensure schedule-created dream tasks have validly formatted startAt dates"
export async function scheduledDreamTaskResultFromStartAt(app, defaultNoteUUID, startAt, task) {
  const normalizedStartAt = Number(startAt);
  if (!Number.isFinite(normalizedStartAt)) return { reason: "invalid_start_at" };
  if (task.isExisting && task.uuid) {
    const updated = await app.updateTask(task.uuid, { startAt: Math.floor(normalizedStartAt) });
    return updated ? { noteUUID: task.noteUUID || null, startAt: Math.floor(normalizedStartAt), taskUuid: task.uuid }
      : { reason: "update_failed", taskUuid: task.uuid };
  }
  const targetNoteUuid = task.noteUUID || defaultNoteUUID;
  if (!targetNoteUuid) return { reason: "missing_note" };
  const taskUuid = await app.insertTask({ uuid: targetNoteUuid }, {
    content: task.title,
    startAt: Math.floor(normalizedStartAt),
  });
  return taskUuid ? { noteUUID: targetNoteUuid, startAt: Math.floor(normalizedStartAt), taskUuid } : { reason: "insert_failed" };
}

// ----------------------------------------------------------------------------------------------
// @desc Convert a (dateSeconds, minutesIntoDay) pair from app.prompt into a unix-seconds startAt.
// @param {Date|number|string} dateInput - app.prompt 'date' input result.
// @param {number} minutesIntoDay - Minutes after local midnight (from the select option value).
// @returns {number}
// [OpenAI GPT-5.5] Task: normalize DreamTask schedule date picker output
// Prompt: "ensure schedule-created dream tasks have validly formatted startAt dates"
export function startAtSecondsFromDateAndMinutes(dateInput, minutesIntoDay) {
  const asDate = dateFromDateInput(dateInput, { throwOnInvalid: false });
  if (!asDate) return null;
  const localMidnight = new Date(asDate.getFullYear(), asDate.getMonth(), asDate.getDate(), 0, 0, 0);
  const minutes = Number(minutesIntoDay);
  if (!Number.isFinite(minutes)) return null;
  return Math.floor(localMidnight.getTime() / 1000) + minutes * SECONDS_PER_MINUTE;
}
