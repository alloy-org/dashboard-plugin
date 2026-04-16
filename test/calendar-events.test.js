/**
 * [Claude-authored file]
 * Created: 2026-04-15 | Model: claude-sonnet-4-6
 * Task: Tests for calendarEvents prop display in AgendaWidget and DaySketchWidget
 * Prompt summary: "prove that calendar events given to components as props show in agenda.js and day-sketch.js"
 */
import { jest } from "@jest/globals";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import AgendaWidget from "../lib/dashboard/agenda.js";
import DaySketchWidget from "../lib/dashboard/day-sketch.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const flushAsync = () =>
  act(async () => { await new Promise(r => setTimeout(r, 0)); });

const CURRENT_DATE = "2026-04-15";

const SAMPLE_EVENTS = [
  {
    title: "Team Standup",
    allDay: false,
    calendar: { uuid: "cal-work-uuid", name: "Work Calendar" },
  },
  {
    title: "Company All-Hands",
    allDay: true,
    calendar: { uuid: "cal-work-uuid", name: "Work Calendar" },
  },
  {
    title: "Personal Reminder",
    allDay: false,
    calendar: { uuid: "cal-personal-uuid", name: "Personal" },
  },
];

function buildMockDaySketchApp({ findNoteResult = null } = {}) {
  return {
    findNote: jest.fn().mockResolvedValue(findNoteResult),
    createNote: jest.fn().mockResolvedValue("new-uuid"),
    replaceNoteContent: jest.fn().mockResolvedValue(true),
    getNoteContent: jest.fn().mockResolvedValue(""),
    navigate: jest.fn(),
  };
}

// [Claude] Generated tests for: calendar events display in AgendaWidget and DaySketchWidget
// Date: 2026-04-15 | Model: claude-sonnet-4-6
describe("AgendaWidget — calendarEvents prop", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => { root.unmount(); });
      root = null;
    }
    container.remove();
  });

  it("renders calendar event titles in the today section", async () => {
    await act(async () => {
      root.render(createElement(AgendaWidget, {
        app: { navigate: jest.fn() },
        currentDate: CURRENT_DATE,
        tasks: {},
        calendarEvents: SAMPLE_EVENTS,
      }));
    });

    expect(container.textContent).toContain("Team Standup");
    expect(container.textContent).toContain("Company All-Hands");
    expect(container.textContent).toContain("Personal Reminder");
  });

  it("renders the calendar name alongside each event", async () => {
    await act(async () => {
      root.render(createElement(AgendaWidget, {
        app: { navigate: jest.fn() },
        currentDate: CURRENT_DATE,
        tasks: {},
        calendarEvents: SAMPLE_EVENTS,
      }));
    });

    expect(container.textContent).toContain("Work Calendar");
    expect(container.textContent).toContain("Personal");
  });

  it("shows an 'All day' indicator for allDay events", async () => {
    await act(async () => {
      root.render(createElement(AgendaWidget, {
        app: { navigate: jest.fn() },
        currentDate: CURRENT_DATE,
        tasks: {},
        calendarEvents: [SAMPLE_EVENTS[1]], // Company All-Hands, allDay: true
      }));
    });

    expect(container.textContent).toContain("All day");
  });

  it("renders calendar events alongside existing tasks", async () => {
    const todayMs = new Date(`${CURRENT_DATE}T09:00:00`).getTime();
    const tasks = {
      [CURRENT_DATE]: [
        { uuid: "t1", content: "Daily planning", startAt: todayMs, important: false, urgent: false },
      ],
    };

    await act(async () => {
      root.render(createElement(AgendaWidget, {
        app: { navigate: jest.fn() },
        currentDate: CURRENT_DATE,
        tasks,
        calendarEvents: [SAMPLE_EVENTS[0]],
      }));
    });

    expect(container.textContent).toContain("Daily planning");
    expect(container.textContent).toContain("Team Standup");
  });

  it("shows today section when tasks is empty but calendarEvents has entries", async () => {
    await act(async () => {
      root.render(createElement(AgendaWidget, {
        app: { navigate: jest.fn() },
        currentDate: CURRENT_DATE,
        tasks: {},
        calendarEvents: [SAMPLE_EVENTS[0]],
      }));
    });

    // Today section header should be present (not the "No tasks" fallback alone)
    expect(container.querySelector(".agenda-day")).not.toBeNull();
    expect(container.textContent).toContain("Team Standup");
    // "No tasks scheduled" should NOT appear since there is a calendar event
    expect(container.textContent).not.toContain("No tasks scheduled");
  });

  it("still shows 'No tasks scheduled' when calendarEvents is empty", async () => {
    await act(async () => {
      root.render(createElement(AgendaWidget, {
        app: { navigate: jest.fn() },
        currentDate: CURRENT_DATE,
        // Pass today as an explicit key so the date section renders
        tasks: { [CURRENT_DATE]: [] },
        calendarEvents: [],
      }));
    });

    // With no tasks and no calendar events the empty-day copy should appear
    expect(container.textContent).toContain("No tasks scheduled");
  });

  it("renders calendar events using agenda-calendar-event-row class", async () => {
    await act(async () => {
      root.render(createElement(AgendaWidget, {
        app: { navigate: jest.fn() },
        currentDate: CURRENT_DATE,
        tasks: {},
        calendarEvents: [SAMPLE_EVENTS[0]],
      }));
    });

    expect(container.querySelector(".agenda-calendar-event-row")).not.toBeNull();
  });
});

