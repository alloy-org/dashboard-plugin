// Exercise DashboardWorkRepository and DashboardWorkJob: versioned persistence in an archived queue note, coalescing
// requests, stale-attempt rejection, checkpoints that survive an expired claim, retry and configuration states, the
// records and notes a newer version wrote, and bounded retention of finished jobs.
import { workQueueNotesApp } from "./work-queue-test-notes";
import DashboardWorkJob, { WORK_JOB_SCHEMA_VERSION } from "dashboard/work-queue/dashboard-work-job";
import { WORK_QUEUE_SCHEMA_VERSION, workQueueNotePayload } from "dashboard/work-queue/dashboard-work-note";
import { CLAIM_LEASE_MILLISECONDS, MAXIMUM_JOB_ATTEMPTS } from "dashboard/work-queue/dashboard-work-policy";
import DashboardWorkRepository, { TERMINAL_RECORD_LIMIT, TERMINAL_RECORD_RETENTION_MILLISECONDS,
  workQueueNoteName } from "dashboard/work-queue/dashboard-work-repository";

const SCOPE = "domain-1:Q4 2026";

// ----------------------------------------------------------------------------------------------
// @desc A repository over a fresh notes app, with a clock the test moves.
// @returns {object} { app, repository, setNow }.
function repositoryHarness() {
  const app = workQueueNotesApp();
  let now = 1_000_000;
  const repository = new DashboardWorkRepository({ app, clock: () => now });
  return { app, repository, setNow: value => { now = value; } };
}

// ----------------------------------------------------------------------------------------------
// @desc The parsed JSON payload of a scope's queue note.
// @param {object} app - From workQueueNotesApp.
// @returns {object} The payload.
function queuePayload(app) {
  const content = app.noteContent(workQueueNoteName(SCOPE));
  return workQueueNotePayload(content).payload;
}

