// Count and time asynchronous calls by label, such as each Amplenote API method the embed sends across its bridge, or
// each read and write of the work queue note grouped by the job transition that caused it. A call's time is how long
// it took to settle, which for a bridge call includes the host's own work on it and any wait for the host's main
// thread, so the same call growing slower is a sign the host is busy. Totals are kept per label rather than per call,
// so a burst of small calls costs nothing to keep and cannot push anything else out of a diagnostics ring. Calls slow
// enough to matter also go on a short timeline with their epoch times, so an export can line them up with main-thread
// stalls and job events. Overlapping slow calls of one label merge into a single burst entry, so a fan-out of a
// thousand lookups takes one place on the timeline instead of pushing everything else off it.

// A call that takes at least this long is counted as slow.
export const SLOW_CALL_MILLISECONDS = 500;
// A call that takes at least this long goes on the timeline. Ordinary calls on a phone take 100 to 200ms.
export const TIMELINE_CALL_MILLISECONDS = 250;
// Most entries the slow-call timeline keeps, oldest dropped first.
export const TIMELINE_ENTRY_LIMIT = 200;
// How many of the newest timeline entries a slow call may merge into.
const TIMELINE_MERGE_LOOKBACK = 8;

// ----------------------------------------------------------------------------------------------
// @desc Holds call counts and timings per label, and how many calls were in flight at once.
export class CallTimingMeter {
  clock; // {function} Returns epoch milliseconds; injected for tests.
  inFlight = 0; // {number} Calls started and not yet settled.
  maximumInFlight = 0; // {number} The most calls in flight at once since the meter was created.
  startedAt; // {number} Epoch milliseconds when the meter was created.
  timeline = []; // {Array<object>} Slow calls and bursts, oldest first: { calls, endedAt, label, maximumInFlight,
  //   maximumMilliseconds, startedAt } with epoch times.
  timingsByLabel = new Map(); // {Map<string, object>} { calls, failures, maximumMilliseconds, slowCalls, totalMilliseconds }.

  // ----------------------------------------------------------------------------------------------
  // @desc Construct an empty meter.
  // @param {object} [options] - { clock = Date.now }.
  constructor({ clock = Date.now } = {}) {
    this.clock = clock;
    this.startedAt = clock();
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Count something that took no call under a label, such as a queue change that left the note as it was.
  // @param {string} label - What was counted.
  count(label) {
    this._record(label, 0, false);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Run a call and add how long it took to settle to its label, whether it resolved or threw.
  // @param {string} label - What the call was, such as "getNoteContent" or "queueNote.claim.write".
  // @param {function} operation - () => a value or a promise; its result is returned unchanged.
  // @returns {Promise<*>} What the operation returned; rejects with what it threw.
  async measure(label, operation) {
    const startedAt = this.clock();
    this.inFlight += 1;
    this.maximumInFlight = Math.max(this.maximumInFlight, this.inFlight);
    const inFlightAtStart = this.inFlight;
    let failed = false;
    try {
      return await operation();
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      this.inFlight -= 1;
      const endedAt = this.clock();
      this._record(label, endedAt - startedAt, failed);
      if (endedAt - startedAt >= TIMELINE_CALL_MILLISECONDS) this._addToTimeline({ endedAt, inFlightAtStart, label, startedAt });
    }
  }

  // ----------------------------------------------------------------------------------------------
  // @desc A copy of the timings, labels with the most total time first, and the slow-call timeline.
  // @returns {object} { inFlight, labels, maximumInFlight, measuredMilliseconds, timeline } where labels is an array of
  //   { averageMilliseconds, calls, failures, label, maximumMilliseconds, slowCalls, totalMilliseconds } and timeline
  //   an array of { calls, endedAt, label, maximumInFlight, maximumMilliseconds, startedAt }, oldest first.
  snapshot() {
    const labels = [...this.timingsByLabel.entries()].map(([label, timing]) => ({ ...timing, label,
      averageMilliseconds: Math.round(timing.totalMilliseconds / timing.calls) }));
    labels.sort((first, second) => second.totalMilliseconds - first.totalMilliseconds || first.label.localeCompare(second.label));
    const timeline = this.timeline.map(entry => ({ ...entry }));
    return { inFlight: this.inFlight, labels, maximumInFlight: this.maximumInFlight, measuredMilliseconds: this.clock() - this.startedAt,
      timeline };
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Put a slow call on the timeline, merging it into the latest entry of its label when the two overlapped,
  //   which turns a parallel fan-out into one burst entry. Only the last few entries are searched, so a burst of
  //   one label interleaved with a few other slow calls still merges.
  // @param {object} call - { endedAt, inFlightAtStart, label, startedAt }: times in epoch milliseconds, and how many calls
  //   were in flight once this one started, itself included.
  _addToTimeline({ endedAt, inFlightAtStart, label, startedAt }) {
    const durationMilliseconds = endedAt - startedAt;
    const recentEntries = this.timeline.slice(-TIMELINE_MERGE_LOOKBACK);
    const overlapping = recentEntries.findLast(entry => entry.label === label && startedAt <= entry.endedAt);
    if (overlapping) {
      overlapping.calls += 1;
      overlapping.endedAt = Math.max(overlapping.endedAt, endedAt);
      overlapping.maximumInFlight = Math.max(overlapping.maximumInFlight, inFlightAtStart);
      overlapping.maximumMilliseconds = Math.max(overlapping.maximumMilliseconds, durationMilliseconds);
      overlapping.startedAt = Math.min(overlapping.startedAt, startedAt);
      return;
    }
    this.timeline.push({ calls: 1, endedAt, label, maximumInFlight: inFlightAtStart, maximumMilliseconds: durationMilliseconds,
      startedAt });
    if (this.timeline.length > TIMELINE_ENTRY_LIMIT) this.timeline.shift();
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Add one settled call to its label's totals.
  // @param {string} label - Call label.
  // @param {number} durationMilliseconds - How long the call took to settle.
  // @param {boolean} failed - Whether it threw.
  _record(label, durationMilliseconds, failed) {
    const timing = this.timingsByLabel.get(label)
      || { calls: 0, failures: 0, maximumMilliseconds: 0, slowCalls: 0, totalMilliseconds: 0 };
    timing.calls += 1;
    timing.totalMilliseconds += durationMilliseconds;
    timing.maximumMilliseconds = Math.max(timing.maximumMilliseconds, durationMilliseconds);
    if (durationMilliseconds >= SLOW_CALL_MILLISECONDS) timing.slowCalls += 1;
    if (failed) timing.failures += 1;
    this.timingsByLabel.set(label, timing);
  }
}

// Every Amplenote API call the embed sends to the host, by method name. The embed's app bridge records into it.
export const bridgeCallMeter = new CallTimingMeter();

// ----------------------------------------------------------------------------------------------
// @desc Run an operation through a meter when one is given, or directly when none is.
// @param {CallTimingMeter|null} meter - The meter, or null.
// @param {string} label - Call label.
// @param {function} operation - () => a value or a promise.
// @returns {Promise<*>} What the operation returned.
export async function measuredCall(meter, label, operation) {
  if (!meter) return operation();
  return meter.measure(label, operation);
}
