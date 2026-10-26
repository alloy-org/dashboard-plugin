// Quarter Retrospective container: a quarter with nothing generated shows the options screen, choosing Data generates
// and plays the story, reopening plays the saved story straight away, and the header links open the plan note and
// return to the styles.
import { jest } from "@jest/globals";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { maintenanceApp } from "./project-maintenance-test-app";

const { default: QuarterRetrospective } = await import("dashboard/quarter-retrospective/quarter-retrospective");

const PLAN = { label: "Q3 2026", noteUUID: "q3-plan-note", quarter: 3, year: 2026 };
let mounted = null;

// ----------------------------------------------------------------------------------------------
// @desc An app holding notes by name, with one completed task in Q3 2026.
// @returns {object} App mock.
function retrospectiveApp() {
  const app = maintenanceApp({ tasks: [] });
  const completedAt = Math.floor(new Date(2026, 7, 12, 15).getTime() / 1000);
  app.getCompletedTasks = jest.fn(async () => [{ completedAt, content: "Ship the dashboard", uuid: "task-1", victoryValue: 5 }]);
  app.navigate = jest.fn(async () => true);
  return app;
}

// ----------------------------------------------------------------------------------------------
// @desc Flush the promise chains loading and generating queue.
async function settle() {
  for (let iteration = 0; iteration < 30; iteration += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Mount the retrospective for Q3 2026 in the Work domain.
// @param {object} app - App mock.
// @param {Function} [onClose] - Close handler.
// @returns {Promise<void>}
async function renderRetrospective(app, onClose = jest.fn()) {
  const mountPoint = document.createElement("div");
  document.body.appendChild(mountPoint);
  const root = createRoot(mountPoint);
  await act(async () => {
    root.render(createElement(QuarterRetrospective, { app, domainName: "Work", domainUuid: "work-domain", onClose, plan: PLAN }));
  });
  await settle();
  mounted = { mountPoint, root };
}

// ----------------------------------------------------------------------------------------------
// @desc Click an element and let what it starts settle.
// @param {HTMLElement} element - The element.
async function clickAndSettle(element) {
  await act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await settle();
}

// ----------------------------------------------------------------------------------------------
// @desc The header link with the given text.
// @param {string} text - Link text.
// @returns {HTMLElement|undefined} The link.
function headerLink(text) {
  return [...document.body.querySelectorAll(".retrospective-header-link")].find(link => link.textContent === text);
}

afterEach(async () => {
  if (!mounted) return;
  await act(async () => { mounted.root.unmount(); });
  mounted.mountPoint.remove();
  mounted = null;
});

describe("QuarterRetrospective", () => {
  it("generates the Data style from the options screen, then plays it on reopening", async () => {
    const app = retrospectiveApp();
    await renderRetrospective(app);
    const cards = [...document.body.querySelectorAll(".retrospective-style-card")];
    expect(cards.map(card => card.querySelector(".retrospective-style-card-title").textContent)).toEqual(["Data", "Roast", "Spotify"]);
    expect(cards.map(card => card.disabled)).toEqual([false, true, true]);

    await clickAndSettle(cards[0]);
    expect(document.body.querySelector(".retrospective-story")).not.toBeNull();
    expect(app.noteContent("Work Q3 2026 Data Retrospective Data")).toContain("## Story");
    expect(headerLink("Generate new")).toBeDefined();

    await act(async () => { mounted.root.unmount(); });
    mounted.mountPoint.remove();
    mounted = null;
    await renderRetrospective(app);
    expect(document.body.querySelector(".retrospective-story")).not.toBeNull();
    expect(app.getCompletedTasks).toHaveBeenCalledTimes(1);

    await clickAndSettle(headerLink("Generate new"));
    expect(document.body.querySelector(".retrospective-options")).not.toBeNull();
  });

  it("opens the plan note from the header and closes the retrospective", async () => {
    const app = retrospectiveApp();
    const onClose = jest.fn();
    await renderRetrospective(app, onClose);
    await clickAndSettle(headerLink("Open plan note"));
    expect(onClose).toHaveBeenCalled();
    expect(app.navigate).toHaveBeenCalled();
  });
});
