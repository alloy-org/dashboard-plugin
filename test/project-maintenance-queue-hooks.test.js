// Verify how the Dashboard and Plan Builder hand project maintenance to the work queue: the Dashboard submits its
// quarter's reconciliation once its load settles and again after a burst of task changes, and Plan Builder planning the
// selected quarter submits the reconciliation as foreground work and re-reads scores as queued rankings complete,
// instead of running its own ranking pass. Once a visit's project jobs have finished and gone quiet, the Dashboard
// prepares the day's shared ranking.
import { jest } from "@jest/globals";
import { createDashboardWorkRuntime } from "dashboard/work-queue/dashboard-work-runtime";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

const { DashboardWorkProvider } = await import("dashboard/work-queue/dashboard-work-context");
const { DASHBOARD_TASKS_UPDATED_EVENT } = await import("hooks/use-dashboard-task-updates");
const { DAY_PREPARATION_QUIET_MILLISECONDS } = await import("dashboard/work-queue/day-preparation-trigger");
const { TASK_CHANGE_DEBOUNCE_MILLISECONDS, useProjectMaintenanceQueue } = await import("hooks/use-project-maintenance-queue");
const { useProjectTaskRanking } = await import("hooks/use-project-task-ranking");

const SCOPE_KEY = "work-domain:Q3 2026";

// ----------------------------------------------------------------------------------------------
// @desc A stand-in for the Dashboard's work: a durable runner that records submissions and hands outcome listeners
//   back to the test, under a scheduler in the given scope, and a planner reporting the given project jobs in flight.
// @param {string} scopeKey - The scheduler's scope.
// @param {object} [options] - { inFlight = 0 }.
// @returns {object} { listeners, work }.
function fakeWork(scopeKey, { inFlight = 0 } = {}) {
  const listeners = [];
  const durable = { recover: jest.fn(async () => 0), submit: jest.fn(async request => request), submitAll: jest.fn(async requests => requests),
    subscribeOutcomes: jest.fn(listener => {
      listeners.push(listener);
      return () => listeners.splice(listeners.indexOf(listener), 1);
    }) };
  const planner = { coverage: jest.fn(() => ({ inFlight })) };
  const runtime = createDashboardWorkRuntime({ requestRun: () => {} });
  runtime.scheduler.setScope(scopeKey);
  return { listeners, work: { planner, runtime: { ...runtime, durable } } };
}

// ----------------------------------------------------------------------------------------------
// @desc Render a component that calls a hook inside the Dashboard's work provider.
// @param {function} useHook - The hook, called with no arguments.
// @param {object} work - The work the provider supplies.
// @returns {Promise<object>} { render, result, unmount }: result.current is the hook's latest return value.
async function renderHook(useHook, work) {
  const result = { current: null };
  // ----------------------------------------------------------------------------------------------
  // @desc Read the hook under test on each render.
  const HookProbe = () => {
    result.current = useHook();
    return null;
  };
  const root = createRoot(document.createElement("div"));
  const render = () => act(async () => root.render(createElement(DashboardWorkProvider, { value: work }, createElement(HookProbe))));
  await render();
  return { render, result, unmount: () => act(() => root.unmount()) };
}

