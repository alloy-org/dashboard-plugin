import { jest } from "@jest/globals";
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";

const { DASHBOARD_WIDGET_LOADED_EVENT, useDashboardLoadTracker, useWidgetLoadedEvent } = await import("dashboard-load-tracking");
const { DashboardWorkProvider } = await import("dashboard/work-queue/dashboard-work-context");

// [Claude claude-opus-4-8 (1M context)] Task: harness that drives the tracker via a reporting script
//   and surfaces the settle result to the test.
function TrackerHarness({ eventProps, onSettle, reports, widgetIds }) {
  const tracker = useDashboardLoadTracker(widgetIds, { eventProps, onSettle });
  useEffect(() => {
    for (const [action, widgetId] of reports) tracker[action](widgetId);
  }, []);
  return null;
}

function drive({ eventProps, reports, widgetIds }) {
  const onSettle = jest.fn();
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(createElement(TrackerHarness, { eventProps, onSettle, reports, widgetIds })));
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

// ------------------------------------------------------------------------------------------
// @desc The aggregate event waits for promised extra properties, such as task counts, and merges them in.
test("sends extra event properties once their promise resolves", async () => {
  const plausible = jest.fn();
  window.plausible = plausible;
  let resolveProps;
  const propsPromise = new Promise(resolve => { resolveProps = resolve; });
  drive({ eventProps: () => propsPromise, reports: [["reportLoaded", "agenda"]], widgetIds: ["agenda"] });
  expect(plausible).not.toHaveBeenCalled();
  resolveProps({ openTaskBucket: "100-249", openTaskCount: "143" });
  await propsPromise;
  await Promise.resolve();
  expect(plausible).toHaveBeenCalledWith("Dashboard Action", { props: { action: "dashboardLoadSuccess", deferredCount: 0,
    openTaskBucket: "100-249", openTaskCount: "143", widgetCount: 1 } });
  delete window.plausible;
});

// ------------------------------------------------------------------------------------------
// @desc A failed lookup of extra properties still sends the load event, without them.
test("sends the load event without extra properties when their promise rejects", async () => {
  const plausible = jest.fn();
  window.plausible = plausible;
  const propsPromise = Promise.reject(new Error("host unavailable"));
  drive({ eventProps: () => propsPromise, reports: [["reportLoaded", "agenda"]], widgetIds: ["agenda"] });
  await propsPromise.catch(() => {});
  await Promise.resolve();
  expect(plausible).toHaveBeenCalledWith("Dashboard Action", { props: { action: "dashboardLoadSuccess", deferredCount: 0, widgetCount: 1 } });
  delete window.plausible;
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

// ------------------------------------------------------------------------------------------
// @desc Inside a Dashboard work provider, the settled load is reported once to the mount coordinator with its outcome.
test("reports a widget's settled content to the mount coordinator", () => {
  const mountCoordinator = { reportContentReady: jest.fn(() => 1200) };
  const container = document.createElement("div");
  const root = createRoot(container);
  const renderHarness = isReady => createElement(DashboardWorkProvider, { value: { mountCoordinator } },
    createElement(WidgetLoadedHarness, { isReady, widgetId: "proposed-agenda" }));
  act(() => root.render(renderHarness(false)));
  expect(mountCoordinator.reportContentReady).not.toHaveBeenCalled();
  act(() => root.render(renderHarness(true)));
  act(() => root.render(renderHarness(true)));
  expect(mountCoordinator.reportContentReady.mock.calls).toEqual([["proposed-agenda", "loaded"]]);
  act(() => root.unmount());
});
