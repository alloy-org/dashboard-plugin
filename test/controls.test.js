// Verify the shared controls bake in what widgets used to add by hand: type="button", labels as aria-label
// and title, variant classes, real links only for navigation, labeled fields, and keyboard-operable tabs.
import { jest } from "@jest/globals";
import { act, createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { MdRefresh } from "react-icons/md";

const { Badge, Button, EmptyState, ErrorState, IconButton, LoadingState, PlainButton, Select, Spinner,
  TextField, UnderlineTabs } = await import("dashboard/controls");

// ------------------------------------------------------------------------------------------
// @desc Mount an element and return its container.
// @param {JSX.Element} element - What to render.
// @returns {Promise<HTMLElement>} The container.
async function render(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => { createRoot(container).render(element); });
  return container;
}

describe("shared controls", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  it("renders Button as a type=button button with its variant, or as a link only when given href", async () => {
    const onClick = jest.fn();
    const container = await render(createElement("div", null,
      createElement(Button, { Icon: MdRefresh, onClick, variant: "raised" }, "Save"),
      createElement(Button, { href: "https://www.amplenote.com" }, "Open")));
    const button = container.querySelector("button");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.className).toBe("dashboard-button dashboard-button--raised");
    expect(button.querySelector("svg")).not.toBeNull();
    await act(async () => { button.click(); });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(container.querySelector("a").getAttribute("href")).toBe("https://www.amplenote.com");
  });

  it("gives IconButton its label as both accessible name and tooltip, and reflects pressed toggles", async () => {
    const container = await render(createElement(IconButton, { Icon: MdRefresh, label: "Reseed",
      pressed: true, size: "small" }));
    const button = container.querySelector("button");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("aria-label")).toBe("Reseed");
    expect(button.getAttribute("title")).toBe("Reseed");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.className).toContain("dashboard-icon-button--small");
  });

  it("makes PlainButton a type=button button that keeps the caller's class", async () => {
    const container = await render(createElement(PlainButton, { className: "profile-option" },
      "Goal-Oriented"));
    const button = container.querySelector("button");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.className).toBe("dashboard-plain-button profile-option");
  });

  it("renders empty, error, and loading states with a status spinner and an optional retry", async () => {
    const onRetry = jest.fn();
    const container = await render(createElement("div", null,
      createElement(EmptyState, { Icon: MdRefresh, title: "Nothing to retire" }, "Everything looks current."),
      createElement(ErrorState, { onRetry }, "The note could not be loaded."),
      createElement(LoadingState, null, "Loading…"),
      createElement(Spinner, { size: "small" })));
    expect(container.querySelector(".dashboard-empty-state-title").textContent).toBe("Nothing to retire");
    expect(container.querySelector(".dashboard-error-state .dashboard-empty-state-title").textContent)
      .toBe("Something went wrong");
    await act(async () => { container.querySelector(".dashboard-error-state button").click(); });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll("[role='status']")).toHaveLength(2);
  });

  it("labels Select and TextField and reports values rather than events", async () => {
    const onSelect = jest.fn();
    const onType = jest.fn();
    const container = await render(createElement("div", null,
      createElement(Select, { label: "Collaborator", onChange: onSelect,
        options: [ { label: "All", value: "all" }, { label: "Dana", value: "dana" } ], value: "all" }),
      createElement(TextField, { label: "Details", multiline: true, onChange: onType, value: "" })));
    const select = container.querySelector("select");
    expect(container.querySelector(`label[for="${ select.id }"]`).textContent).toBe("Collaborator");
    await act(async () => {
      select.value = "dana";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledWith("dana");
    expect(container.querySelector("textarea")).not.toBeNull();
  });

  it("selects tabs by click and arrow keys", async () => {
    const onChange = jest.fn();
    const tabs = [ { id: "work", label: "Work" }, { id: "personal", label: "Personal" } ];
    const container = await render(createElement(UnderlineTabs, { ariaLabel: "Task domain", onChange, tabs,
      value: "work" }));
    const [ workTab, personalTab ] = container.querySelectorAll("[role='tab']");
    expect(workTab.getAttribute("aria-selected")).toBe("true");
    await act(async () => { personalTab.click(); });
    expect(onChange).toHaveBeenLastCalledWith("personal");
    await act(async () => {
      workTab.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    });
    expect(onChange).toHaveBeenLastCalledWith("personal");
  });

  it("keeps tabs reachable with nothing selected and lets deselectable tabs close", async () => {
    const onChange = jest.fn();
    const tabs = [ { id: "january", label: "January" }, { id: "february", label: "February" } ];
    let container = await render(createElement(UnderlineTabs, { ariaLabel: "Month", onChange, tabs,
      value: null }));
    expect([ ...container.querySelectorAll("[role='tab']") ].map(tab => tab.tabIndex)).toEqual([ 0, -1 ]);
    container = await render(createElement(UnderlineTabs, { ariaLabel: "Month", deselectable: true, onChange,
      tabs, value: "january" }));
    await act(async () => { container.querySelector("[role='tab']").click(); });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("renders Badge in its tone, passing attributes through and optionally keeping case", async () => {
    const container = await render(createElement(Badge, { title: "Source note", tone: "action",
      uppercase: false }, "Recommended"));
    const badge = container.querySelector(".dashboard-badge--action");
    expect(badge.textContent).toBe("Recommended");
    expect(badge.getAttribute("title")).toBe("Source note");
    expect(badge.className).toContain("dashboard-badge--keep-case");
  });

  it("forwards refs, allows submit buttons, and joins class names without stray spaces", async () => {
    const buttonRef = createRef();
    const plainRef = createRef();
    const iconRef = createRef();
    const fieldRef = createRef();
    const container = await render(createElement("form", null,
      createElement(Button, { dense: false, ref: buttonRef, tone: "danger", type: "submit" }, "Remove"),
      createElement(PlainButton, { ref: plainRef }, "Row"),
      createElement(IconButton, { Icon: MdRefresh, label: "Reseed", ref: iconRef,
        tooltip: "Reseed: new suggestions" }),
      createElement(TextField, { dense: true, inputClassName: "date-input", label: "Date", onChange: () => {},
        ref: fieldRef, value: "" })));
    expect(buttonRef.current.getAttribute("type")).toBe("submit");
    expect(buttonRef.current.className)
      .toBe("dashboard-button dashboard-button--text dashboard-button--danger");
    expect(plainRef.current.tagName).toBe("BUTTON");
    expect(iconRef.current.getAttribute("aria-label")).toBe("Reseed");
    expect(iconRef.current.getAttribute("title")).toBe("Reseed: new suggestions");
    const tippyContainer = await render(createElement(IconButton, { Icon: MdRefresh, label: "Update",
      tooltip: false }));
    expect(tippyContainer.querySelector("button").hasAttribute("title")).toBe(false);
    expect(fieldRef.current.className).toBe("dashboard-text-field date-input");
    expect(container.querySelector(".dashboard-field--dense")).not.toBeNull();
  });

  it("renders compact empty states and alerting error states with extra actions", async () => {
    const container = await render(createElement("div", null,
      createElement(EmptyState, { compact: true, Icon: MdRefresh, role: "note" }, "No tasks scheduled"),
      createElement(ErrorState, {
        action: createElement(Button, { href: "https://www.amplenote.com" }, "View note"),
        onRetry: () => {},
        title: null,
      }, "Could not propose a schedule.")));
    const compact = container.querySelector(".dashboard-empty-state--compact");
    expect(compact.getAttribute("role")).toBe("note");
    expect(compact.querySelector("svg")).toBeNull();
    const error = container.querySelector(".dashboard-error-state");
    expect(error.getAttribute("role")).toBe("alert");
    expect(error.querySelector(".dashboard-empty-state-title")).toBeNull();
    expect(error.querySelectorAll(".dashboard-empty-state-actions a, .dashboard-empty-state-actions button"))
      .toHaveLength(2);
  });
});
