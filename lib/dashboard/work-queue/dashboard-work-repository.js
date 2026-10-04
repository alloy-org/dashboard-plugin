// Keep durable work jobs in an archived "Dashboard Work Queue" note per domain and quarter, so work a closed
// Dashboard left unfinished resumes at the next opportunity. Every change is a fresh read, a transform, and a write
// through the shared note writer, so changes from this session never overwrite each other. Another device can still
// write between this session's read and write: the note API has no compare-and-swap, so a claim is best-effort
// coordination and a job may run more than once. Results must therefore be applied idempotently.
import { readJsonNote, writeJsonNote } from "dashboard/work-queue/dashboard-json-note";
import DashboardNoteWriter from "dashboard/work-queue/dashboard-note-writer";
import DashboardWorkJob, { TERMINAL_WORK_JOB_STATUSES } from "dashboard/work-queue/dashboard-work-job";
import { logIfEnabled } from "util/log";

// The queue note layout this code writes. A note with a later version is read but never written.
export const WORK_QUEUE_SCHEMA_VERSION = 1;
// How long a completed, failed, or superseded job stays in the note for an operator to inspect.
export const TERMINAL_RECORD_RETENTION_MILLISECONDS = 24 * 60 * 60 * 1000;
// Most finished jobs kept in one note, newest first, however recent.
export const TERMINAL_RECORD_LIMIT = 50;
// Shown above the JSON in the queue note.
const QUEUE_NOTE_DESCRIPTION = "This archived note is maintained by the dashboard plugin. It records background work the "
  + "Dashboard has yet to finish for this domain and quarter, so the work can resume the next time the Dashboard opens.";

