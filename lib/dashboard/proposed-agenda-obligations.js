// [Claude claude-opus-4-8 (1M context)-authored file]
// Prompt summary: "derive which tasks & events are already scheduled for today; let Agenda broadcast them and
//   fall back to the same data source Agenda uses when the Agenda widget is not on the dashboard"
import { normalizeExternalCalendarEvents } from "hooks/use-external-calendar-events";
import { fetchDomainOrAllNotesTasks } from "util/all-notes-tasks";
import { formatDateKey } from "util/date-utility";
import { logIfEnabled } from "util/log";

// Agenda broadcasts today's obligations on this event; proposed-agenda asks for them on the request event.
export const TODAY_OBLIGATIONS_EVENT = "dashboard:today-obligations";
export const TODAY_OBLIGATIONS_REQUEST_EVENT = "dashboard:today-obligations-request";

const OBLIGATIONS_RESPONSE_TIMEOUT_MS = 500;
const EPOCH_SECONDS_THRESHOLD = 1e10;
const MS_PER_MINUTE = 60_000;

// ----------------------------------------------------------------------------------------------
// @desc Normalize today's open tasks and calendar events into obligation records sorted by start time.
//   Tasks contribute their startAt (or deadline); events contribute their start and start→end duration.
// @param {Array<object>} tasks - Open task objects scheduled today (startAt/deadline based).
// @param {Array<object>} events - Calendar events (start/end may be Date or raw timestamps).
// @param {Date|string|null} currentDate - "Today" reference; defaults to now.
// @returns {Array<object>} Obligation records ({ durationMinutes, source, startMinutes, taskUuid, title }).
export function obligationsFromTasksAndEvents(tasks, events, currentDate) {
  const todayKey = formatDateKey(currentDate || new Date());
  const taskObligations = (tasks || []).filter(task => task && !task.completedAt && !task.dismissedAt)
    .filter(task => _isOnDateKey(task.startAt || task.deadline, todayKey))
    .map(task => _obligationRecord({ source: "task", startMinutes: _minutesSinceMidnight(task.startAt || task.deadline),
      taskUuid: task.uuid || null, title: task.content }));
  const eventObligations = (events || [])
    .filter(event => event && !event.allDay && _isOnDateKey(event.start, todayKey))
    .map(event => _obligationRecord({ durationMinutes: _eventDurationMinutes(event), source: "event",
      startMinutes: _minutesSinceMidnight(event.start), title: event.title || "Calendar event" }));
  return [...taskObligations, ...eventObligations].filter(Boolean).sort((a, b) => a.startMinutes - b.startMinutes);
}

