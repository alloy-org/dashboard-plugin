// Exercise DashboardWorkDiagnosticsStore: outcomes saved in batches to an archived history note and read back by a
// later session, sanitization of what is kept, the 100-outcome and seven-day bounds, and a failed save that is counted
// and retried without failing anything else.
import DashboardWorkDiagnosticsStore, { HISTORY_FLUSH_DELAY_MILLISECONDS, HISTORY_RECORD_LIMIT, HISTORY_RETENTION_MILLISECONDS,
  workHistoryNoteName } from "dashboard/work-queue/dashboard-work-diagnostics-store";
import { workQueueNotesApp } from "./work-queue-test-notes";

const SCOPE = "domain-1:Q4 2026";

// ----------------------------------------------------------------------------------------------
// @desc A store over a notes app, with a clock the test moves and timers it fires by hand.
// @param {object} [options] - { app, clockState }.
// @returns {object} { app, clockState, store, timers }.
function storeHarness({ app = workQueueNotesApp(), clockState = { now: 10_000_000_000 } } = {}) {
  const timers = [];
  const store = new DashboardWorkDiagnosticsStore({ app, clearTimer: () => {}, clock: () => clockState.now, sessionId: "session-a",
    setTimer: (callback, delay) => { timers.push({ callback, delay }); return timers.length; } });
  return { app, clockState, store, timers };
}

describe("DashboardWorkDiagnosticsStore", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Outcomes wait for one batch timer, land in an archived note, and are read back by a later session.
  it("saves outcomes in a batch that a later session reads", async () => {
    const { app, clockState, store, timers } = storeHarness();
    store.recordOutcome(SCOPE, { jobKey: "rank:p", jobType: "rank", status: "completed" });
    store.recordOutcome(SCOPE, { jobKey: "ideas:p", jobType: "ideas", status: "failed" });
    expect(timers).toHaveLength(1);
    expect(timers[0].delay).toBe(HISTORY_FLUSH_DELAY_MILLISECONDS);
    expect(app.notes.size).toBe(0);
    await timers[0].callback();
    const note = [...app.notes.values()][0];
    expect(note).toMatchObject({ archived: true, name: workHistoryNoteName(SCOPE) });
    expect(store.snapshot()).toMatchObject({ pending: 0, storage: { failures: 0, writes: 1 } });
    const later = storeHarness({ app, clockState });
    const history = await later.store.readHistory(SCOPE);
    expect(history.available).toBe(true);
    expect(history.records.map(record => [record.jobKey, record.sessionId])).toEqual([["ideas:p", "session-a"], ["rank:p", "session-a"]]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Only allow-listed fields are kept, and anything resembling a credential is redacted.
  it("keeps only sanitized outcome fields", async () => {
    const { store } = storeHarness();
    store.recordOutcome(SCOPE, { error: `Bad key sk_${ "a".repeat(40) }`, jobKey: "rank:p", prompt: "secret prompt", status: "failed" });
    const { records } = await store.readHistory(SCOPE);
    expect(records[0].prompt).toBeUndefined();
    expect(records[0].error).toBe("Bad key [redacted]");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc At most HISTORY_RECORD_LIMIT outcomes are kept, none older than the retention period.
  it("bounds history by count and age", async () => {
    const { clockState, store } = storeHarness();
    store.recordOutcome(SCOPE, { jobKey: "old", status: "completed" });
    await store.flush();
    clockState.now += HISTORY_RETENTION_MILLISECONDS + 1;
    for (let index = 0; index < HISTORY_RECORD_LIMIT + 10; index += 1) {
      clockState.now += 1;
      store.recordOutcome(SCOPE, { jobKey: `job-${ index }`, status: "completed" });
    }
    await store.flush();
    const { records } = await store.readHistory(SCOPE);
    expect(records).toHaveLength(HISTORY_RECORD_LIMIT);
    expect(records[0].jobKey).toBe(`job-${ HISTORY_RECORD_LIMIT + 9 }`);
    expect(records.some(record => record.jobKey === "old")).toBe(false);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A failed save is counted, its outcomes stay readable and are saved by the next batch, and flush never rejects.
  it("isolates a failed save", async () => {
    const { app, store } = storeHarness();
    store.recordOutcome(SCOPE, { jobKey: "seed", status: "completed" });
    await store.flush();
    app.failNextWrites(1);
    store.recordOutcome(SCOPE, { jobKey: "rank:p", status: "completed" });
    await expect(store.flush()).resolves.toBeUndefined();
    expect(store.snapshot()).toMatchObject({ pending: 1, storage: { failures: 1, writes: 1 } });
    expect((await store.readHistory(SCOPE)).records.map(record => record.jobKey)).toContain("rank:p");
    await store.flush();
    expect(store.snapshot()).toMatchObject({ pending: 0, storage: { failures: 1, writes: 2 } });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc An unreadable history note is reported unavailable, with the unsaved outcomes still shown.
  it("reports an unreadable note as unavailable", async () => {
    const { app, store } = storeHarness();
    await app.createNote(workHistoryNoteName(SCOPE), [], { archive: true });
    const [uuid] = app.notes.keys();
    app.notes.get(uuid).content = "Not JSON at all";
    store.recordOutcome(SCOPE, { jobKey: "rank:p", status: "completed" });
    const history = await store.readHistory(SCOPE);
    expect(history).toMatchObject({ available: false });
    expect(history.records.map(record => record.jobKey)).toEqual(["rank:p"]);
  });
});
