// A durable work job: the record kept in a scope's queue note so unfinished work survives a closed Dashboard. It
// describes the work, never carries it out: a type names the handler that runs it, a small JSON input and the desired
// input revision say what to run against, and a cursor records progress between batches. Prompts, project snapshots,
// and callbacks never enter it. Each attempt holds a token, and every change an attempt makes checks that token, so an
// attempt another session has taken over, or one superseded by newer inputs, cannot overwrite the current record.
import { CLAIM_LEASE_MILLISECONDS, MAXIMUM_JOB_ATTEMPTS, priorityRank } from "dashboard/work-queue/dashboard-work-policy";

// The record layout this code writes. A record with a later version is preserved untouched and never run.
export const WORK_JOB_SCHEMA_VERSION = 1;
// Every status a durable job can hold.
export const WORK_JOB_STATUSES = ["blockedConfiguration", "completed", "failed", "pending", "retryWaiting", "running", "superseded"];
// Statuses a job does not leave unless its inputs change.
export const TERMINAL_WORK_JOB_STATUSES = ["completed", "failed", "superseded"];
// Longest serialized input a job may carry; anything larger belongs in the store it describes.
const MAXIMUM_INPUT_CHARACTERS = 2000;
// The fields a record holds, in the order they are written.
const RECORD_FIELDS = ["attempt", "attemptRevision", "attemptToken", "category", "claimExpiresAt", "cursor", "desiredRevision",
  "enqueuedAt", "entityId", "input", "key", "lastAttemptedAt", "lastFailure", "nextEligibleAt", "ownerId", "scopeKey", "status",
  "succeededAt", "succeededRevision", "type", "updatedAt"];

// ----------------------------------------------------------------------------------------------
// @desc One durable job record and the transitions it allows. Transition methods return false, changing nothing,
//   when the attempt token they are given is no longer the job's current one.
export default class DashboardWorkJob {
  attempt = 0; // {number} Attempts started since the job last needed new work.
  attemptRevision = null; // {string|number|null} The desired revision the running attempt was started against.
  attemptToken = null; // {string|null} Identifies the running attempt.
  category = "maintenance"; // {string} Priority category it is enqueued at.
  claimExpiresAt = null; // {number|null} When another session may treat the running attempt as abandoned.
  cursor = null; // {*} Progress saved by the last checkpoint, resumed from by the next attempt.
  desiredRevision = null; // {string|number|null} The input revision the job should bring its output up to.
  enqueuedAt = 0; // {number} When the job was first saved.
  entityId = null; // {string|null} The project or term the job is about.
  input = null; // {*} Small plain JSON passed to the handler.
  key; // {string} Stable identity, such as "rankProjectTasks:<projectUuid>".
  lastAttemptedAt = null; // {number|null} When the last attempt started.
  lastFailure = null; // {object|null} { at, classification, message } from the last failed attempt.
  nextEligibleAt = null; // {number|null} When a job waiting to retry may run again.
  ownerId = null; // {string|null} The session running the attempt.
  scopeKey = null; // {string|null} The domain and quarter whose queue holds the job.
  status = "pending"; // {string} One of WORK_JOB_STATUSES.
  succeededAt = null; // {number|null} When an attempt last completed.
  succeededRevision = null; // {string|number|null} The revision the output was last brought up to.
  type; // {string} Names the handler that runs it.
  updatedAt = 0; // {number} When the record last changed.

