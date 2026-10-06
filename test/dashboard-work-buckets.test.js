// Verify fixed queue buckets, legacy migration, and independent clients applying narrow updates to current note content.
import { workQueueNotesApp } from "./work-queue-test-notes";
import { jest } from "@jest/globals";
import { readJsonNote } from "dashboard/work-queue/dashboard-json-note";
import { workQueueBucketIndex, WORK_QUEUE_BUCKET_COUNT, WORK_QUEUE_SCHEMA_VERSION, workQueueNoteMarkdown, workQueueNotePayload } from "dashboard/work-queue/dashboard-work-note";
import DashboardWorkRepository, { TERMINAL_RECORD_RETENTION_MILLISECONDS, workQueueNoteName } from "dashboard/work-queue/dashboard-work-repository";
import { guideHeadingRanges } from "plan-wizard/vision-guide-markdown";

const SCOPE = "work:Q4 2026";

// ----------------------------------------------------------------------------------------------
// @desc Create independent app interfaces over one shared notebook, with an optional interposed content read.
// @param {object} base - Shared file-free notebook app.
// @param {function|null} beforeRead - Called before each read, allowing another client to update between reads.
// @returns {object} Independent app interface and inspected section-write calls.
function clientApp(base, beforeRead = null) {
  let reads = 0;
  const app = { ...base, replaceNoteContent: jest.fn(base.replaceNoteContent) };
  // ----------------------------------------------------------------------------------------------
  // @desc Interpose a remote write before returning the current note content to this client.
  // @param {object} handle - Note UUID.
  // @returns {Promise<string>} Current markdown.
  app.getNoteContent = async handle => {
    reads += 1;
    await beforeRead?.(reads);
    return base.getNoteContent(handle);
  };
  return app;
}

// ----------------------------------------------------------------------------------------------
// @desc Find two keys routed to the same bucket and one routed elsewhere without relying on one hash output.
// @returns {object} Keys for a collision and an independent bucket.
function exampleKeys() {
  const first = "rank:project-0";
  const keys = Array.from({ length: 100 }, (unused, index) => `rank:project-${ index + 1 }`);
  const same = keys.find(key => workQueueBucketIndex(key) === workQueueBucketIndex(first));
  const different = keys.find(key => workQueueBucketIndex(key) !== workQueueBucketIndex(first));
  return { different, first, same };
}

// ----------------------------------------------------------------------------------------------
// @desc Read a unified payload from the test notebook.
// @param {object} app - Shared notebook.
// @returns {object} Decoded metadata and all bucket records.
function payloadFromApp(app) {
  return workQueueNotePayload(app.noteContent(workQueueNoteName(SCOPE))).payload;
}

// ----------------------------------------------------------------------------------------------
// @desc A rejected section write rejects its caller, leaves data unchanged, and permits the next retry.
// @returns {Promise<void>}
async function verifyCheckedFailures() {
  const base = workQueueNotesApp();
  const app = clientApp(base);
  const repository = new DashboardWorkRepository({ app, clock: () => 1000 });
  await repository.saveJob(SCOPE, { key: "rank:p", type: "rank" });
  const before = base.noteContent(workQueueNoteName(SCOPE));
  app.replaceNoteContent.mockResolvedValueOnce(false);
  await expect(repository.claim(SCOPE, "rank:p", { ownerId: "me", token: "me:1" })).rejects.toThrow("replacement failed");
  expect(base.noteContent(workQueueNoteName(SCOPE))).toBe(before);
  await expect(repository.claim(SCOPE, "rank:p", { ownerId: "me", token: "me:2" })).resolves.toMatchObject({ attemptToken: "me:2" });
}

