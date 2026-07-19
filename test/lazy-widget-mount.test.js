/**
 * [Claude claude-opus-4-8 (1M context)-authored file]
 * Prompt summary: "use viewport-gated lazy mounting" — verify a widget stays a placeholder until it
 *   scrolls near the viewport, then mounts once, and reports itself deferred meanwhile.
 */
import { jest } from "@jest/globals";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { DashboardLoadContext } from "dashboard-load-tracking";

const { default: LazyWidgetMount } = await import("lazy-widget-mount");

// [Claude claude-opus-4-8 (1M context)] Task: controllable IntersectionObserver stub whose callback
//   the test can fire on demand to simulate a widget scrolling into view.
function installIntersectionObserverStub() {
  const instances = [];
  class FakeIntersectionObserver {
    constructor(callback) { this.callback = callback; this.disconnected = false; instances.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
    fireIntersecting() { this.callback([{ isIntersecting: true }]); }
  }
  global.IntersectionObserver = FakeIntersectionObserver;
  return instances;
}

function mockTracker() {
  return { reportDeferred: jest.fn(), reportError: jest.fn(), reportLoaded: jest.fn() };
}

function renderWithTracker(tracker, children) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(DashboardLoadContext.Provider, { value: tracker },
      createElement(LazyWidgetMount, { widgetId: "agenda" }, children)));
  });
  return { container, root };
}

afterEach(() => {
  delete global.IntersectionObserver;
  jest.restoreAllMocks();
});

test("mounts children eagerly when IntersectionObserver is unavailable", () => {
  const tracker = mockTracker();
  const { container, root } = renderWithTracker(tracker, createElement("div", { className: "real-widget" }, "content"));
  expect(container.querySelector(".real-widget")).not.toBeNull();
  expect(container.querySelector(".lazy-widget-placeholder")).toBeNull();
  expect(tracker.reportDeferred).not.toHaveBeenCalled();
  act(() => root.unmount());
});

test("renders a placeholder and reports deferred until scrolled into view", () => {
  const observers = installIntersectionObserverStub();
  const tracker = mockTracker();
  const { container, root } = renderWithTracker(tracker, createElement("div", { className: "real-widget" }, "content"));

  expect(container.querySelector(".lazy-widget-placeholder")).not.toBeNull();
  expect(container.querySelector(".real-widget")).toBeNull();
  expect(tracker.reportDeferred).toHaveBeenCalledWith("agenda");

  act(() => observers[0].fireIntersecting());

  expect(container.querySelector(".real-widget")).not.toBeNull();
  expect(container.querySelector(".lazy-widget-placeholder")).toBeNull();
  expect(observers[0].disconnected).toBe(true);
  act(() => root.unmount());
});
