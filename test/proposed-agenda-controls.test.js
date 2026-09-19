// Exercise agenda popout navigation, dismissal, and custom priority instructions.
import { jest } from "@jest/globals";
import ProposedAgendaDateControl from "proposed-agenda-date-control";
import { priorityOptionFromKey } from "proposed-agenda-priority";
import ProposedAgendaPriorityControl from "proposed-agenda-priority-control";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

let container;
let root;

// ----------------------------------------------------------------------------------------------
// @desc Click a uniquely identified control and flush its React state updates.
// @param {string} selector - CSS selector scoped to the document, including portaled popouts.
async function clickControl(selector) {
  await act(async () => document.querySelector(selector).click());
}

// ----------------------------------------------------------------------------------------------
// @desc Mount a control in an isolated React root for interaction assertions.
// @param {Function} component - Calendar or priority control.
// @param {object} props - Props supplied to the control.
async function renderControl(component, props) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(component, props)));
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 8, 19, 10));
});

afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = "";
  jest.useRealTimers();
});

describe("agenda date popout", () => {
  // ------------------------------------------------------------------------------------------
  // @desc Calendar clicks select exact weekend dates and month navigation crosses year boundaries.
  it("opens a portaled calendar and selects a day in the next year", async () => {
    const onSelectDate = jest.fn();
    await renderControl(ProposedAgendaDateControl, { dateValue: "2026-12-21", onSelectDate });
    await clickControl('[aria-label="Change agenda date"]');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('[role="dialog"]').textContent).toContain("December 2026");
    await clickControl('[aria-label="Next month"]');
    await clickControl('[aria-label="Saturday, January 2, 2027"]');
    expect(onSelectDate).toHaveBeenCalledWith("2027-01-02");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  // ------------------------------------------------------------------------------------------
  // @desc Escape dismisses the dialog and returns keyboard focus to the trigger.
  it("restores focus on Escape and dismisses clicks outside", async () => {
    await renderControl(ProposedAgendaDateControl, { dateValue: "2026-09-21", onSelectDate: jest.fn() });
    await clickControl('[aria-label="Change agenda date"]');
    expect(document.activeElement.getAttribute("aria-pressed")).toBe("true");
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement.getAttribute("aria-label")).toBe("Change agenda date");
    await clickControl('[aria-label="Change agenda date"]');
    await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  // ------------------------------------------------------------------------------------------
  // @desc Quick shortcuts choose real local dates without automatic weekend skipping.
  it("offers today, tomorrow, next Monday, and relative day navigation", async () => {
    const onSelectDate = jest.fn();
    await renderControl(ProposedAgendaDateControl, { dateValue: "2026-09-21", onSelectDate });
    await clickControl('[aria-label="Previous agenda day"]');
    expect(onSelectDate).toHaveBeenLastCalledWith("2026-09-20");
    await clickControl('[aria-label="Next agenda day"]');
    expect(onSelectDate).toHaveBeenLastCalledWith("2026-09-22");
    for (const [index, expected] of [[0, "2026-09-19"], [1, "2026-09-20"], [2, "2026-09-21"]]) {
      await clickControl('[aria-label="Change agenda date"]');
      await clickControl(`.agenda-calendar-shortcuts button:nth-child(${ index + 1 })`);
      expect(onSelectDate).toHaveBeenLastCalledWith(expected);
    }
  });

  // ------------------------------------------------------------------------------------------
  // @desc Calendar markers reflect known generated dates and busy days from supplied event data.
  it("shows markers only for known agendas and days with three timed meetings", async () => {
    const calendarEvents = [9, 10, 11].map(hour => ({ start: new Date(2026, 8, 22, hour) }));
    await renderControl(ProposedAgendaDateControl, { calendarEvents, dateValue: "2026-09-21",
      onSelectDate: jest.fn(), savedDates: ["2026-09-21"] });
    await clickControl('[aria-label="Change agenda date"]');
    expect(document.querySelectorAll(".agenda-calendar-grid .agenda-calendar-saved")).toHaveLength(1);
    expect(document.querySelectorAll(".agenda-calendar-grid .agenda-calendar-busy")).toHaveLength(1);
    expect(document.querySelector('[aria-label="Tuesday, September 22, 2026"] .agenda-calendar-busy')).not.toBeNull();
  });
});

describe("agenda priority popout", () => {
  // ------------------------------------------------------------------------------------------
  // @desc Built-in choices retain legacy storage keys while displaying the reference design's wording.
  it("keeps the cleanup priority's existing identity", async () => {
    const onPriorityChange = jest.fn();
    await renderControl(ProposedAgendaPriorityControl, { dateValue: "2026-09-21", onPriorityChange, priorityKey: "goal-progress" });
    await clickControl('[aria-label="Change agenda priority"]');
    expect(document.querySelector('[role="dialog"]').textContent).toContain("What should Monday serve?");
    const cleanup = [...document.querySelectorAll(".agenda-priority-option")].find(button => button.textContent.includes("Clear the decks"));
    await act(async () => cleanup.click());
    expect(onPriorityChange).toHaveBeenCalledWith({ target: { value: "barnacle-cleanup" } });
  });

  // ------------------------------------------------------------------------------------------
  // @desc Custom text becomes the model instruction rather than silently resolving to the default priority.
  it("submits a trimmed custom priority and resolves its generation instruction", async () => {
    const onPriorityChange = jest.fn();
    await renderControl(ProposedAgendaPriorityControl, { dateValue: "2026-09-21", onPriorityChange, priorityKey: "goal-progress" });
    await clickControl('[aria-label="Change agenda priority"]');
    const input = document.querySelector(".agenda-priority-custom input");
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, "  Protect the morning  ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => document.querySelector(".agenda-priority-custom").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(onPriorityChange).toHaveBeenCalledWith({ target: { value: "custom:Protect the morning" } });
    expect(priorityOptionFromKey("custom:Protect the morning").instruction).toContain("Protect the morning");
    expect(priorityOptionFromKey("custom:  ").key).toBe("goal-progress");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
