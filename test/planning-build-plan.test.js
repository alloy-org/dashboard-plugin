// The Quarterly Planning widget's Build plan button and current-quarter card follow the 15-day rule. The
// clock is frozen per test so the assertions do not depend on the day the suite runs.

import { jest } from "@jest/globals";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { defaultQuarterlyTemplate } from "constants/quarters";
import { createPlanWizardApp } from "./fixtures/plan-wizard-app.js";

await jest.unstable_mockModule("plan-wizard/wizard-prompt-runner", () => ({
  raceWizardPrompt: jest.fn(async () => ({ occupationHypothesis: "", personal: [], work: [] })),
}));

const { default: PlanningWidget } = await import("dashboard/planning");

const currentPlan = { domainName: "Work", hasAllMonthlyDetails: false, label: "Q3 2026", noteUUID: null, quarter: 3, year: 2026 };
const nextPlan = { domainName: "Work", hasAllMonthlyDetails: false, label: "Q4 2026", noteUUID: null, quarter: 4, year: 2026 };

// ----------------------------------------------------------------------------------------------
// @desc Make `new Date()` return one local day for the rest of the test, leaving explicit date
//   construction on the real clock.
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
// @desc Flush the promise chains a click or the widget's initial month load queues.
async function settle() {
  for (let iteration = 0; iteration < 12; iteration += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Mount the planning widget on a frozen day.
// @param {object} params - { app, now, quarterlyPlans }.
// @returns {Promise<object>} The mount, a cleanup that also restores the clock, and the widget root.
async function renderPlanning({ app = {}, now, quarterlyPlans = { current: currentPlan, next: nextPlan } }) {
  const restoreNow = freezeNow(now);
  const mountPoint = document.createElement("div");
  document.body.appendChild(mountPoint);
  const root = createRoot(mountPoint);
  try {
    await act(async () => {
      root.render(createElement(PlanningWidget, { app, quarterlyPlans, taskDomainName: "Work", taskDomainUUID: "domain-work" }));
    });
    await settle();
  } catch (renderError) {
    restoreNow();
    throw renderError;
  }
  return { cleanup: async () => {
    await act(async () => { root.unmount(); });
    mountPoint.remove();
    restoreNow();
  }, container: mountPoint };
}

// ----------------------------------------------------------------------------------------------
// @desc Click an element the way the widget's handlers listen, then let the resulting promises settle.
// @param {HTMLElement} element - Element that owns the onClick.
async function clickAndSettle(element) {
  await act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await settle();
}

describe("PlanningWidget build plan", () => {
  it("names the current quarter until 15 days before the next one", async () => {
    const { cleanup, container } = await renderPlanning({ now: new Date(2026, 8, 15) });
    expect(container.querySelector(".widget-header-action").title).toContain("Q3 2026");
    await cleanup();
  });

  it("names the upcoming quarter once it is 15 days away", async () => {
    const { cleanup, container } = await renderPlanning({ now: new Date(2026, 8, 16) });
    expect(container.querySelector(".widget-header-action").title).toContain("Q4 2026");
    await cleanup();
  });

  it("opens the upcoming quarter from Build plan inside the lead window", async () => {
    const { cleanup, container } = await renderPlanning({ app: createPlanWizardApp(), now: new Date(2026, 8, 21) });
    await clickAndSettle(container.querySelector(".widget-header-action"));
    expect(document.body.querySelector(".plan-wizard-title-quarter").textContent).toBe("Q4 2026");
    await cleanup();
  });

  it("copies an existing upcoming plan onto the current quarter instead of opening the wizard", async () => {
    const app = createPlanWizardApp();
    app.notes.push({ archived: false, content: defaultQuarterlyTemplate("Q4 2026", 4), localUuid: "local-next",
      name: "Q4 2026 Work Plan", tags: ["plugins/dashboard", "planning/quarterly"], uuid: "next-note" });
    const quarterlyPlans = { current: currentPlan, next: { ...nextPlan, noteUUID: "next-note" } };
    const { cleanup, container } = await renderPlanning({ app, now: new Date(2026, 8, 21), quarterlyPlans });
    const [currentCard, nextCard] = container.querySelectorAll(".quarter-card");
    expect(currentCard.querySelector(".quarter-status").textContent).toContain("Create Plan");

    await clickAndSettle(currentCard);
    const currentNote = app.notes.find(note => note.name === "Q3 2026 Work Plan");
    expect(currentNote.content).toContain("# Projects");
    expect(currentNote.content).not.toContain("October");
    expect(currentCard.querySelector(".quarter-status").textContent).toContain("Open Plan");
    expect(document.body.querySelector(".plan-wizard-page")).toBeNull();
    expect(nextCard.querySelector(".quarter-status").textContent).toContain("Open Plan");
    await cleanup();
  });

  it("opens the upcoming wizard from the current card when neither quarter has a plan", async () => {
    const { cleanup, container } = await renderPlanning({ app: createPlanWizardApp(), now: new Date(2026, 8, 21) });
    await clickAndSettle(container.querySelector(".quarter-card"));
    expect(document.body.querySelector(".plan-wizard-title-quarter").textContent).toBe("Q4 2026");
    await cleanup();
  });

  it("opens the current quarter from its card outside the lead window", async () => {
    const { cleanup, container } = await renderPlanning({ app: createPlanWizardApp(), now: new Date(2026, 8, 1) });
    await clickAndSettle(container.querySelector(".quarter-card"));
    expect(document.body.querySelector(".plan-wizard-title-quarter").textContent).toBe("Q3 2026");
    await cleanup();
  });
});