// ----------------------------------------------------------------------------------------------
// @desc Name a scope's queue note.
// @param {string|null} scopeKey - The domain and quarter, such as "<domainUuid>:Q4 2026".
// @returns {string} Note name.
export function workQueueNoteName(scopeKey) {
  return `Dashboard Work Queue ${ scopeKey || "unscoped" }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Reads and changes the durable jobs of each scope.
export default class DashboardWorkRepository {
  app; // {object} Host-compatible Amplenote API.
  clock; // {function} Returns epoch milliseconds; injected for tests.
  noteWriter; // {DashboardNoteWriter} Serializes each queue note's read-then-write changes.

  // ----------------------------------------------------------------------------------------------
  // @desc Construct a repository, sharing the app's note writer unless given another.
  // @param {object} options - { app, clock = Date.now, noteWriter }.
  constructor({ app, clock = Date.now, noteWriter = DashboardNoteWriter.forApp(app) }) {
    Object.assign(this, { app, clock, noteWriter });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Save a running attempt's progress and renew its claim.
  // @param {string|null} scopeKey - The job's scope.
  // @param {string} key - Job key.
  // @param {string} token - Attempt token.
  // @param {*} cursor - Plain JSON progress.
  // @returns {Promise<DashboardWorkJob|null>} The job, or null when the attempt is stale.
  checkpoint(scopeKey, key, token, cursor) {
    return this._changeJob(scopeKey, key, (job, now) => job.checkpoint(token, cursor, now));
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Claim an eligible job for a session's attempt.
  // @param {string|null} scopeKey - The job's scope.
  // @param {string} key - Job key.
  // @param {object} options - { ownerId, token }.
  // @returns {Promise<DashboardWorkJob|null>} The claimed job, or null when it is missing, running, or not yet due.
  claim(scopeKey, key, { ownerId, token }) {
    return this._changeJob(scopeKey, key, (job, now) => job.claim({ now, ownerId, token }));
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Acknowledge an attempt whose output has already been written.
  // @param {string|null} scopeKey - The job's scope.
  // @param {string} key - Job key.
  // @param {string} token - Attempt token.
  // @param {object} options - { revision }: the revision the output now reflects.
  // @returns {Promise<DashboardWorkJob|null>} The job, pending again if newer inputs arrived, or null when stale.
  complete(scopeKey, key, token, { revision }) {
    return this._changeJob(scopeKey, key, (job, now) => job.complete(token, { now, revision }));
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Record a failed attempt.
  // @param {string|null} scopeKey - The job's scope.
  // @param {string} key - Job key.
  // @param {string} token - Attempt token.
  // @param {object} failure - { classification, message, retryAt }.
  // @returns {Promise<DashboardWorkJob|null>} The job, or null when the attempt is stale.
  fail(scopeKey, key, token, failure) {
    return this._changeJob(scopeKey, key, (job, now) => job.fail(token, { ...failure, now }));
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Read every job of a scope without changing the note, bringing the notes list up to date first.
  // @param {string|null} scopeKey - The scope.
  // @returns {Promise<object>} { jobs, unreadableRecords, writable }: the readable jobs, how many records this version
  //   cannot read, such as those a later version wrote, and whether this version may write the note.
  async readAll(scopeKey) {
    await this.noteWriter.refreshNotesList();
    const state = await this._readState(scopeKey);
    return { jobs: [...state.jobsByKey.values()], unreadableRecords: state.preservedRecords.length, writable: state.writable };
  }

  // ----------------------------------------------------------------------------------------------
  // @desc The jobs of a scope that may start an attempt now.
  // @param {string|null} scopeKey - The scope.
  // @returns {Promise<Array<DashboardWorkJob>>} Eligible jobs, oldest first.
  async readPending(scopeKey) {
    const { jobs } = await this.readAll(scopeKey);
    const now = this.clock();
    const eligibleJobs = jobs.filter(job => job.isEligible(now));
    eligibleJobs.sort((first, second) => first.enqueuedAt - second.enqueuedAt);
    return eligibleJobs;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Return jobs whose claims have lapsed to pending, keeping their cursors, so this session can resume them.
  // @param {string|null} scopeKey - The scope.
  // @returns {Promise<Array<DashboardWorkJob>>} The recovered jobs.
  recoverExpired(scopeKey) {
    return this._update(scopeKey, (state, now) => {
      const expiredJobs = [...state.jobsByKey.values()].filter(job => job.claimExpired(now));
      for (const job of expiredJobs) job.release({ expired: true, now });
      return expiredJobs;
    });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Let go of a running attempt without counting a failure, as when its session is closing.
  // @param {string|null} scopeKey - The job's scope.
  // @param {string} key - Job key.
  // @param {string} token - Attempt token.
  // @returns {Promise<DashboardWorkJob|null>} The pending job, or null when the attempt is stale.
  release(scopeKey, key, token) {
    return this._changeJob(scopeKey, key, (job, now) => job.release({ now, token }));
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Confirm an attempt still holds its job and renew its claim, before it resumes from a checkpoint or writes
  //   its output.
  // @param {string|null} scopeKey - The job's scope.
  // @param {string} key - Job key.
  // @param {string} token - Attempt token.
  // @returns {Promise<DashboardWorkJob|null>} The job, or null when another attempt has replaced this one.
  renew(scopeKey, key, token) {
    return this._changeJob(scopeKey, key, (job, now) => job.checkpoint(token, job.cursor, now));
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Let every job of a scope that waits for configuration try again, after a settings change.
  // @param {string|null} scopeKey - The scope.
  // @returns {Promise<number>} How many jobs resumed.
  resumeAfterConfiguration(scopeKey) {
    return this._update(scopeKey, (state, now) => {
      const resumedJobs = [...state.jobsByKey.values()].filter(job => job.resumeAfterConfiguration(now));
      return resumedJobs.length;
    });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Save a request for work, coalescing it into the scope's job with the same key: its desired revision and
  //   input replace the older ones, and a running job runs once more after its current attempt.
  // @param {string|null} scopeKey - The scope.
  // @param {object} request - { category, desiredRevision, entityId, input, key, type }.
  // @returns {Promise<object>} { job, runnable }: the saved job and whether it needs to run.
  async saveJob(scopeKey, request) {
    const [saved] = await this.saveJobs(scopeKey, [request]);
    return saved;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Save several requests for work in one write of the scope's queue note, each coalescing as saveJob does.
  // @param {string|null} scopeKey - The scope.
  // @param {Array<object>} requests - { category, desiredRevision, entityId, input, key, type } each.
  // @returns {Promise<Array<object>>} { job, runnable } for each request, in order.
  saveJobs(scopeKey, requests) {
    return this._update(scopeKey, (state, now) => requests.map(request => {
      const existing = state.jobsByKey.get(request.key);
      if (existing) return { job: existing, runnable: existing.request(request, now) };
      const job = DashboardWorkJob.create({ ...request, scopeKey }, now);
      state.jobsByKey.set(job.key, job);
      return { job, runnable: true };
    }));
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Retire an attempt whose inputs no longer apply.
  // @param {string|null} scopeKey - The job's scope.
  // @param {string} key - Job key.
  // @param {string} token - Attempt token.
  // @returns {Promise<DashboardWorkJob|null>} The job, or null when the attempt is stale.
  supersede(scopeKey, key, token) {
    return this._changeJob(scopeKey, key, (job, now) => job.supersede(token, now));
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Change one job through a transition that reports whether it applied.
  // @param {string|null} scopeKey - The job's scope.
  // @param {string} key - Job key.
  // @param {function} transition - (job, now) => boolean.
  // @returns {Promise<DashboardWorkJob|null>} The changed job, or null when it is missing or the transition refused.
  _changeJob(scopeKey, key, transition) {
    return this._update(scopeKey, (state, now) => {
      const job = state.jobsByKey.get(key);
      if (!job || !transition(job, now)) return null;
      return job;
    });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Drop finished jobs older than the retention period, and all but the newest TERMINAL_RECORD_LIMIT of them.
  // @param {object} state - From _readState, changed in place.
  // @param {number} now - Epoch milliseconds.
  _prune(state, now) {
    const finishedJobs = [...state.jobsByKey.values()].filter(job => TERMINAL_WORK_JOB_STATUSES.includes(job.status));
    finishedJobs.sort((first, second) => second.updatedAt - first.updatedAt);
    finishedJobs.forEach((job, index) => {
      if (index >= TERMINAL_RECORD_LIMIT || now - job.updatedAt > TERMINAL_RECORD_RETENTION_MILLISECONDS) state.jobsByKey.delete(job.key);
    });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Read a scope's queue note. Records this version cannot read, because a later version wrote them or they are
  //   damaged, are kept aside untouched to be written back, so this version never discards work it does not understand.
  // @param {string|null} scopeKey - The scope.
  // @returns {Promise<object>} { jobsByKey, noteHandle, preservedRecords, writable }.
  async _readState(scopeKey) {
    const { noteHandle, payload } = await readJsonNote(this.app, workQueueNoteName(scopeKey));
    const jobsByKey = new Map();
    const preservedRecords = [];
    for (const record of payload?.jobs || []) {
      try {
        const job = DashboardWorkJob.fromRecord(record);
        jobsByKey.set(job.key, job);
      } catch (error) {
        logIfEnabled("[dashboard-work-repository] kept a record this version cannot read", error?.message);
        preservedRecords.push(record);
      }
    }
    const writable = (payload?.schemaVersion || 0) <= WORK_QUEUE_SCHEMA_VERSION;
    return { jobsByKey, noteHandle, preservedRecords, writable };
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Read, transform, prune, and write a scope's queue note once its earlier changes have finished. The note is
  //   written only when something changed, and created only when it has something to hold.
  // @param {string|null} scopeKey - The scope.
  // @param {function} transform - (state, now) => result; changes state.jobsByKey in place.
  // @returns {Promise<*>} The transform's result.
  // @throws When a later version wrote the note, so this version must not rewrite it.
  _update(scopeKey, transform) {
    const name = workQueueNoteName(scopeKey);
    return this.noteWriter.update(name, async () => {
      const state = await this._readState(scopeKey);
      if (!state.writable) throw new Error(`"${ name }" was written by a newer version of the plugin`);
      const before = _serializedJobs(state);
      const now = this.clock();
      const result = transform(state, now);
      this._prune(state, now);
      const after = _serializedJobs(state);
      if (after === before || (!state.noteHandle && !state.jobsByKey.size)) return result;
      const payload = { jobs: JSON.parse(after), schemaVersion: WORK_QUEUE_SCHEMA_VERSION, scopeKey };
      await writeJsonNote(this.app, { description: QUEUE_NOTE_DESCRIPTION, name, noteHandle: state.noteHandle, payload,
        title: "Dashboard work queue" });
      return result;
    });
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Serialize a state's records, readable ones first in key order, then the preserved ones as they were read.
// @param {object} state - From _readState.
// @returns {string} JSON array text.
function _serializedJobs(state) {
  const jobs = [...state.jobsByKey.values()].sort((first, second) => first.key.localeCompare(second.key));
  const records = jobs.map(job => job.toRecord());
  return JSON.stringify([...records, ...state.preservedRecords]);
}
