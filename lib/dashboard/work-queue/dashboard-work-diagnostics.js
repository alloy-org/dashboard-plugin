// Keep a bounded record of what the Dashboard work scheduler did: a ring of recent events, counters by event type,
// and run and wait timings by job type. An operator inspecting the queue reads it without Console Logging enabled.
// Events carry only allow-listed scalar fields, so no prompt or provider response body is retained, and anything
// resembling a key or token is redacted both when recorded and again when exported. A completed job may name the
// project or note it worked on, for the operator watching the inspector; that name is left out of exported snapshots.
import { logIfEnabled } from "util/log";

// How many recent events are kept before the oldest is dropped.
export const DIAGNOSTIC_EVENT_LIMIT = 500;
// How many of the session's first events are kept apart from the ring, so the burst of work queued as the Dashboard
// opens stays in an export however long the session runs.
export const FIRST_EVENT_LIMIT = 150;
// The fields an exported event may carry.
const EVENT_FIELDS = ["at", "attempt", "category", "durationMilliseconds", "effectiveCategory", "error", "jobKey", "jobType",
  "outcomeDetail", "resource", "scopeKey", "status", "type", "waitedMilliseconds", "waitingReason"];
// The fields an event may carry while held in memory; any other field is dropped when the event is recorded.
// outcomeSubject names the project or note a job worked on, user-written text that stays out of exports.
const RECORDED_EVENT_FIELDS = [...EVENT_FIELDS, "outcomeSubject"];
// The fields an exported widget mount registration may carry.
const MOUNT_FIELDS = ["admittedAt", "committedAt", "generation", "nearViewport", "queuedCategory", "registeredAt", "releasedBy",
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
  clock; // {function} Returns epoch milliseconds; injected for tests.
  countersByType = {}; // {object} How many events of each type were recorded.
  eventLimit; // {number} How many events the ring keeps.
  events = []; // {Array<object>} The most recent sanitized events, oldest first.
  firstEvents = []; // {Array<object>} The session's first FIRST_EVENT_LIMIT sanitized events, oldest first.
  lastProgressAt = null; // {number|null} When a job last completed or checkpointed, in epoch milliseconds.
  listeners = new Set(); // {Set<function>} Called after a batch of recorded events.
  notifyScheduled = false; // {boolean} True while a notification is queued for the current batch.
  timingsByJobType = {}; // {object} { runs, totalRunMilliseconds, maximumRunMilliseconds, totalWaitMilliseconds, waits }.

  // ----------------------------------------------------------------------------------------------
  // @desc Construct an empty record.
  // @param {object} [options] - { clock = Date.now, eventLimit = DIAGNOSTIC_EVENT_LIMIT }.
  constructor({ clock = Date.now, eventLimit = DIAGNOSTIC_EVENT_LIMIT } = {}) {
    Object.assign(this, { clock, eventLimit });
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
  // @desc Add an event's run or wait duration to its job type's timings.
  // @param {object} event - A sanitized event.
  _recordTimings(event) {
    if (!event.jobType) return;
    const hasRun = typeof event.durationMilliseconds === "number";
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
// @desc A call timing snapshot with every label sanitized, or null without one.
// @param {object|null|undefined} timings - From CallTimingMeter#snapshot.
// @returns {object|null} The snapshot, its labels sanitized.
function _sanitizedCallTimings(timings) {
  if (!timings) return null;
  const labels = (timings.labels || []).map(timing => ({ ...timing, label: sanitizedValue(timing.label) }));
  return { ...timings, labels };
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
