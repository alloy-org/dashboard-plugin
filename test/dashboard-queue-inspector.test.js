// Exercise the admin Queue inspector: its model's filters, overview, urgent render rows and outcomes; a live view of a
// deliberately stalled scheduler that inspection does not change; throttled updates without Console Logging;
// unsubscribing when closed; and the Debug Console offering the Queue view only under the admin tools policy.
import { jest } from "@jest/globals";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { ALL_JOBS_FILTER, filteredJobs, queueInspectorView, queueOverview, recentOutcomes,
  urgentRenderRows } from "dashboard/work-queue/dashboard-queue-inspector-model";
import { DashboardWorkProvider } from "dashboard/work-queue/dashboard-work-context";
import { createDashboardWorkRuntime } from "dashboard/work-queue/dashboard-work-runtime";
import WidgetMountCoordinator from "dashboard/work-queue/widget-mount-coordinator";
import { setLoggingEnabled } from "util/log";

const { default: DashboardQueueInspector } = await import("dashboard/work-queue/dashboard-queue-inspector");
const { default: DebugConsoleWidget } = await import("debug-console");

// ----------------------------------------------------------------------------------------------
// @desc Let queued microtasks run inside act.
async function flush() {
  await act(async () => { for (let index = 0; index < 10; index += 1) await Promise.resolve(); });
}

// ----------------------------------------------------------------------------------------------
// @desc A work runtime whose admission passes run in microtasks and a coordinator over stub observers, with one widget
//   mounting and never committing and a second visible widget therefore stalled behind the single mount permit.
// @returns {Promise<object>} { coordinator, mounted, runtime, work }.
async function stalledWork() {
  const runtime = createDashboardWorkRuntime();
  const observers = [];
  const createObserver = callback => {
    const observer = { callback, disconnect: () => {}, observe: () => {}, unobserve: () => {} };
    observers.push(observer);
    return observer;
  };
  const coordinator = new WidgetMountCoordinator({ createObserver, scheduler: runtime.scheduler, setTimer: () => 1 });
  const mounted = [];
  const elements = { agenda: { id: "agenda" }, mood: { id: "mood" } };
  for (const widgetId of Object.keys(elements)) coordinator.register(widgetId, { element: elements[widgetId], mount: () => mounted.push(widgetId) });
  observers[1].callback([{ isIntersecting: true, target: elements.agenda }, { isIntersecting: true, target: elements.mood }]);
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
  return { coordinator, mounted, runtime, work: { mountCoordinator: coordinator, runtime } };
}

// ----------------------------------------------------------------------------------------------
// @desc Render an element into a fresh container.
// @param {React.ReactElement} element - What to render.
// @returns {object} { container, root }.
function render(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(element));
  return { container, root };
}

describe("Queue inspector model", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Filters combine; the overview counts waiting reasons; widgets pair with their mount job's waiting reason.
  it("filters jobs, summarizes the overview, and pairs widgets with their jobs", async () => {
    const { runtime, work } = await stalledWork();
    runtime.scheduler.setScope("work:2026-Q4");
    runtime.scheduler.enqueue({ key: "rankProjectTasks:project-1", run: () => new Promise(() => {}), type: "rankProjectTasks" });
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
    const view = queueInspectorView(work);
    expect(filteredJobs(view.scheduler.jobs, ALL_JOBS_FILTER)).toHaveLength(3);
    expect(filteredJobs(view.scheduler.jobs, { ...ALL_JOBS_FILTER, keyText: "PROJECT-1" }).map(job => job.type)).toEqual(["rankProjectTasks"]);
    expect(filteredJobs(view.scheduler.jobs, { ...ALL_JOBS_FILTER, status: "pending", type: "widgetMount" })
      .map(job => job.key)).toEqual(["widgetMount:mood"]);
    const overview = queueOverview(view);
    expect(overview).toMatchObject({ pending: 2, running: 1, scopeKey: "work:2026-Q4" });
    expect(overview.waitingByReason).toEqual({ loadGate: 1, resourceBusy: 1 });
    const rows = urgentRenderRows(view);
    expect(rows.map(row => [row.widgetId, row.status, row.waitingReason])).toEqual([["mood", "waiting", "resourceBusy"],
      ["agenda", "mounting", null]]);
    const outcomes = recentOutcomes([{ type: "started" }, { at: 1, type: "completed" }, { at: 2, type: "failed" }]);
    expect(outcomes.map(event => event.type)).toEqual(["failed", "completed"]);
  });
});

