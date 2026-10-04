// Tests that Proposed Agenda only takes the Agenda widget's obligations broadcast for the day it is planning.
import { jest } from "@jest/globals";
import { requestTodayObligations, TODAY_OBLIGATIONS_EVENT, TODAY_OBLIGATIONS_REQUEST_EVENT } from "proposed-agenda-obligations";

const PLANNED_DAY = new Date(2026, 9, 5);
const AGENDA_TODAY_KEY = "2026-10-04";
const TODAY_MEETING = { durationMinutes: 60, source: "event", startMinutes: 600, taskUuid: null, title: "Today meeting" };

let agendaResponder = null;

afterEach(() => {
  if (agendaResponder) window.removeEventListener(TODAY_OBLIGATIONS_REQUEST_EVENT, agendaResponder);
  agendaResponder = null;
});

// ----------------------------------------------------------------------------------------------
// @desc Answer every obligations request the way the Agenda widget does: with its own today's obligations.
// @param {string} dateKey - The day the simulated Agenda widget treats as today.
// @param {Array<object>} obligations - Obligations it broadcasts.
function respondAsAgendaWidget(dateKey, obligations) {
  agendaResponder = () => {
    window.dispatchEvent(new CustomEvent(TODAY_OBLIGATIONS_EVENT, { detail: { dateKey, obligations } }));
  };
  window.addEventListener(TODAY_OBLIGATIONS_REQUEST_EVENT, agendaResponder);
}

// ----------------------------------------------------------------------------------------------
// @desc App stub whose planned day holds one scheduled task at 14:00.
// @returns {object} App with the task-domain and calendar surface deriveTodayObligations reads.
function buildPlannedDayApp() {
  const startAt = Math.floor(new Date(2026, 9, 5, 14, 0).getTime() / 1000);
  return { getExternalCalendarEvents: jest.fn(async () => []),
    getTaskDomainTasks: jest.fn(async () => [{ content: "Planned-day review", startAt, uuid: "task-planned" }]),
    getTaskDomains: jest.fn(async () => []) };
}

describe("requestTodayObligations", () => {
  it("uses the Agenda widget's broadcast when it is for the planned day", async () => {
    respondAsAgendaWidget("2026-10-05", [TODAY_MEETING]);
    const obligations = await requestTodayObligations(buildPlannedDayApp(), { currentDate: PLANNED_DAY });
    expect(obligations).toEqual([TODAY_MEETING]);
  });

  it("derives the planned day itself when the broadcast is for a different day", async () => {
    respondAsAgendaWidget(AGENDA_TODAY_KEY, [TODAY_MEETING]);
    const app = buildPlannedDayApp();
    const obligations = await requestTodayObligations(app, { currentDate: PLANNED_DAY, domainUuid: "domain-1" });
    expect(obligations.map(obligation => obligation.title)).toEqual(["Planned-day review"]);
    expect(obligations[0].startMinutes).toBe(14 * 60);
  });
});