// ----------------------------------------------------------------------------------------------
// @desc Coerce an Amplenote timestamp (Date | Unix seconds | Unix ms | ISO string) to epoch milliseconds.
// @param {Date|number|string|null} timestamp
// @returns {number|null}
function _millisFromTimestamp(timestamp) {
  if (!timestamp) return null;
  if (timestamp instanceof Date) return Number.isNaN(timestamp.getTime()) ? null : timestamp.getTime();
  if (typeof timestamp === "number") return timestamp < EPOCH_SECONDS_THRESHOLD ? timestamp * 1000 : timestamp;
  if (typeof timestamp === "string") {
    const parsed = new Date(timestamp).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

// ----------------------------------------------------------------------------------------------
// @desc Minutes since local midnight for a timestamp, or null when it can't be parsed.
// @param {Date|number|string|null} timestamp
// @returns {number|null}
function _minutesSinceMidnight(timestamp) {
  const millis = _millisFromTimestamp(timestamp);
  if (millis == null) return null;
  const date = new Date(millis);
  return date.getHours() * 60 + date.getMinutes();
}

// ----------------------------------------------------------------------------------------------
// @desc True when a timestamp falls on the given local date key (YYYY-MM-DD).
// @param {Date|number|string|null} timestamp
// @param {string} todayKey
// @returns {boolean}
function _isOnDateKey(timestamp, todayKey) {
  const millis = _millisFromTimestamp(timestamp);
  return millis != null && formatDateKey(new Date(millis)) === todayKey;
}

// ----------------------------------------------------------------------------------------------
// @desc Build a normalized obligation record (the immutable shape both Agenda's broadcast and the fallback
//   derivation share, and that the widget renders / the prompt lists).
// @param {object} fields - { durationMinutes, source, startMinutes, taskUuid, title }.
// @returns {object|null} Record, or null when it has no parseable start time or title.
// [Claude claude-opus-4-8 (1M context)] Task: shape a single today-obligation record
function _obligationRecord({ durationMinutes = null, source, startMinutes, taskUuid = null, title }) {
  const cleanTitle = String(title || "").replace(/\s+/g, " ").trim();
  if (startMinutes == null || !cleanTitle) return null;
  return { durationMinutes: durationMinutes || null, source, startMinutes, taskUuid, title: cleanTitle };
}

// ----------------------------------------------------------------------------------------------
// @desc Whole-minute duration of a calendar event from its start/end, or null when not derivable.
// @param {object} event
// @returns {number|null}
function _eventDurationMinutes(event) {
  const startMs = _millisFromTimestamp(event?.start);
  const endMs = _millisFromTimestamp(event?.end);
  if (startMs == null || endMs == null || endMs <= startMs) return null;
  return Math.round((endMs - startMs) / MS_PER_MINUTE);
}

// ----------------------------------------------------------------------------------------------
// @desc Fallback used when the Agenda widget is not on the dashboard: derive today's obligations directly
//   from the same app surfaces Agenda would (task-domain tasks + external calendar events).
// @param {object} app - Amplenote app bridge.
// @param {object} options - { currentDate, domainUuid }.
// @returns {Promise<Array<object>>} Obligation records.
// [Claude claude-opus-4-8 (1M context)] Task: derive today's obligations without the Agenda widget present
export async function deriveTodayObligations(app, { currentDate = null, domainUuid = null } = {}) {
  const tasks = await fetchDomainOrAllNotesTasks(app, domainUuid).catch(() => []);
  let events = [];
  try {
    const calendarOptions = domainUuid ? { days: 1, taskDomainUUID: domainUuid } : { days: 1 };
    const raw = await app.getExternalCalendarEvents(calendarOptions);
    events = normalizeExternalCalendarEvents(raw);
  } catch (err) {
    logIfEnabled("[proposed-agenda] deriveTodayObligations: calendar fetch failed", err);
  }
  const obligations = obligationsFromTasksAndEvents(tasks, events, currentDate);
  logIfEnabled("[proposed-agenda] deriveTodayObligations", { count: obligations.length, domainUuid });
  return obligations;
}

// ----------------------------------------------------------------------------------------------
// @desc Resolve today's obligations, preferring a live broadcast from the Agenda widget and falling back to
//   self-derivation when Agenda is absent. Dispatches a request event, waits briefly for Agenda's response,
//   and derives directly on timeout (or immediately when there is no window, e.g. under test).
// @param {object} app - Amplenote app bridge.
// @param {object} options - { currentDate, domainUuid, timeoutMs }.
// @returns {Promise<Array<object>>} Obligation records.
// [Claude claude-opus-4-8 (1M context)] Task: ask Agenda for today's obligations, else derive them ourselves
export function requestTodayObligations(app, { currentDate = null, domainUuid = null,
    timeoutMs = OBLIGATIONS_RESPONSE_TIMEOUT_MS } = {}) {
  if (typeof window === "undefined" || !window.dispatchEvent) {
    return deriveTodayObligations(app, { currentDate, domainUuid });
  }
  return new Promise(resolve => {
    let settled = false;
    const finish = obligations => { if (settled) return; settled = true; cleanup(); resolve(obligations); };
    const onResponse = event => finish(Array.isArray(event?.detail?.obligations) ? event.detail.obligations : []);
    function cleanup() {
      window.removeEventListener(TODAY_OBLIGATIONS_EVENT, onResponse);
      clearTimeout(timer);
    }
    window.addEventListener(TODAY_OBLIGATIONS_EVENT, onResponse);
    const timer = setTimeout(() => {
      deriveTodayObligations(app, { currentDate, domainUuid }).then(finish).catch(() => finish([]));
    }, timeoutMs);
    window.dispatchEvent(new CustomEvent(TODAY_OBLIGATIONS_REQUEST_EVENT));
  });
}