// ----------------------------------------------------------------------------

describe("DaySketchWidget — calendarEvents prop", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => { root.unmount(); });
      root = null;
    }
    container.remove();
  });

  it("renders calendar event titles in the Today's Calendar panel", async () => {
    const app = buildMockDaySketchApp();

    await act(async () => {
      root.render(createElement(DaySketchWidget, {
        app,
        agendaTasks: {},
        currentDate: CURRENT_DATE,
        calendarEvents: SAMPLE_EVENTS,
      }));
    });
    await flushAsync();

    expect(container.textContent).toContain("Team Standup");
    expect(container.textContent).toContain("Company All-Hands");
    expect(container.textContent).toContain("Personal Reminder");
  });

  it("renders the calendar name alongside each event", async () => {
    const app = buildMockDaySketchApp();

    await act(async () => {
      root.render(createElement(DaySketchWidget, {
        app,
        agendaTasks: {},
        currentDate: CURRENT_DATE,
        calendarEvents: SAMPLE_EVENTS,
      }));
    });
    await flushAsync();

    expect(container.textContent).toContain("Work Calendar");
    expect(container.textContent).toContain("Personal");
  });

  it("shows 'All day' indicator for allDay events", async () => {
    const app = buildMockDaySketchApp();

    await act(async () => {
      root.render(createElement(DaySketchWidget, {
        app,
        agendaTasks: {},
        currentDate: CURRENT_DATE,
        calendarEvents: [SAMPLE_EVENTS[1]], // Company All-Hands, allDay: true
      }));
    });
    await flushAsync();

    expect(container.textContent).toContain("All day");
  });

  it("renders the Today's Calendar heading when events are present", async () => {
    const app = buildMockDaySketchApp();

    await act(async () => {
      root.render(createElement(DaySketchWidget, {
        app,
        agendaTasks: {},
        currentDate: CURRENT_DATE,
        calendarEvents: [SAMPLE_EVENTS[0]],
      }));
    });
    await flushAsync();

    expect(container.textContent).toContain("Today's Calendar");
    expect(container.querySelector(".day-sketch-calendar-events")).not.toBeNull();
  });

  it("does not render the Today's Calendar panel when calendarEvents is empty", async () => {
    const app = buildMockDaySketchApp();

    await act(async () => {
      root.render(createElement(DaySketchWidget, {
        app,
        agendaTasks: {},
        currentDate: CURRENT_DATE,
        calendarEvents: [],
      }));
    });
    await flushAsync();

    expect(container.querySelector(".day-sketch-calendar-events")).toBeNull();
  });

  it("does not render the Today's Calendar panel when calendarEvents is null", async () => {
    const app = buildMockDaySketchApp();

    await act(async () => {
      root.render(createElement(DaySketchWidget, {
        app,
        agendaTasks: {},
        currentDate: CURRENT_DATE,
        calendarEvents: null,
      }));
    });
    await flushAsync();

    expect(container.querySelector(".day-sketch-calendar-events")).toBeNull();
  });
});
