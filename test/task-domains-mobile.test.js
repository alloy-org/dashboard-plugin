/**
 * [Claude claude-opus-5 (1M context)-authored file]
 * Created: 2026-08-07 | Model: claude-opus-5[1m]
 * Task: Task Domains mobile bar — only the selected domain shows until the expand toggle is tapped
 * Prompt summary: "When viewing Dashboard in a mobile view, hide all Task Domains behind an 'Expand' icon,
 *   besides the selected Task Domain"
 */
import { jest } from "@jest/globals";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

const switchTaskDomain = jest.fn(async () => ({ tasks: [] }));

await jest.unstable_mockModule("data-service", async () => ({
  refreshTaskDomains: jest.fn(async () => null),
  switchTaskDomain,
}));

const { default: TaskDomains } = await import("dashboard/task-domains");

const DOMAINS = [{ name: "Work", uuid: "dom-work" }, { name: "Personal", uuid: "dom-personal" },
  { name: "Errands", uuid: "dom-errands" }];

describe("TaskDomains mobile collapsing", () => {
  let container, root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    switchTaskDomain.mockClear();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Render the bar with an active domain selected. The mobile-visible marker and expanded state
  //   are class flips, since the stylesheet (not JS) decides which viewport actually hides pills.
  function renderDomainBar(activeTaskDomain) {
    act(() => {
      root.render(createElement(TaskDomains, { activeTaskDomain, app: {}, domains: DOMAINS,
        onDomainChange: () => {} }));
    });
  }

  it("marks only the selected domain as the pill that stays visible on mobile", () => {
    renderDomainBar("dom-personal");
    const mobileVisible = container.querySelectorAll(".task-domain-item--mobile-visible");
    expect(mobileVisible.length).toBe(1);
    expect(mobileVisible[0].textContent).toBe("Personal");
    expect(mobileVisible[0].className).toContain("active");
    // All three pills stay in the DOM so expanding never needs a re-fetch or re-render of the list.
    expect(container.querySelectorAll(".task-domain-item").length).toBe(3);
  });

  it("falls back to the first domain when the active uuid matches none of the domains", () => {
    renderDomainBar("dom-deleted");
    const mobileVisible = container.querySelectorAll(".task-domain-item--mobile-visible");
    expect(mobileVisible.length).toBe(1);
    expect(mobileVisible[0].textContent).toBe("Work");
  });

  it("toggles the expanded class when the expand icon is clicked, and collapses after a domain is picked",
      async () => {
    renderDomainBar("dom-work");
    const expandButton = container.querySelector(".task-domains-expand");
    expect(expandButton).not.toBeNull();
    expect(expandButton.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".task-domains").className).not.toContain("task-domains--expanded");

    await act(async () => { expandButton.click(); });
    expect(container.querySelector(".task-domains").className).toContain("task-domains--expanded");
    expect(container.querySelector(".task-domains-expand").getAttribute("aria-expanded")).toBe("true");

    const errandsPill = Array.from(container.querySelectorAll(".task-domain-item"))
      .find(pill => pill.textContent === "Errands");
    await act(async () => { errandsPill.click(); });
    expect(switchTaskDomain).toHaveBeenCalledWith({}, "dom-errands");
    expect(container.querySelector(".task-domains").className).not.toContain("task-domains--expanded");
  });

  it("omits the expand icon when there is only one domain to choose from", () => {
    act(() => {
      root.render(createElement(TaskDomains, { activeTaskDomain: "dom-work", app: {},
        domains: [DOMAINS[0]], onDomainChange: () => {} }));
    });
    expect(container.querySelector(".task-domains-expand")).toBeNull();
  });

  it("renders both the worded refresh label and the mobile-only refresh glyph", () => {
    renderDomainBar("dom-work");
    expect(container.querySelector(".task-domains-refresh-label").textContent).toContain("Refresh Task Domains");
    expect(container.querySelector(".task-domains-refresh-icon").textContent).toBe("↻");
  });
});
