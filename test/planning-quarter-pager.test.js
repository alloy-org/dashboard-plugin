// Side buttons on Quarterly Planning step one quarter at a time. The clock is frozen on 2 Oct 2026, so the current
// quarter is Q4 and, being in its first half, the widget opens on Q3 beside Q4; one step back is the Q2–Q3 pair. Past
// Q4's midpoint it opens on Q4 beside Q1 2027 instead. A past quarter's card opens its retrospective whether or not a
// plan was recorded.
import { jest } from "@jest/globals";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { createPlanWizardApp } from "./fixtures/plan-wizard-app.js";

const { default: PlanningWidget } = await import("dashboard/planning");

const currentPlan = { domainName: "Work", hasAllMonthlyDetails: false, label: "Q4 2026", noteUUID: "q4-note", quarter: 4,
  year: 2026 };
const nextPlan = { domainName: "Work", hasAllMonthlyDetails: false, label: "Q1 2027", noteUUID: null, quarter: 1, year: 2027 };

// ----------------------------------------------------------------------------------------------
// @desc Make `new Date()` return one local day for the rest of the test.
// @param {Date} now - The day the widget should treat as today.
// @returns {Function} Restores the real Date.
function freezeNow(now) {
  const RealDate = global.Date;
  const fixedTime = now.getTime();
  function FrozenDate(...args) {
    if (args.length === 0) return new RealDate(fixedTime);
    return new RealDate(...args);
  }
  FrozenDate.now = () => fixedTime;
  FrozenDate.parse = RealDate.parse;
  FrozenDate.UTC = RealDate.UTC;
  FrozenDate.prototype = RealDate.prototype;
  global.Date = FrozenDate;
  return () => { global.Date = RealDate; };
}

