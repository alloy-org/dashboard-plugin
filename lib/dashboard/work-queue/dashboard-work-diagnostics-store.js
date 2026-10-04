// Keep a short durable history of how durable jobs ended, so an operator reopening the Dashboard can see what earlier
// sessions finished or failed. Outcomes are buffered and written in occasional low-priority batches straight through
// the note writer, never as queue jobs, so saving history cannot appear in the queue metrics it records or wait
// behind the work it describes. Each scope keeps at most 100 compact, sanitized outcomes for at most seven days. A
// failure to save history is counted and shown, and never fails the job it describes.
import { readJsonNote, writeJsonNote } from "dashboard/work-queue/dashboard-json-note";
import DashboardNoteWriter from "dashboard/work-queue/dashboard-note-writer";
import { sanitizedFields } from "dashboard/work-queue/dashboard-work-diagnostics";
import { cancelWorkTimer, startWorkTimer } from "dashboard/work-queue/work-timers";
import { logIfEnabled } from "util/log";

// How long after the first unsaved outcome a batch is written.
export const HISTORY_FLUSH_DELAY_MILLISECONDS = 30 * 1000;
// Most outcomes kept per scope.
export const HISTORY_RECORD_LIMIT = 100;
// Oldest outcome kept.
export const HISTORY_RETENTION_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;
// The history note layout this code writes.
export const HISTORY_SCHEMA_VERSION = 1;
// Shown above the JSON in the history note.
const HISTORY_NOTE_DESCRIPTION = "This archived note is maintained by the dashboard plugin. It keeps a week of how the "
  + "Dashboard's background work ended for this domain and quarter, for troubleshooting.";
// The fields an outcome keeps.
const OUTCOME_FIELDS = ["at", "attempt", "durationMilliseconds", "error", "failureClassification", "jobKey", "jobType",
  "outputRevision", "recovered", "retryAt", "sessionId", "status"];

