import { dateFromDateInput, dateKeyFromDateInput, localMidnightFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";

const DEFAULT_MAX_EXTERNAL_CALENDAR_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ----------------------------------------------------------------------------------------------
// @desc Number of forward calendar days needed for getExternalCalendarEvents to include the target date.
// @param {Date|string|number} targetDate - Target date.
// @param {object} [options={}] - { maxDays, today }.
// @returns {number} Days clamped to the API-supported range.
export function calendarFetchDaysForDate(targetDate, { maxDays = DEFAULT_MAX_EXTERNAL_CALENDAR_DAYS,
    today = new Date() } = {}) {
  const dayDelta = dayDeltaFromToday(targetDate, today);
  return Math.max(1, Math.min(maxDays, dayDelta + 1));
}

// ----------------------------------------------------------------------------------------------
// @desc Whole-day offset from today's local midnight to the target's local midnight.
// @param {Date|string|number} targetDate - Target date.
// @param {Date|string|number} [today=new Date()] - Reference date.
// @returns {number} Negative for past dates, zero for today, positive for future dates.
export function dayDeltaFromToday(targetDate, today = new Date()) {
  const todayMidnight = localMidnightFromDateInput(today);
  const targetMidnight = localMidnightFromDateInput(targetDate);
  return Math.floor((targetMidnight.getTime() - todayMidnight.getTime()) / MS_PER_DAY);
}

// ----------------------------------------------------------------------------------------------
// @desc Whether a calendar event's start/end span includes the target local date.
// @param {object} event - Calendar event with start/end values.
// @param {Date|string|number} targetDate - Target date.
// @returns {boolean}
export function eventCoversDate(event, targetDate) {
  if (!event) return false;
  if (event.start && dateKeyFromDateInput(event.start) === dateKeyFromDateInput(targetDate)) return true;
  const targetStart = localMidnightFromDateInput(targetDate).getTime();
  const targetEnd = targetStart + MS_PER_DAY;
  const eventStart = event.start ? dateFromDateInput(event.start, { throwOnInvalid: false }) : null;
  const eventEnd = event.end ? dateFromDateInput(event.end, { throwOnInvalid: false }) : null;
  const start = eventStart ? eventStart.getTime() : targetStart;
  const end = eventEnd ? eventEnd.getTime() : start + MS_PER_DAY;
  return start < targetEnd && end > targetStart;
}

// ----------------------------------------------------------------------------------------------
// @desc Fetch cached external calendar events for a target date when it falls inside the API's forward window.
// @param {object} app - Amplenote app bridge.
// @param {Date|string|number} targetDate - Target date.
// @param {string|null} [domainUuid=null] - Optional task domain UUID filter.
// @param {object} [options={}] - { logPrefix, maxDays }.
// @returns {Promise<Array<object>>} External calendar events, or [] when unavailable/out of range.
export async function externalCalendarEventsForTargetDate(app, targetDate, domainUuid = null,
    { logPrefix = "[calendar-utility]", maxDays = DEFAULT_MAX_EXTERNAL_CALENDAR_DAYS } = {}) {
  if (typeof app.getExternalCalendarEvents !== "function") return [];
  const dayDelta = dayDeltaFromToday(targetDate);
  if (dayDelta < 0 || dayDelta >= maxDays) return [];
  const days = calendarFetchDaysForDate(targetDate, { maxDays });
  const options = domainUuid ? { days, taskDomainUUID: domainUuid } : { days };
  return await app.getExternalCalendarEvents(options).catch(error => {
    logIfEnabled(`${ logPrefix } getExternalCalendarEvents failed`, error?.message);
    return [];
  });
}
