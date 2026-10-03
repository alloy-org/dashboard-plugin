// Exercise durable work through the Dashboard work runtime: output written before acknowledgement, an interrupted
// attempt completed by the next session without running again, a stale attempt discarding its result, retry with
// backoff, waiting for configuration, and resuming a yielded job from its saved checkpoint.
import DashboardWorkDiagnosticsStore from "dashboard/work-queue/dashboard-work-diagnostics-store";
import { workHandlerRegistry } from "dashboard/work-queue/dashboard-work-handlers";
import { CLAIM_LEASE_MILLISECONDS, RETRY_BASE_DELAY_MILLISECONDS } from "dashboard/work-queue/dashboard-work-policy";
import DashboardWorkRepository from "dashboard/work-queue/dashboard-work-repository";
import { createDashboardWorkRuntime } from "dashboard/work-queue/dashboard-work-runtime";
import { workQueueNotesApp } from "./work-queue-test-notes";

const SCOPE = "domain-1:Q4 2026";

// ----------------------------------------------------------------------------------------------
// @desc Let every pending promise callback and note write finish.
// @returns {Promise<void>}
function settle() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

// ----------------------------------------------------------------------------------------------
// @desc A runtime with durable work over a shared notes app and clock, admitting maintenance at once.
// @param {object} options - { app, clockState, handlers }.
// @returns {object} { diagnosticsStore, repository, runtime, timers }: timers holds the retry timers it set.
function durableRuntime({ app, clockState, handlers }) {
  const clock = () => clockState.now;
  const timers = [];
  const setTimer = (callback, delay) => {
    timers.push({ callback, delay });
    return timers.length;
  };
  const repository = new DashboardWorkRepository({ app, clock });
  const diagnosticsStore = new DashboardWorkDiagnosticsStore({ app, clearTimer: () => {}, clock, setTimer: () => 0 });
  const runtime = createDashboardWorkRuntime({ clearTimer: () => {}, clock, diagnosticsStore, handlers: workHandlerRegistry(handlers),
    repository, setTimer });
  runtime.scheduler.setScope(SCOPE);
  runtime.scheduler.setConditions({ loadSettled: true });
  return { diagnosticsStore, repository, runtime, timers };
}

// ----------------------------------------------------------------------------------------------
// @desc A handler whose output store is a map of job key to revision, recording each step it takes.
// @param {object} [options] - { applyGate, runGate }: promises the apply or run step waits on.
// @returns {object} { handler, outputs, steps }.
function recordingHandler({ applyGate = null, runGate = null } = {}) {
  const outputs = new Map();
  const steps = [];
  const handler = {
    appliedRevision: async ({ job }) => outputs.get(job.key) ?? null,
    applyResult: async ({ job, result }) => {
      outputs.set(job.key, result.revision);
      steps.push(`apply ${ result.revision }`);
      if (applyGate) await applyGate;
    },
    run: async ({ job }) => {
      steps.push(`run ${ job.desiredRevision }`);
      if (runGate) await runGate();
      return { revision: job.desiredRevision };
    },
    type: "rank",
  };
  return { handler, outputs, steps };
}