// ----------------------------------------------------------------------------------------------
// @desc Name a scope's history note.
// @param {string|null} scopeKey - The domain and quarter.
// @returns {string} Note name.
export function workHistoryNoteName(scopeKey) {
  return `Dashboard Work History ${ scopeKey || "unscoped" }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Buffers job outcomes and saves them per scope.
export default class DashboardWorkDiagnosticsStore {
  app; // {object} Host-compatible Amplenote API.
  clearTimer; // {function} Cancels a timer from setTimer.
  clock; // {function} Returns epoch milliseconds; injected for tests.
  flushTimer = null; // {*} The pending batch timer, if any.
  flushing = null; // {Promise|null} The batch being written, shared by concurrent flush calls.
  noteWriter; // {DashboardNoteWriter} Serializes each history note's read-then-write updates.
  pendingByScope = new Map(); // {Map<string|null, Array<object>>} Outcomes not yet saved.
  sessionId; // {string|null} Marks outcomes recorded by this session.
  setTimer; // {function} (callback, milliseconds) => timer.
  storage = { failures: 0, lastFailure: null, lastWrittenAt: null, writes: 0 }; // {object} Counts its own housekeeping.

  // ----------------------------------------------------------------------------------------------
  // @desc Construct a store.
  // @param {object} options - { app, clearTimer = cancelWorkTimer, clock = Date.now, noteWriter, sessionId = null,
  //   setTimer = startWorkTimer }.
  constructor({ app, clearTimer = cancelWorkTimer, clock = Date.now, noteWriter = DashboardNoteWriter.forApp(app), sessionId = null,
    setTimer = startWorkTimer }) {
    Object.assign(this, { app, clearTimer, clock, noteWriter, sessionId, setTimer });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Stop the batch timer and save what is buffered.
  // @returns {Promise<void>} Settles once the final batch is written or has failed.
  dispose() {
    this.clearTimer(this.flushTimer);
    this.flushTimer = null;
    return this.flush();
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Save every buffered outcome, one write per scope. Outcomes that could not be saved stay buffered, up to the
  //   per-scope limit, for the next batch.
  // @returns {Promise<void>} Never rejects.
  flush() {
    this.clearTimer(this.flushTimer);
    this.flushTimer = null;
    if (!this.flushing) this.flushing = this._writePending().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Read a scope's history, newest first, with outcomes not yet saved included.
  // @param {string|null} scopeKey - The scope.
  // @returns {Promise<object>} { available, error, records, storage }: available is false when the note could not be
  //   read, with error saying why.
  async readHistory(scopeKey) {
    const unsaved = this.pendingByScope.get(scopeKey) || [];
    try {
      const { payload } = await readJsonNote(this.app, workHistoryNoteName(scopeKey));
      const records = _retainedOutcomes([...(payload?.outcomes || []), ...unsaved], this.clock());
      return { available: true, error: null, records, storage: { ...this.storage } };
    } catch (error) {
      return { available: false, error: error?.message || String(error), records: _retainedOutcomes(unsaved, this.clock()),
        storage: { ...this.storage } };
    }
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Buffer one job outcome and arrange for it to be saved.
  // @param {string|null} scopeKey - The job's scope.
  // @param {object} outcome - Any OUTCOME_FIELDS; anything else is dropped and every value is sanitized.
  recordOutcome(scopeKey, outcome) {
    const record = sanitizedFields({ at: this.clock(), sessionId: this.sessionId, ...outcome }, OUTCOME_FIELDS);
    const pending = this.pendingByScope.get(scopeKey) || [];
    pending.push(record);
    this.pendingByScope.set(scopeKey, pending.slice(-HISTORY_RECORD_LIMIT));
    if (this.flushTimer === null) this.flushTimer = this.setTimer(() => this.flush(), HISTORY_FLUSH_DELAY_MILLISECONDS);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc How much is buffered and how saving has gone.
  // @returns {object} { pending, storage }.
  snapshot() {
    let pending = 0;
    for (const outcomes of this.pendingByScope.values()) pending += outcomes.length;
    return { pending, storage: { ...this.storage } };
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Write each scope's buffered outcomes merged into its note, pruned to the retention limits.
  // @returns {Promise<void>} Never rejects.
  async _writePending() {
    const batches = [...this.pendingByScope.entries()];
    this.pendingByScope.clear();
    for (const [scopeKey, outcomes] of batches) {
      const name = workHistoryNoteName(scopeKey);
      try {
        await this.noteWriter.update(name, async () => {
          const { noteHandle, payload } = await readJsonNote(this.app, name);
          if ((payload?.schemaVersion || 0) > HISTORY_SCHEMA_VERSION) throw new Error(`"${ name }" was written by a newer version`);
          const retained = _retainedOutcomes([...(payload?.outcomes || []), ...outcomes], this.clock());
          const nextPayload = { outcomes: retained.reverse(), schemaVersion: HISTORY_SCHEMA_VERSION, scopeKey };
          await writeJsonNote(this.app, { description: HISTORY_NOTE_DESCRIPTION, name, noteHandle, payload: nextPayload,
            title: "Dashboard work history" });
        });
        this.storage.writes += 1;
        this.storage.lastWrittenAt = this.clock();
      } catch (error) {
        this.storage.failures += 1;
        this.storage.lastFailure = { at: this.clock(), message: String(error?.message || error).slice(0, 160) };
        logIfEnabled("[dashboard-work-history] could not save outcomes", error?.message);
        const requeued = [...outcomes, ...(this.pendingByScope.get(scopeKey) || [])];
        this.pendingByScope.set(scopeKey, requeued.slice(-HISTORY_RECORD_LIMIT));
      }
    }
  }
}

// ----------------------------------------------------------------------------------------------
// @desc The outcomes within the retention period, newest first, at most HISTORY_RECORD_LIMIT of them. Outcomes recorded
//   in the same millisecond keep the order they arrived in.
// @param {Array<object>} outcomes - Outcomes, oldest first.
// @param {number} now - Epoch milliseconds.
// @returns {Array<object>} Retained outcomes, newest first.
function _retainedOutcomes(outcomes, now) {
  const recentOutcomes = outcomes.filter(outcome => typeof outcome?.at === "number" && now - outcome.at <= HISTORY_RETENTION_MILLISECONDS);
  const newestFirst = recentOutcomes.map((outcome, index) => ({ index, outcome }));
  newestFirst.sort((first, second) => second.outcome.at - first.outcome.at || second.index - first.index);
  const retained = newestFirst.slice(0, HISTORY_RECORD_LIMIT).map(entry => entry.outcome);
  return retained;
}
