// Verify the work queue's classes can call their default timer functions as methods. Browsers reject the native
// setTimeout and clearTimeout when called with a receiver other than the window ("Illegal invocation"); Node does not,
// so these tests install globals that reject a receiver the way the browser does.
import { jest } from "@jest/globals";
import DashboardWorkDiagnosticsStore from "dashboard/work-queue/dashboard-work-diagnostics-store";
import { workHandlerRegistry } from "dashboard/work-queue/dashboard-work-handlers";
import DashboardWorkRepository from "dashboard/work-queue/dashboard-work-repository";
import { createDashboardWorkRuntime } from "dashboard/work-queue/dashboard-work-runtime";
import WidgetMountCoordinator from "dashboard/work-queue/widget-mount-coordinator";
import { workQueueNotesApp } from "./work-queue-test-notes";

// ----------------------------------------------------------------------------------------------
// @desc Wrap a timer global so it throws, as the browser's does, when called with an object as its receiver.
// @param {function} nativeFunction - The original global.
// @returns {function} The receiver-checking wrapper.
function receiverCheckedTimer(nativeFunction) {
  return function checkedTimer(...timerArguments) {
    if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
    return nativeFunction(...timerArguments);
  };
}

describe("work queue default timers", () => {
  const originalClearTimeout = globalThis.clearTimeout;
  const originalSetTimeout = globalThis.setTimeout;

  beforeEach(() => {
    globalThis.clearTimeout = receiverCheckedTimer(originalClearTimeout);
    globalThis.setTimeout = receiverCheckedTimer(originalSetTimeout);
  });

  afterEach(() => {
    globalThis.clearTimeout = originalClearTimeout;
    globalThis.setTimeout = originalSetTimeout;
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Each class that keeps timer functions as properties starts and cancels a timer through its defaults.
  it("starts and cancels timers through each class's defaults", () => {
    const app = workQueueNotesApp();
    const createObserver = () => ({ disconnect: () => {}, observe: () => {}, unobserve: () => {} });
    const runtime = createDashboardWorkRuntime({ handlers: workHandlerRegistry([]), repository: new DashboardWorkRepository({ app }),
      requestRun: () => {} });
    const owners = [new WidgetMountCoordinator({ createObserver, scheduler: runtime.scheduler }), new DashboardWorkDiagnosticsStore({ app }),
      runtime.durable];
    for (const owner of owners) {
      const callback = jest.fn();
      expect(() => owner.clearTimer(owner.setTimer(callback, 1000))).not.toThrow();
    }
  });
});
