// Quarterly Planning leaves the splash once saved answers or a plan note show the quarter has been begun.

import { jest } from "@jest/globals";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { createPlanWizardApp } from "./fixtures/plan-wizard-app.js";

const resolveBegunQuarterPlan = jest.fn();

await jest.unstable_mockModule("plan-wizard/plan-begun", () => ({
  resolveBegunQuarterPlan: (...args) => resolveBegunQuarterPlan(...args),
}));
await jest.unstable_mockModule("plan-wizard/wizard-prompt-runner", () => ({
  raceWizardPrompt: jest.fn(async () => ({ occupationHypothesis: "", personal: [], work: [] })),
}));

const { default: PlanningWidget } = await import("dashboard/planning");

const quarterlyPlans = {
  current: { domainName: "Work", hasAllMonthlyDetails: false, label: "Q4 2026", noteUUID: null, quarter: 4,
    year: 2026 },
  next: { domainName: "Work", hasAllMonthlyDetails: false, label: "Q1 2027", noteUUID: null, quarter: 1,
    year: 2027 },
};

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
// @desc Flush the promise chains the widget's plan check and splash decision queue.
async function settle() {
  for (let iteration = 0; iteration < 12; iteration += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Mount Planning on Oct 2, 2026, when Q4 is the quarter Plan Builder would open.
// @returns {Promise<object>} { cleanup, container }
async function renderPlanning() {
  const restoreNow = freezeNow(new Date(2026, 9, 2));
  const app = createPlanWizardApp();
  app.getNoteSections = jest.fn(async () => []);
  const mountPoint = document.createElement("div");
  document.body.appendChild(mountPoint);
  const root = createRoot(mountPoint);
  await act(async () => {
    root.render(createElement(PlanningWidget, { app, quarterlyPlans, taskDomainName: "Work",
      taskDomainUUID: "domain-work" }));
  });
  await settle();
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

describe("Planning begun-plan detection", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    resolveBegunQuarterPlan.mockReset();
  });

  it("keeps the splash when the quarter has no saved answers and no plan note", async () => {
    resolveBegunQuarterPlan.mockResolvedValue({ begun: false, noteUUID: null, quarter: 4, year: 2026 });
    const { cleanup, container } = await renderPlanning();
    try {
      expect(container.querySelector(".plan-entry-title")).not.toBeNull();
      expect(container.textContent).not.toContain("Checking your plan");
      expect(container.querySelector(".quarter-card")).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it("shows the quarter cards once saved answers exist, even without a plan note", async () => {
    resolveBegunQuarterPlan.mockResolvedValue({ begun: true, noteUUID: null, quarter: 4, year: 2026 });
    const { cleanup, container } = await renderPlanning();
    try {
      expect(container.querySelector(".plan-entry-title")).toBeNull();
      expect(container.textContent).toContain("Q4 2026");
      expect(container.textContent).toContain("Create Plan");
      expect(container.textContent).not.toContain("Set your Q4 2026 plan");
    } finally {
      await cleanup();
    }
  });

  it("shows Open Plan when the lookup finds a plan note the dashboard had not loaded", async () => {
    resolveBegunQuarterPlan.mockResolvedValue({ begun: true, noteUUID: "q4-note", quarter: 4, year: 2026 });
    const { cleanup, container } = await renderPlanning();
    try {
      expect(container.querySelector(".plan-entry-title")).toBeNull();
      expect(container.textContent).toContain("Open Plan");
    } finally {
      await cleanup();
    }
  });

  it("leaves the splash after the wizard closes once answers have been saved", async () => {
    resolveBegunQuarterPlan.mockResolvedValueOnce({ begun: false, noteUUID: null, quarter: 4, year: 2026 });
    resolveBegunQuarterPlan.mockResolvedValue({ begun: true, noteUUID: null, quarter: 4, year: 2026 });
    const { cleanup, container } = await renderPlanning();
    try {
      const startPlan = container.querySelector(".plan-entry-scratch, .plan-entry-begin, .plan-entry-build");
      expect(startPlan).not.toBeNull();
      await clickAndSettle(startPlan);
      const backdrop = document.body.querySelector(".plan-wizard-backdrop");
      expect(backdrop).not.toBeNull();
      await clickAndSettle(backdrop);
      expect(container.querySelector(".plan-entry-title")).toBeNull();
      expect(container.textContent).toContain("Create Plan");
      expect(resolveBegunQuarterPlan).toHaveBeenCalledTimes(2);
    } finally {
      await cleanup();
    }
  });
});
