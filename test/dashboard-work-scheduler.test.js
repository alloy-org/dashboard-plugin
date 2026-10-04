// Exercise DashboardWorkScheduler: independent resource admission, priority, coalescing, cancellation, foreground
// demand, waiting reasons, yielding, and scope changes.
import DashboardResourceBudget from "dashboard/work-queue/dashboard-resource-budget";
import DashboardWorkDiagnostics from "dashboard/work-queue/dashboard-work-diagnostics";
import { createDashboardWorkRuntime } from "dashboard/work-queue/dashboard-work-runtime";
import DashboardWorkScheduler from "dashboard/work-queue/dashboard-work-scheduler";

// ----------------------------------------------------------------------------------------------
// @desc A promise with its resolve and reject functions exposed, so a test decides when a job finishes.
// @returns {object} { promise, reject, resolve }.
function deferred() {
  let resolve = null;
  let reject = null;
  const promise = new Promise((settle, fail) => { resolve = settle; reject = fail; });
  return { promise, reject, resolve };
}

// ----------------------------------------------------------------------------------------------
// @desc Let every queued promise callback run.
// @returns {Promise<void>}
async function flushPromises() {
  for (let round = 0; round < 10; round += 1) await Promise.resolve();
}

// ----------------------------------------------------------------------------------------------
// @desc A scheduler whose admission passes run only when the test calls runReady, with the load gate open.
// @param {object} [options] - { limits }: permits per resource.
// @returns {object} { budget, diagnostics, scheduler }.
function manualScheduler({ limits } = {}) {
  const budget = new DashboardResourceBudget({ limits });
  const diagnostics = new DashboardWorkDiagnostics({ clock: () => 0 });
  const scheduler = new DashboardWorkScheduler({ budget, clock: () => 0, diagnostics, requestRun: () => {} });
  scheduler.setConditions({ loadSettled: true });
  return { budget, diagnostics, scheduler };
}

// ----------------------------------------------------------------------------------------------
// @desc A job descriptor whose run records its start and then waits on the given promise.
// @param {string} key - Job key.
// @param {Array<string>} started - Receives the key when the job starts.
// @param {object} [options] - { category, promise = Promise.resolve(key), resource }.
// @returns {object} Enqueue descriptor.
function recordingJob(key, started, { category, promise = Promise.resolve(key), resource } = {}) {
  return { category, key, resource, run: () => { started.push(key); return promise; }, type: key.split(":")[0] };
}

// ----------------------------------------------------------------------------------------------
// @desc The waiting reason the scheduler's snapshot reports for a job.
// @param {DashboardWorkScheduler} scheduler - Scheduler.
// @param {string} key - Job key.
// @returns {string|null} Waiting reason.
function waitingReason(scheduler, key) {
  return scheduler.snapshot().jobs.find(job => job.key === key)?.waitingReason ?? null;
}

