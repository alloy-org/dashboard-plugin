// Sort a quarter's recorded calendar events into kinds of meeting from their titles and attendee counts: personal
// appointments, focus blocks, external calls, 1:1s, team meetings, and large meetings. The sorting is local, so a
// month's digest prompt only names and narrates the categories instead of reading every event.
export const MEETING_CATEGORIES = Object.freeze({ external: "External meetings", focus: "Focus blocks", largeMeeting: "Large meetings",
  oneOnOne: "1:1s", personal: "Personal", teamMeeting: "Team meetings" });
// A title seen on this many different days is a recurring meeting.
const RECURRING_DAY_COUNT = 3;
const LARGE_MEETING_ATTENDEES = 6;
const MILLISECONDS_PER_MINUTE = 60 * 1000;
const SAMPLE_TITLE_COUNT = 5;
const PERSONAL_TITLE_PATTERN = /\b(dentist|doctor|dr\.|therapy|therapist|gym|workout|yoga|haircut|kids?|school|pick ?up|drop ?off|daycare|birthday|anniversary|dinner|vet|appointment|personal|family|errand)\b/i;
const EXTERNAL_TITLE_PATTERN = /\b(interview|candidate|customer|client|prospect|demo|sales|partner|partnership|investor|vendor|podcast|onboarding call|intro call|discovery call)\b/i;

// ----------------------------------------------------------------------------------------------
// @desc Total timed calendar events by kind of meeting. All-day events are left out, since they mark days rather than
//   spend hours. A title matching a personal word is Personal whoever attends; otherwise an event with no attendees is
//   a focus block, one whose title names a customer, candidate, or the like is external, and the rest divide by
//   attendee count. Amplenote leaves the user out of an event's attendees.
// @param {Map<string, object>} daysByDate - Calendar journal days by YYYY-MM-DD, each { events }.
// @returns {Array<object>} { category, eventCount, minutes, recurringEventCount, sampleTitles } per category that had
//   any events, most minutes first; sampleTitles are the category's most frequent titles.
export function meetingMinutesByCategory(daysByDate) {
  const timedEvents = _timedEvents(daysByDate);
  const recurringTitles = _recurringTitleKeys(timedEvents);
  const totalsByCategory = new Map();
  for (const { event, minutes } of timedEvents) {
    const category = calendarEventCategory(event);
    const totals = totalsByCategory.get(category) || { category, eventCount: 0, minutes: 0, recurringEventCount: 0, titleCounts: new Map() };
    const titleKey = _titleKey(event.title);
    totals.eventCount += 1;
    totals.minutes += minutes;
    if (recurringTitles.has(titleKey)) totals.recurringEventCount += 1;
    if (titleKey) {
      const titleCount = totals.titleCounts.get(titleKey) || { count: 0, title: event.title.trim() };
      titleCount.count += 1;
      totals.titleCounts.set(titleKey, titleCount);
    }
    totalsByCategory.set(category, totals);
  }
  const categories = [...totalsByCategory.values()].map(({ titleCounts, ...totals }) => {
    const rankedTitles = [...titleCounts.values()].sort((first, second) => second.count - first.count);
    return { ...totals, sampleTitles: rankedTitles.slice(0, SAMPLE_TITLE_COUNT).map(titleCount => titleCount.title) };
  });
  const rankedCategories = categories.sort((first, second) => second.minutes - first.minutes);
  return rankedCategories;
}

// ----------------------------------------------------------------------------------------------
// @desc The kind of meeting one event is, from its title and attendee count.
// @param {object} event - A journal event: { attendeeCount, title }.
// @returns {string} A MEETING_CATEGORIES value.
export function calendarEventCategory(event) {
  const title = String(event?.title || "");
  const attendeeCount = Number(event?.attendeeCount) || 0;
  if (PERSONAL_TITLE_PATTERN.test(title)) return MEETING_CATEGORIES.personal;
  if (!attendeeCount) return MEETING_CATEGORIES.focus;
  if (EXTERNAL_TITLE_PATTERN.test(title)) return MEETING_CATEGORIES.external;
  if (attendeeCount === 1) return MEETING_CATEGORIES.oneOnOne;
  if (attendeeCount < LARGE_MEETING_ATTENDEES) return MEETING_CATEGORIES.teamMeeting;
  return MEETING_CATEGORIES.largeMeeting;
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc The titles seen on at least RECURRING_DAY_COUNT different days.
// @param {Array<object>} timedEvents - From _timedEvents.
// @returns {Set<string>} Title keys.
function _recurringTitleKeys(timedEvents) {
  const dateKeysByTitle = new Map();
  for (const { dateKey, event } of timedEvents) {
    const titleKey = _titleKey(event.title);
    if (!titleKey) continue;
    const dateKeys = dateKeysByTitle.get(titleKey) || new Set();
    dateKeys.add(dateKey);
    dateKeysByTitle.set(titleKey, dateKeys);
  }
  const recurringEntries = [...dateKeysByTitle].filter(([, dateKeys]) => dateKeys.size >= RECURRING_DAY_COUNT);
  return new Set(recurringEntries.map(([titleKey]) => titleKey));
}

// ----------------------------------------------------------------------------------------------
// @desc Every timed event with a positive length, with the day it was recorded on.
// @param {Map<string, object>} daysByDate - Calendar journal days by YYYY-MM-DD.
// @returns {Array<object>} { dateKey, event, minutes } per event.
function _timedEvents(daysByDate) {
  const timedEvents = [];
  for (const [dateKey, day] of daysByDate || []) {
    for (const event of day?.events || []) {
      if (!event || event.allDay || !event.end) continue;
      const minutes = Math.round((Date.parse(event.end) - Date.parse(event.start)) / MILLISECONDS_PER_MINUTE);
      if (Number.isFinite(minutes) && minutes > 0) timedEvents.push({ dateKey, event, minutes });
    }
  }
  return timedEvents;
}

// ----------------------------------------------------------------------------------------------
// @desc A title compared without case or extra spaces, so "Weekly sync" and "weekly  sync" are the same meeting.
// @param {string} title - Event title.
// @returns {string} Comparison key, empty for no title.
function _titleKey(title) {
  return String(title || "").toLowerCase().replace(/\s+/g, " ").trim();
}
