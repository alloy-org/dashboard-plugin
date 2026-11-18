// Keep a bounded record of what the Dashboard work scheduler did: a ring of recent events, counters by event type,
// and run and wait timings by job type. An operator inspecting the queue reads it without Console Logging enabled.
// Events carry only allow-listed scalar fields, so no prompt or provider response body is retained, and anything
// resembling a key or token is redacted both when recorded and again when exported. A completed job may name the
// project or note it worked on, for the operator watching the inspector; that name is left out of exported snapshots.
// A finished attempt also keeps when it began. Main-thread stalls credited to its job type, the same credit the lag
// monitor uses, are totalled as blockingMilliseconds: time the thread stalled while the attempt ran, not time it
// spent waiting on notes or a model. Stalls that overlap are shared by every credited job rather than divided.
import { logIfEnabled } from "util/log";

// How many recent events are kept before the oldest is dropped.
export const DIAGNOSTIC_EVENT_LIMIT = 500;
// How many of the session's first events are kept apart from the ring, so the burst of work queued as the Dashboard
// opens stays in an export however long the session runs.
export const FIRST_EVENT_LIMIT = 150;
// How many recent main-thread stalls are kept so an outcome recorded after them can still be credited.
const MAIN_THREAD_STALL_LIMIT = 100;
// Event types that end a running attempt. A widget's content report is not one: the mount attempt has already ended.
const ATTEMPT_ENDING_TYPES = ["cancelled", "completed", "failed", "superseded", "yielded"];
// The fields an exported event may carry.
const EVENT_FIELDS = ["at", "attempt", "blockingMilliseconds", "category", "durationMilliseconds", "effectiveCategory", "error", "jobKey", "jobType",
  "outcomeDetail", "resource", "scopeKey", "startedAt", "status", "type", "waitedMilliseconds", "waitingReason"];
// The fields an event may carry while held in memory; any other field is dropped when the event is recorded.
// outcomeSubject names the project or note a job worked on, user-written text that stays out of exports.
const RECORDED_EVENT_FIELDS = [...EVENT_FIELDS, "outcomeSubject"];
// The fields an exported widget mount registration may carry.
const MOUNT_FIELDS = ["admittedAt", "committedAt", "contentOutcome", "contentReadyAt", "generation", "nearViewport", "queuedCategory", "registeredAt", "releasedBy",
  "requestedAt", "status", "visible", "watchdogActive", "widgetId"];
// The fields an exported runtime session may carry.
const SESSION_FIELDS = ["sessionId", "startedAt"];
// Event types that mean a job finished doing work, which an operator reads as the queue making progress.
const PROGRESS_EVENT_TYPES = ["completed", "yielded"];
// Event types that mean a job was running at the moment of the event, whether starting or ending an attempt.
const RUNNING_EVENT_TYPES = ["cancelled", "completed", "failed", "started", "superseded", "yielded"];
// The fields an exported job snapshot may carry.
const JOB_FIELDS = ["attempt", "category", "effectiveCategory", "enqueuedAt", "key", "resource", "scopeKey", "startedAt",
  "status", "type", "waitingExplanation", "waitingReason"];
// Longest string any diagnostic field keeps.
const MAXIMUM_FIELD_CHARACTERS = 160;
// A run of characters long enough to be a key, token, or other credential. Hyphens break a run, so UUIDs survive.
const CREDENTIAL_PATTERN = /[A-Za-z0-9_]{32,}/g;

// ----------------------------------------------------------------------------------------------
// @desc Collects scheduler events and notifies subscribers once per batch of events.
export default class DashboardWorkDiagnostics {
  blockingExactByEvent = new WeakMap(); // {WeakMap<object, number>} Unrounded blocking total per outcome event.
  clock; // {function} Returns epoch milliseconds; injected for tests.
  countersByType = {}; // {object} How many events of each type were recorded.
  eventLimit; // {number} How many events the ring keeps.
  events = []; // {Array<object>} The most recent sanitized events, oldest first.
  firstEvents = []; // {Array<object>} The session's first FIRST_EVENT_LIMIT sanitized events, oldest first.
  lastProgressAt = null; // {number|null} When a job last completed or checkpointed, in epoch milliseconds.
  listeners = new Set(); // {Set<function>} Called after a batch of recorded events.
  mainThreadStalls = []; // {Array<object>} Recent blocking stalls, oldest first, for outcomes recorded after them.
  notifyScheduled = false; // {boolean} True while a notification is queued for the current batch.
  openAttemptsByKey = new Map(); // {Map<string, object>} Running attempts accruing blocking until they end.
  timingsByJobType = {}; // {object} { runs, totalRunMilliseconds, maximumRunMilliseconds, totalWaitMilliseconds, waits }.

