// Verify disabling durable work pauses both Dashboard and Builder maintenance without reviving timers or writers.
import { jest } from "@jest/globals";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { workQueueNotesApp } from "./work-queue-test-notes";

jest.unstable_mockModule("dashboard/work-queue/dashboard-work-features", () => ({ DICTIONARY_REFINEMENT_ENABLED: true,
  DURABLE_WORK_ENABLED: false, queuedMaintenanceSelected: () => false, SCHEDULED_WIDGET_MOUNTING_ENABLED: true }));

const { DashboardWorkProvider } = await import("dashboard/work-queue/dashboard-work-context");
const { queuedMaintenanceSelected } = await import("dashboard/work-queue/dashboard-work-features");
const { default: useDashboardWorkQueue } = await import("hooks/use-dashboard-work-queue");
const { useProjectMaintenanceQueue } = await import("hooks/use-project-maintenance-queue");
const { useProjectTaskRanking } = await import("hooks/use-project-task-ranking");

const SCOPE_KEY = "work-domain:Q3 2026";

// ----------------------------------------------------------------------------------------------
// @desc Observer sufficient to construct the independent widget mount coordinator.
class ViewportObserverStub {
  // ----------------------------------------------------------------------------------------------
  // @desc Dispose the empty observer.
  disconnect() {}
}

describe("disabled durable maintenance", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    globalThis.IntersectionObserver = ViewportObserverStub;
  });
  afterEach(() => {
    delete globalThis.IntersectionObserver;
    jest.useRealTimers();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc With durable work off, settling and advancing beyond both former delays never reads tasks or writes notes,
  //   whether widget mounting remains scheduled or is also off.
  it.each([true, false])("keeps maintenance idle with scheduled mounting=%s", async enabled => {
    const app = workQueueNotesApp();
    app.getTaskDomainTasks = jest.fn(async () => []);
    app.filterNotes = jest.fn(async () => []);
    const state = {};
    // ----------------------------------------------------------------------------------------------
    // @desc Mount the real Builder hook for a different quarter inside the disabled runtime's provider.
    function BuilderProbe() {
      useProjectTaskRanking({ app, domainName: "Work", domainUuid: "work-domain", isAwaitingProvider: false, quarter: 4, year: 2026 });
      return null;
    }
    // ----------------------------------------------------------------------------------------------
    // @desc Connect the Dashboard's actual runtime and maintenance hooks, exposing their settle signals to the test.
    function DashboardProbe() {
      const { reportLoadSettled, work } = useDashboardWorkQueue({ app, enabled, scopeKey: SCOPE_KEY });
      const startMaintenance = useProjectMaintenanceQueue({ domainName: "Work", domainUuid: "work-domain",
        enabled: queuedMaintenanceSelected(), quarter: 3, scopeKey: SCOPE_KEY, work, year: 2026 });
      Object.assign(state, { reportLoadSettled, startMaintenance, work });
      return createElement(DashboardWorkProvider, { value: work }, createElement(BuilderProbe));
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(DashboardProbe)));
    await act(async () => { state.startMaintenance(); state.reportLoadSettled(); });
    await act(async () => jest.advanceTimersByTime(10_000));
    expect(Boolean(state.work?.mountCoordinator)).toBe(enabled);
    expect(state.work?.runtime.durable ?? null).toBeNull();
    expect(app.getTaskDomainTasks).not.toHaveBeenCalled();
    expect(app.filterNotes).not.toHaveBeenCalled();
    expect(app.notes.size).toBe(0);
    await act(async () => root.unmount());
    expect(jest.getTimerCount()).toBe(0);
  });
});