describe("DurableWorkRunner acknowledgement", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A session that wrote its output and stopped before acknowledging leaves the job claimed; once the claim
  //   lapses, the next session sees the output already reflects the revision and completes without running again.
  it("completes an attempt interrupted after its output was written without running it again", async () => {
    const app = workQueueNotesApp();
    const clockState = { now: 1_000_000 };
    const neverSettles = new Promise(() => {});
    const first = recordingHandler({ applyGate: neverSettles });
    const firstSession = durableRuntime({ app, clockState, handlers: [first.handler] });
    await firstSession.runtime.durable.submit({ desiredRevision: "r1", key: "rank:p", type: "rank" });
    await settle();
    expect(first.steps).toEqual(["run r1", "apply r1"]);
    expect((await firstSession.repository.readAll(SCOPE)).jobs[0].status).toBe("running");

    clockState.now += CLAIM_LEASE_MILLISECONDS + 1;
    const second = recordingHandler();
    second.outputs.set("rank:p", "r1");
    const secondSession = durableRuntime({ app, clockState, handlers: [second.handler] });
    await expect(secondSession.runtime.durable.recover(SCOPE)).resolves.toBe(1);
    await settle();
    expect(second.steps).toEqual([]);
    const [job] = (await secondSession.repository.readAll(SCOPE)).jobs;
    expect(job).toMatchObject({ status: "completed", succeededRevision: "r1" });
    const history = await secondSession.diagnosticsStore.readHistory(SCOPE);
    expect(history.records[0]).toMatchObject({ jobKey: "rank:p", recovered: true, status: "completed" });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc An attempt whose claim lapsed while it ran, and was taken by another session, discards its result.
  it("discards a stale attempt's result", async () => {
    const app = workQueueNotesApp();
    const clockState = { now: 1_000_000 };
    let releaseFirstRun = null;
    const firstRunGate = new Promise(resolve => { releaseFirstRun = resolve; });
    const first = recordingHandler({ runGate: () => firstRunGate });
    const firstSession = durableRuntime({ app, clockState, handlers: [first.handler] });
    await firstSession.runtime.durable.submit({ desiredRevision: "r1", key: "rank:p", type: "rank" });
    await settle();
    clockState.now += CLAIM_LEASE_MILLISECONDS + 1;
    const second = recordingHandler();
    const secondSession = durableRuntime({ app, clockState, handlers: [second.handler] });
    await secondSession.runtime.durable.recover(SCOPE);
    await settle();
    expect(second.steps).toEqual(["run r1", "apply r1"]);
    releaseFirstRun();
    await settle();
    expect(first.steps).toEqual(["run r1"]);
    const [job] = (await secondSession.repository.readAll(SCOPE)).jobs;
    expect(job).toMatchObject({ attempt: 2, status: "completed" });
  });
});

describe("DurableWorkRunner failures and checkpoints", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A transient failure waits a jittered backoff before retrying; a missing setting waits for a settings change.
  it("retries with backoff and waits for configuration", async () => {
    const app = workQueueNotesApp();
    const clockState = { now: 1_000_000 };
    let rankRuns = 0;
    let keyConfigured = false;
    const handlers = [
      { run: async () => { rankRuns += 1; if (rankRuns === 1) throw new Error("Provider timed out"); return { revision: "r1" }; }, type: "rank" },
      { run: async () => {
        if (!keyConfigured) throw Object.assign(new Error("No provider key"), { workFailure: "configuration" });
        return { revision: "r1" };
      }, type: "ideas" },
    ];
    const { repository, runtime, timers } = durableRuntime({ app, clockState, handlers });
    await runtime.durable.submit({ desiredRevision: "r1", key: "rank:p", type: "rank" });
    await runtime.durable.submit({ desiredRevision: "r1", key: "ideas:p", type: "ideas" });
    await settle();
    const statuses = async () => Object.fromEntries((await repository.readAll(SCOPE)).jobs.map(job => [job.key, job.status]));
    expect(await statuses()).toEqual({ "ideas:p": "blockedConfiguration", "rank:p": "retryWaiting" });
    expect(timers).toHaveLength(1);
    expect(timers[0].delay).toBeGreaterThanOrEqual(RETRY_BASE_DELAY_MILLISECONDS / 2);
    expect(timers[0].delay).toBeLessThanOrEqual(RETRY_BASE_DELAY_MILLISECONDS);
    clockState.now += timers[0].delay;
    timers[0].callback();
    keyConfigured = true;
    await runtime.durable.configurationChanged(SCOPE);
    await settle();
    expect(await statuses()).toEqual({ "ideas:p": "completed", "rank:p": "completed" });
    const history = await runtime.diagnosticsStore.readHistory(SCOPE);
    const outcomes = history.records.map(record => [record.jobKey, record.status, record.failureClassification || null]);
    expect(outcomes).toEqual(expect.arrayContaining([["rank:p", "retryWaiting", "transient"],
      ["ideas:p", "blockedConfiguration", "configuration"], ["rank:p", "completed", null], ["ideas:p", "completed", null]]));
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A yielded job saves its checkpoint durably and resumes from it, in the same attempt.
  it("resumes a yielded job from its saved checkpoint", async () => {
    const app = workQueueNotesApp();
    const clockState = { now: 1_000_000 };
    const cursorsSeen = [];
    const handler = { run: async ({ job }) => {
      cursorsSeen.push(job.cursor);
      const batch = (job.cursor?.batch || 0) + 1;
      return batch < 3 ? { checkpoint: { batch }, status: "yielded" } : { revision: "r1" };
    }, type: "rank" };
    const { repository, runtime } = durableRuntime({ app, clockState, handlers: [handler] });
    await runtime.durable.submit({ desiredRevision: "r1", key: "rank:p", type: "rank" });
    await settle();
    await settle();
    expect(cursorsSeen).toEqual([null, { batch: 1 }, { batch: 2 }]);
    const [job] = (await repository.readAll(SCOPE)).jobs;
    expect(job).toMatchObject({ attempt: 1, cursor: null, status: "completed" });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A runtime given no repository has no durable runner, and a request for an unregistered type is refused.
  it("runs durable work only with a repository and registered handlers", async () => {
    expect(createDashboardWorkRuntime().durable).toBeNull();
    const { runtime } = durableRuntime({ app: workQueueNotesApp(), clockState: { now: 0 }, handlers: [] });
    await expect(runtime.durable.submit({ key: "x", type: "unknown" })).rejects.toThrow("No work handler");
  });
});
