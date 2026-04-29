/**
 * [Claude-authored file]
 * Created: 2026-04-15 | Model: claude-sonnet-4-6
 * Updated: 2026-04-16 | Model: claude-4.6-opus
 * Task: Tests for calendarEvents prop display in AgendaWidget and DaySketchWidget
 * Prompt summary: "prove that calendar events given to components as props show in agenda.js and day-sketch.js"
 */
import { jest } from "@jest/globals";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import AgendaWidget from "../lib/dashboard/agenda.js";
import DaySketchWidget from "../lib/dashboard/day-sketch.js";
import { normalizeExternalCalendarEvents } from "../lib/hooks/use-external-calendar-events.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const flushAsync = () =>
  act(async () => { await new Promise(r => setTimeout(r, 0)); });

const CURRENT_DATE = "2026-04-15";

const SAMPLE_EVENTS = [
  {
    title: "Team Standup",
    allDay: false,
    calendar: { uuid: "cal-work-uuid", name: "Work Calendar" },
    color: "#4285f4",
    end: new Date("2026-04-15T10:00:00"),
    start: new Date("2026-04-15T09:00:00"),
  },
  {
    title: "Company All-Hands",
    allDay: true,
    calendar: { uuid: "cal-work-uuid", name: "Work Calendar" },
    color: "#0b8043",
    end: new Date("2026-04-15T23:59:59"),
    start: new Date("2026-04-15T00:00:00"),
  },
  {
    title: "Personal Reminder",
    allDay: false,
    calendar: { uuid: "cal-personal-uuid", name: "Personal" },
    color: "#7986cb",
    end: new Date("2026-04-15T15:30:00"),
    start: new Date("2026-04-15T14:00:00"),
  },
];

const TOMORROW_EVENT = {
  title: "Tomorrow Meeting",
  allDay: false,
  calendar: { uuid: "cal-work-uuid", name: "Work Calendar" },
  color: "#4285f4",
  end: new Date("2026-04-16T17:00:00"),
  start: new Date("2026-04-16T16:00:00"),
};

function buildMockDaySketchApp({ findNoteResult = null } = {}) {
  return {
    findNote: jest.fn().mockResolvedValue(findNoteResult),
    createNote: jest.fn().mockResolvedValue("new-uuid"),
    replaceNoteContent: jest.fn().mockResolvedValue(true),
    getNoteContent: jest.fn().mockResolvedValue(""),
    navigate: jest.fn(),
  };
}

// [Claude claude-4.6-opus] Generated tests for: calendar events display in AgendaWidget and DaySketchWidget
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
        calendarEvents: [SAMPLE_EVENTS[1]],
      }));
    });

    expect(container.textContent).toContain("All day");
  });

  it("renders calendar events alongside existing tasks", async () => {
    const todayMs = new Date(`${ CURRENT_DATE }T09:00:00`).getTime();
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

    expect(container.querySelector(".agenda-day")).not.toBeNull();
    expect(container.textContent).toContain("Team Standup");
    expect(container.textContent).not.toContain("No tasks scheduled");
  });

  it("still shows 'No tasks scheduled' when calendarEvents is empty", async () => {
    await act(async () => {
      root.render(createElement(AgendaWidget, {
        app: { navigate: jest.fn() },
        currentDate: CURRENT_DATE,
        tasks: { [CURRENT_DATE]: [] },
        calendarEvents: [],
      }));
    });

    expect(container.textContent).toContain("No tasks scheduled");
  });

  it("renders calendar events using agenda-task-row class (same as tasks)", async () => {
    await act(async () => {
      root.render(createElement(AgendaWidget, {
        app: { navigate: jest.fn() },
        currentDate: CURRENT_DATE,
        tasks: {},
        calendarEvents: [SAMPLE_EVENTS[0]],
      }));
    });

    const taskRows = container.querySelectorAll(".agenda-task-row");
    expect(taskRows.length).toBeGreaterThanOrEqual(1);
    expect(taskRows[0].textContent).toContain("Team Standup");
  });

  it("does not show tomorrow's calendar event in today's section", async () => {
    await act(async () => {
      root.render(createElement(AgendaWidget, {
        app: { navigate: jest.fn() },
        currentDate: CURRENT_DATE,
        tasks: { [CURRENT_DATE]: [] },
        calendarEvents: [TOMORROW_EVENT],
      }));
    });

    expect(container.textContent).not.toContain("Tomorrow Meeting");
  });

  it("shows calendar event duration when start and end are present", async () => {
    await act(async () => {
      root.render(createElement(AgendaWidget, {
        app: { navigate: jest.fn() },
        currentDate: CURRENT_DATE,
        tasks: {},
        calendarEvents: [SAMPLE_EVENTS[0]],
      }));
    });

    expect(container.textContent).toContain("60m");
  });

  // [OpenAI GPT-5.5] Generated test for: agenda accepts serialized mobile calendar event dates
  // Date: 2026-04-29 | Model: GPT-5.5
  it("shows calendar event duration when mobile returns serialized date strings", async () => {
    await act(async () => {
      root.render(createElement(AgendaWidget, {
        app: { navigate: jest.fn() },
        currentDate: CURRENT_DATE,
        tasks: {},
        calendarEvents: [{
          title: "Mobile Sync",
          allDay: false,
          calendar: { uuid: "cal-mobile", name: "Mobile Calendar" },
          end: "2026-04-15T10:30:00",
          start: "2026-04-15T09:00:00",
        }],
      }));
    });

    expect(container.textContent).toContain("Mobile Sync");
    expect(container.textContent).toContain("90m");
  });
});