  // ----------------------------------------------------------------------------------------------
  // @desc Construct a job from record fields, validating them.
  // @param {object} fields - Any RECORD_FIELDS; key and type are required.
  constructor(fields) {
    for (const field of RECORD_FIELDS) {
      if (fields[field] !== undefined) this[field] = fields[field];
    }
    _validate(this);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc A new pending job.
  // @param {object} request - { category, desiredRevision, entityId, input, key, scopeKey, type }.
  // @param {number} now - Epoch milliseconds.
  // @returns {DashboardWorkJob} The job.
  static create(request, now) {
    const { category = "maintenance", desiredRevision = null, entityId = null, input = null, key, scopeKey = null, type } = request;
    return new DashboardWorkJob({ category, desiredRevision, enqueuedAt: now, entityId, input, key, scopeKey, type, updatedAt: now });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Read a stored record.
  // @param {object} record - As toRecord wrote it.
  // @returns {DashboardWorkJob} The job.
  // @throws When the record was written by a later version, or is invalid.
  static fromRecord(record) {
    if (!record || typeof record !== "object") throw new Error("A work job record must be an object");
    if ((record.schemaVersion || 0) > WORK_JOB_SCHEMA_VERSION) {
      throw new Error(`Work job record "${ record.key }" has schema ${ record.schemaVersion }, newer than this version reads`);
    }
    return new DashboardWorkJob(record);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Whether the given token is the running attempt's.
  // @param {string} token - Attempt token.
  // @returns {boolean} True when the attempt may still change the job.
  acceptsAttempt(token) {
    return this.status === "running" && Boolean(token) && this.attemptToken === token;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Save an attempt's progress and renew its claim.
  // @param {string} token - Attempt token.
  // @param {*} cursor - Plain JSON progress.
  // @param {number} now - Epoch milliseconds.
  // @returns {boolean} False when the attempt is stale.
  checkpoint(token, cursor, now) {
    if (!this.acceptsAttempt(token)) return false;
    _requirePlainJson(cursor, `Checkpoint of work job "${ this.key }"`);
    Object.assign(this, { claimExpiresAt: now + CLAIM_LEASE_MILLISECONDS, cursor, updatedAt: now });
    return true;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Start an attempt for a session, counting it and claiming the job until the lease expires.
  // @param {object} options - { now, ownerId, token }.
  // @returns {boolean} False when the job is not eligible to start.
  claim({ now, ownerId, token }) {
    if (!this.isEligible(now)) return false;
    Object.assign(this, { attempt: this.attempt + 1, attemptRevision: this.desiredRevision, attemptToken: token,
      claimExpiresAt: now + CLAIM_LEASE_MILLISECONDS, lastAttemptedAt: now, nextEligibleAt: null, ownerId, status: "running",
      updatedAt: now });
    return true;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Whether a running attempt's claim has lapsed, so its session is presumed gone.
  // @param {number} now - Epoch milliseconds.
  // @returns {boolean} True when another session may recover the job.
  claimExpired(now) {
    return this.status === "running" && (this.claimExpiresAt === null || this.claimExpiresAt <= now);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Finish an attempt whose output has been written. When newer inputs arrived while it ran, the job returns
  //   to pending to bring the output up to them; otherwise it completes.
  // @param {string} token - Attempt token.
  // @param {object} options - { now, revision }: the revision the output now reflects.
  // @returns {boolean} False when the attempt is stale.
  complete(token, { now, revision }) {
    if (!this.acceptsAttempt(token)) return false;
    const replaced = this.desiredRevision !== this.attemptRevision;
    this._clearAttempt(now);
    Object.assign(this, { cursor: null, lastFailure: null, status: replaced ? "pending" : "completed", succeededAt: now,
      succeededRevision: revision ?? this.attemptRevision });
    if (replaced) this.attempt = 0;
    return true;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Record a failed attempt. A missing configuration waits for a settings change; a permanent failure, or one
  //   past the attempt limit, stays failed until the inputs change; anything else waits to retry.
  // @param {string} token - Attempt token.
  // @param {object} failure - { classification, message, now, retryAt }.
  // @returns {boolean} False when the attempt is stale.
  fail(token, { classification, message, now, retryAt }) {
    if (!this.acceptsAttempt(token)) return false;
    this._clearAttempt(now);
    this.lastFailure = { at: now, classification, message: String(message || "").slice(0, 200) };
    if (classification === "configuration") this.status = "blockedConfiguration";
    else if (classification === "permanent" || this.attempt >= MAXIMUM_JOB_ATTEMPTS) this.status = "failed";
    else Object.assign(this, { nextEligibleAt: retryAt, status: "retryWaiting" });
    return true;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Whether the job may start an attempt now.
  // @param {number} now - Epoch milliseconds.
  // @returns {boolean} True for a pending job, or one whose retry delay has passed.
  isEligible(now) {
    return this.status === "pending" || (this.status === "retryWaiting" && (this.nextEligibleAt ?? 0) <= now);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Return a running job to pending without counting a failure, keeping its cursor, because its session let go
  //   of it or its claim lapsed. A lapsed job already at the attempt limit fails instead.
  // @param {object} options - { expired = false, now, token = null }: token is required unless expired is true.
  // @returns {boolean} False when the job is not running, or the token is stale.
  release({ expired = false, now, token = null }) {
    if (expired ? !this.claimExpired(now) : !this.acceptsAttempt(token)) return false;
    this._clearAttempt(now);
    if (expired) this.lastFailure = { at: now, classification: "abandoned", message: "Its session stopped before finishing" };
    this.status = expired && this.attempt >= MAXIMUM_JOB_ATTEMPTS ? "failed" : "pending";
    return true;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Ask for the output to be brought up to a revision. Pending work takes the new revision and input; a running
  //   attempt keeps going and the job runs once more after it; a job already completed at that revision is left alone.
  //   A new revision clears the attempt count and cursor, but a job waiting to retry keeps its delay.
  // @param {object} request - { category, desiredRevision, input }.
  // @param {number} now - Epoch milliseconds.
  // @returns {boolean} Whether the job needs to run.
  request({ category = "maintenance", desiredRevision = null, input = null }, now) {
    _requirePlainJson(input, `Input of work job "${ this.key }"`);
    this.category = priorityRank(category) < priorityRank(this.category) ? category : this.category;
    const revisionChanged = desiredRevision !== this.desiredRevision;
    Object.assign(this, { desiredRevision, input, updatedAt: now });
    if (this.status === "running") return true;
    if (this.status === "completed" && this.succeededRevision === desiredRevision) return false;
    if (!revisionChanged && ["blockedConfiguration", "failed", "pending", "retryWaiting"].includes(this.status)) {
      return this.status === "pending" || this.status === "retryWaiting";
    }
    Object.assign(this, { attempt: 0, cursor: null });
    if (this.status !== "retryWaiting") this.status = "pending";
    return true;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Let a job waiting for configuration try again, after a settings change.
  // @param {number} now - Epoch milliseconds.
  // @returns {boolean} Whether the job was waiting for configuration.
  resumeAfterConfiguration(now) {
    if (this.status !== "blockedConfiguration") return false;
    Object.assign(this, { attempt: 0, status: "pending", updatedAt: now });
    return true;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Retire an attempt whose handler found its inputs no longer apply.
  // @param {string} token - Attempt token.
  // @param {number} now - Epoch milliseconds.
  // @returns {boolean} False when the attempt is stale.
  supersede(token, now) {
    if (!this.acceptsAttempt(token)) return false;
    this._clearAttempt(now);
    Object.assign(this, { cursor: null, status: "superseded" });
    return true;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc The record to store.
  // @returns {object} Plain JSON with schemaVersion and every RECORD_FIELDS value.
  toRecord() {
    const record = { schemaVersion: WORK_JOB_SCHEMA_VERSION };
    for (const field of RECORD_FIELDS) record[field] = this[field];
    return record;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Drop the running attempt's claim.
  // @param {number} now - Epoch milliseconds.
  _clearAttempt(now) {
    Object.assign(this, { attemptToken: null, claimExpiresAt: null, ownerId: null, updatedAt: now });
  }
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Whether a value is plain JSON: null, booleans, finite numbers, strings, and arrays or plain objects of them.
// @param {*} value - Value to check.
// @returns {boolean} True when the value survives a JSON round trip unchanged.
function _isPlainJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(_isPlainJson);
  if (typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(value).every(_isPlainJson);
}

// ----------------------------------------------------------------------------------------------
// @desc Require a small plain JSON value, keeping callbacks, class instances, and large snapshots out of the queue.
// @param {*} value - Value to check.
// @param {string} label - Names the value in the error.
// @throws When the value is not plain JSON or is too large.
function _requirePlainJson(value, label) {
  if (!_isPlainJson(value)) throw new Error(`${ label } must be plain JSON`);
  if (JSON.stringify(value).length > MAXIMUM_INPUT_CHARACTERS) throw new Error(`${ label } is too large to queue`);
}

// ----------------------------------------------------------------------------------------------
// @desc Validate a job's fields.
// @param {DashboardWorkJob} job - The job.
// @throws When a required field is missing or a field has the wrong form.
function _validate(job) {
  if (typeof job.key !== "string" || !job.key) throw new Error("A work job needs a key");
  if (typeof job.type !== "string" || !job.type) throw new Error(`Work job "${ job.key }" needs a type`);
  if (!WORK_JOB_STATUSES.includes(job.status)) throw new Error(`Work job "${ job.key }" has unknown status "${ job.status }"`);
  priorityRank(job.category);
  _requirePlainJson(job.input, `Input of work job "${ job.key }"`);
  _requirePlainJson(job.cursor, `Checkpoint of work job "${ job.key }"`);
}
