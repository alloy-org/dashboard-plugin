// Exercise DashboardWorkDiagnostics: the bounded event ring, counters and timings, the last progress time, batched
// notification, and the sanitizing of recorded and exported fields, including widget mounts and the runtime session.
import DashboardWorkDiagnostics, { sanitizedValue } from "dashboard/work-queue/dashboard-work-diagnostics";

describe("DashboardWorkDiagnostics", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Only the most recent events are kept, while counters and timings cover every event.
  it("keeps a bounded ring of events with complete counters and timings", () => {
    const diagnostics = new DashboardWorkDiagnostics({ clock: () => 5, eventLimit: 3 });
    diagnostics.record({ jobKey: "rank:a", jobType: "rank", type: "started", waitedMilliseconds: 40 });
    diagnostics.record({ durationMilliseconds: 100, jobKey: "rank:a", jobType: "rank", type: "completed" });
    diagnostics.record({ jobKey: "rank:b", jobType: "rank", type: "started", waitedMilliseconds: 60 });
    diagnostics.record({ durationMilliseconds: 300, jobKey: "rank:b", jobType: "rank", type: "completed" });
    const snapshot = diagnostics.snapshot();
    expect(snapshot.events.map(event => event.jobKey)).toEqual(["rank:a", "rank:b", "rank:b"]);
    expect(snapshot.counters).toEqual({ completed: 2, started: 2 });
    expect(snapshot.timings.rank).toEqual({ maximumRunMilliseconds: 300, runs: 2, totalRunMilliseconds: 400,
      totalWaitMilliseconds: 100, waits: 2 });
    expect(snapshot.events[0].at).toBe(5);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Fields outside the allow list are dropped, credentials are redacted while UUIDs survive, and long text is
  //   shortened; the export sanitizes the scheduler's jobs the same way.
  it("sanitizes recorded events and exported snapshots", () => {
    const diagnostics = new DashboardWorkDiagnostics({ clock: () => Date.UTC(2026, 9, 3) });
    const apiKey = `sk-ant-${ "a".repeat(48) }`;
    diagnostics.record({ error: new Error(`Unauthorized ${ apiKey }`), jobKey: "rank:8f2e4c1a-1b2c-4d3e-9f00-123456789abc",
      prompt: "Private note text", type: "failed" });
    const [event] = diagnostics.snapshot().events;
    expect(event.prompt).toBeUndefined();
    expect(event.error).toBe("Unauthorized sk-ant-[redacted]");
    expect(event.jobKey).toBe("rank:8f2e4c1a-1b2c-4d3e-9f00-123456789abc");
    expect(sanitizedValue("x ".repeat(200))).toHaveLength(160);
    expect(sanitizedValue({ nested: true })).toBeNull();
    const exported = diagnostics.exportSnapshot({ counts: { pending: 1, running: 0 },
      jobs: [{ input: "Private note text", key: "rank:project", status: "pending" }], scopeKey: "work:2026-Q4" });
    expect(exported.scheduler.jobs).toEqual([{ key: "rank:project", status: "pending" }]);
    expect(exported.exportedAt).toBe("2026-10-03T00:00:00.000Z");
    expect(new DashboardWorkDiagnostics().exportSnapshot().scheduler).toBeNull();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The last progress time follows completed and checkpointed jobs only, and an export passes widget mounts and
  //   the runtime session through their own allow-lists.
  it("tracks the last progress and sanitizes exported mounts and session", () => {
    let now = 10;
    const diagnostics = new DashboardWorkDiagnostics({ clock: () => now });
    expect(diagnostics.snapshot().lastProgressAt).toBeNull();
    diagnostics.record({ type: "completed" });
    now = 20;
    diagnostics.record({ type: "yielded" });
    now = 30;
    diagnostics.record({ type: "failed" });
    expect(diagnostics.snapshot().lastProgressAt).toBe(20);
    const mountSnapshot = { widgets: [{ element: { tagName: "DIV" }, status: "mounting", watchdogActive: true,
      widgetId: `agenda-${ "b".repeat(40) }` }] };
    const exported = diagnostics.exportSnapshot(null, { mountSnapshot, session: { secret: "x", sessionId: "abc", startedAt: 1 } });
    expect(exported.mounts).toEqual([{ status: "mounting", watchdogActive: true, widgetId: "agenda-[redacted]" }]);
    expect(exported.session).toEqual({ sessionId: "abc", startedAt: 1 });
    expect(diagnostics.exportSnapshot().mounts).toBeNull();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A burst of events produces one notification, and an unsubscribed listener hears nothing more.
  it("notifies subscribers once per burst of events", async () => {
    const diagnostics = new DashboardWorkDiagnostics();
    let notifications = 0;
    const unsubscribe = diagnostics.subscribe(() => { notifications += 1; });
    diagnostics.record({ type: "enqueued" });
    diagnostics.record({ type: "started" });
    await Promise.resolve();
    expect(notifications).toBe(1);
    unsubscribe();
    diagnostics.record({ type: "completed" });
    await Promise.resolve();
    expect(notifications).toBe(1);
  });
});