// ----------------------------------------------------------------------------------------------
// @desc Two repositories updating different buckets can read concurrently and retain both clients' claims.
// @returns {Promise<void>}
async function verifyConcurrentBuckets() {
  const base = workQueueNotesApp();
  const keys = exampleKeys();
  const seed = new DashboardWorkRepository({ app: base, clock: () => 1000 });
  await seed.saveJobs(SCOPE, [{ key: keys.first, type: "rank" }, { key: keys.different, type: "rank" }]);
  let arrived = 0;
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  // ----------------------------------------------------------------------------------------------
  // @desc Hold both initial reads until each independent client has begun its transition.
  // @param {number} reads - This client's content read count.
  // @returns {Promise<void>} Resolves when both clients are reading.
  const beforeRead = async reads => {
    if (reads !== 1) return;
    arrived += 1;
    if (arrived === 2) release();
    await barrier;
  };
  const firstApp = clientApp(base, beforeRead);
  const secondApp = clientApp(base, beforeRead);
  const first = new DashboardWorkRepository({ app: firstApp, clock: () => 2000 });
  const second = new DashboardWorkRepository({ app: secondApp, clock: () => 2000 });
  await Promise.all([first.claim(SCOPE, keys.first, { ownerId: "first", token: "first:1" }),
    second.claim(SCOPE, keys.different, { ownerId: "second", token: "second:1" })]);
  const records = payloadFromApp(base).jobs;
  expect(records.find(record => record.key === keys.first).attemptToken).toBe("first:1");
  expect(records.find(record => record.key === keys.different).attemptToken).toBe("second:1");
  const calls = [...firstApp.replaceNoteContent.mock.calls, ...secondApp.replaceNoteContent.mock.calls];
  expect(calls).toHaveLength(2);
  expect(new Set(calls.map(call => call[2].section.heading.text)).size).toBe(2);
}

