// Quarterly Planning shows the open month's projects from its Focus bullet with an intensity meter above the month
// tabs, and starring a project writes the star into that bullet of the plan note. The clock is frozen on 2 Oct 2026.
import { jest } from "@jest/globals";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { createPlanWizardApp } from "./fixtures/plan-wizard-app.js";

const { default: PlanningWidget } = await import("dashboard/planning");

const PLAN_NOTE_CONTENT = "# Month-by-Month Breakdown\n\n## October\n- Focus: hiring; Ship v2 \\[builder\\]; Launch Diff Digest "
  + "\\[builder\\]\n- Key move: close the loop\n\n## November\n- Focus:\n";
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
// @desc Mount the planning widget on 2 Oct 2026 over a Q4 plan note whose October Focus bullet names three projects.
// @returns {Promise<object>} The app stub, the widget root, and a cleanup that also restores the clock.
async function renderPlanning() {
  const restoreNow = freezeNow(new Date(2026, 9, 2));
  const app = createPlanWizardApp();
  app.getNoteSections = jest.fn(async () => [{ heading: { text: "October" } }, { heading: { text: "November" } }]);
  app.notes.push({ archived: false, content: PLAN_NOTE_CONTENT, localUuid: "local-q4", name: "Q4 2026 Work Plan",
    tags: ["plugins/dashboard"], uuid: "q4-note" });
  const mountPoint = document.createElement("div");
  document.body.appendChild(mountPoint);
  const root = createRoot(mountPoint);
  await act(async () => {
    root.render(createElement(PlanningWidget, { app, quarterlyPlans: { current: currentPlan, next: nextPlan },
      taskDomainName: "Work", taskDomainUUID: "domain-work" }));
  });
  await settle();
  return { app, cleanup: async () => {
    await act(async () => { root.unmount(); });
    mountPoint.remove();
    restoreNow();
  }, container: mountPoint };
}

test("the open month shows its projects and an intensity meter", async () => {
  const { cleanup, container } = await renderPlanning();
  const projectLabels = [...container.querySelectorAll(".month-project-label")].map(label => label.textContent);
  expect(projectLabels).toEqual(["hiring", "Ship v2", "Launch Diff Digest"]);
  expect(container.querySelector(".month-intensity-level").textContent).toBe("Mildly Ambitious");
  expect(container.querySelector(".month-intensity-hint").textContent).toBe("2 more projects tip October into Aggressive.");
  expect(container.querySelector(".month-content-text").textContent).toContain("close the loop");
  await cleanup();
});

test("starring a project writes the star into the month's Focus bullet", async () => {
  const { app, cleanup, container } = await renderPlanning();
  const starButton = container.querySelector('[aria-label="Star Ship v2 as October\'s focus"]');
  await act(async () => { starButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await settle();
  const savedContent = app.notes.find(note => note.uuid === "q4-note").content;
  expect(savedContent).toContain("- Focus: hiring; ⭐ Ship v2 \\[builder\\]; Launch Diff Digest \\[builder\\]");
  expect(container.querySelector(".month-focus-callout").textContent).toContain("Ship v2");
  expect(container.querySelector(".month-project-row--starred .month-project-label").textContent).toBe("Ship v2");
  await cleanup();
});
