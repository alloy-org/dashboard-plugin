// Exercise the Dashboard's main-thread instrumentation: call timings by label, the interaction tracker, the lag
// monitor's timer and long-frame stalls with their job attribution, the queue repository's labelled note calls, and
// the diagnostics export that carries them.
import { workQueueNotesApp } from "./work-queue-test-notes";
import DashboardWorkDiagnostics, { FIRST_EVENT_LIMIT } from "dashboard/work-queue/dashboard-work-diagnostics";
import DashboardWorkRepository from "dashboard/work-queue/dashboard-work-repository";
import { createInteractionTracker } from "dashboard/work-queue/interaction-tracker";
import MainThreadLagMonitor, { LAG_SAMPLE_INTERVAL_MILLISECONDS, NO_JOB_LABEL } from "dashboard/work-queue/main-thread-lag-monitor";
import { CallTimingMeter, SLOW_CALL_MILLISECONDS } from "util/call-timing-meter";

// ----------------------------------------------------------------------------------------------
// @desc A document stand-in that keeps its listeners and dispatches events by type.
// @returns {object} { addEventListener, dispatch, listenerCount, removeEventListener }.
function fakeDocument() {
  const listeners = new Map();
  return { addEventListener: (type, listener) => listeners.set(type, listener), dispatch: type => listeners.get(type)?.(),
    listenerCount: () => listeners.size, removeEventListener: type => listeners.delete(type) };
}

// ----------------------------------------------------------------------------------------------
// @desc A lag monitor over a manual clock and timers, with the job types it credits supplied by the test.
// @param {object} [options] - { activeJobTypes = [], performanceObserverClass = null, tracker = null }.
// @returns {object} { advance, fireTimer, monitor, setNow }.
function monitorHarness({ activeJobTypes = [], performanceObserverClass = null, tracker = null } = {}) {
  let now = 10_000;
  let pendingCallback = null;
  const monitor = new MainThreadLagMonitor({ activeJobTypesSince: () => activeJobTypes, clearTimer: () => { pendingCallback = null; },
    clock: () => now, interactionTracker: tracker, performanceObject: { timeOrigin: 0 }, performanceObserverClass,
    setTimer: callback => { pendingCallback = callback; return 1; } });
  const fireTimer = lateness => {
    now += LAG_SAMPLE_INTERVAL_MILLISECONDS + lateness;
    pendingCallback();
  };
  return { fireTimer, monitor, setNow: value => { now = value; } };
}

describe("CallTimingMeter", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Calls are totalled per label, failures and slow calls counted, and concurrent calls tracked.
  it("totals calls per label, counting failures, slow calls, and calls in flight", async () => {
    let now = 0;
    const meter = new CallTimingMeter({ clock: () => now });
    const slowCall = meter.measure("getNoteContent", () => new Promise(resolve => setTimeout(resolve, 0)));
    const failingCall = expect(meter.measure("replaceNoteContent", async () => { throw new Error("offline"); })).rejects.toThrow("offline");
    now = SLOW_CALL_MILLISECONDS;
    await slowCall;
    await failingCall;
    meter.count("queueNote.claim.unchanged");
    const { inFlight, labels, maximumInFlight } = meter.snapshot();
    expect(inFlight).toBe(0);
    expect(maximumInFlight).toBe(2);
    expect(labels.find(timing => timing.label === "getNoteContent")).toMatchObject({ calls: 1, failures: 0, slowCalls: 1 });
    expect(labels.find(timing => timing.label === "replaceNoteContent")).toMatchObject({ calls: 1, failures: 1 });
    expect(labels.find(timing => timing.label === "queueNote.claim.unchanged")).toMatchObject({ calls: 1, totalMilliseconds: 0 });
  });
});

describe("createInteractionTracker", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Input starts an interaction that lasts until a second of quiet, and separate bursts are counted apart.
  it("treats input as interacting until a quiet second passes", () => {
    let now = 0;
    const documentObject = fakeDocument();
    const tracker = createInteractionTracker({ clock: () => now, documentObject });
    expect(tracker.interacting()).toBe(false);
    documentObject.dispatch("scroll");
    now = 600;
    documentObject.dispatch("touchmove");
    now = 1500;
    expect(tracker.interacting()).toBe(true);
    now = 1700;
    expect(tracker.interacting()).toBe(false);
    documentObject.dispatch("pointerdown");
    now = 5000;
    expect(tracker.snapshot()).toEqual({ interacting: false, interactionMilliseconds: 2600, interactions: 2 });
    tracker.dispose();
    expect(documentObject.listenerCount()).toBe(0);
  });
});

