// Exercise WidgetMountCoordinator over a real scheduler and budget: visible widgets mount before near ones and one at
// a time, requests follow scrolling, permits are released by commit, unregistration, or watchdog, and overlays hold
// mounts.
import { createDashboardWorkRuntime } from "dashboard/work-queue/dashboard-work-runtime";
import WidgetMountCoordinator from "dashboard/work-queue/widget-mount-coordinator";

// ----------------------------------------------------------------------------------------------
// @desc Let queued microtasks, such as job starts and completions, run.
async function flush() {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

// ----------------------------------------------------------------------------------------------
// @desc A coordinator over a runtime whose admission passes run only when the test calls pass(), with stub observers
//   the test reports through and timers it fires by hand. A pass first lets pending completions release their permits,
//   as they would before the next frame.
// @returns {object} { coordinator, fireTimers, mounted, pass, register, report, runtime }.
function harness() {
  const runtime = createDashboardWorkRuntime({ requestRun: () => {} });
  const createdObservers = [];
  const createObserver = callback => {
    const observer = { callback, disconnect: () => {}, observe: () => {}, unobserve: () => {} };
    createdObservers.push(observer);
    return observer;
  };
  const timers = new Map();
  let timerId = 0;
  const coordinator = new WidgetMountCoordinator({ clearTimer: id => timers.delete(id),
    createObserver, scheduler: runtime.scheduler,
    setTimer: callback => { timers.set(++timerId, callback); return timerId; } });
  const mounted = [];
  const elements = new Map();
  const register = widgetId => {
    elements.set(widgetId, { widgetId });
    return coordinator.register(widgetId, { element: elements.get(widgetId), mount: () => mounted.push(widgetId) });
  };
  // Observer 0 watches the lookahead band, observer 1 the viewport.
  const report = (observerIndex, intersections) => createdObservers[observerIndex].callback(
    Object.entries(intersections).map(([widgetId, isIntersecting]) => ({ isIntersecting, target: elements.get(widgetId) })));
  const pass = async () => {
    await flush();
    runtime.scheduler.runReady();
    await flush();
  };
  const fireTimers = () => {
    for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
  };
  return { coordinator, fireTimers, mounted, pass, register, report, runtime };
}

describe("WidgetMountCoordinator", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc One observer batch reports several widgets; visible ones mount first, and only one mount runs until its
  //   commit releases the permit.
  it("mounts visible widgets first, one at a time, releasing on commit", async () => {
    const { coordinator, mounted, pass, register, report } = harness();
    const generations = { agenda: register("agenda"), calendar: register("calendar"), mood: register("mood") };
    report(0, { agenda: true, calendar: true, mood: true });
    report(1, { calendar: true, mood: true });
    await pass();
    expect(mounted).toEqual(["calendar"]);
    await pass();
    expect(mounted).toEqual(["calendar"]);
    coordinator.reportCommitted("calendar", generations.calendar);
    await pass();
    expect(mounted).toEqual(["calendar", "mood"]);
    coordinator.reportCommitted("mood", generations.mood);
    await pass();
    expect(mounted).toEqual(["calendar", "mood", "agenda"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A widget that leaves the lookahead band before its turn withdraws its request; one scrolled into view is
  //   promoted; one scrolled from view back into the band is lowered again.
  it("follows scrolling: withdraws, promotes, and lowers requests", async () => {
    const { mounted, pass, register, report, runtime } = harness();
    register("agenda");
    register("mood");
    report(0, { agenda: true, mood: true });
    report(0, { agenda: false });
    const keys = () => runtime.scheduler.snapshot().jobs.map(job => `${ job.key }=${ job.category }`);
    expect(keys()).toEqual(["widgetMount:mood=nearViewportRender"]);
    report(1, { mood: true });
    expect(keys()).toEqual(["widgetMount:mood=visibleRender"]);
    report(1, { mood: false });
    expect(keys()).toEqual(["widgetMount:mood=nearViewportRender"]);
    await pass();
    expect(mounted).toEqual(["mood"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A mount whose commit never arrives releases its permit when the watchdog fires, without mounting the same
  //   widget again; a late commit report is then harmless.
  it("releases a stuck mount through the watchdog without mounting twice", async () => {
    const { coordinator, fireTimers, mounted, pass, register, report, runtime } = harness();
    const generation = register("agenda");
    register("mood");
    report(1, { agenda: true, mood: true });
    await pass();
    expect(runtime.budget.snapshot().resources.mount.available).toBe(0);
    fireTimers();
    await pass();
    expect(mounted).toEqual(["agenda", "mood"]);
    coordinator.reportCommitted("agenda", generation);
    expect(mounted).toEqual(["agenda", "mood"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Unregistering a mounting widget releases its permit; a registration replaced by a newer one, as StrictMode
  //   cleanup does, ignores its stale callbacks and withdraws its queued request.
  it("releases on unregister and ignores stale generations", async () => {
    const { coordinator, mounted, pass, register, report, runtime } = harness();
    const agendaGeneration = register("agenda");
    const staleMoodGeneration = register("mood");
    report(1, { agenda: true, mood: true });
    await pass();
    expect(mounted).toEqual(["agenda"]);
    const moodGeneration = register("mood");
    coordinator.unregister("mood", staleMoodGeneration);
    expect(runtime.scheduler.snapshot().jobs.map(job => job.key)).toEqual(["widgetMount:agenda"]);
    coordinator.unregister("agenda", agendaGeneration);
    await flush();
    expect(runtime.budget.snapshot().resources.mount.available).toBe(1);
    report(1, { mood: true });
    await pass();
    expect(mounted).toEqual(["agenda", "mood"]);
    coordinator.reportCommitted("mood", moodGeneration);
    expect(coordinator.registrations.get("mood").status).toBe("mounted");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc While an overlay holds renders, widgets scrolled into view wait with the overlay reason; on release the
  //   visible widget mounts before the near one.
  it("holds mounts under an overlay and drains visible widgets first on release", async () => {
    const { coordinator, mounted, pass, register, report, runtime } = harness();
    runtime.scheduler.setConditions({ overlayHeld: true });
    const generations = { agenda: register("agenda"), mood: register("mood") };
    report(0, { agenda: true });
    report(1, { mood: true });
    await pass();
    expect(mounted).toEqual([]);
    expect(runtime.scheduler.snapshot().jobs.map(job => job.waitingReason)).toEqual(["overlay", "overlay"]);
    runtime.scheduler.setConditions({ overlayHeld: false });
    await pass();
    expect(mounted).toEqual(["mood"]);
    coordinator.reportCommitted("mood", generations.mood);
    await pass();
    expect(mounted).toEqual(["mood", "agenda"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A provider request that never resolves holds only its own resource: a widget scrolled into view still
  //   mounts, and disposing the coordinator withdraws what is left.
  it("mounts a visible widget while a provider request stays pending", async () => {
    const { coordinator, mounted, pass, register, report, runtime } = harness();
    runtime.scheduler.setConditions({ loadSettled: true });
    runtime.scheduler.enqueue({ category: "foregroundData", key: "rank:project", resource: "generative",
      run: () => new Promise(() => {}), type: "rankProjectTasks" });
    await pass();
    register("agenda");
    register("mood");
    report(1, { agenda: true });
    report(0, { mood: true });
    await pass();
    expect(mounted).toEqual(["agenda"]);
    coordinator.dispose();
    await flush();
    expect(runtime.scheduler.snapshot().jobs.map(job => job.key)).toEqual(["rank:project"]);
  });
});