  // ----------------------------------------------------------------------------------------------
  // @desc Construct an empty record.
  // @param {object} [options] - { clock = Date.now, eventLimit = DIAGNOSTIC_EVENT_LIMIT }.
  constructor({ clock = Date.now, eventLimit = DIAGNOSTIC_EVENT_LIMIT } = {}) {
    Object.assign(this, { clock, eventLimit });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Credit one main-thread stall to the running attempts and finished outcomes it overlapped. A stall that arrives
  //   before an attempt starts is applied when that attempt starts; one that arrives after the attempt is recorded is
  //   applied to the outcome already kept. Timer stalls and long-frame stalls for the same jank must not both be
  //   passed here: the lag monitor reports only the source it prefers.
  // @param {object} stall - { blockingMilliseconds, durationMilliseconds, endedAt, jobTypes, startedAt }, jobTypes the
  //   types the monitor credited and the times in epoch milliseconds.
  attributeMainThreadStall(stall) {
    const recordedStall = _recordedStall(stall);
    if (!recordedStall) return;
    this.mainThreadStalls.push(recordedStall);
    if (this.mainThreadStalls.length > MAIN_THREAD_STALL_LIMIT) this.mainThreadStalls.shift();
    for (const attempt of this.openAttemptsByKey.values()) {
      const share = _overlappingBlocking(attempt.startedAt, Number.POSITIVE_INFINITY, attempt.jobType, recordedStall);
      attempt.blockingMilliseconds += share;
    }
    let changed = false;
    for (const event of this.events) {
      if (typeof event.startedAt !== "number" || typeof event.at !== "number") continue;
      const share = _overlappingBlocking(event.startedAt, event.at, event.jobType, recordedStall);
      if (share > 0 && this._addBlocking(event, share)) changed = true;
    }
    if (changed) this._scheduleNotify();
  }

  // ----------------------------------------------------------------------------------------------
  // @desc A sanitized copy of the record, with the given scheduler, mount, and session state, for an operator to copy
  //   or download. Every job, mount, and session field is passed through an allow-list again here.
  // @param {object|null} [schedulerSnapshot] - From DashboardWorkScheduler#snapshot.
  // @param {object} [options] - An object with the following properties:
  //   - {object|null} [appCalls] - { bridge, bookkeeping }: CallTimingMeter snapshots of every app call by method, and of
  //     the queue and history notes' reads and writes by the change that caused them
  //   - {object|null} [mainThread] - From MainThreadLagMonitor#snapshot, which sanitizes its own fields
  //   - {object|null} [mountSnapshot] - From WidgetMountCoordinator#snapshot
  //   - {object|null} [session] - { sessionId, startedAt } for the runtime
  // @returns {object} { appCalls, diagnostics, exportedAt, mainThread, mounts, scheduler, session }.
  exportSnapshot(schedulerSnapshot = null, { appCalls = null, mainThread = null, mountSnapshot = null, session = null } = {}) {
    const diagnostics = this.snapshot();
    diagnostics.events = diagnostics.events.map(event => sanitizedFields(event, EVENT_FIELDS));
    diagnostics.firstEvents = diagnostics.firstEvents.map(event => sanitizedFields(event, EVENT_FIELDS));
    const scheduler = schedulerSnapshot ? { ...schedulerSnapshot,
      jobs: (schedulerSnapshot.jobs || []).map(job => sanitizedFields(job, JOB_FIELDS)),
      scopeKey: sanitizedValue(schedulerSnapshot.scopeKey) } : null;
    const mounts = mountSnapshot ? (mountSnapshot.widgets || []).map(widget => sanitizedFields(widget, MOUNT_FIELDS)) : null;
    const exportedSession = session ? sanitizedFields(session, SESSION_FIELDS) : null;
    const exportedAppCalls = appCalls ? { bookkeeping: _sanitizedCallTimings(appCalls.bookkeeping),
      bridge: _sanitizedCallTimings(appCalls.bridge) } : null;
    return { appCalls: exportedAppCalls, diagnostics, exportedAt: new Date(this.clock()).toISOString(), mainThread, mounts, scheduler,
      session: exportedSession };
  }

  // ----------------------------------------------------------------------------------------------
  // @desc The types of jobs that started or ended an attempt at or after a moment, from the events still held. With
  //   the scheduler's running jobs, this says which work could have held the main thread over a span that has ended.
  // @param {number} sinceEpochMilliseconds - Start of the span.
  // @returns {Array<string>} Job types, each once.
  jobTypesActiveSince(sinceEpochMilliseconds) {
    const activeTypes = new Set();
    for (let index = this.events.length - 1; index >= 0; index -= 1) {
      const event = this.events[index];
      if (event.at < sinceEpochMilliseconds) break;
      if (event.jobType && RUNNING_EVENT_TYPES.includes(event.type)) activeTypes.add(event.jobType);
    }
    return [...activeTypes];
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Record one scheduler event. A failure is also logged when Console Logging is on.
  // @param {object} event - { type, jobKey, jobType, ... } with any of the allow-listed fields.
  record(event) {
    const sanitized = sanitizedFields({ at: this.clock(), ...event }, RECORDED_EVENT_FIELDS);
    this._rememberAttempt(sanitized);
    this.events.push(sanitized);
    if (this.events.length > this.eventLimit) this.events.shift();
    if (this.firstEvents.length < FIRST_EVENT_LIMIT) this.firstEvents.push(sanitized);
    this.countersByType[sanitized.type] = (this.countersByType[sanitized.type] || 0) + 1;
    if (PROGRESS_EVENT_TYPES.includes(sanitized.type)) this.lastProgressAt = sanitized.at;
    this._recordTimings(sanitized);
    if (sanitized.type === "failed") logIfEnabled("[dashboard-work] job failed", sanitized);
    this._scheduleNotify();
  }

  // ----------------------------------------------------------------------------------------------
  // @desc A copy of the counters, events, the session's first events, last progress time, and timings.
  // @returns {object} { counters, events, firstEvents, lastProgressAt, timings }.
  snapshot() {
    const timings = {};
    for (const [jobType, timing] of Object.entries(this.timingsByJobType)) timings[jobType] = { ...timing };
    const events = this.events.map(event => ({ ...event }));
    const firstEvents = this.firstEvents.map(event => ({ ...event }));
    return { counters: { ...this.countersByType }, events, firstEvents, lastProgressAt: this.lastProgressAt, timings };
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Call a listener after each batch of recorded events.
  // @param {function} listener - Called with no arguments.
  // @returns {function} Removes the listener.
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Add unrounded blocking time to an outcome and store the rounded total operators see.
  // @param {object} event - A recorded outcome.
  // @param {number} share - Milliseconds of the stall that overlapped the outcome.
  // @returns {boolean} Whether the rounded total changed.
  _addBlocking(event, share) {
    const exact = (this.blockingExactByEvent.get(event) || 0) + share;
    this.blockingExactByEvent.set(event, exact);
    const rounded = Math.round(exact);
    if (event.blockingMilliseconds === rounded) return false;
    event.blockingMilliseconds = rounded;
    return true;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Add an event's run or wait duration to its job type's timings. Only an event that ends an attempt counts as a
  //   run, so a widget's "contentReady" duration, which spans its data loading, stays out of its mount job's run times.
  // @param {object} event - A sanitized event.
  _recordTimings(event) {
    if (!event.jobType) return;
    const hasRun = typeof event.durationMilliseconds === "number" && RUNNING_EVENT_TYPES.includes(event.type);
    const hasWait = typeof event.waitedMilliseconds === "number";
    if (!hasRun && !hasWait) return;
    const timing = this.timingsByJobType[event.jobType]
      || { maximumRunMilliseconds: 0, runs: 0, totalRunMilliseconds: 0, totalWaitMilliseconds: 0, waits: 0 };
    if (hasRun) {
      timing.runs += 1;
      timing.totalRunMilliseconds += event.durationMilliseconds;
      timing.maximumRunMilliseconds = Math.max(timing.maximumRunMilliseconds, event.durationMilliseconds);
    }
    if (hasWait) {
      timing.waits += 1;
      timing.totalWaitMilliseconds += event.waitedMilliseconds;
    }
    this.timingsByJobType[event.jobType] = timing;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Open a running attempt, close one and keep the blocking it accrued, or credit an outcome that was never a
  //   scheduler attempt, such as a widget's content report, from the stalls already seen.
  // @param {object} event - A sanitized event, changed in place.
  _rememberAttempt(event) {
    const attemptKey = _attemptKey(event);
    if (event.type === "started" && event.jobKey) {
      const attempt = { blockingMilliseconds: 0, jobType: event.jobType, startedAt: event.at };
      for (const stall of this.mainThreadStalls) {
        const share = _overlappingBlocking(attempt.startedAt, Number.POSITIVE_INFINITY, attempt.jobType, stall);
        attempt.blockingMilliseconds += share;
      }
      this.openAttemptsByKey.set(attemptKey, attempt);
      return;
    }
    if (ATTEMPT_ENDING_TYPES.includes(event.type) && event.jobKey) {
      const openAttempt = this.openAttemptsByKey.get(attemptKey);
      this.openAttemptsByKey.delete(attemptKey);
      if (!openAttempt) return;
      if (typeof event.startedAt !== "number") event.startedAt = openAttempt.startedAt;
      this.blockingExactByEvent.set(event, openAttempt.blockingMilliseconds);
      event.blockingMilliseconds = Math.round(openAttempt.blockingMilliseconds);
      return;
    }
    if (typeof event.startedAt !== "number" || typeof event.at !== "number") return;
    let blocking = 0;
    for (const stall of this.mainThreadStalls) blocking += _overlappingBlocking(event.startedAt, event.at, event.jobType, stall);
    this.blockingExactByEvent.set(event, blocking);
    event.blockingMilliseconds = Math.round(blocking);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Queue one notification for every event recorded before it runs.
  _scheduleNotify() {
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    Promise.resolve().then(() => {
      this.notifyScheduled = false;
      for (const listener of [...this.listeners]) listener();
    });
  }
}

// ----------------------------------------------------------------------------------------------
// @desc The map key of one attempt of a job.
// @param {object} event - { attempt, jobKey }.
// @returns {string} The key.
function _attemptKey(event) {
  return `${ event.jobKey }:${ event.attempt }`;
}

// ----------------------------------------------------------------------------------------------
// @desc How much of a stall's blocking time falls inside a window, when the stall was credited to that job type.
// @param {number} windowStart - Epoch milliseconds the window opens.
// @param {number} windowEnd - Epoch milliseconds the window closes.
// @param {string|null} jobType - The outcome's job type.
// @param {object} stall - From _recordedStall.
// @returns {number} Milliseconds, possibly fractional.
function _overlappingBlocking(windowStart, windowEnd, jobType, stall) {
  if (!jobType || !stall.jobTypes.includes(jobType)) return 0;
  if (!(stall.durationMilliseconds > 0) || !(stall.blockingMilliseconds > 0)) return 0;
  const overlap = Math.min(windowEnd, stall.endedAt) - Math.max(windowStart, stall.startedAt);
  if (overlap <= 0) return 0;
  return stall.blockingMilliseconds * (overlap / stall.durationMilliseconds);
}

// ----------------------------------------------------------------------------------------------
// @desc A stall worth crediting, or null when it did not block or its times cannot be read.
// @param {object} stall - The stall the monitor reported.
// @returns {object|null} { blockingMilliseconds, durationMilliseconds, endedAt, jobTypes, startedAt }.
function _recordedStall(stall) {
  const blockingMilliseconds = stall?.blockingMilliseconds;
  const durationMilliseconds = stall?.durationMilliseconds;
  const endedAt = stall?.endedAt;
  const startedAt = stall?.startedAt;
  if (typeof startedAt !== "number" || typeof endedAt !== "number" || !(blockingMilliseconds > 0)) return null;
  if (!(durationMilliseconds > 0) || endedAt < startedAt) return null;
  const jobTypes = Array.isArray(stall.jobTypes) ? stall.jobTypes : [];
  return { blockingMilliseconds, durationMilliseconds, endedAt, jobTypes, startedAt };
}

// ----------------------------------------------------------------------------------------------
// @desc A call timing snapshot with every label sanitized, or null without one.
// @param {object|null|undefined} timings - From CallTimingMeter#snapshot.
// @returns {object|null} The snapshot, its labels sanitized.
function _sanitizedCallTimings(timings) {
  if (!timings) return null;
  const labels = (timings.labels || []).map(timing => ({ ...timing, label: sanitizedValue(timing.label) }));
  const timeline = (timings.timeline || []).map(entry => ({ ...entry, label: sanitizedValue(entry.label) }));
  return { ...timings, labels, timeline };
}

// ----------------------------------------------------------------------------------------------
// @desc Keep only the allowed fields of a record, each reduced to a sanitized scalar.
// @param {object} record - Event or job snapshot.
// @param {Array<string>} fields - Field names to keep.
// @returns {object} A new object holding the allowed fields that are present.
export function sanitizedFields(record, fields) {
  const sanitized = {};
  for (const field of fields) {
    if (record?.[field] === undefined) continue;
    sanitized[field] = sanitizedValue(record[field]);
  }
  return sanitized;
}

// ----------------------------------------------------------------------------------------------
// @desc Reduce one diagnostic value to a scalar: numbers, booleans, and null pass through; an Error keeps its message;
//   strings are shortened and anything resembling a credential is redacted; other values are dropped to null.
// @param {*} value - Value to sanitize.
// @returns {string|number|boolean|null} The sanitized value.
export function sanitizedValue(value) {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  const text = value instanceof Error ? value.message : value;
  if (typeof text !== "string") return null;
  const redacted = text.replace(CREDENTIAL_PATTERN, "[redacted]");
  return redacted.length > MAXIMUM_FIELD_CHARACTERS ? `${ redacted.slice(0, MAXIMUM_FIELD_CHARACTERS - 1) }…` : redacted;
}