describe("MainThreadLagMonitor", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A late timer counts as a stall credited to the running jobs; a punctual one is only a sample.
  it("records late timer samples as stalls credited to the jobs that could have caused them", () => {
    const { fireTimer, monitor } = monitorHarness({ activeJobTypes: ["rankProjectTasks"] });
    monitor.start();
    fireTimer(5);
    fireTimer(180);
    const snapshot = monitor.snapshot();
    expect(snapshot.timerLag).toMatchObject({ count: 1, maximumMilliseconds: 180, samples: 2, totalMilliseconds: 180 });
    expect(snapshot.timerLag.histogram["100-199"]).toBe(1);
    expect(snapshot.byJobType).toEqual([{ jobType: "rankProjectTasks", longFrameMilliseconds: 0, longFrames: 0,
      timerStallMilliseconds: 180, timerStalls: 1 }]);
    expect(snapshot.recentStalls[0]).toMatchObject({ durationMilliseconds: 180, interacting: false, jobTypes: "rankProjectTasks",
      source: "timer" });
    expect(snapshot.device).toEqual(expect.objectContaining({ tier: expect.any(String) }));
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Long animation frames are observed with their longest script, and a stall while the user scrolls is marked.
  it("observes long animation frames and marks stalls during interaction", () => {
    let deliver = null;
    class FakeObserver {
      static supportedEntryTypes = ["long-animation-frame", "longtask"];
      constructor(callback) { deliver = callback; }
      disconnect() {}
      observe(options) { this.options = options; }
    }
    const tracker = { interacting: at => at >= 12_000, snapshot: () => ({ interacting: true }) };
    const { monitor } = monitorHarness({ performanceObserverClass: FakeObserver, tracker });
    monitor.start();
    const scripts = [{ duration: 30, invoker: "Response.json.then", invokerType: "resolve-promise", sourceFunctionName: "parse" },
      { duration: 90, invoker: "FrameRequestCallback", invokerType: "user-callback", sourceFunctionName: "runReady" }];
    deliver({ getEntries: () => [{ blockingDuration: 70, duration: 120, scripts, startTime: 12_000 }] });
    const snapshot = monitor.snapshot();
    expect(snapshot.longFrameSource).toBe("long-animation-frame");
    expect(snapshot.longFrames).toMatchObject({ count: 1, duringInteractionCount: 1, duringInteractionMilliseconds: 120 });
    expect(snapshot.recentStalls[0]).toMatchObject({ blockingMilliseconds: 70, jobTypes: NO_JOB_LABEL,
      topScript: "user-callback FrameRequestCallback runReady", topScriptMilliseconds: 90 });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Samples taken while the page is hidden are discarded, since hidden pages throttle timers.
  it("ignores timer samples while the page is hidden", () => {
    let hidden = true;
    let now = 0;
    let pendingCallback = null;
    const monitor = new MainThreadLagMonitor({ activeJobTypesSince: () => [], clearTimer: () => {}, clock: () => now,
      hidden: () => hidden, performanceObserverClass: null, setTimer: callback => { pendingCallback = callback; } });
    monitor.start();
    now += 1000;
    hidden = false;
    pendingCallback();
    expect(monitor.snapshot().timerLag).toMatchObject({ count: 0, samples: 0 });
    monitor.dispose();
  });
});

describe("main-thread instrumentation in the work queue", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc The repository times each queue note read and write under the job transition that caused it.
  it("labels the queue note's reads and writes by the job transition", async () => {
    const meter = new CallTimingMeter();
    const repository = new DashboardWorkRepository({ app: workQueueNotesApp(), callTimingMeter: meter, clock: () => 1_000_000 });
    await repository.saveJob("scope", { desiredRevision: "r1", input: null, key: "rank:a", type: "rank" });
    await repository.claim("scope", "rank:a", { ownerId: "session", token: "session:1" });
    await repository.claim("scope", "rank:a", { ownerId: "session", token: "session:2" });
    const labels = meter.snapshot().labels.map(timing => timing.label).sort();
    expect(labels).toEqual(["queueNote.claim.read", "queueNote.claim.unchanged", "queueNote.claim.write", "queueNote.save.read",
      "queueNote.save.write"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Diagnostics keep the session's first events past the ring, name the job types active since a moment, and
  //   export app call timings and the main-thread snapshot.
  it("keeps first events, reports recently active job types, and exports the new sections", () => {
    let now = 0;
    const diagnostics = new DashboardWorkDiagnostics({ clock: () => now, eventLimit: 5 });
    for (let index = 0; index < FIRST_EVENT_LIMIT + 10; index += 1) {
      now = index;
      diagnostics.record({ jobKey: `mount:${ index }`, jobType: index % 2 ? "widgetMount" : "rankProjectTasks", type: "started" });
    }
    expect(diagnostics.jobTypesActiveSince(FIRST_EVENT_LIMIT + 9)).toEqual(["widgetMount"]);
    const exported = diagnostics.exportSnapshot(null, { appCalls: { bookkeeping: null, bridge: { labels: [{ calls: 1, label: "findNote" }] } },
      mainThread: { timerLag: { count: 0 } } });
    expect(exported.diagnostics.events).toHaveLength(5);
    expect(exported.diagnostics.firstEvents).toHaveLength(FIRST_EVENT_LIMIT);
    expect(exported.appCalls.bridge.labels[0].label).toBe("findNote");
    expect(exported.mainThread).toEqual({ timerLag: { count: 0 } });
  });
});
