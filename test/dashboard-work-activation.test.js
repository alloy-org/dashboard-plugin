// Verify independent rollout switches against the real Dashboard runtime hook, including browsers without viewport
// observers, load-gated maintenance, foreground provider contention, and cleanup when the runtime is replaced.
import { jest } from "@jest/globals";
import { queuedMaintenanceSelected } from "dashboard/work-queue/dashboard-work-features";
import { LOAD_GATE_GRACE_MILLISECONDS } from "dashboard/work-queue/dashboard-work-policy";
import useDashboardWorkQueue from "hooks/use-dashboard-work-queue";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushPromises, workQueueNotesApp } from "./work-queue-test-notes";

// ----------------------------------------------------------------------------------------------
// @desc Observer interface sufficient to construct and dispose a coordinator without delivering viewport events.
class ViewportObserverStub {
  // ----------------------------------------------------------------------------------------------
  // @desc Release observation; this stub retains no elements.
  disconnect() {}
}

// ----------------------------------------------------------------------------------------------
// @desc Mount the runtime hook and allow its feature switches to change without replacing the Dashboard component.
// @param {object} options - Runtime hook options.
// @returns {Promise<object>} { render, result, unmount }, with the latest hook value in result.current.
async function renderRuntime(options) {
  const result = { current: null };
  // ----------------------------------------------------------------------------------------------
  // @desc Publish the hook value for lifecycle assertions.
  // @param {object} props - Runtime hook options.
  function RuntimeProbe(props) {
    result.current = useDashboardWorkQueue(props);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const render = async props => act(async () => root.render(createElement(RuntimeProbe, props)));
  await render(options);
  return { render, result, unmount: () => act(async () => root.unmount()) };
}

describe("Dashboard work activation", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    delete globalThis.IntersectionObserver;
    jest.useRealTimers();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Every switch combination creates only the requested services; observer support affects mounts alone.
  it.each([
    [false, false, false], [false, false, true], [false, true, false], [false, true, true],
    [true, false, false], [true, false, true], [true, true, false], [true, true, true],
  ])("selects durable=%s, mounting=%s, observers=%s independently", async (durableEnabled, enabled, observersAvailable) => {
    if (observersAvailable) globalThis.IntersectionObserver = ViewportObserverStub;
    const app = workQueueNotesApp();
    const { result, unmount } = await renderRuntime({ app, durableEnabled, enabled, scopeKey: "work:Q4 2026" });
    const { work } = result.current;
    expect(Boolean(work)).toBe(durableEnabled || (enabled && observersAvailable));
    expect(Boolean(work?.runtime.durable)).toBe(durableEnabled);
    expect(Boolean(work?.mountCoordinator)).toBe(enabled && observersAvailable);
    expect(app.notes.size).toBe(0);
    await unmount();
    expect(jest.getTimerCount()).toBe(0);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Missing viewport observers cannot select the legacy maintenance pass alongside the durable runtime.
  it("keeps maintenance selected without IntersectionObserver", () => {
    expect(queuedMaintenanceSelected()).toBe(true);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc In maintenance-only mode, admission still waits for settling plus the grace period. An in-flight background
  //   generation leaves the foreground permit available, and its completion publishes a diagnostic outcome.
  it("gates maintenance and admits foreground data while background generation is pending", async () => {
    const { result, unmount } = await renderRuntime({ app: workQueueNotesApp(), durableEnabled: true, enabled: false,
      scopeKey: "work:Q4 2026" });
    const { budget, diagnostics, scheduler } = result.current.work.runtime;
    let finishMaintenance;
    const maintenance = jest.fn(() => new Promise(resolve => { finishMaintenance = resolve; }));
    scheduler.enqueue({ category: "maintenance", key: "ideas", resource: "generative", run: maintenance, type: "generateProjectIdeas" });
    scheduler.runReady();
    await flushPromises();
    expect(maintenance).not.toHaveBeenCalled();
    await act(async () => {
      result.current.reportLoadSettled();
      jest.advanceTimersByTime(LOAD_GATE_GRACE_MILLISECONDS - 1);
    });
    expect(maintenance).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(1));
    scheduler.runReady();
    await flushPromises();
    expect(maintenance).toHaveBeenCalledTimes(1);
    const foreground = jest.fn(async () => "ready");
    scheduler.enqueue({ category: "foregroundData", key: "daily", resource: "generative", run: foreground, type: "prepareDayRanking" });
    scheduler.runReady();
    await flushPromises();
    expect(foreground).toHaveBeenCalledTimes(1);
    expect(budget.snapshot().resources.generative.maintenance).toBe(1);
    finishMaintenance();
    await flushPromises();
    expect(diagnostics.snapshot().events).toEqual(expect.arrayContaining([
      expect.objectContaining({ jobKey: "ideas", type: "completed" }),
      expect.objectContaining({ jobKey: "daily", type: "completed" }),
    ]));
    await unmount();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Replacing a settled runtime cancels its grace timer and resumes settling on the new runtime. Turning both
  //   features off disposes the replacement and removes every remaining timer.
  it("disposes replaced runtimes and preserves the load signal", async () => {
    globalThis.IntersectionObserver = ViewportObserverStub;
    const options = { app: workQueueNotesApp(), durableEnabled: true, enabled: true, scopeKey: "work:Q4 2026" };
    const { render, result, unmount } = await renderRuntime(options);
    const original = result.current.work;
    const dispose = jest.spyOn(original, "dispose");
    await act(async () => result.current.reportLoadSettled());
    await render({ ...options, enabled: false });
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(result.current.work.mountCoordinator).toBeNull();
    await act(async () => jest.advanceTimersByTime(LOAD_GATE_GRACE_MILLISECONDS));
    expect(original.runtime.scheduler.conditions.loadSettled).toBe(false);
    expect(result.current.work.runtime.scheduler.conditions.loadSettled).toBe(true);
    await render({ ...options, durableEnabled: false, enabled: false });
    expect(result.current.work).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
    await unmount();
  });
});
