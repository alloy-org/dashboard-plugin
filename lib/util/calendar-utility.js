import { dateFromDateInput, dateKeyFromDateInput, localMidnightFromDateInput, millisFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";

const DEFAULT_MAX_EXTERNAL_CALENDAR_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Calendar requests still awaiting the host, by app and then by request options.
const PENDING_CALENDAR_REQUESTS_BY_APP = new WeakMap();

// ----------------------------------------------------------------------------------------------
// @desc Parse calendar timestamps without importing the React hook into the host plugin.
// @param {Date|number|string|null|undefined} value - Raw event timestamp value.
// @returns {Date|null} Parsed date, or null when absent or invalid.
export function calendarEventDateFromValue(value) {
  if (!value || (typeof value !== "number" && typeof value !== "string" && !(value instanceof Date))) return null;
  const eventMillis = millisFromDateInput(value);
  return eventMillis === null ? null : new Date(eventMillis);
}

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
// @desc Fetch cached external calendar events for a target date when it falls inside the API's forward window. The host
//   can take most of a minute to answer, so a caller that cannot wait that long passes timeoutMs and receives [] once
//   it passes; the request keeps running, and a later call with the same options joins it rather than asking again.
// @param {object} app - Amplenote app bridge.
// @param {Date|string|number} targetDate - Target date.
// @param {string|null} [domainUuid=null] - Optional task domain UUID filter.
// @param {object} [options={}] - { logPrefix, maxDays, timeoutMs }: timeoutMs null waits for the host's answer.
// @returns {Promise<Array<object>>} External calendar events, or [] when unavailable, out of range, or not answered
//   within timeoutMs.
export async function externalCalendarEventsForTargetDate(app, targetDate, domainUuid = null,
    { logPrefix = "[calendar-utility]", maxDays = DEFAULT_MAX_EXTERNAL_CALENDAR_DAYS, timeoutMs = null } = {}) {
  if (typeof app.getExternalCalendarEvents !== "function") return [];
  const dayDelta = dayDeltaFromToday(targetDate);
  if (dayDelta < 0 || dayDelta >= maxDays) return [];
  const days = calendarFetchDaysForDate(targetDate, { maxDays });
  const options = domainUuid ? { days, taskDomainUUID: domainUuid } : { days };
  const request = _sharedCalendarRequest(app, options).catch(error => {
    logIfEnabled(`${ logPrefix } getExternalCalendarEvents failed`, error?.message);
    return [];
  });
  if (!Number.isFinite(timeoutMs)) return await request;
  let timer = null;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => {
      logIfEnabled(`${ logPrefix } calendar events still pending, continuing without them`, { timeoutMs });
      resolve([]);
    }, timeoutMs);
  });
  const events = await Promise.race([request, timeout]);
  clearTimeout(timer);
  return events;
}

// ----------------------------------------------------------------------------------------------
// @desc Normalize external calendar events for both the React embed and the host plugin.
// @param {Array<object>} events - Raw external calendar events from the app API.
// @returns {Array<object>} Events with start/end converted to Date instances when parseable.
export function normalizeExternalCalendarEvents(events) {
  if (!Array.isArray(events)) return [];
  const validEvents = events.filter(event => event && typeof event === "object");
  const normalizedEvents = validEvents.map(event => ({
    ...event,
    end: calendarEventDateFromValue(event.end),
    start: calendarEventDateFromValue(event.start),
  }));
  return normalizedEvents;
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Ask the host for calendar events, joining a request with the same options that is still awaiting its answer.
// @param {object} app - Amplenote app bridge.
// @param {object} options - getExternalCalendarEvents options.
// @returns {Promise<Array<object>>} The host's answer; rejects when the host does.
function _sharedCalendarRequest(app, options) {
  if (!PENDING_CALENDAR_REQUESTS_BY_APP.has(app)) PENDING_CALENDAR_REQUESTS_BY_APP.set(app, new Map());
  const pendingRequests = PENDING_CALENDAR_REQUESTS_BY_APP.get(app);
  const requestKey = JSON.stringify(options);
  if (!pendingRequests.has(requestKey)) {
    const request = Promise.resolve().then(() => app.getExternalCalendarEvents(options))
      .finally(() => pendingRequests.delete(requestKey));
    pendingRequests.set(requestKey, request);
  }
  return pendingRequests.get(requestKey);
}