// ----------------------------------------------------------------------------------------------
// @desc Invalid or ambiguous bucket layouts are never converted into an empty queue or overwritten.
// @returns {Promise<void>}
async function verifyDamagedBuckets() {
  const base = workQueueNotesApp();
  const repository = new DashboardWorkRepository({ app: base });
  await repository.saveJob(SCOPE, { key: "rank:p", type: "rank" });
  const [note] = base.notes.values();
  const original = note.content;
  for (const damaged of [original.replace("## Queue bucket 01", "## Renamed bucket"),
    `${ original }\n## Queue bucket 01\n\n\`\`\`json\n{\"jobs\":[]}\n\`\`\`\n`,
    original.replace('"jobs": []', '"jobs": {')]) {
    note.content = damaged;
    await expect(repository.saveJob(SCOPE, { key: "another", type: "rank" })).rejects.toThrow();
    expect(note.content).toBe(damaged);
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Fixed buckets contain multiline job fields and keep a key in the same section across state changes.
// @returns {Promise<void>}
async function verifyFixedLayout() {
  const app = clientApp(workQueueNotesApp());
  const repository = new DashboardWorkRepository({ app, clock: () => 1000 });
  await repository.saveJob(SCOPE, { input: { text: "A ```json example\n# not a section" }, key: "rank:p", type: "rank" });
  const content = app.noteContent(workQueueNoteName(SCOPE));
  const headings = guideHeadingRanges(content).filter(heading => heading.text.startsWith("Queue bucket "));
  expect(headings).toHaveLength(WORK_QUEUE_BUCKET_COUNT);
  expect(content).toMatch(/\n\s+"key": "rank:p",\n/);
  expect(payloadFromApp(app)).toMatchObject({ bucketCount: WORK_QUEUE_BUCKET_COUNT, schemaVersion: WORK_QUEUE_SCHEMA_VERSION });
  const originalBucket = workQueueBucketIndex("rank:p");
  app.replaceNoteContent.mockClear();
  await repository.claim(SCOPE, "rank:p", { ownerId: "me", token: "me:1" });
  await repository.checkpoint(SCOPE, "rank:p", "me:1", { batch: 2 });
  const sections = app.replaceNoteContent.mock.calls.map(call => call[2].section.heading.text);
  expect(new Set(sections).size).toBe(1);
  expect(workQueueBucketIndex(payloadFromApp(app).jobs[0].key)).toBe(originalBucket);
  const records = [{ key: "rank:a", type: "rank" }, { key: "rank:A", type: "rank" }];
  const ordered = workQueueNoteMarkdown({ description: "", records, scopeKey: SCOPE });
  expect(workQueueNotePayload(ordered).payload.jobs.map(record => record.key)).toEqual(["rank:A", "rank:a"]);
}

// ----------------------------------------------------------------------------------------------
// @desc Updating bucket sections permits a large aggregate note while keeping each individual write below the API limit.
// @returns {Promise<void>}
async function verifyLargeQueue() {
  const app = clientApp(workQueueNotesApp());
  const repository = new DashboardWorkRepository({ app, clock: () => 1000 });
  await repository.saveJob(SCOPE, { key: "seed", type: "rank" });
  app.replaceNoteContent.mockClear();
  const requests = Array.from({ length: 64 }, (unused, index) => ({ input: { evidence: "x".repeat(1800) },
    key: `rank:project-${ index }`, type: "rank" }));
  await repository.saveJobs(SCOPE, requests);
  expect(app.noteContent(workQueueNoteName(SCOPE)).length).toBeGreaterThan(100000);
  expect(payloadFromApp(app).jobs).toHaveLength(65);
  for (const call of app.replaceNoteContent.mock.calls) {
    expect(call[2].section).toBeDefined();
    expect(call[1].length).toBeLessThanOrEqual(100000);
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Migrating a compact legacy note preserves running attempt metadata and future records, and old writers see version two.
// @returns {Promise<void>}
async function verifyLegacyMigration() {
  const base = workQueueNotesApp();
  const seed = new DashboardWorkRepository({ app: base, clock: () => 1000 });
  await seed.saveJob(SCOPE, { desiredRevision: "r1", key: "rank:p", type: "rank" });
  await seed.claim(SCOPE, "rank:p", { ownerId: "old", token: "old:1" });
  await seed.checkpoint(SCOPE, "rank:p", "old:1", { batch: 3 });
  const payload = payloadFromApp(base);
  payload.schemaVersion = 1;
  payload.jobs.push({ extraMetadata: [1, 2], key: "future", schemaVersion: 99, type: "rank" });
  const [note] = base.notes.values();
  note.content = `# Dashboard work queue\n\n\`\`\`json\n${ JSON.stringify(payload) }\n\`\`\`\n`;
  const app = clientApp(base);
  const repository = new DashboardWorkRepository({ app, clock: () => 2000 });
  expect((await repository.readAll(SCOPE)).jobs[0]).toMatchObject({ attemptToken: "old:1", cursor: { batch: 3 } });
  expect(app.replaceNoteContent).not.toHaveBeenCalled();
  await repository.saveJob(SCOPE, { key: "new", type: "rank" });
  const migrated = payloadFromApp(base);
  expect(migrated.jobs.find(job => job.key === "rank:p")).toMatchObject({ attemptToken: "old:1", cursor: { batch: 3 }, ownerId: "old" });
  expect(migrated.jobs.find(job => job.key === "future")).toEqual(payload.jobs[1]);
  expect(app.replaceNoteContent).toHaveBeenCalledTimes(1);
  expect(app.replaceNoteContent.mock.calls[0][2]).toEqual({});
  expect((await readJsonNote(app, workQueueNoteName(SCOPE))).payload.schemaVersion).toBe(2);
  app.replaceNoteContent.mockClear();
  await repository.checkpoint(SCOPE, "rank:p", "old:1", { batch: 4 });
  expect(app.replaceNoteContent.mock.calls[0][2].section).toBeDefined();
}

// ----------------------------------------------------------------------------------------------
// @desc Defaults added by the job model are not mistaken for a concurrent edit to a minimal stored record.
// @returns {Promise<void>}
async function verifyMinimalRecords() {
  const base = workQueueNotesApp();
  const repository = new DashboardWorkRepository({ app: base, clock: () => 1000 });
  await repository.saveJob(SCOPE, { key: "minimal", type: "rank" });
  const [note] = base.notes.values();
  const records = payloadFromApp(base).jobs;
  note.content = note.content.replace(JSON.stringify({ jobs: records }, null, 2),
    JSON.stringify({ jobs: [{ key: "minimal", schemaVersion: 1, type: "rank" }] }, null, 2));
  await expect(repository.claim(SCOPE, "minimal", { ownerId: "me", token: "me:1" })).resolves.toMatchObject({ attemptToken: "me:1" });
}

// ----------------------------------------------------------------------------------------------
// @desc A partially saved batch retries the unsaved bucket while retaining the bucket already committed.
// @returns {Promise<void>}
async function verifyPartialBatchRetry() {
  const base = workQueueNotesApp();
  const app = clientApp(base);
  let now = 1000;
  const repository = new DashboardWorkRepository({ app, clock: () => now });
  const keys = exampleKeys();
  const requests = [keys.first, keys.different].map(key => ({ desiredRevision: "r1", key, type: "rank" }));
  await repository.saveJobs(SCOPE, requests);
  now = 2000;
  app.replaceNoteContent.mockClear();
  app.replaceNoteContent.mockImplementationOnce(base.replaceNoteContent).mockResolvedValueOnce(false);
  const updated = requests.map(request => ({ ...request, desiredRevision: "r2" }));
  await expect(repository.saveJobs(SCOPE, updated)).rejects.toThrow("replacement failed");
  expect(payloadFromApp(base).jobs.map(job => job.desiredRevision).sort()).toEqual(["r1", "r2"]);
  await repository.saveJobs(SCOPE, updated);
  expect(payloadFromApp(base).jobs.map(job => job.desiredRevision)).toEqual(["r2", "r2"]);
  expect(app.replaceNoteContent).toHaveBeenCalledTimes(3);
}

// ----------------------------------------------------------------------------------------------
// @desc Retention pruning leaves a completed job that another client has just requested at a new revision intact.
// @returns {Promise<void>}
async function verifyRemotePruningRace() {
  const base = workQueueNotesApp();
  let now = 1000;
  const remote = new DashboardWorkRepository({ app: base, clock: () => now });
  await remote.saveJob(SCOPE, { desiredRevision: "old", key: "old", type: "rank" });
  await remote.claim(SCOPE, "old", { ownerId: "remote", token: "remote:1" });
  await remote.complete(SCOPE, "old", "remote:1", { revision: "old" });
  now += TERMINAL_RECORD_RETENTION_MILLISECONDS + 1;
  // ----------------------------------------------------------------------------------------------
  // @desc Refresh the old record remotely immediately before the local bucket re-read.
  const app = clientApp(base, async reads => {
    if (reads === 2) await remote.saveJob(SCOPE, { desiredRevision: "new", key: "old", type: "rank" });
  });
  const repository = new DashboardWorkRepository({ app, clock: () => now });
  await repository.saveJob(SCOPE, { key: "trigger", type: "rank" });
  expect(payloadFromApp(base).jobs.find(job => job.key === "old")).toMatchObject({ desiredRevision: "new", status: "pending" });
}

// ----------------------------------------------------------------------------------------------
// @desc Fresh bucket reads retain another client's new key even when that key shares this transition's bucket.
// @returns {Promise<void>}
async function verifySameBucketAddition() {
  const base = workQueueNotesApp();
  const keys = exampleKeys();
  const remote = new DashboardWorkRepository({ app: base, clock: () => 1000 });
  await remote.saveJob(SCOPE, { key: keys.first, type: "rank" });
  // ----------------------------------------------------------------------------------------------
  // @desc Add a same-bucket job remotely between the local snapshot and its scoped write.
  const app = clientApp(base, async reads => {
    if (reads === 2) await remote.saveJob(SCOPE, { key: keys.same, type: "rank" });
  });
  const repository = new DashboardWorkRepository({ app, clock: () => 2000 });
  await repository.claim(SCOPE, keys.first, { ownerId: "local", token: "local:1" });
  expect(payloadFromApp(base).jobs).toHaveLength(2);
  expect(payloadFromApp(base).jobs.find(job => job.key === keys.same).status).toBe("pending");
}

// ----------------------------------------------------------------------------------------------
// @desc A fresh competing claim for the same job is preserved; the stale transition is rejected rather than patched over it.
// @returns {Promise<void>}
async function verifySameJobConflict() {
  const base = workQueueNotesApp();
  const remote = new DashboardWorkRepository({ app: base, clock: () => 1000 });
  await remote.saveJob(SCOPE, { key: "rank:p", type: "rank" });
  // ----------------------------------------------------------------------------------------------
  // @desc Claim the job remotely before the local transition can patch it.
  const app = clientApp(base, async reads => {
    if (reads === 2) await remote.claim(SCOPE, "rank:p", { ownerId: "remote", token: "remote:1" });
  });
  const repository = new DashboardWorkRepository({ app, clock: () => 2000 });
  await expect(repository.claim(SCOPE, "rank:p", { ownerId: "local", token: "local:1" })).rejects.toThrow("changed on another client");
  expect(payloadFromApp(base).jobs[0].attemptToken).toBe("remote:1");
}

it("checks failed section replacements and permits retries", verifyCheckedFailures);
it("preserves independent concurrent bucket claims", verifyConcurrentBuckets);
it("refuses damaged and ambiguous bucket notes", verifyDamagedBuckets);
it("precreates stable buckets and writes multiline records", verifyFixedLayout);
it("supports notes larger than one API write with scoped bucket updates", verifyLargeQueue);
it("accepts supported records with implicit model defaults", verifyMinimalRecords);
it("retries a partially committed batch without losing saved buckets", verifyPartialBatchRetry);
it("migrates legacy running jobs and preserves future records", verifyLegacyMigration);
it("preserves remotely refreshed records during pruning", verifyRemotePruningRace);
it("preserves a fresh same-bucket addition", verifySameBucketAddition);
it("rejects a stale same-job transition", verifySameJobConflict);