describe("DashboardQueueInspector", () => {
  afterEach(() => {
    jest.useRealTimers();
    document.body.innerHTML = "";
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A stalled scheduler is shown with explicit waiting reasons, without Console Logging, and rendering the
  //   inspector neither starts, promotes, nor cancels anything.
  it("shows a stalled queue's waiting reasons without changing it", async () => {
    const { mounted, runtime, work } = await stalledWork();
    const jobsBefore = JSON.stringify(runtime.scheduler.snapshot().jobs);
    const countersBefore = JSON.stringify(runtime.diagnostics.snapshot().counters);
    setLoggingEnabled("false");
    const { container, root } = render(createElement(DashboardQueueInspector, { work }));
    await flush();
    expect(container.textContent).toContain("Every permit for its resource is in use");
    expect(container.textContent).toContain("Held, watchdog armed");
    expect(container.textContent).toContain("Unavailable until durable jobs exist");
    expect(JSON.stringify(runtime.scheduler.snapshot().jobs)).toBe(jobsBefore);
    expect(JSON.stringify(runtime.diagnostics.snapshot().counters)).toBe(countersBefore);
    expect(mounted).toEqual(["agenda"]);
    act(() => root.unmount());
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A burst of changes produces one refresh after the throttle interval, and closing the inspector removes every
  //   subscription it made.
  it("throttles live updates and unsubscribes when closed", async () => {
    jest.useFakeTimers();
    const { coordinator, runtime, work } = await stalledWork();
    const snapshotSpy = jest.spyOn(runtime.scheduler, "snapshot");
    const { container, root } = render(createElement(DashboardQueueInspector, { work }));
    const readsAfterOpen = snapshotSpy.mock.calls.length;
    for (let index = 0; index < 5; index += 1) {
      runtime.scheduler.enqueue({ key: `noteWrite:${ index }`, run: () => new Promise(() => {}), type: "noteWrite" });
      await flush();
    }
    expect(snapshotSpy.mock.calls.length).toBe(readsAfterOpen);
    await act(async () => { jest.advanceTimersByTime(250); });
    expect(snapshotSpy.mock.calls.length).toBe(readsAfterOpen + 1);
    expect(container.textContent).toContain("noteWrite:4");
    act(() => root.unmount());
    expect(runtime.scheduler.listeners.size).toBe(0);
    expect(runtime.diagnostics.listeners.size).toBe(0);
    expect(coordinator.listeners.size).toBe(0);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Without a running work queue the inspector explains why instead of showing an empty queue.
  it("explains when no work queue is running", () => {
    const { container, root } = render(createElement(DashboardQueueInspector, { work: null }));
    expect(container.textContent).toContain("The work queue is not running in this Dashboard");
    act(() => root.unmount());
  });
});

describe("DebugConsoleWidget Queue view", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  // ----------------------------------------------------------------------------------------------
  // @desc The Queue button appears only when the admin tools policy allows it, and switches between log and queue.
  it("offers the Queue view only with admin tools", async () => {
    const { work } = await stalledWork();
    const renderConsole = adminToolsEnabled => render(createElement(DashboardWorkProvider, { value: work },
      createElement(DebugConsoleWidget, { adminToolsEnabled, app: {} })));
    const withoutTools = renderConsole(false);
    const buttonLabels = container => [...container.querySelectorAll("button")].map(button => button.textContent);
    expect(buttonLabels(withoutTools.container)).not.toContain("Queue");
    act(() => withoutTools.root.unmount());
    const withTools = renderConsole(true);
    const queueButton = [...withTools.container.querySelectorAll("button")].find(button => button.textContent === "Queue");
    act(() => queueButton.click());
    await flush();
    expect(withTools.container.querySelector(".dashboard-queue-inspector")).not.toBeNull();
    expect(buttonLabels(withTools.container)).not.toContain("Debug");
    const logButton = [...withTools.container.querySelectorAll("button")].find(button => button.textContent === "Log");
    act(() => logButton.click());
    expect(withTools.container.querySelector(".dashboard-queue-inspector")).toBeNull();
    expect(work.runtime.scheduler.listeners.size).toBe(0);
    act(() => withTools.root.unmount());
  });
});