// ----------------------------------------------------------------------------------------------
// @desc Flush the promise chains a click or the widget's plan lookup queues.
async function settle() {
  for (let iteration = 0; iteration < 20; iteration += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Mount the planning widget while Q4 2026 is current.
// @param {object} [options] - An object with the following properties:
//   - {object} [app] - Amplenote app stub. Defaults to one that can look up plan notes.
//   - {Date} [now] - The day the widget treats as today. Defaults to 2 Oct 2026, in Q4's first half.
// @returns {Promise<object>} The mount, a cleanup that also restores the clock, and the widget root.
async function renderPlanning({ app = planningApp(), now = new Date(2026, 9, 2) } = {}) {
  const restoreNow = freezeNow(now);
  const mountPoint = document.createElement("div");
  document.body.appendChild(mountPoint);
  const root = createRoot(mountPoint);
  await act(async () => {
    root.render(createElement(PlanningWidget, { app, quarterlyPlans: { current: currentPlan, next: nextPlan },
      taskDomainName: "Work", taskDomainUUID: "domain-work" }));
  });
  await settle();
  return { cleanup: async () => {
    await act(async () => { root.unmount(); });
    mountPoint.remove();
    restoreNow();
  }, container: mountPoint };
}

// ----------------------------------------------------------------------------------------------
// @desc An app stub whose note lookup the pager can call, including a Q3 plan note.
// @returns {object} The stub.
function planningApp() {
  const app = createPlanWizardApp();
  app.getNoteSections = jest.fn(async () => []);
  app.notes.push({ archived: false, content: "# July\n- Focus: ship", localUuid: "local-q3", name: "Q3 2026 Work Plan",
    tags: ["plugins/dashboard"], uuid: "q3-note" });
  return app;
}

// ----------------------------------------------------------------------------------------------
// @desc Click an element the way the widget's handlers listen, then let the resulting promises settle.
// @param {HTMLElement} element - Element that owns the onClick.
async function clickAndSettle(element) {
  await act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await settle();
}

// ----------------------------------------------------------------------------------------------
// @desc The visible quarter-card titles, in order.
// @param {HTMLElement} container - The widget mount.
// @returns {Array<string>} Each card's title text.
function cardTitles(container) {
  return [...container.querySelectorAll(".quarter-label")].map(label => label.textContent);
}

describe("PlanningWidget quarter pager", () => {
  it("opens on the previous quarter beside the current one in the current quarter's first half", async () => {
    const { cleanup, container } = await renderPlanning();
    expect(cardTitles(container)).toEqual(["Q3 2026 · Work", "Q4 2026 · Work"]);
    expect(container.querySelector("[aria-label='Show Q2 2026']")).not.toBeNull();
    expect(container.querySelector("[aria-label='Show Q1 2027']")).not.toBeNull();
    const [pastCard, currentCard] = container.querySelectorAll(".quarter-card");
    expect(pastCard.querySelector(".quarter-past-badge").textContent).toBe("Past");
    expect(pastCard.querySelector(".quarter-status").textContent).toBe("✨ Retrospective");
    expect(pastCard.querySelector("input")).toBeNull();
    expect(currentCard.querySelector(".quarter-past-badge")).toBeNull();
    expect(currentCard.querySelector("input")).not.toBeNull();
    expect(container.querySelector(".month-tab.active").textContent).toBe("Oct");
    expect(container.querySelector(".planning-return-quarter")).toBeNull();
    await cleanup();
  });

  it("opens on the current quarter beside the next from the current quarter's midpoint", async () => {
    const { cleanup, container } = await renderPlanning({ now: new Date(2026, 10, 16) });
    expect(cardTitles(container)).toEqual(["Q4 2026 · Work", "Q1 2027 · Work"]);
    expect(container.querySelector("[aria-label='Show Q3 2026']")).not.toBeNull();
    expect(container.querySelector("[aria-label='Show Q2 2027']")).not.toBeNull();
    expect(container.querySelector(".planning-return-quarter")).toBeNull();
    await cleanup();
  });

  it("opens an unrecorded past quarter's retrospective after a step back, and returns to today", async () => {
    const { cleanup, container } = await renderPlanning();
    await clickAndSettle(container.querySelector("[aria-label='Show Q2 2026']"));

    expect(cardTitles(container)).toEqual(["Q2 2026 · Work", "Q3 2026 · Work"]);
    expect(container.querySelector(".planning-return-quarter").textContent).toBe("↩ Back to Q4 2026");
    const [unrecordedCard] = container.querySelectorAll(".quarter-card");
    expect(unrecordedCard.querySelector(".quarter-status").textContent).toBe("✨ Retrospective");
    expect(container.querySelector(".month-tab.active").textContent).toBe("Apr");
    expect(container.querySelector(".month-content-unrecorded").textContent).toBe("No plan was recorded for Q2 2026.");

    await clickAndSettle(unrecordedCard);
    expect(document.body.querySelector(".plan-wizard-page")).toBeNull();
    expect(document.body.querySelector(".retrospective-options-headline").textContent).toBe("Craft your Q2 retrospective");
    expect(document.body.querySelector(".retrospective-header-link")).toBeNull();
    await clickAndSettle(document.body.querySelector(".retrospective-overlay-close"));
    expect(document.body.querySelector(".quarter-retrospective-overlay")).toBeNull();

    await clickAndSettle(container.querySelector(".planning-return-quarter"));
    expect(cardTitles(container)).toEqual(["Q3 2026 · Work", "Q4 2026 · Work"]);
    expect(container.querySelector(".month-tab.active").textContent).toBe("Oct");
    await cleanup();
  });

  it("steps forward to the quarter after the one already on the right", async () => {
    const { cleanup, container } = await renderPlanning();
    await clickAndSettle(container.querySelector("[aria-label='Show Q1 2027']"));
    expect(cardTitles(container)).toEqual(["Q4 2026 · Work", "Q1 2027 · Work"]);
    expect(container.querySelector(".quarter-past-badge")).toBeNull();
    expect(container.querySelector("[aria-label='Show Q2 2027']")).not.toBeNull();
    await cleanup();
  });
});
