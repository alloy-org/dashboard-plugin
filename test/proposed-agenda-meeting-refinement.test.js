// Verify that a calendar request the host is slow to answer gives up within its time limit and is shared by later
// callers, and that an agenda planned before the day's calendar events arrived gains preparation for the meetings it
// did not know of, moving aside the pending suggestions that held those hours.
import { jest } from "@jest/globals";
import { meetingsFromCalendarEvents } from "dashboard/proposed-agenda/meeting-preparation";
import { agendaWithNewMeetingPreparation } from "dashboard/proposed-agenda/proposed-agenda-meeting-refinement";
import { externalCalendarEventsForTargetDate } from "util/calendar-utility";

const TARGET_DATE = new Date(2026, 8, 17);
const NORTHWIND_CALL = { allDay: false, attendees: [{ name: "Dana Whitfield", status: true }],
  end: new Date(2026, 8, 17, 15, 0), start: new Date(2026, 8, 17, 14, 0), title: "Northwind pricing call" };
const LAUNCH_POST = { durationMinutes: 60, scheduledEm: "pending", startMinutes: 12 * 60, taskUuid: "task-launch",
  title: "Write the launch post" };
const STANDUP_NOTES = { durationMinutes: 60, scheduledEm: "pending", startMinutes: 9 * 60, taskUuid: "task-standup",
  title: "Tidy standup notes" };
const PRICING_PREPARATION = { durationMinutes: 60, meetingStartMinutes: 14 * 60, startMinutes: 12 * 60,
  taskUuid: "task-northwind", title: "Send Northwind the revised pricing sheet" };

describe("externalCalendarEventsForTargetDate", () => {
  it("continues without events once its time limit passes, and shares the request still awaiting the host", async () => {
    let answerHost;
    const getExternalCalendarEvents = jest.fn(() => new Promise(resolve => { answerHost = resolve; }));
    const app = { getExternalCalendarEvents };
    const today = new Date();
    const timedOut = await externalCalendarEventsForTargetDate(app, today, null, { timeoutMs: 10 });
    expect(timedOut).toEqual([]);
    const waiting = externalCalendarEventsForTargetDate(app, today);
    await Promise.resolve();
    expect(getExternalCalendarEvents).toHaveBeenCalledTimes(1);
    answerHost([NORTHWIND_CALL]);
    await expect(waiting).resolves.toEqual([NORTHWIND_CALL]);
  });
});

describe("agendaWithNewMeetingPreparation", () => {
  const options = { activities: [STANDUP_NOTES, LAUNCH_POST], calendarEvents: [NORTHWIND_CALL], reserveTasks: [],
    targetDate: TARGET_DATE, unavailableKeys: new Set() };

  it("places preparation for a meeting the agenda was not planned for, moving aside the pending suggestion it overlaps", async () => {
    const freshSchedule = jest.fn(async () => ({ activities: [PRICING_PREPARATION, { ...STANDUP_NOTES, startMinutes: 16 * 60 }] }));
    const publishProvisional = jest.fn();
    const prepared = await agendaWithNewMeetingPreparation({ ...options, freshSchedule, knownMeetingKeys: [], publishProvisional });
    const [meeting] = meetingsFromCalendarEvents([NORTHWIND_CALL], TARGET_DATE);
    expect(publishProvisional).toHaveBeenCalledWith(options.activities);
    expect(prepared.changed).toBe(true);
    expect(prepared.meetingKeys).toEqual([meeting.meetingKey]);
    expect(prepared.activities.map(activity => activity.title)).toEqual(["Tidy standup notes", "Send Northwind the revised pricing sheet"]);
    expect(prepared.placed).toEqual([PRICING_PREPARATION]);
    expect(prepared.reserveTasks.map(task => task.taskText)).toEqual(["Write the launch post"]);
  });

  it("leaves the agenda alone when its meetings are already known, or not known at all", async () => {
    const [meeting] = meetingsFromCalendarEvents([NORTHWIND_CALL], TARGET_DATE);
    const freshSchedule = jest.fn();
    const known = await agendaWithNewMeetingPreparation({ ...options, freshSchedule, knownMeetingKeys: [meeting.meetingKey] });
    const unknown = await agendaWithNewMeetingPreparation({ ...options, freshSchedule, knownMeetingKeys: null });
    const pending = await agendaWithNewMeetingPreparation({ ...options, calendarEvents: null, freshSchedule, knownMeetingKeys: [] });
    expect([known.changed, unknown.changed, pending.changed]).toEqual([false, false, false]);
    expect(freshSchedule).not.toHaveBeenCalled();
  });
});