describe("DashboardWorkScheduler admission", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A provider request that never resolves holds only its own resource: a Jev batch and then a mount still
  //   start, and each pass returns without waiting for any job.
  it("does not let an unresolved provider request block other resources", async () => {
    const { scheduler } = manualScheduler();
    const started = [];
    scheduler.enqueue(recordingJob("generate:first", started, { promise: new Promise(() => {}), resource: "generative" }));
    scheduler.enqueue(recordingJob("generate:second", started, { resource: "generative" }));
    scheduler.enqueue(recordingJob("rank:project", started, { promise: new Promise(() => {}), resource: "jev" }));
    expect(scheduler.runReady()).toBe(2);
    await flushPromises();
    expect(waitingReason(scheduler, "generate:second")).toBe("resourceBusy");
    scheduler.enqueue(recordingJob("mount:agenda", started, { category: "visibleRender", resource: "mount" }));
    expect(scheduler.runReady()).toBe(1);
    await flushPromises();
    expect(started).toEqual(["generate:first", "rank:project", "mount:agenda"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A visible render enqueued after maintenance takes the one permit first.
  it("starts the most urgent category first", async () => {
    const { scheduler } = manualScheduler({ limits: { appRead: 1 } });
    const started = [];
    scheduler.enqueue(recordingJob("read:maintenance", started, { resource: "appRead" }));
    scheduler.enqueue(recordingJob("read:refresh", started, { category: "visibleRefresh", resource: "appRead" }));
    scheduler.enqueue(recordingJob("read:visible", started, { category: "foregroundData", resource: "appRead" }));
    scheduler.runReady();
    await flushPromises();
    scheduler.runReady();
    await flushPromises();
    scheduler.runReady();
    await flushPromises();
    expect(started).toEqual(["read:visible", "read:refresh", "read:maintenance"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Each condition names its own waiting reason, and a job waits for the jobs it depends on.
  it("reports why each pending job is waiting", async () => {
    const { scheduler } = manualScheduler();
    const started = [];
    scheduler.setConditions({ loadSettled: false });
    scheduler.enqueue(recordingJob("discover:terms", started));
    scheduler.runReady();
    expect(waitingReason(scheduler, "discover:terms")).toBe("loadGate");
    expect(scheduler.snapshot().jobs[0].waitingExplanation).toMatch(/finish loading/);
    scheduler.setConditions({ hidden: true, loadSettled: true });
    scheduler.runReady();
    expect(waitingReason(scheduler, "discover:terms")).toBe("hidden");
    scheduler.setConditions({ hidden: false, overlayHeld: true });
    scheduler.enqueue(recordingJob("mount:agenda", started, { category: "visibleRender", resource: "mount" }));
    scheduler.runReady();
    expect(waitingReason(scheduler, "mount:agenda")).toBe("overlay");
    scheduler.setConditions({ overlayHeld: false });
    scheduler.enqueue({ ...recordingJob("rate:ideas", started), dependsOn: ["discover:terms"] });
    scheduler.runReady();
    expect(waitingReason(scheduler, "discover:terms")).toBe("foregroundDemand");
    await flushPromises();
    scheduler.runReady();
    expect(waitingReason(scheduler, "rate:ideas")).toBe("dependency");
    await flushPromises();
    scheduler.runReady();
    await flushPromises();
    expect(started).toEqual(["mount:agenda", "discover:terms", "rate:ideas"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A near-viewport mount waits while a visible mount cannot start.
  it("holds near-viewport renders behind waiting visible renders", async () => {
    const { scheduler } = manualScheduler();
    const started = [];
    const visibleMount = deferred();
    scheduler.enqueue(recordingJob("mount:first", started, { category: "visibleRender", promise: visibleMount.promise,
      resource: "mount" }));
    scheduler.enqueue(recordingJob("mount:second", started, { category: "visibleRender", resource: "mount" }));
    scheduler.enqueue(recordingJob("mount:below", started, { category: "nearViewportRender" }));
    scheduler.runReady();
    expect(waitingReason(scheduler, "mount:below")).toBe("foregroundDemand");
    visibleMount.resolve();
    await flushPromises();
    scheduler.runReady();
    await flushPromises();
    scheduler.runReady();
    await flushPromises();
    expect(started).toEqual(["mount:first", "mount:second", "mount:below"]);
  });
});

describe("DashboardWorkScheduler job lifecycle", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Two requests for a pending key become one job running the newer input at the more urgent category; a request
  //   for a running key runs once after it, and further requests fold into that one replacement.
  it("coalesces pending requests and keeps one replacement for a running job", async () => {
    const { scheduler } = manualScheduler();
    const inputs = [];
    const firstRun = deferred();
    const run = ({ job }) => { inputs.push(job.input); return inputs.length === 1 ? firstRun.promise : job.input; };
    const first = scheduler.enqueue({ input: "revision 1", key: "rank:project", run });
    const second = scheduler.enqueue({ category: "visibleRefresh", input: "revision 2", key: "rank:project", run });
    expect(second).toBe(first);
    expect(scheduler.snapshot().jobs[0].category).toBe("visibleRefresh");
    scheduler.runReady();
    await flushPromises();
    const replacement = scheduler.enqueue({ input: "revision 3", key: "rank:project", run });
    const folded = scheduler.enqueue({ input: "revision 4", key: "rank:project", run });
    expect(folded).toBe(replacement);
    firstRun.resolve("first result");
    await expect(first).resolves.toEqual({ result: "first result", status: "completed" });
    scheduler.runReady();
    await expect(replacement).resolves.toEqual({ result: "revision 4", status: "completed" });
    expect(inputs).toEqual(["revision 2", "revision 4"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Cancelling a running job aborts its signal and frees its permit at once; its late result is ignored, so it
  //   settles exactly once and the next job can take the permit.
  it("releases a cancelled job's permit without completing it twice", async () => {
    const { budget, diagnostics, scheduler } = manualScheduler({ limits: { generative: 1 } });
    const providerCall = deferred();
    let signal = null;
    const started = [];
    const cancelled = scheduler.enqueue({ key: "generate:first", resource: "generative",
      run: context => { signal = context.signal; return providerCall.promise; } });
    scheduler.enqueue(recordingJob("generate:second", started, { resource: "generative" }));
    scheduler.runReady();
    await flushPromises();
    expect(scheduler.cancel("generate:first")).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(budget.snapshot().resources.generative.available).toBe(1);
    await expect(cancelled).resolves.toEqual({ status: "cancelled" });
    scheduler.runReady();
    providerCall.resolve("late result");
    await flushPromises();
    expect(started).toEqual(["generate:second"]);
    const firstEvents = diagnostics.snapshot().events.filter(event => event.jobKey === "generate:first");
    expect(firstEvents.map(event => event.type)).toEqual(["enqueued", "started", "cancelled"]);
    expect(scheduler.cancel("generate:first")).toBe(false);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A thrown error fails the job, releases its permit, and is recorded for diagnostics.
  it("fails a job that throws and frees its permit", async () => {
    const { budget, diagnostics, scheduler } = manualScheduler({ limits: { generative: 1 } });
    const outcome = scheduler.enqueue({ key: "generate:ideas", resource: "generative",
      run: async () => { throw new Error("provider unavailable"); } });
    scheduler.runReady();
    await expect(outcome).resolves.toMatchObject({ status: "failed" });
    expect(budget.snapshot().resources.generative.available).toBe(1);
    expect(diagnostics.snapshot().counters.failed).toBe(1);
    expect(scheduler.snapshot().jobs).toEqual([]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A yielding job returns to the back of its category with its checkpoint, so another project advances in
  //   between, and later continues from where it stopped.
  it("lets a yielding job continue from its checkpoint after others advance", async () => {
    const { scheduler } = manualScheduler({ limits: { jev: 1 } });
    const events = [];
    const large = scheduler.enqueue({ key: "rank:large", resource: "jev", run: ({ checkpoint }) => {
      events.push(`large from ${ checkpoint ?? 0 }`);
      return checkpoint ? "done" : { checkpoint: 25, status: "yielded" };
    } });
    scheduler.enqueue({ key: "rank:small", resource: "jev", run: () => { events.push("small"); } });
    for (let pass = 0; pass < 3; pass += 1) {
      scheduler.runReady();
      await flushPromises();
    }
    await expect(large).resolves.toEqual({ result: "done", status: "completed" });
    expect(events).toEqual(["large from 0", "small", "large from 25"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A finished job is gone from the queue, so later passes never run it again unless it is enqueued again.
  it("does not rerun a completed job on later passes", async () => {
    const { scheduler } = manualScheduler();
    const started = [];
    scheduler.enqueue(recordingJob("reconcile:projects", started));
    for (let pass = 0; pass < 3; pass += 1) {
      scheduler.runReady();
      await flushPromises();
    }
    expect(started).toEqual(["reconcile:projects"]);
  });
});

describe("DashboardWorkScheduler demand and scope", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A widget needing a maintenance result promotes that job and its prerequisite past the load gate; once the
  //   widget stops asking, a job still pending returns to maintenance.
  it("runs demanded work and its prerequisites as foreground data until demand ends", async () => {
    const { scheduler } = manualScheduler();
    scheduler.setConditions({ loadSettled: false });
    const started = [];
    const reconcile = deferred();
    scheduler.enqueue(recordingJob("reconcile:projects", started, { promise: reconcile.promise }));
    scheduler.enqueue({ ...recordingJob("prepare:day", started), dependsOn: ["reconcile:projects"] });
    scheduler.enqueue(recordingJob("discover:terms", started));
    scheduler.setForegroundDemand("dream-task", ["prepare:day"]);
    scheduler.runReady();
    await flushPromises();
    expect(started).toEqual(["reconcile:projects"]);
    expect(waitingReason(scheduler, "discover:terms")).toBe("loadGate");
    const effective = scheduler.snapshot().jobs.find(job => job.key === "prepare:day").effectiveCategory;
    expect(effective).toBe("foregroundData");
    scheduler.setForegroundDemand("dream-task", []);
    const restored = scheduler.snapshot().jobs.find(job => job.key === "prepare:day").effectiveCategory;
    expect(restored).toBe("maintenance");
    expect(scheduler.promote("prepare:day", "foregroundData")).toBe(true);
    reconcile.resolve();
    await flushPromises();
    scheduler.runReady();
    await flushPromises();
    expect(started).toEqual(["reconcile:projects", "prepare:day"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Switching domains supersedes the old scope's jobs, running or pending, and leaves unscoped mounts alone.
  it("supersedes the old scope's work when the scope changes", async () => {
    const { scheduler } = manualScheduler();
    scheduler.setScope("work-domain:2026-Q3");
    const started = [];
    const running = scheduler.enqueue(recordingJob("rank:work", started, { promise: new Promise(() => {}) }));
    scheduler.runReady();
    await flushPromises();
    const pending = scheduler.enqueue(recordingJob("rank:pending", started, { resource: "generative" }));
    const mount = scheduler.enqueue({ ...recordingJob("mount:agenda", started, { category: "visibleRender" }),
      scopeKey: null });
    scheduler.setScope("home-domain:2026-Q3");
    await expect(running).resolves.toEqual({ status: "superseded" });
    await expect(pending).resolves.toEqual({ status: "superseded" });
    await expect(scheduler.enqueue({ ...recordingJob("rank:late", started), scopeKey: "work-domain:2026-Q3" }))
      .resolves.toEqual({ status: "superseded" });
    scheduler.runReady();
    await expect(mount).resolves.toMatchObject({ status: "completed" });
    expect(scheduler.snapshot()).toMatchObject({ generation: 2, scopeKey: "home-domain:2026-Q3" });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Subscribers hear once per batch of changes, and a disposed scheduler cancels its work and admits nothing.
  it("notifies subscribers once per batch and stops when disposed", async () => {
    const { scheduler } = manualScheduler();
    let notifications = 0;
    const unsubscribe = scheduler.subscribe(() => { notifications += 1; });
    const pending = scheduler.enqueue(recordingJob("discover:terms", []));
    scheduler.enqueue(recordingJob("rank:project", []));
    await flushPromises();
    expect(notifications).toBe(1);
    unsubscribe();
    scheduler.dispose();
    await expect(pending).resolves.toEqual({ status: "cancelled" });
    expect(scheduler.runReady()).toBe(0);
    await expect(scheduler.enqueue(recordingJob("late", []))).resolves.toEqual({ status: "cancelled" });
  });
});

describe("createDashboardWorkRuntime", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc The composed runtime admits work on its own, passes the app to jobs, and exports what it did.
  it("runs a job end to end without durable services", async () => {
    const app = { name: "app" };
    const runtime = createDashboardWorkRuntime({ app, clock: () => 1000 });
    runtime.scheduler.setConditions({ loadSettled: true });
    const outcome = await runtime.scheduler.enqueue({ key: "read:note", resource: "appRead",
      run: ({ context }) => context.app.name });
    expect(outcome).toEqual({ result: "app", status: "completed" });
    const exported = runtime.exportSnapshot();
    expect(exported.diagnostics.counters).toMatchObject({ completed: 1, enqueued: 1, started: 1 });
    expect(exported.scheduler.counts).toEqual({ pending: 0, running: 0 });
    runtime.dispose();
  });
});
