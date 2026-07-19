import { jest } from "@jest/globals";
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";

const { DASHBOARD_WIDGET_LOADED_EVENT, useDashboardLoadTracker, useWidgetLoadedEvent } = await import("dashboard-load-tracking");

// [Claude claude-opus-4-8 (1M context)] Task: harness that drives the tracker via a reporting script
//   and surfaces the settle result to the test.
function TrackerHarness({ onSettle, reports, widgetIds }) {
  const tracker = useDashboardLoadTracker(widgetIds, { onSettle });
  useEffect(() => {
    for (const [action, widgetId] of reports) tracker[action](widgetId);
  }, []);
  return null;
}

function drive({ reports, widgetIds }) {
  const onSettle = jest.fn();
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(createElement(TrackerHarness, { onSettle, reports, widgetIds })));
  act(() => root.unmount());
  return onSettle;
}

test("settles when the last widget is deferred rather than loaded", () => {
  const onSettle = drive({ widgetIds: ["agenda", "calendar", "mood"],
    reports: [["reportLoaded", "agenda"], ["reportLoaded", "calendar"], ["reportDeferred", "mood"]] });
  expect(onSettle).toHaveBeenCalledTimes(1);
  expect(onSettle).toHaveBeenCalledWith(expect.objectContaining({ deferredCount: 1, errorCount: 0, expectedCount: 3 }));
});

test("does not settle while a widget is still pending", () => {
  const onSettle = drive({ widgetIds: ["agenda", "calendar"],
    reports: [["reportLoaded", "agenda"]] });
  expect(onSettle).not.toHaveBeenCalled();
});

test("reports errors in the settle payload", () => {
  const onSettle = drive({ widgetIds: ["agenda", "calendar"],
    reports: [["reportLoaded", "agenda"], ["reportError", "calendar"]] });
  expect(onSettle).toHaveBeenCalledWith(expect.objectContaining({ errorCount: 1, erroredIds: ["calendar"] }));
});

function WidgetLoadedHarness({ hasError = false, isReady, widgetId }) {
  useWidgetLoadedEvent(widgetId, isReady, hasError);
  return null;
}

test("dispatches a widget loaded event once when initial readiness becomes true", () => {
  const listener = jest.fn();
  const container = document.createElement("div");
  const root = createRoot(container);
  window.addEventListener(DASHBOARD_WIDGET_LOADED_EVENT, listener);
  act(() => root.render(createElement(WidgetLoadedHarness, { isReady: false, widgetId: "agenda" })));
  act(() => root.render(createElement(WidgetLoadedHarness, { isReady: true, widgetId: "agenda" })));
  act(() => root.render(createElement(WidgetLoadedHarness, { isReady: true, widgetId: "agenda" })));
  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener.mock.calls[0][0].detail).toEqual({ outcome: "loaded", widgetId: "agenda" });
  window.removeEventListener(DASHBOARD_WIDGET_LOADED_EVENT, listener);
  act(() => root.unmount());
});

test("dispatches an error outcome when a widget initial load settles with an error", () => {
  const listener = jest.fn();
  const container = document.createElement("div");
  const root = createRoot(container);
  window.addEventListener(DASHBOARD_WIDGET_LOADED_EVENT, listener);
  act(() => root.render(createElement(WidgetLoadedHarness, { hasError: true, isReady: false, widgetId: "graveyard" })));
  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener.mock.calls[0][0].detail).toEqual({ outcome: "error", widgetId: "graveyard" });
  window.removeEventListener(DASHBOARD_WIDGET_LOADED_EVENT, listener);
  act(() => root.unmount());
});
