// Verify the calendar history journal: events sorted into the days they cover and listed once per title and start,
// days recorded in date order and replaced by later observations, an empty read never erasing recorded events, no
// journal created for a domain with no calendar, a window across New Year split between two years' journals, the
// session skipping reads that saw nothing new, and coverage counted over a range.
import { jest } from "@jest/globals";
import { calendarDayNeedsWrite, calendarHistoryCoverage, calendarHistoryDaysFromContent, calendarHistoryNoteName,
  journalEventFromCalendarEvent, journalEventsByDate, readCalendarHistory, recordCalendarHistory,
  resetCalendarHistorySession } from "dashboard/quarter-retrospective/calendar-history-journal";
import { guideHeadingRanges } from "plan-wizard/vision-guide-markdown";
import { maintenanceApp } from "./project-maintenance-test-app";

const JOURNAL_NAME = "Work Calendar History 2026";
const TODAY = new Date(2026, 9, 26, 9, 0, 0);

// ----------------------------------------------------------------------------------------------
// @desc A host calendar event.
// @param {string} title - Event title.
// @param {Date} start - Start.
// @param {object} [fields] - Fields to override.
// @returns {object} Event as getExternalCalendarEvents returns it.
function calendarEvent(title, start, fields = {}) {
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return { allDay: false, calendar: { name: "Work", uuid: "calendar-work" }, end, start, title, ...fields };
}

