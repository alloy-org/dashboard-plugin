// Verify Builder quarter scopes share one scheduler and provider budget without sharing durable jobs or claims.
import { jest } from "@jest/globals";
import { workHandlerRegistry } from "dashboard/work-queue/dashboard-work-handlers";
import DashboardWorkRepository from "dashboard/work-queue/dashboard-work-repository";
import { createDashboardWorkRuntime } from "dashboard/work-queue/dashboard-work-runtime";
import { flushPromises, workQueueNotesApp } from "./work-queue-test-notes";

const DASHBOARD_SCOPE = "work:Q4 2026";
const BUILDER_SCOPE = "work:Q1 2027";

// ----------------------------------------------------------------------------------------------
// @desc Hold one operation until the test releases it.
// @returns {object} { promise, resolve }.
function deferred() {
  let resolve;
  const promise = new Promise(release => { resolve = release; });
  return { promise, resolve };
}

// ----------------------------------------------------------------------------------------------
// @desc Create a durable runtime over isolated notes, with optional controlled retry timers.
// @param {Array<object>} handlers - Handlers to register.
// @param {object} options - Runtime overrides such as clock or setTimer.
// @returns {object} The runtime, including its repository and scheduler.
function scopedRuntime(handlers, options = {}) {
  const app = workQueueNotesApp();
  const repository = new DashboardWorkRepository({ app, clock: options.clock });
  const runtime = createDashboardWorkRuntime({ app, handlers: workHandlerRegistry(handlers), repository, ...options });
  runtime.scheduler.setScope(DASHBOARD_SCOPE);
  runtime.scheduler.setConditions({ loadSettled: true });
  return runtime;
}

// ----------------------------------------------------------------------------------------------
// @desc Drain the note writer chains as well as queued admissions without advancing a real timer.
// @returns {Promise<void>}
async function settleWork() {
  for (let round = 0; round < 10; round += 1) await flushPromises();
}

