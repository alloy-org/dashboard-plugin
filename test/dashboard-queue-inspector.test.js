// Exercise the admin Queue inspector: its model's filters, overview, urgent render rows and outcomes; a live view of a
// deliberately stalled scheduler that inspection does not change; throttled updates without Console Logging;
// unsubscribing when closed; saved jobs and durable history read on open, with other sessions' claims never shown as
// running; and the Debug Console offering the Queue view only under the admin tools policy.
import { jest } from "@jest/globals";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { ALL_JOBS_FILTER, filteredJobs, formattedRevision, queueInspectorView, queueOverview, recentOutcomes, savedJobRows,
  urgentRenderRows } from "dashboard/work-queue/dashboard-queue-inspector-model";
import DashboardWorkDiagnosticsStore from "dashboard/work-queue/dashboard-work-diagnostics-store";
import { workHandlerRegistry } from "dashboard/work-queue/dashboard-work-handlers";
import DashboardWorkRepository from "dashboard/work-queue/dashboard-work-repository";
import { DashboardWorkProvider } from "dashboard/work-queue/dashboard-work-context";
import { createDashboardWorkRuntime } from "dashboard/work-queue/dashboard-work-runtime";
import WidgetMountCoordinator from "dashboard/work-queue/widget-mount-coordinator";
import { setLoggingEnabled } from "util/log";
import { workQueueNotesApp } from "./work-queue-test-notes";

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

describe("Saved job rows", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Another session's claim is shown as claimed and unverified, a lapsed claim as lapsed, and this session's
  //   attempt as running; unfinished work sorts before finished work.
  it("separates this session's attempts from other sessions' claims", () => {
    const now = 100_000;
    const job = fields => ({ attempt: 1, claimExpiresAt: null, cursor: null, desiredRevision: "r1", lastFailure: null,
      nextEligibleAt: null, ownerId: null, status: "pending", succeededAt: null, succeededRevision: null, type: "rank", updatedAt: 1, ...fields });
    const rows = savedJobRows([
      job({ key: "done", status: "completed", updatedAt: 5 }),
      job({ claimExpiresAt: now + 1000, key: "remote", ownerId: "other", status: "running" }),
      job({ claimExpiresAt: now - 1, key: "lapsed", ownerId: "other", status: "running" }),
      job({ claimExpiresAt: now + 1000, key: "local", ownerId: "me", status: "running" }),
      job({ key: "retry", nextEligibleAt: now + 30_000, status: "retryWaiting" }),
      job({ key: "retry-due", nextEligibleAt: now - 5, status: "retryWaiting", updatedAt: 0 }),
    ], { now, sessionId: "me" });
    expect(rows.map(row => [row.key, row.statusLabel])).toEqual([
      ["remote", "Claimed by another session (other), not verified running"],
      ["lapsed", "Claim lapsed; resumes on the next recovery"],
      ["local", "Running in this session"],
      ["retry", "Retrying in 30.0 s"],
      ["retry-due", "Retry due"],
      ["done", "completed"],
    ]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A revision that reads as a recent request time, as a reconciliation's does, is shown as an age; any other
  //   revision is shown as written.
  it("shows a request-time revision as an age", () => {
    const now = 1_791_131_623_195;
    expect(formattedRevision("1791131585195", now)).toBe("38.0 s ago");
    expect(formattedRevision(1_791_131_585_195, now)).toBe("38.0 s ago");
    expect(formattedRevision("a1b2c3d4@snapshot:5", now)).toBe("a1b2c3d4@snapshot:5");
    expect(formattedRevision("1", now)).toBe("1");
    expect(formattedRevision(null, now)).toBe("—");
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
    expect(container.textContent).toContain("Unavailable: durable work is switched off");
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
  // @desc With durable work on, opening the inspector reads the scope's saved jobs and history once, and shows another
  //   session's claimed job without calling it running.
  it("reads saved work and durable history when opened", async () => {
    const app = workQueueNotesApp();
    const scopeKey = "domain-1:Q4 2026";
    const otherRepository = new DashboardWorkRepository({ app });
    await otherRepository.saveJob(scopeKey, { desiredRevision: "r1", key: "rankProjectTasks:project-9", type: "rankProjectTasks" });
    await otherRepository.claim(scopeKey, "rankProjectTasks:project-9", { ownerId: "other-session", token: "other-session:1" });
    const history = new DashboardWorkDiagnosticsStore({ app, sessionId: "other-session" });
    history.recordOutcome(scopeKey, { jobKey: "ideas:project-9", jobType: "ideas", status: "completed" });
    await history.dispose();
    const runtime = createDashboardWorkRuntime({ diagnosticsStore: new DashboardWorkDiagnosticsStore({ app }),
      handlers: workHandlerRegistry([]), repository: new DashboardWorkRepository({ app }) });
    runtime.scheduler.setScope(scopeKey);
    const readSpy = jest.spyOn(runtime.repository, "readAll");
    const { container, root } = render(createElement(DashboardQueueInspector, { work: { mountCoordinator: null, runtime } }));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(container.textContent).toContain("Claimed by another session (other-session), not verified running");
    expect(container.textContent).toContain("ideas:project-9");
    expect(readSpy).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    runtime.dispose();
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