describe("calendar history journal", () => {
  beforeEach(() => resetCalendarHistorySession());

  // ----------------------------------------------------------------------------------------------
  // @desc The journal is named by domain and year.
  it("names the journal by domain and year", () => {
    expect(calendarHistoryNoteName("Work", 2026)).toBe(JOURNAL_NAME);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Only counted facts are kept: attendee names never reach the journal, and declined attendees aren't counted.
  it("keeps attendee counts without names", () => {
    const attendees = [{ name: "Dana Whitfield", status: true }, { name: "ops@northwind.com", status: null },
      { name: "Lee", status: false }];
    const journalEvent = journalEventFromCalendarEvent(calendarEvent("Quarterly Review Sync", TODAY, { attendees }));
    expect(journalEvent.attendeeCount).toBe(2);
    expect(JSON.stringify(journalEvent)).not.toContain("Dana");
    expect(journalEvent.calendarName).toBe("Work");
    expect(journalEventFromCalendarEvent({ title: "No start" })).toBeNull();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc An event spanning two days is listed on both, and a duplicate of the same title and start is listed once.
  it("sorts events into the days they cover", () => {
    const tomorrowMorning = new Date(2026, 9, 27, 8, 0, 0);
    const offsite = calendarEvent("Offsite", new Date(2026, 9, 26, 18, 0, 0), { end: new Date(2026, 9, 27, 12, 0, 0) });
    const events = [calendarEvent("Standup", tomorrowMorning), calendarEvent("Standup", tomorrowMorning), offsite];
    const eventsByDate = journalEventsByDate(events, ["2026-10-26", "2026-10-27", "2026-10-28"]);
    expect(eventsByDate.get("2026-10-26").map(event => event.title)).toEqual(["Offsite"]);
    expect(eventsByDate.get("2026-10-27").map(event => event.title)).toEqual(["Offsite", "Standup"]);
    expect(eventsByDate.get("2026-10-28")).toEqual([]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A read records every day of its window in date order, each with the date it was observed on, and a later
  //   read replaces a day whose events changed.
  it("records the window's days and replaces them with later observations", async () => {
    const app = maintenanceApp({ tasks: [] });
    const events = [calendarEvent("Planning", new Date(2026, 9, 27, 10, 0, 0))];
    const written = await recordCalendarHistory(app, { domainName: "Work", events, today: TODAY, windowDays: 3 });
    expect(written).toEqual(["2026-10-26", "2026-10-27", "2026-10-28"]);
    const content = app.noteContent(JOURNAL_NAME);
    expect(guideHeadingRanges(content).map(heading => heading.text)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28"]);
    expect(content).toContain("- No events");
    expect(content).toContain("Planning");

    const nextDay = new Date(2026, 9, 27, 9, 0, 0);
    const movedEvents = [calendarEvent("Planning (moved)", new Date(2026, 9, 27, 14, 0, 0))];
    const rewritten = await recordCalendarHistory(app, { domainName: "Work", events: movedEvents, today: nextDay, windowDays: 3 });
    expect(rewritten).toEqual(["2026-10-27", "2026-10-29"]);
    const { daysByDate, unreadableDates } = calendarHistoryDaysFromContent(app.noteContent(JOURNAL_NAME));
    expect(unreadableDates).toEqual([]);
    expect(daysByDate.get("2026-10-27").events.map(event => event.title)).toEqual(["Planning (moved)"]);
    expect(daysByDate.get("2026-10-27").observedOn).toBe("2026-10-27");
    expect(daysByDate.get("2026-10-26").observedOn).toBe("2026-10-26");
    expect([...daysByDate.keys()]).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A failed calendar read arrives as no events, so an empty read never erases a day that has events.
  it("keeps recorded events when a later read is empty", async () => {
    const app = maintenanceApp({ tasks: [] });
    const events = [calendarEvent("Planning", new Date(2026, 9, 26, 10, 0, 0))];
    await recordCalendarHistory(app, { domainName: "Work", events, today: TODAY, windowDays: 1 });
    resetCalendarHistorySession();
    const written = await recordCalendarHistory(app, { domainName: "Work", events: [], today: TODAY, windowDays: 1 });
    expect(written).toEqual([]);
    expect(app.noteContent(JOURNAL_NAME)).toContain("Planning");
    expect(calendarDayNeedsWrite({ events: [] }, [])).toBe(false);
    expect(calendarDayNeedsWrite(null, [])).toBe(true);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A domain whose reads hold no events never gets a journal.
  it("creates no journal for a calendar with no events", async () => {
    const app = maintenanceApp({ tasks: [] });
    const written = await recordCalendarHistory(app, { domainName: "Work", events: [], today: TODAY, windowDays: 4 });
    expect(written).toEqual([]);
    expect(app.noteContent(JOURNAL_NAME)).toBeNull();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A window that crosses New Year writes each day to its own year's journal.
  it("splits a window across New Year between two journals", async () => {
    const app = maintenanceApp({ tasks: [] });
    const newYearsEve = new Date(2026, 11, 31, 9, 0, 0);
    const events = [calendarEvent("Party", new Date(2026, 11, 31, 20, 0, 0)), calendarEvent("Kickoff", new Date(2027, 0, 1, 10, 0, 0))];
    await recordCalendarHistory(app, { domainName: "Work", events, today: newYearsEve, windowDays: 2 });
    expect(app.noteContent(JOURNAL_NAME)).toContain("Party");
    expect(app.noteContent("Work Calendar History 2027")).toContain("Kickoff");
    expect(app.noteContent("Work Calendar History 2027")).not.toContain("Party");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A refocus that sees the same events as the session last wrote doesn't read the journal again.
  it("skips reading the journal when nothing changed this session", async () => {
    const app = maintenanceApp({ tasks: [] });
    const events = [calendarEvent("Planning", new Date(2026, 9, 26, 10, 0, 0))];
    await recordCalendarHistory(app, { domainName: "Work", events, today: TODAY, windowDays: 2 });
    app.getNoteContent = jest.fn(app.getNoteContent);
    const written = await recordCalendarHistory(app, { domainName: "Work", events, today: TODAY, windowDays: 2 });
    expect(written).toEqual([]);
    expect(app.getNoteContent).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Coverage counts the recorded days inside a range, and a read is limited to that range.
  it("counts coverage over a range", async () => {
    const app = maintenanceApp({ tasks: [] });
    const events = [calendarEvent("Planning", new Date(2026, 9, 26, 10, 0, 0))];
    await recordCalendarHistory(app, { domainName: "Work", events, today: TODAY, windowDays: 4 });
    const history = await readCalendarHistory(app, { domainName: "Work", endDateKey: "2026-12-31", startDateKey: "2026-10-01" });
    expect(history.coverage).toEqual({ coveredDays: 4, totalDays: 92 });
    expect(history.daysByDate.get("2026-10-26").events.map(event => event.title)).toEqual(["Planning"]);
    const outside = await readCalendarHistory(app, { domainName: "Work", endDateKey: "2026-09-30", startDateKey: "2026-07-01" });
    expect(outside.coverage).toEqual({ coveredDays: 0, totalDays: 92 });
    const missing = await readCalendarHistory(app, { domainName: "Home", endDateKey: "2026-12-31", startDateKey: "2026-10-01" });
    expect(missing.daysByDate.size).toBe(0);
    expect(calendarHistoryCoverage(new Map(), "2026-10-01", "2026-10-01")).toEqual({ coveredDays: 0, totalDays: 1 });
  });
});