describe("DashboardWorkRepository persistence", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A saved job lands in an archived, versioned queue note, and a second request for its key coalesces.
  it("saves versioned records in an archived note and coalesces requests by key", async () => {
    const { app, repository } = repositoryHarness();
    const request = { desiredRevision: "r1", entityId: "project-1", input: { projectUuid: "project-1" }, key: "rank:project-1", type: "rank" };
    await expect(repository.saveJob(SCOPE, request)).resolves.toMatchObject({ runnable: true });
    await repository.saveJob(SCOPE, { ...request, desiredRevision: "r2" });
    const note = [...app.notes.values()][0];
    expect(note).toMatchObject({ archived: true, name: workQueueNoteName(SCOPE) });
    const payload = queuePayload(app);
    expect(payload).toMatchObject({ schemaVersion: WORK_QUEUE_SCHEMA_VERSION, scopeKey: SCOPE });
    expect(payload.jobs).toHaveLength(1);
    expect(payload.jobs[0]).toMatchObject({ desiredRevision: "r2", schemaVersion: WORK_JOB_SCHEMA_VERSION, status: "pending" });
    const pending = await repository.readPending(SCOPE);
    expect(pending.map(job => job.key)).toEqual(["rank:project-1"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Inputs carrying callbacks or class instances are refused, keeping executable code out of the queue.
  it("refuses inputs that are not plain JSON", async () => {
    const { repository } = repositoryHarness();
    await expect(repository.saveJob(SCOPE, { input: { run: () => {} }, key: "a", type: "rank" })).rejects.toThrow("plain JSON");
    await expect(repository.saveJob(SCOPE, { input: { when: new Date() }, key: "b", type: "rank" })).rejects.toThrow("plain JSON");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Reading or recovering a scope with no queue note creates nothing.
  it("creates no note until it has a job to hold", async () => {
    const { app, repository } = repositoryHarness();
    await expect(repository.readAll(SCOPE)).resolves.toMatchObject({ jobs: [], writable: true });
    await repository.recoverExpired(SCOPE);
    expect(app.notes.size).toBe(0);
  });
});

describe("DashboardWorkRepository attempts", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc An attempt whose claim lapsed and was taken by another session can no longer checkpoint, complete, or fail.
  it("rejects a stale attempt after another session takes over", async () => {
    const { repository, setNow } = repositoryHarness();
    await repository.saveJob(SCOPE, { desiredRevision: "r1", key: "rank:p", type: "rank" });
    await expect(repository.claim(SCOPE, "rank:p", { ownerId: "first", token: "first:1" })).resolves.toMatchObject({ attempt: 1 });
    await expect(repository.claim(SCOPE, "rank:p", { ownerId: "second", token: "second:1" })).resolves.toBeNull();
    await repository.checkpoint(SCOPE, "rank:p", "first:1", { batch: 2 });
    setNow(1_000_000 + CLAIM_LEASE_MILLISECONDS + 1);
    const recovered = await repository.recoverExpired(SCOPE);
    expect(recovered.map(job => [job.status, job.cursor])).toEqual([["pending", { batch: 2 }]]);
    await expect(repository.claim(SCOPE, "rank:p", { ownerId: "second", token: "second:1" })).resolves.toMatchObject({ attempt: 2,
      cursor: { batch: 2 } });
    await expect(repository.checkpoint(SCOPE, "rank:p", "first:1", { batch: 3 })).resolves.toBeNull();
    await expect(repository.complete(SCOPE, "rank:p", "first:1", { revision: "r1" })).resolves.toBeNull();
    await expect(repository.fail(SCOPE, "rank:p", "first:1", { classification: "transient", message: "x", retryAt: 0 })).resolves.toBeNull();
    await expect(repository.complete(SCOPE, "rank:p", "second:1", { revision: "r1" })).resolves.toMatchObject({ status: "completed",
      succeededRevision: "r1" });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc New inputs during an attempt make the job run once more; the same inputs after completion do not.
  it("keeps one replacement for a job whose inputs change while it runs", async () => {
    const { repository } = repositoryHarness();
    await repository.saveJob(SCOPE, { desiredRevision: "r1", key: "rank:p", type: "rank" });
    await repository.claim(SCOPE, "rank:p", { ownerId: "me", token: "me:1" });
    await expect(repository.saveJob(SCOPE, { desiredRevision: "r2", key: "rank:p", type: "rank" })).resolves.toMatchObject({ runnable: true });
    const completed = await repository.complete(SCOPE, "rank:p", "me:1", { revision: "r1" });
    expect(completed).toMatchObject({ attempt: 0, desiredRevision: "r2", status: "pending", succeededRevision: "r1" });
    await repository.claim(SCOPE, "rank:p", { ownerId: "me", token: "me:2" });
    await repository.complete(SCOPE, "rank:p", "me:2", { revision: "r2" });
    await expect(repository.saveJob(SCOPE, { desiredRevision: "r2", key: "rank:p", type: "rank" })).resolves.toMatchObject({ runnable: false });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Transient failures wait to retry, missing configuration waits for a settings change, and the attempt limit
  //   leaves a job failed until its inputs change.
  it("moves failures to retry, configuration, and failed states", async () => {
    const { repository, setNow } = repositoryHarness();
    await repository.saveJob(SCOPE, { desiredRevision: "r1", key: "a", type: "rank" });
    await repository.claim(SCOPE, "a", { ownerId: "me", token: "t1" });
    await repository.fail(SCOPE, "a", "t1", { classification: "transient", message: "timeout", retryAt: 1_060_000 });
    expect(await repository.readPending(SCOPE)).toEqual([]);
    setNow(1_060_000);
    expect((await repository.readPending(SCOPE)).map(job => job.status)).toEqual(["retryWaiting"]);
    await repository.saveJob(SCOPE, { desiredRevision: "r1", key: "b", type: "rank" });
    await repository.claim(SCOPE, "b", { ownerId: "me", token: "t2" });
    await repository.fail(SCOPE, "b", "t2", { classification: "configuration", message: "no key", retryAt: 0 });
    await expect(repository.resumeAfterConfiguration(SCOPE)).resolves.toBe(1);
    const job = DashboardWorkJob.create({ desiredRevision: "r1", key: "c", type: "rank" }, 0);
    for (let attempt = 1; attempt <= MAXIMUM_JOB_ATTEMPTS; attempt += 1) {
      job.claim({ now: attempt * 1000, ownerId: "me", token: `c${ attempt }` });
      job.fail(`c${ attempt }`, { classification: "transient", message: "x", now: attempt * 1000, retryAt: 0 });
    }
    expect(job.status).toBe("failed");
    expect(job.request({ desiredRevision: "r1" }, 9000)).toBe(false);
    expect(job.request({ desiredRevision: "r2" }, 9000)).toBe(true);
    expect(job).toMatchObject({ attempt: 0, status: "pending" });
  });
});

describe("DashboardWorkRepository versions and retention", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A record a later version wrote is kept untouched beside this version's records, and never run.
  it("preserves records it cannot read", async () => {
    const { app, repository } = repositoryHarness();
    await repository.saveJob(SCOPE, { key: "mine", type: "rank" });
    const payload = queuePayload(app);
    payload.schemaVersion = 1;
    payload.jobs.push({ futureField: true, key: "future", schemaVersion: WORK_JOB_SCHEMA_VERSION + 1, type: "rank" });
    const [uuid] = app.notes.keys();
    app.notes.get(uuid).content = `# Queue\n\n\`\`\`json\n${ JSON.stringify(payload) }\n\`\`\`\n`;
    await expect(repository.readAll(SCOPE)).resolves.toMatchObject({ unreadableRecords: 1 });
    await repository.saveJob(SCOPE, { key: "another", type: "rank" });
    const written = queuePayload(app);
    expect(written.jobs.map(job => job.key).sort()).toEqual(["another", "future", "mine"]);
    expect(written.jobs.find(job => job.key === "future")).toEqual({ futureField: true, key: "future", schemaVersion: WORK_JOB_SCHEMA_VERSION + 1, type: "rank" });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A queue note a later version wrote is read but never rewritten.
  it("refuses to rewrite a note from a newer version", async () => {
    const { app, repository } = repositoryHarness();
    await repository.saveJob(SCOPE, { key: "mine", type: "rank" });
    const [uuid] = app.notes.keys();
    const newerContent = `# Queue\n\n\`\`\`json\n${ JSON.stringify({ jobs: [], schemaVersion: 99 }) }\n\`\`\`\n`;
    app.notes.get(uuid).content = newerContent;
    await expect(repository.readAll(SCOPE)).resolves.toMatchObject({ writable: false });
    await expect(repository.saveJob(SCOPE, { key: "another", type: "rank" })).rejects.toThrow("newer version");
    expect(app.notes.get(uuid).content).toBe(newerContent);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Finished jobs are pruned after the retention period, and beyond the newest TERMINAL_RECORD_LIMIT.
  it("bounds the finished jobs it keeps", async () => {
    const { app, repository, setNow } = repositoryHarness();
    for (let index = 0; index < TERMINAL_RECORD_LIMIT + 5; index += 1) {
      setNow(1_000_000 + index);
      await repository.saveJob(SCOPE, { desiredRevision: "r", key: `job-${ index }`, type: "rank" });
      await repository.claim(SCOPE, `job-${ index }`, { ownerId: "me", token: `t${ index }` });
      await repository.complete(SCOPE, `job-${ index }`, `t${ index }`, { revision: "r" });
    }
    await repository.saveJob(SCOPE, { key: "open", type: "rank" });
    expect(queuePayload(app).jobs).toHaveLength(TERMINAL_RECORD_LIMIT + 1);
    setNow(1_000_000 + TERMINAL_RECORD_RETENTION_MILLISECONDS + 1000);
    await repository.saveJob(SCOPE, { key: "open", type: "rank", desiredRevision: "r2" });
    expect(queuePayload(app).jobs.map(job => job.key)).toEqual(["open"]);
  });
});