describe("Dashboard and Builder work scopes", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Same-named jobs in two scopes have separate attempts and follow-ups while nested requests obey one limit.
  it("isolates identical durable keys and follow-ups while sharing provider permits", async () => {
    const gate = deferred();
    const started = [];
    const followUps = [];
    const handler = { run: async ({ context, job, signal }) => {
      await context.providerDispatch.jev(async () => {
        started.push(job.scopeKey);
        if (job.scopeKey === DASHBOARD_SCOPE) await gate.promise;
      }, { background: false, signal });
      return { followUps: [{ key: "follow:shared", type: "follow" }], revision: job.scopeKey };
    }, type: "rank" };
    const runtime = scopedRuntime([handler, { run: async ({ job }) => { followUps.push(job.scopeKey); }, type: "follow" }],
      { limits: { jev: 1 } });
    const release = runtime.scheduler.retainScope(BUILDER_SCOPE);
    await runtime.durable.submit({ category: "foregroundData", key: "rank:shared", scopeKey: DASHBOARD_SCOPE, type: "rank" });
    await settleWork();
    await runtime.durable.submit({ category: "foregroundData", key: "rank:shared", scopeKey: BUILDER_SCOPE, type: "rank" });
    await settleWork();
    expect(started).toEqual([DASHBOARD_SCOPE]);
    expect(runtime.durable.snapshot().claimedKeys).toHaveLength(2);
    expect(runtime.budget.snapshot().resources.jev.foreground).toBe(1);
    gate.resolve();
    await settleWork();
    expect(started).toEqual([DASHBOARD_SCOPE, BUILDER_SCOPE]);
    expect(followUps.sort()).toEqual([DASHBOARD_SCOPE, BUILDER_SCOPE].sort());
    for (const scopeKey of [DASHBOARD_SCOPE, BUILDER_SCOPE]) {
      const { jobs } = await runtime.repository.readAll(scopeKey);
      expect(jobs.find(job => job.key === "rank:shared")).toMatchObject({ status: "completed", succeededRevision: scopeKey });
      expect(jobs.find(job => job.key === "follow:shared")).toMatchObject({ scopeKey, status: "completed" });
    }
    release();
    runtime.dispose();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Closing an extra scope releases only its claims; reopening resumes its saved job without rerunning the
  //   Dashboard's matching key. A late result from the cancelled attempt must not release the new attempt's claim.
  it("releases and recovers Builder work independently of the Dashboard", async () => {
    const firstGate = deferred();
    const resumedGate = deferred();
    let builderRuns = 0;
    const handler = { run: async ({ job }) => {
      if (job.scopeKey === BUILDER_SCOPE) {
        builderRuns += 1;
        await (builderRuns === 1 ? firstGate.promise : resumedGate.promise);
      }
      return { revision: "ranked" };
    }, type: "rank" };
    const runtime = scopedRuntime([handler]);
    const release = runtime.scheduler.retainScope(BUILDER_SCOPE);
    for (const scopeKey of [DASHBOARD_SCOPE, BUILDER_SCOPE]) {
      await runtime.durable.submit({ category: "foregroundData", key: "rank:shared", scopeKey, type: "rank" });
    }
    await settleWork();
    release();
    await settleWork();
    expect((await runtime.repository.readAll(DASHBOARD_SCOPE)).jobs[0].status).toBe("completed");
    expect((await runtime.repository.readAll(BUILDER_SCOPE)).jobs[0].status).toBe("pending");
    await expect(runtime.durable.recover(BUILDER_SCOPE)).resolves.toBe(0);
    const releaseReopened = runtime.scheduler.retainScope(BUILDER_SCOPE);
    await runtime.durable.recover(BUILDER_SCOPE);
    await settleWork();
    expect(builderRuns).toBe(2);
    firstGate.resolve();
    await settleWork();
    expect(runtime.durable.snapshot().claimedKeys).toHaveLength(1);
    resumedGate.resolve();
    await settleWork();
    expect((await runtime.repository.readAll(BUILDER_SCOPE)).jobs[0].status).toBe("completed");
    releaseReopened();
    runtime.dispose();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Retry timers for the same key in two scopes both survive, and recovering an already queued job cannot
  //   replace its running attempt.
  it("keeps independent retries and avoids duplicate recovery admissions", async () => {
    const timers = [];
    let now = 1_000_000;
    const gate = deferred();
    const runs = new Map();
    const handler = { run: async ({ job }) => {
      const count = (runs.get(job.scopeKey) || 0) + 1;
      runs.set(job.scopeKey, count);
      if (count === 1) throw new Error("Retry this scope");
      await gate.promise;
      return { revision: "retried" };
    }, type: "rank" };
    const runtime = scopedRuntime([handler], { clearTimer: () => {}, clock: () => now,
      setTimer: callback => { timers.push(callback); return timers.length; } });
    const release = runtime.scheduler.retainScope(BUILDER_SCOPE);
    for (const scopeKey of [DASHBOARD_SCOPE, BUILDER_SCOPE]) {
      await runtime.durable.submit({ category: "foregroundData", key: "rank:shared", scopeKey, type: "rank" });
    }
    await settleWork();
    expect(runtime.durable.snapshot().retryKeys).toHaveLength(2);
    now += 60_000;
    for (const fire of timers) fire();
    await settleWork();
    await expect(runtime.durable.recover(BUILDER_SCOPE)).resolves.toBe(0);
    expect(runtime.scheduler.jobsByKey.get(runtime.durable.schedulerKey("rank:shared", BUILDER_SCOPE)).replacement).toBeNull();
    gate.resolve();
    await settleWork();
    expect([...runs.values()]).toEqual([2, 2]);
    release();
    runtime.dispose();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Multiple mounted owners may retain a quarter, but a Dashboard domain change invalidates all registrations
  //   and cancels running work. Old cleanup callbacks cannot revoke a newly retained scope.
  it("invalidates retained scopes on a Dashboard scope change", async () => {
    const runtime = scopedRuntime([]);
    const firstRelease = runtime.scheduler.retainScope(BUILDER_SCOPE);
    const secondRelease = runtime.scheduler.retainScope(BUILDER_SCOPE);
    const run = jest.fn(() => new Promise(() => {}));
    const outcome = runtime.scheduler.enqueue({ category: "foregroundData", key: "builder", run, scopeKey: BUILDER_SCOPE, type: "rank" });
    await flushPromises();
    firstRelease();
    expect(runtime.scheduler.acceptsScope(BUILDER_SCOPE)).toBe(true);
    runtime.scheduler.setScope("home:Q4 2026");
    await expect(outcome).resolves.toEqual({ status: "superseded" });
    expect(runtime.scheduler.acceptsScope(BUILDER_SCOPE)).toBe(false);
    const newRelease = runtime.scheduler.retainScope(BUILDER_SCOPE);
    secondRelease();
    expect(runtime.scheduler.acceptsScope(BUILDER_SCOPE)).toBe(true);
    newRelease();
    runtime.dispose();
  });
});
