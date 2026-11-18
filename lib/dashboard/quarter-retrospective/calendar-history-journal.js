// Record the active domain's calendar events into an archived journal, one note per domain and year, so a Quarter
// Retrospective can describe a quarter's meetings after the fact. The host's calendar API reads only from the start of
// today forward, so a day that was never observed while it was current can't be recovered later. Each day the
// Dashboard sees is a `## YYYY-MM-DD` section holding readable bullets and a compact JSON fence. A day is replaced by
// each later observation of it, so the last look before the day ended is what the journal keeps. Only the facts a
// retrospective counts are stored: title, times, calendar name, and how many attendees, never their names.
import { DASHBOARD_NOTE_TAG } from "constants/settings";
import { datedNoteHeadings, writeDatedNoteSection } from "dashboard/dated-note-sections";
import { parseJsonPayload } from "plan-wizard/vision-guide-markdown";
import { checkedAppResult, resolvedNoteHandle } from "plan-wizard/vision-guide-notes";
import { eventCoversDate } from "util/calendar-utility";
import { dateFromDateInput, dateKeyFromDateInput, localMidnightFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";

export const CALENDAR_HISTORY_SCHEMA_VERSION = 1;
export const CALENDAR_HISTORY_INTRODUCTION = "Written by the Dashboard. Each day lists the calendar events the "
  + "Dashboard saw for it, so a Quarter Retrospective can look back at them. The JSON block beneath each day is what "
  + "the Dashboard reads; the bullets are rewritten from it.";
const JOURNAL_LOG_LABEL = "[calendar-history-journal]";
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
// Day signatures last written in this session, by note name and date key. A refocus that sees the same events as the
// last write skips reading the note at all.
const RECORDED_SIGNATURES = new Map();

// ----------------------------------------------------------------------------------------------
// @desc Name a domain's calendar journal for one year.
// @param {string} domainName - Task domain display name.
// @param {number} year - Calendar year the journal's days fall in.
// @returns {string} Note title, such as "Work Calendar History 2026".
export function calendarHistoryNoteName(domainName, year) {
  return `${ domainName } Calendar History ${ year }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Reduce a host calendar event to what the journal keeps. Attendees who declined are left out of the count;
//   Amplenote leaves the user out of an event's attendees, so the count is the people met.
// @param {object} event - External calendar event, start/end as Date or raw timestamps.
// @returns {object|null} An object with the following properties, or null when the event has no readable start:
//   - {boolean} allDay - Whether the event spans whole days
//   - {number} attendeeCount - Attendees who have not declined
//   - {string|null} calendarName - Name of the calendar the event belongs to
//   - {string|null} end - End as an ISO timestamp
//   - {string} start - Start as an ISO timestamp
//   - {string} title - Event title
export function journalEventFromCalendarEvent(event) {
  const start = event?.start ? dateFromDateInput(event.start, { throwOnInvalid: false }) : null;
  if (!start) return null;
  const end = event.end ? dateFromDateInput(event.end, { throwOnInvalid: false }) : null;
  const attendees = Array.isArray(event.attendees) ? event.attendees : [];
  const attendingAttendees = attendees.filter(attendee => attendee?.status !== false);
  const title = String(event.title || "Untitled event").trim();
  return { allDay: !!event.allDay, attendeeCount: attendingAttendees.length, calendarName: event.calendar?.name || null,
    end: end ? end.toISOString() : null, start: start.toISOString(), title };
}

// ----------------------------------------------------------------------------------------------
// @desc Sort the host's events into the days of the window they cover. An event spanning several days is listed on
//   each of them. Within a day, an event is listed once per title and start, in start order.
// @param {Array<object>} events - External calendar events, as the host returned them.
// @param {Array<string>} dateKeys - The window's days, as YYYY-MM-DD.
// @returns {Map<string, Array<object>>} Journal events by date key, with every window day present, even when empty.
export function journalEventsByDate(events, dateKeys) {
  const eventsByDate = new Map(dateKeys.map(dateKey => [dateKey, new Map()]));
  for (const event of Array.isArray(events) ? events : []) {
    const journalEvent = journalEventFromCalendarEvent(event);
    if (!journalEvent) continue;
    for (const dateKey of dateKeys) {
      if (!eventCoversDate(event, localMidnightFromDateInput(dateKey))) continue;
      eventsByDate.get(dateKey).set(`${ journalEvent.title }\u0000${ journalEvent.start }`, journalEvent);
    }
  }
  const sortedEventsByDate = new Map();
  for (const [dateKey, eventsByIdentity] of eventsByDate) {
    const dayEvents = [...eventsByIdentity.values()];
    const sortedDayEvents = dayEvents.sort((first, second) => first.start.localeCompare(second.start));
    sortedEventsByDate.set(dateKey, sortedDayEvents);
  }
  return sortedEventsByDate;
}

// ----------------------------------------------------------------------------------------------
// @desc The days of the host's calendar window, starting today.
// @param {Date} today - The current moment.
// @param {number} windowDays - How many days the calendar request covered.
// @returns {Array<string>} Date keys, oldest first.
export function calendarWindowDateKeys(today, windowDays) {
  const todayMidnight = localMidnightFromDateInput(today);
  const dateKeys = [];
  for (let offset = 0; offset < windowDays; offset += 1) {
    const day = new Date(todayMidnight.getFullYear(), todayMidnight.getMonth(), todayMidnight.getDate() + offset);
    dateKeys.push(dateKeyFromDateInput(day));
  }
  return dateKeys;
}

// ----------------------------------------------------------------------------------------------
// @desc Render one day's section body: a bullet per event, then the day's JSON.
// @param {object} day - { events, observedOn }: the day's journal events and the date key they were observed on.
// @returns {string} Section body markdown, without its heading.
export function calendarHistorySectionMarkdown({ events, observedOn }) {
  const bullets = events.map(_eventBullet);
  const bulletText = bullets.length ? bullets.join("\n") : "- No events";
  const payload = { events, observedOn, schemaVersion: CALENDAR_HISTORY_SCHEMA_VERSION };
  return `${ bulletText }\n\n\`\`\`json\n${ JSON.stringify(payload) }\n\`\`\`\n`;
}

// ----------------------------------------------------------------------------------------------
// @desc Read every day from journal markdown. A day whose JSON cannot be read is reported rather than treated as
//   empty, so a later write never replaces events it could not see, and a retrospective doesn't count it as covered.
// @param {string} content - Journal note markdown.
// @returns {object} An object with the following properties:
//   - {Map<string, object>} daysByDate - { events, observedOn } by date key, in the order the note holds them
//   - {Array<string>} unreadableDates - Date keys whose section could not be parsed
export function calendarHistoryDaysFromContent(content) {
  const daysByDate = new Map();
  const unreadableDates = [];
  for (const heading of datedNoteHeadings(content)) {
    try {
      const { payload } = parseJsonPayload(content.slice(heading.bodyStart, heading.end));
      if (!Array.isArray(payload.events)) throw new Error("Calendar history section has no events list");
      daysByDate.set(heading.text, { events: payload.events, observedOn: payload.observedOn || null });
    } catch (error) {
      unreadableDates.push(heading.text);
      logIfEnabled(`${ JOURNAL_LOG_LABEL } unreadable day`, { dateKey: heading.text, message: error?.message });
    }
  }
  return { daysByDate, unreadableDates };
}

// ----------------------------------------------------------------------------------------------
// @desc Decide whether a new observation of a day should replace what the journal holds. An empty observation never
//   replaces recorded events, since the Dashboard's calendar read reports a failed request as no events; losing a
//   real cancellation of a day's last event is the lesser harm.
// @param {object|null} recordedDay - { events } as the journal holds the day, or null when it holds none.
// @param {Array<object>} incomingEvents - The day's events as just observed.
// @returns {boolean} True when the day should be written.
export function calendarDayNeedsWrite(recordedDay, incomingEvents) {
  if (!recordedDay) return true;
  if (!incomingEvents.length && recordedDay.events.length) return false;
  return _eventsSignature(recordedDay.events) !== _eventsSignature(incomingEvents);
}

// ----------------------------------------------------------------------------------------------
// @desc Count how many days of a range the journal covers.
// @param {Map<string, object>} daysByDate - Journal days by date key.
// @param {string} startDateKey - First day of the range, as YYYY-MM-DD.
// @param {string} endDateKey - Last day of the range, inclusive.
// @returns {object} { coveredDays, totalDays }, such as 41 of 92.
export function calendarHistoryCoverage(daysByDate, startDateKey, endDateKey) {
  const startMidnight = localMidnightFromDateInput(startDateKey);
  const endMidnight = localMidnightFromDateInput(endDateKey);
  const totalDays = Math.max(0, Math.round((endMidnight.getTime() - startMidnight.getTime()) / MILLISECONDS_PER_DAY) + 1);
  const coveredDateKeys = [...daysByDate.keys()].filter(dateKey => dateKey >= startDateKey && dateKey <= endDateKey);
  return { coveredDays: coveredDateKeys.length, totalDays };
}

// ----------------------------------------------------------------------------------------------
// @desc Record the days of a calendar read into the domain's journal. Days already recorded with the same events are
//   left alone, and a journal is only created once a read holds at least one event, so a domain with no calendar
//   connected never gets one. A window that crosses New Year writes to both years' journals.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - An object with the following properties:
//   - {string} domainName - Task domain display name
//   - {Array<object>} events - External calendar events, as the host returned them for the window
//   - {Date} [today] - The current moment
//   - {number} windowDays - How many days, starting today, the calendar read covered
// @returns {Promise<Array<string>>} Date keys written.
export async function recordCalendarHistory(app, { domainName, events, today = new Date(), windowDays }) {
  const eventsByDate = journalEventsByDate(events, calendarWindowDateKeys(today, windowDays));
  const observedOn = dateKeyFromDateInput(today);
  const dateKeysByYear = new Map();
  for (const dateKey of eventsByDate.keys()) {
    const year = Number(dateKey.slice(0, 4));
    if (!dateKeysByYear.has(year)) dateKeysByYear.set(year, []);
    dateKeysByYear.get(year).push(dateKey);
  }
  const writtenDateKeys = [];
  for (const [year, dateKeys] of dateKeysByYear) {
    const yearEventsByDate = new Map(dateKeys.map(dateKey => [dateKey, eventsByDate.get(dateKey)]));
    const yearWrittenDateKeys = await _recordJournalYear(app, { domainName, eventsByDate: yearEventsByDate, observedOn, year });
    writtenDateKeys.push(...yearWrittenDateKeys);
  }
  return writtenDateKeys;
}

// ----------------------------------------------------------------------------------------------
// @desc Read a domain's journal days across a date range, which may span two years' notes, without creating any note.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { domainName, endDateKey, startDateKey }, date keys as YYYY-MM-DD, end inclusive.
// @returns {Promise<object>} An object with the following properties:
//   - {object} coverage - { coveredDays, totalDays } over the range
//   - {Map<string, object>} daysByDate - { events, observedOn } by date key, for days inside the range
//   - {Array<string>} unreadableDates - Date keys inside the range whose section could not be parsed
export async function readCalendarHistory(app, { domainName, endDateKey, startDateKey }) {
  const daysByDate = new Map();
  const unreadableDates = [];
  const startYear = Number(startDateKey.slice(0, 4));
  const endYear = Number(endDateKey.slice(0, 4));
  for (let year = startYear; year <= endYear; year += 1) {
    const found = checkedAppResult(await app.findNote({ name: calendarHistoryNoteName(domainName, year) }));
    if (!found?.uuid) continue;
    const content = checkedAppResult(await app.getNoteContent({ uuid: found.uuid }));
    if (typeof content !== "string") continue;
    const journal = calendarHistoryDaysFromContent(content);
    for (const [dateKey, day] of journal.daysByDate) {
      if (dateKey >= startDateKey && dateKey <= endDateKey) daysByDate.set(dateKey, day);
    }
    const rangeUnreadableDates = journal.unreadableDates.filter(dateKey => dateKey >= startDateKey && dateKey <= endDateKey);
    unreadableDates.push(...rangeUnreadableDates);
  }
  const coverage = calendarHistoryCoverage(daysByDate, startDateKey, endDateKey);
  return { coverage, daysByDate, unreadableDates };
}

// ----------------------------------------------------------------------------------------------
// @desc Forget the day signatures this session has written, so the next record reads the journal again.
export function resetCalendarHistorySession() {
  RECORDED_SIGNATURES.clear();
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Record one year's days of a calendar read into that year's journal.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { domainName, eventsByDate, observedOn, year }.
// @returns {Promise<Array<string>>} Date keys written.
async function _recordJournalYear(app, { domainName, eventsByDate, observedOn, year }) {
  const name = calendarHistoryNoteName(domainName, year);
  const changedDateKeys = [...eventsByDate.keys()].filter(dateKey => {
    const signature = _eventsSignature(eventsByDate.get(dateKey));
    return RECORDED_SIGNATURES.get(`${ name }\u0000${ dateKey }`) !== signature;
  });
  if (!changedDateKeys.length) return [];
  const hasEvents = [...eventsByDate.values()].some(dayEvents => dayEvents.length);
  const journal = await _openJournal(app, name, { create: hasEvents });
  if (!journal) return [];
  let { content } = journal;
  const { daysByDate, unreadableDates } = calendarHistoryDaysFromContent(content);
  const writtenDateKeys = [];
  for (const dateKey of changedDateKeys) {
    const incomingEvents = eventsByDate.get(dateKey);
    const signatureKey = `${ name }\u0000${ dateKey }`;
    if (unreadableDates.includes(dateKey)) continue;
    if (!calendarDayNeedsWrite(daysByDate.get(dateKey) || null, incomingEvents)) {
      RECORDED_SIGNATURES.set(signatureKey, _eventsSignature(incomingEvents));
      continue;
    }
    const body = calendarHistorySectionMarkdown({ events: incomingEvents, observedOn });
    content = await writeDatedNoteSection(app, { body, content, dateKey, noteHandle: journal.noteHandle, noteLabel: "Calendar history journal" });
    RECORDED_SIGNATURES.set(signatureKey, _eventsSignature(incomingEvents));
    writtenDateKeys.push(dateKey);
  }
  return writtenDateKeys;
}

// ----------------------------------------------------------------------------------------------
// @desc Open a year's journal, creating it archived and tagged when asked to and it does not exist yet. The handle
//   is a bare { uuid } literal, since a write through a bridge-produced handle can silently report success.
// @param {object} app - Host-compatible Amplenote API.
// @param {string} name - Journal note name.
// @param {object} options - { create }: false returns null for a journal that does not exist.
// @returns {Promise<object|null>} { content, noteHandle }, or null when the journal does not exist and was not created.
async function _openJournal(app, name, { create }) {
  const found = checkedAppResult(await app.findNote({ name }));
  let uuid = found?.uuid || null;
  if (uuid) {
    const content = checkedAppResult(await app.getNoteContent({ uuid }));
    if (typeof content !== "string") throw new Error(`Could not read calendar history journal "${ name }"`);
    if (content.trim()) return { content, noteHandle: { uuid } };
  } else {
    if (!create) return null;
    const created = checkedAppResult(await app.createNote(name, [DASHBOARD_NOTE_TAG], { archive: true }));
    uuid = typeof created === "string" ? created : created?.uuid;
    if (!uuid) throw new Error(`Could not create calendar history journal "${ name }"`);
    // createNote can hand back a local identifier the host stops resolving once the note reaches the server, and a
    // write through it reports success without writing. Looking the note up exchanges it for the current one.
    uuid = (await resolvedNoteHandle(app, uuid)).uuid;
  }
  const seeded = `${ CALENDAR_HISTORY_INTRODUCTION }\n`;
  checkedAppResult(await app.replaceNoteContent({ uuid }, seeded));
  return { content: seeded, noteHandle: { uuid } };
}

// ----------------------------------------------------------------------------------------------
// @desc One event as a bullet: its time, title, attendee count and calendar.
// @param {object} event - Journal event.
// @returns {string} Bullet markdown.
function _eventBullet(event) {
  const start = new Date(event.start);
  const clock = `${ String(start.getHours()).padStart(2, "0") }:${ String(start.getMinutes()).padStart(2, "0") }`;
  const timeText = event.allDay ? "All day" : clock;
  const attendeeText = event.attendeeCount ? ` (${ event.attendeeCount } ${ event.attendeeCount === 1 ? "attendee" : "attendees" })` : "";
  const calendarText = event.calendarName ? ` · ${ event.calendarName }` : "";
  const title = event.title.replace(/\s+/g, " ");
  return `- ${ timeText } ${ title }${ attendeeText }${ calendarText }`;
}

// ----------------------------------------------------------------------------------------------
// @desc A day's events as one comparable string.
// @param {Array<object>} events - Journal events.
// @returns {string} JSON of the events.
function _eventsSignature(events) {
  return JSON.stringify(events);
}
