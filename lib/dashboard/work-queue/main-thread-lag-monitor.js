// Measure how long the Dashboard's main thread goes without responding, and which work was running when it did. Two
// sources are kept side by side. Long animation frames, where the browser reports them (Chromium), or long tasks
// where only those are reported, give exact durations and the script that ran longest. A short repeating timer gives
// how late it fired, which every browser supports and which is the only measure WebKit offers. Each stall is credited
// to every job type that could have caused it (those running at its end, or that started or ended an attempt during
// it), and is marked as during an interaction when the user was scrolling or touching at either end. When jobs
// overlap, a stall is credited to each of them, so the per-type totals rank the suspects rather than adding up to the
// total. Amplenote's own work for a bridge call can share this thread, so it shows up here as well. Browser-only.
import { sanitizedFields, sanitizedValue } from "dashboard/work-queue/dashboard-work-diagnostics";
import { cancelWorkTimer, startWorkTimer } from "dashboard/work-queue/work-timers";
import { deviceMemoryGb, deviceTier, hardwareConcurrency, isMobilePlatform, viewportMetrics } from "util/device-profile";

// How often the timer sampler fires.
export const LAG_SAMPLE_INTERVAL_MILLISECONDS = 250;
// A frame or timer at least this late counts as a stall: past it, a tap or scroll visibly lags.
export const STALL_THRESHOLD_MILLISECONDS = 50;
// How many recent stalls are kept with their details.
export const RECENT_STALL_LIMIT = 100;
// Credited for a stall that ended before monitoring began, reported by the browser from its buffer.
export const BEFORE_MONITORING_LABEL = "(before monitoring)";
// Credited for a stall during which no job was running.
export const NO_JOB_LABEL = "(no job running)";
// Lower bounds of the stall duration histogram's buckets, in milliseconds.
const STALL_BUCKET_BOUNDS = [50, 100, 200, 400, 800];
// The fields an exported recent stall may carry.
const STALL_FIELDS = ["blockingMilliseconds", "durationMilliseconds", "interacting", "jobTypes", "offsetMilliseconds", "source",
  "topScript", "topScriptMilliseconds"];

// ----------------------------------------------------------------------------------------------
// @desc Samples main-thread lag from the moment it starts until it is disposed.
export default class MainThreadLagMonitor {
  activeJobTypesSince; // {function} (epochMilliseconds) => job types that could have held the thread since then.
  clearTimer; // {function} Cancels a timer from setTimer.
  clock; // {function} Returns epoch milliseconds.
  disposed = false; // {boolean} True once disposed; nothing further is sampled.
  hidden; // {function} Returns whether the page is hidden, when timers are throttled and lateness means nothing.
  interactionTracker; // {object|null} From createInteractionTracker.
  longFrameSource = "none"; // {string} "long-animation-frame", "longtask", or "none" when the browser reports neither.
  longFrames = _emptyStallTotals(); // {object} Totals for long frames or long tasks.
  observer = null; // {PerformanceObserver|null} Receives long frames or long tasks.
  performanceObject; // {Performance|null} Converts entry times to epoch milliseconds.
  performanceObserverClass; // {function|null} PerformanceObserver, or null where unavailable.
  recentStalls = []; // {Array<object>} The latest stalls with their details, oldest first.
  sampleTimer = null; // {*} The pending sampler timer.
  sampleExpectedAt = null; // {number|null} When the pending sampler timer should fire, in epoch milliseconds.
  setTimer; // {function} (callback, milliseconds) => timer.
  stallsByJobType = new Map(); // {Map<string, object>} { longFrameMilliseconds, longFrames, timerStallMilliseconds, timerStalls }.
  startedAt = null; // {number|null} Epoch milliseconds when monitoring began.
  timerLag = { ..._emptyStallTotals(), samples: 0 }; // {object} Totals for late sampler timers, and how many samples were taken.