// ----------------------------------------------------------------------------

// [Claude claude-4.6-opus] Generated tests for: DaySketch calendar event prefill into hour rows
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

  it("prefills hour rows with calendar event titles at scheduled times", async () => {
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

    const inputs = container.querySelectorAll(".day-sketch-input");
    const nineAmInput = Array.from(inputs).find(input => input.value === "Team Standup");
    expect(nineAmInput).not.toBeUndefined();
  });

  it("prefills multiple hours for events spanning more than one hour", async () => {
    const app = buildMockDaySketchApp();

    await act(async () => {
      root.render(createElement(DaySketchWidget, {
        app,
        agendaTasks: {},
        currentDate: CURRENT_DATE,
        calendarEvents: [SAMPLE_EVENTS[2]],
      }));
    });
    await flushAsync();

    const inputs = container.querySelectorAll(".day-sketch-input");
    const matchingInputs = Array.from(inputs).filter(input => input.value === "Personal Reminder");
    expect(matchingInputs.length).toBe(2);
  });

  it("does not prefill rows for allDay events", async () => {
    const app = buildMockDaySketchApp();

    await act(async () => {
      root.render(createElement(DaySketchWidget, {
        app,
        agendaTasks: {},
        currentDate: CURRENT_DATE,
        calendarEvents: [SAMPLE_EVENTS[1]],
      }));
    });
    await flushAsync();

    const inputs = container.querySelectorAll(".day-sketch-input");
    const allHandsInput = Array.from(inputs).find(input => input.value === "Company All-Hands");
    expect(allHandsInput).toBeUndefined();
  });

  it("does not prefill rows for events on a different date", async () => {
    const app = buildMockDaySketchApp();

    await act(async () => {
      root.render(createElement(DaySketchWidget, {
        app,
        agendaTasks: {},
        currentDate: CURRENT_DATE,
        calendarEvents: [TOMORROW_EVENT],
      }));
    });
    await flushAsync();

    const inputs = container.querySelectorAll(".day-sketch-input");
    const tomorrowInput = Array.from(inputs).find(input => input.value === "Tomorrow Meeting");
    expect(tomorrowInput).toBeUndefined();
  });

  it("does not render a separate Today's Calendar panel", async () => {
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

    expect(container.querySelector(".day-sketch-calendar-events")).toBeNull();
  });
});

// ----------------------------------------------------------------------------

// [OpenAI GPT-5.5] Generated tests for: external calendar event date normalization
// Date: 2026-04-29 | Model: GPT-5.5
describe("normalizeExternalCalendarEvents", () => {
  it("converts serialized start and end values into Date instances", () => {
    const normalized = normalizeExternalCalendarEvents([{
      title: "Mobile Sync",
      end: "2026-04-15T10:30:00",
      start: "2026-04-15T09:00:00",
    }]);

    expect(normalized).toHaveLength(1);
    expect(normalized[0].end).toBeInstanceOf(Date);
    expect(normalized[0].start).toBeInstanceOf(Date);
  });
});