describe("project maintenance hooks", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    globalThis.IntersectionObserver = class IntersectionObserverStub {};
  });

  afterEach(() => {
    jest.useRealTimers();
    delete globalThis.IntersectionObserver;
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Nothing is submitted until the load settles; then the quarter's reconciliation is, and a burst of task
  //   changes submits one more once it quiets down.
  it("submits the Dashboard's reconciliation on settle and after task changes", async () => {
    const { work } = fakeWork(SCOPE_KEY);
    const { result, unmount } = await renderHook(() => useProjectMaintenanceQueue({ domainName: "Work", domainUuid: "work-domain",
      enabled: true, quarter: 3, scopeKey: SCOPE_KEY, work, year: 2026 }), work);
    expect(work.runtime.durable.submit).not.toHaveBeenCalled();
    await act(async () => result.current());
    expect(work.runtime.durable.submit).toHaveBeenCalledTimes(1);
    expect(work.runtime.durable.submit.mock.calls[0][0]).toMatchObject({ category: "maintenance",
      input: { domainName: "Work", domainUuid: "work-domain", quarter: 3, year: 2026 }, key: "reconcileProjects:2026-Q3",
      scopeKey: SCOPE_KEY, type: "reconcileProjects" });
    await act(async () => {
      window.dispatchEvent(new CustomEvent(DASHBOARD_TASKS_UPDATED_EVENT, { detail: {} }));
      window.dispatchEvent(new CustomEvent(DASHBOARD_TASKS_UPDATED_EVENT, { detail: {} }));
      jest.advanceTimersByTime(TASK_CHANGE_DEBOUNCE_MILLISECONDS);
    });
    expect(work.runtime.durable.submit).toHaveBeenCalledTimes(2);
    await unmount();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A reconciliation in the Dashboard's scope, with no project job left in flight, prepares today's ranking once
  //   the quiet period passes; an outcome from another scope does not.
  it("prepares the day's ranking once the visit's project jobs have gone quiet", async () => {
    jest.setSystemTime(new Date(2026, 8, 17, 10, 0));
    const { listeners, work } = fakeWork(SCOPE_KEY);
    const { result, unmount } = await renderHook(() => useProjectMaintenanceQueue({ domainName: "Work", domainUuid: "work-domain",
      enabled: true, quarter: 3, scopeKey: SCOPE_KEY, work, year: 2026 }), work);
    await act(async () => result.current());
    await act(async () => {
      for (const listener of listeners) listener({ jobType: "rankProjectTasks", scopeKey: "other-domain:Q3 2026", status: "completed" });
      jest.advanceTimersByTime(DAY_PREPARATION_QUIET_MILLISECONDS);
    });
    expect(work.runtime.durable.submitAll).not.toHaveBeenCalled();
    await act(async () => {
      for (const listener of listeners) listener({ jobType: "reconcileProjects", scopeKey: SCOPE_KEY, status: "completed" });
      jest.advanceTimersByTime(DAY_PREPARATION_QUIET_MILLISECONDS);
    });
    expect(work.runtime.durable.submitAll).toHaveBeenCalledTimes(1);
    const [requests, options] = work.runtime.durable.submitAll.mock.calls[0];
    expect(options).toEqual({ scopeKey: SCOPE_KEY });
    expect(requests).toEqual([expect.objectContaining({ category: "maintenance", input: { dateKey: "2026-09-17", domainName: "Work",
      domainUuid: "work-domain" }, key: "prepareDayRanking:work-domain:2026-09-17", type: "prepareDayRanking" })]);
    expect(work.planner.coverage).toHaveBeenCalledWith(SCOPE_KEY);
    await unmount();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc With queued maintenance turned off for the Dashboard, settling submits nothing.
  it("submits nothing when the queue is not selected", async () => {
    const { work } = fakeWork(SCOPE_KEY);
    const { result, unmount } = await renderHook(() => useProjectMaintenanceQueue({ domainName: "Work", domainUuid: "work-domain",
      enabled: false, quarter: 3, scopeKey: SCOPE_KEY, work, year: 2026 }), work);
    await act(async () => result.current());
    expect(work.runtime.durable.submit).not.toHaveBeenCalled();
    await unmount();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Plan Builder planning the Dashboard's quarter submits a foreground reconciliation once idle, reads no tasks
  //   for a pass of its own, and re-reads scores after a queued ranking in its scope completes.
  it("routes Plan Builder's ranking through the queue for the Dashboard's quarter", async () => {
    const { listeners, work } = fakeWork(SCOPE_KEY);
    const app = { getTaskDomainTasks: jest.fn(async () => []) };
    const onRanked = jest.fn();
    const { unmount } = await renderHook(() => useProjectTaskRanking({ app, domainName: "Work", domainUuid: "work-domain",
      isAwaitingProvider: false, onRanked, quarter: 3, year: 2026 }), work);
    expect(work.runtime.durable.submit).toHaveBeenCalledTimes(1);
    expect(work.runtime.durable.submit.mock.calls[0][0]).toMatchObject({ category: "foregroundData", scopeKey: SCOPE_KEY,
      type: "reconcileProjects" });
    expect(app.getTaskDomainTasks).not.toHaveBeenCalled();
    await act(async () => {
      for (const listener of listeners) {
        listener({ entityId: "elsewhere", jobType: "rankProjectTasks", scopeKey: "other-domain:Q3 2026", status: "completed" });
        listener({ entityId: "project", jobType: "rankProjectTasks", scopeKey: SCOPE_KEY, status: "completed" });
      }
      jest.advanceTimersByTime(1000);
    });
    expect(onRanked).toHaveBeenCalledTimes(1);
    await unmount();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Another quarter uses the shared queue immediately, and closing Builder releases only its extra scope.
  it("queues another quarter and reloads only that quarter's completed rankings", async () => {
    const { listeners, work } = fakeWork(SCOPE_KEY);
    const builderScope = "work-domain:Q4 2026";
    const app = { getTaskDomainTasks: jest.fn(async () => []) };
    const onRanked = jest.fn();
    const { unmount } = await renderHook(() => useProjectTaskRanking({ app, domainName: "Work", domainUuid: "work-domain",
      isAwaitingProvider: false, onRanked, quarter: 4, year: 2026 }), work);
    expect(work.runtime.durable.submit).toHaveBeenCalledWith(expect.objectContaining({ category: "foregroundData",
      input: { domainName: "Work", domainUuid: "work-domain", quarter: 4, year: 2026 }, scopeKey: builderScope }));
    expect(work.runtime.scheduler.scopeKey).toBe(SCOPE_KEY);
    expect(work.runtime.scheduler.acceptsScope(builderScope)).toBe(true);
    expect(app.getTaskDomainTasks).not.toHaveBeenCalled();
    await act(async () => {
      for (const listener of listeners) listener({ jobType: "rankProjectTasks", scopeKey: SCOPE_KEY, status: "completed" });
      jest.advanceTimersByTime(1000);
    });
    expect(onRanked).not.toHaveBeenCalled();
    await act(async () => {
      for (const listener of listeners) listener({ jobType: "rankProjectTasks", scopeKey: builderScope, status: "completed" });
      jest.advanceTimersByTime(1000);
    });
    expect(onRanked).toHaveBeenCalledTimes(1);
    await unmount();
    expect(work.runtime.scheduler.acceptsScope(builderScope)).toBe(false);
    expect(work.runtime.scheduler.acceptsScope(SCOPE_KEY)).toBe(true);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Provider activity does not restart a legacy timer; repeated idle signals reuse the durable revision.
  //   Switching the selected quarter submits fresh work and releases the former scope.
  it("waits for provider idle and follows quarter changes without a once-per-mount guard", async () => {
    const { work } = fakeWork(SCOPE_KEY);
    const app = {};
    let quarter = 4;
    let isAwaitingProvider = true;
    const { render, unmount } = await renderHook(() => useProjectTaskRanking({ app, domainName: "Work", domainUuid: "work-domain",
      isAwaitingProvider, quarter, year: 2026 }), work);
    expect(work.runtime.durable.submit).not.toHaveBeenCalled();
    isAwaitingProvider = false;
    await render();
    const first = work.runtime.durable.submit.mock.calls[0][0];
    isAwaitingProvider = true;
    await render();
    jest.advanceTimersByTime(5000);
    isAwaitingProvider = false;
    await render();
    expect(work.runtime.durable.submit.mock.calls[1][0]).toEqual(first);
    quarter = 2;
    await render();
    expect(work.runtime.scheduler.acceptsScope("work-domain:Q4 2026")).toBe(false);
    expect(work.runtime.durable.submit.mock.calls[2][0].scopeKey).toBe("work-domain:Q2 2026");
    await unmount();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Changing Dashboard domains cancels a Builder's registration even before its props or unmount catch up.
  it("does not reclaim the previous domain after Dashboard switches domains", async () => {
    const { work } = fakeWork(SCOPE_KEY);
    const { unmount } = await renderHook(() => useProjectTaskRanking({ app: {}, domainName: "Work", domainUuid: "work-domain",
      isAwaitingProvider: false, quarter: 4, year: 2026 }), work);
    await act(async () => work.runtime.scheduler.setScope("home-domain:Q3 2026"));
    expect(work.runtime.scheduler.acceptsScope("work-domain:Q4 2026")).toBe(false);
    expect(work.runtime.durable.submit).toHaveBeenCalledTimes(1);
    await unmount();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Closing Builder while its queue note is being read prevents a later reconciliation submission.
  it("does not submit after unmount during recovery", async () => {
    const { work } = fakeWork(SCOPE_KEY);
    let finishRecovery;
    work.runtime.durable.recover.mockImplementation(() => new Promise(resolve => { finishRecovery = resolve; }));
    const { unmount } = await renderHook(() => useProjectTaskRanking({ app: {}, domainName: "Work", domainUuid: "work-domain",
      isAwaitingProvider: false, quarter: 4, year: 2026 }), work);
    await unmount();
    await act(async () => finishRecovery(0));
    expect(work.runtime.durable.submit).not.toHaveBeenCalled();
    expect(work.runtime.scheduler.acceptsScope("work-domain:Q4 2026")).toBe(false);
  });
});