  // ----------------------------------------------------------------------------------------------
  // @desc Construct a monitor; nothing is observed until start.
  // @param {object} options - { activeJobTypesSince, clearTimer = cancelWorkTimer, clock = Date.now, hidden, interactionTracker,
  //   performanceObject, performanceObserverClass, setTimer = startWorkTimer }; the performance options default to the
  //   browser's.
  constructor({ activeJobTypesSince, clearTimer = cancelWorkTimer, clock = Date.now, hidden = () => false, interactionTracker = null,
      performanceObject = _globalValue("performance"), performanceObserverClass = _globalValue("PerformanceObserver"),
      setTimer = startWorkTimer }) {
    Object.assign(this, { activeJobTypesSince, clearTimer, clock, hidden, interactionTracker, performanceObject,
      performanceObserverClass, setTimer });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Stop observing and sampling.
  dispose() {
    this.disposed = true;
    this.observer?.disconnect();
    this.observer = null;
    this.clearTimer(this.sampleTimer);
    this.sampleTimer = null;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc A sanitized copy of what has been measured, with the device's profile for comparing runs across devices.
  // @returns {object} { byJobType, device, interaction, longFrameSource, longFrames, monitoredMilliseconds, recentStalls,
  //   stallThresholdMilliseconds, timerLag }; byJobType is sorted with the most stalled time first.
  snapshot() {
    const byJobType = [...this.stallsByJobType.entries()].map(([jobType, stalls]) => ({ jobType: sanitizedValue(jobType), ...stalls }));
    byJobType.sort((first, second) => _stalledMilliseconds(second) - _stalledMilliseconds(first));
    const recentStalls = this.recentStalls.map(stall => sanitizedFields(stall, STALL_FIELDS));
    const monitoredMilliseconds = this.startedAt === null ? 0 : this.clock() - this.startedAt;
    return { byJobType, device: _deviceProfile(), interaction: this.interactionTracker?.snapshot() || null,
      longFrameSource: this.longFrameSource, longFrames: _copiedTotals(this.longFrames), monitoredMilliseconds, recentStalls,
      stallThresholdMilliseconds: STALL_THRESHOLD_MILLISECONDS, timerLag: _copiedTotals(this.timerLag) };
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Begin observing long frames where the browser reports them, including those it buffered since the page
  //   loaded, and begin sampling timer lateness.
  start() {
    if (this.disposed || this.startedAt !== null) return;
    this.startedAt = this.clock();
    this._observeLongFrames();
    this._scheduleSample();
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Record one long animation frame or long task. A long animation frame names the script that ran longest in it.
  // @param {object} entry - A PerformanceEntry of type "long-animation-frame" or "longtask".
  _handleLongFrame(entry) {
    const startedAt = this._epochFromEntryTime(entry.startTime);
    const durationMilliseconds = Math.round(entry.duration);
    const blockingMilliseconds = Math.round(typeof entry.blockingDuration === "number" ? entry.blockingDuration
      : Math.max(0, entry.duration - STALL_THRESHOLD_MILLISECONDS));
    const scripts = entry.scripts || [];
    const longestScript = scripts.reduce((longest, script) => (!longest || script.duration > longest.duration ? script : longest), null);
    const scriptNameParts = longestScript ? [longestScript.invokerType, longestScript.invoker, longestScript.sourceFunctionName] : [];
    const topScript = longestScript ? scriptNameParts.filter(Boolean).join(" ") : null;
    const topScriptMilliseconds = longestScript ? Math.round(longestScript.duration) : null;
    this._recordStall({ blockingMilliseconds, durationMilliseconds, source: "longFrame", startedAt, topScript, topScriptMilliseconds });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Convert a performance timeline time to epoch milliseconds.
  // @param {number} entryTime - Milliseconds since the page's time origin.
  // @returns {number} Epoch milliseconds.
  _epochFromEntryTime(entryTime) {
    const timeOrigin = this.performanceObject?.timeOrigin;
    if (typeof timeOrigin === "number") return Math.round(timeOrigin + entryTime);
    const now = this.performanceObject?.now?.() ?? entryTime;
    return Math.round(this.clock() - (now - entryTime));
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Observe long animation frames, or long tasks where those are all the browser reports.
  _observeLongFrames() {
    const supportedTypes = this.performanceObserverClass?.supportedEntryTypes || [];
    const entryType = ["long-animation-frame", "longtask"].find(type => supportedTypes.includes(type));
    if (!entryType) return;
    try {
      this.observer = new this.performanceObserverClass(list => {
        if (!this.disposed) list.getEntries().forEach(entry => this._handleLongFrame(entry));
      });
      this.observer.observe({ buffered: true, type: entryType });
      this.longFrameSource = entryType;
    } catch {
      this.observer = null;
    }
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Add one stall to its source's totals and the recent stalls, crediting it to the job types that could have
  //   caused it.
  // @param {object} stall - { blockingMilliseconds, durationMilliseconds, source, startedAt, topScript = null,
  //   topScriptMilliseconds = null }, source being "longFrame" or "timer" and startedAt in epoch milliseconds.
  _recordStall({ blockingMilliseconds, durationMilliseconds, source, startedAt, topScript = null, topScriptMilliseconds = null }) {
    const endedAt = startedAt + durationMilliseconds;
    const interacting = Boolean(this.interactionTracker?.interacting(startedAt) || this.interactionTracker?.interacting(endedAt));
    const activeTypes = endedAt < this.startedAt ? [BEFORE_MONITORING_LABEL] : this.activeJobTypesSince(startedAt);
    const jobTypes = activeTypes.length ? activeTypes : [NO_JOB_LABEL];
    _addToTotals(source === "timer" ? this.timerLag : this.longFrames, durationMilliseconds, interacting);
    for (const jobType of jobTypes) {
      const stalls = this.stallsByJobType.get(jobType)
        || { longFrameMilliseconds: 0, longFrames: 0, timerStallMilliseconds: 0, timerStalls: 0 };
      if (source === "timer") {
        stalls.timerStalls += 1;
        stalls.timerStallMilliseconds += durationMilliseconds;
      } else {
        stalls.longFrames += 1;
        stalls.longFrameMilliseconds += durationMilliseconds;
      }
      this.stallsByJobType.set(jobType, stalls);
    }
    this.recentStalls.push({ blockingMilliseconds, durationMilliseconds, interacting, jobTypes: jobTypes.join(", "),
      offsetMilliseconds: startedAt - this.startedAt, source, topScript, topScriptMilliseconds });
    if (this.recentStalls.length > RECENT_STALL_LIMIT) this.recentStalls.shift();
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Measure how late the sampler timer fired and record a stall when it was late enough, then schedule the next
  //   sample. A sample that began or ended while the page was hidden is discarded, since hidden pages throttle timers.
  // @param {boolean} hiddenWhenScheduled - Whether the page was hidden when this sample was scheduled.
  _sample(hiddenWhenScheduled) {
    this.sampleTimer = null;
    if (this.disposed) return;
    const now = this.clock();
    const lateness = Math.max(0, now - this.sampleExpectedAt);
    if (!hiddenWhenScheduled && !this.hidden()) {
      this.timerLag.samples += 1;
      if (lateness >= STALL_THRESHOLD_MILLISECONDS) {
        this._recordStall({ blockingMilliseconds: lateness - STALL_THRESHOLD_MILLISECONDS, durationMilliseconds: lateness,
          source: "timer", startedAt: now - lateness });
      }
    }
    this._scheduleSample();
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Schedule the next timer sample.
  _scheduleSample() {
    const hiddenWhenScheduled = this.hidden();
    this.sampleExpectedAt = this.clock() + LAG_SAMPLE_INTERVAL_MILLISECONDS;
    this.sampleTimer = this.setTimer(() => this._sample(hiddenWhenScheduled), LAG_SAMPLE_INTERVAL_MILLISECONDS);
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Add one stall to a source's totals.
// @param {object} totals - From _emptyStallTotals, changed in place.
// @param {number} durationMilliseconds - The stall's duration.
// @param {boolean} interacting - Whether the user was interacting during it.
function _addToTotals(totals, durationMilliseconds, interacting) {
  totals.count += 1;
  totals.totalMilliseconds += durationMilliseconds;
  totals.maximumMilliseconds = Math.max(totals.maximumMilliseconds, durationMilliseconds);
  if (interacting) {
    totals.duringInteractionCount += 1;
    totals.duringInteractionMilliseconds += durationMilliseconds;
  }
  const bucketBound = [...STALL_BUCKET_BOUNDS].reverse().find(bound => durationMilliseconds >= bound) ?? STALL_BUCKET_BOUNDS[0];
  totals.histogram[_bucketLabel(bucketBound)] += 1;
}

// ----------------------------------------------------------------------------------------------
// @desc Name a histogram bucket by its bounds, such as "100-199" or "800+".
// @param {number} bound - The bucket's lower bound, one of STALL_BUCKET_BOUNDS.
// @returns {string} The bucket's name.
function _bucketLabel(bound) {
  const nextBound = STALL_BUCKET_BOUNDS[STALL_BUCKET_BOUNDS.indexOf(bound) + 1];
  return nextBound ? `${ bound }-${ nextBound - 1 }` : `${ bound }+`;
}

// ----------------------------------------------------------------------------------------------
// @desc A copy of a source's totals, its histogram copied too.
// @param {object} totals - From _emptyStallTotals.
// @returns {object} The copy.
function _copiedTotals(totals) {
  return { ...totals, histogram: { ...totals.histogram } };
}

// ----------------------------------------------------------------------------------------------
// @desc The device's profile, so exports from a phone and a laptop can be told apart and compared.
// @returns {object} { deviceMemoryGigabytes, hardwareConcurrency, mobile, tier, userAgent, viewport }.
function _deviceProfile() {
  const userAgent = typeof navigator === "undefined" ? null : sanitizedValue(navigator.userAgent || null);
  return { deviceMemoryGigabytes: deviceMemoryGb(), hardwareConcurrency: hardwareConcurrency(), mobile: isMobilePlatform(),
    tier: deviceTier(), userAgent, viewport: viewportMetrics() };
}

// ----------------------------------------------------------------------------------------------
// @desc Empty totals for one stall source.
// @returns {object} { count, duringInteractionCount, duringInteractionMilliseconds, histogram, maximumMilliseconds,
//   totalMilliseconds }, histogram counting stalls per duration bucket.
function _emptyStallTotals() {
  const histogram = {};
  for (const bound of STALL_BUCKET_BOUNDS) histogram[_bucketLabel(bound)] = 0;
  return { count: 0, duringInteractionCount: 0, duringInteractionMilliseconds: 0, histogram, maximumMilliseconds: 0, totalMilliseconds: 0 };
}

// ----------------------------------------------------------------------------------------------
// @desc A browser global, or null where the runtime lacks it.
// @param {string} name - Global name, such as "PerformanceObserver".
// @returns {*} The global's value, or null.
function _globalValue(name) {
  return typeof globalThis[name] === "undefined" ? null : globalThis[name];
}

// ----------------------------------------------------------------------------------------------
// @desc A job type's stalled time, preferring long frames where the browser reports them.
// @param {object} stalls - { longFrameMilliseconds, timerStallMilliseconds }.
// @returns {number} Milliseconds.
function _stalledMilliseconds(stalls) {
  return stalls.longFrameMilliseconds || stalls.timerStallMilliseconds;
}
