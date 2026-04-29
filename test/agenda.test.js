/**
 * [Claude-authored file]
 * Created: 2026-03-24 | Model: claude-sonnet-4-6
 * Task: Agenda widget tests — hideUntil filtering and pagination
 * Prompt summary: "add agenda tests; use real current date/time and relative offsets for hideUntil and date keys"
 */
import { jest } from "@jest/globals";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { formatDateKey } from "util/date-utility";
import AgendaWidget from "../lib/dashboard/agenda.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const flushAsync = () =>
  act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function buildMockApp() {
  return { navigate: jest.fn().mockResolvedValue(undefined) };
}

// [Claude] Task: calendar math for agenda date keys (keys via shared formatDateKey)
// Prompt: "DRY formatDateKey in date-utility"
// Date: 2026-03-24 | Model: claude-sonnet-4-6
function addDays(date, deltaDays) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + deltaDays);
  return d;
}

// [Claude] Generated tests for: Agenda hideUntil filtering and date pagination (real clock + relative offsets)
// Date: 2026-03-24 | Model: claude-sonnet-4-6
describe("AgendaWidget", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    if (root) {
      await act(async () => { root.unmount(); });
      root = null;
    }
    container.remove();
  });

  it("omits tasks whose hideUntil is later than the current time", async () => {
    const nowMs = Date.now();
    const oneHourMs = 3_600_000;
    const app = buildMockApp();
    const today = new Date();
    const dateKey = formatDateKey(today);
    const tasks = {
      [dateKey]: [
        { uuid: "task-visible-default", content: "Always visible", startAt: nowMs },
        {
          uuid: "task-hidden-future",
          content: "Snoozed until later",
          startAt: nowMs,
          hideUntil: nowMs + oneHourMs,
        },
        {
          uuid: "task-visible-past-hide",
          content: "Hide window elapsed",
          startAt: nowMs,
          hideUntil: nowMs - oneHourMs,
        },
      ],
    };

    await act(async () => {
      root.render(
        createElement(AgendaWidget, {
          app,
          currentDate: today.toISOString(),
          tasks,
        })
      );
    });
    await flushAsync();

    const text = container.textContent || "";
    expect(text).toContain("Always visible");
    expect(text).toContain("Hide window elapsed");
    expect(text).not.toContain("Snoozed until later");
  });

  // [OpenAI GPT-5.5] Generated test for: mixed Agenda task/event ordering by timestamp
  // Date: 2026-04-29 | Model: GPT-5.5
  it("intersperses tasks and calendar events by ascending time within a day", async () => {
    const app = buildMockApp();
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dateKey = formatDateKey(dayStart);
    const msFromHour = (hour) => new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(),
      hour, 0, 0, 0).getTime();
    const tasks = {
      [dateKey]: [
        { uuid: "task-1500", content: "Task at 3 PM", startAt: msFromHour(15) },
        { uuid: "task-1000", content: "Task at 10 AM", startAt: msFromHour(10) },
      ],
    };
    const calendarEvents = [
      { end: new Date(msFromHour(12)), start: new Date(msFromHour(11)), title: "Event at 11 AM" },
      { end: new Date(msFromHour(10)), start: new Date(msFromHour(9)), title: "Event at 9 AM" },
    ];

    await act(async () => {
      root.render(
        createElement(AgendaWidget, {
          app,
          calendarEvents,
          currentDate: dayStart.toISOString(),
          tasks,
        })
      );
    });
    await flushAsync();

    const labels = Array.from(container.querySelectorAll(".agenda-item .agenda-text"))
      .map((element) => element.textContent);
    expect(labels).toEqual(["Event at 9 AM", "Task at 10 AM", "Event at 11 AM", "Task at 3 PM"]);
  });

  it("shows at most three date sections per page and reveals the next date after clicking forward", async () => {
    const app = buildMockApp();
    const base = new Date();
    const k0 = formatDateKey(addDays(base, 0));
    const k1 = formatDateKey(addDays(base, 1));
    const k2 = formatDateKey(addDays(base, 2));
    const k3 = formatDateKey(addDays(base, 3));
    const tasks = {
      [k0]: [{ uuid: "d1", content: "Alpha day task", startAt: null }],
      [k1]: [{ uuid: "d2", content: "Bravo day task", startAt: null }],
      [k2]: [{ uuid: "d3", content: "Charlie day task", startAt: null }],
      [k3]: [{ uuid: "d4", content: "Delta day task", startAt: null }],
    };

    await act(async () => {
      root.render(
        createElement(AgendaWidget, {
          app,
          currentDate: base.toISOString(),
          tasks,
        })
      );
    });
    await flushAsync();

    expect(container.querySelector(".agenda-pagination")).not.toBeNull();
    expect(container.textContent).toContain("Alpha day task");
    expect(container.textContent).toContain("Bravo day task");
    expect(container.textContent).toContain("Charlie day task");
    expect(container.textContent).not.toContain("Delta day task");

    const indicator = container.querySelector(".agenda-page-indicator");
    expect(indicator?.textContent?.trim()).toBe("1 / 2");

    const arrows = container.querySelectorAll(".agenda-page-arrow");
    expect(arrows.length).toBe(2);
    const forward = arrows[1];
    expect(forward.hasAttribute("disabled")).toBe(false);

    await act(async () => { forward.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await flushAsync();

    expect(indicator?.textContent?.trim()).toBe("2 / 2");
    expect(container.textContent).toContain("Delta day task");
    expect(container.textContent).not.toContain("Alpha day task");
  });

  it("does not render pagination when there are three or fewer dates", async () => {
    const app = buildMockApp();
    const base = new Date();
    const k0 = formatDateKey(addDays(base, 10));
    const k1 = formatDateKey(addDays(base, 11));
    const k2 = formatDateKey(addDays(base, 12));
    const tasks = {
      [k0]: [{ uuid: "a", content: "One", startAt: null }],
      [k1]: [{ uuid: "b", content: "Two", startAt: null }],
      [k2]: [{ uuid: "c", content: "Three", startAt: null }],
    };

    await act(async () => {
      root.render(
        createElement(AgendaWidget, {
          app,
          currentDate: base.toISOString(),
          tasks,
        })
      );
    });
    await flushAsync();

    expect(container.querySelector(".agenda-pagination")).toBeNull();
  });

  it("jumps to the page that contains selectedDate after mount", async () => {
    const app = buildMockApp();
    const base = new Date();
    const k0 = formatDateKey(addDays(base, 20));
    const k1 = formatDateKey(addDays(base, 21));
    const k2 = formatDateKey(addDays(base, 22));
    const k3 = formatDateKey(addDays(base, 23));
    const tasks = {
      [k0]: [{ uuid: "p1", content: "Page one A", startAt: null }],
      [k1]: [{ uuid: "p2", content: "Page one B", startAt: null }],
      [k2]: [{ uuid: "p3", content: "Page one C", startAt: null }],
      [k3]: [{ uuid: "p4", content: "Page two only", startAt: null }],
    };

    await act(async () => {
      root.render(
        createElement(AgendaWidget, {
          app,
          currentDate: base.toISOString(),
          selectedDate: k3,
          tasks,
        })
      );
    });
    await flushAsync();

    expect(container.querySelector(".agenda-page-indicator")?.textContent?.trim()).toBe("2 / 2");
    expect(container.textContent).toContain("Page two only");
    expect(container.textContent).not.toContain("Page one A");
  });
});
