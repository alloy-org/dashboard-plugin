import { logIfEnabled } from "util/log";

const BYTES_PER_MEGABYTE = 1024 * 1024;

// ------------------------------------------------------------------------------------------
// @desc Read a single heap sample from performance.memory, converting bytes to megabytes and
//   deriving the fraction of the heap limit currently in use. Returns null on any runtime that does
//   not expose performance.memory (notably iOS WKWebView and desktop Safari).
// @returns {{ usedMb: number, totalMb: number, limitMb: number, usedRatio: number }|null}
export function readMemorySample() {
  if (typeof performance === "undefined") return null;
  const memory = performance.memory;
  if (!memory || typeof memory.usedJSHeapSize !== "number") return null;
  const usedMb = memory.usedJSHeapSize / BYTES_PER_MEGABYTE;
  const totalMb = memory.totalJSHeapSize / BYTES_PER_MEGABYTE;
  const limitMb = memory.jsHeapSizeLimit / BYTES_PER_MEGABYTE;
  const usedRatio = limitMb > 0 ? usedMb / limitMb : 0;
  return { limitMb: round(limitMb), totalMb: round(totalMb), usedMb: round(usedMb), usedRatio: round(usedRatio, 3) };
}

// ------------------------------------------------------------------------------------------
// @desc Observe performance.memory for a short window and return the lowest heap sample seen.
//   JavaScript cannot force garbage collection in the production embed, so the minimum is a more
//   useful approximation of retained memory than a single arbitrarily timed sample.
// @param {number} [durationMilliseconds=3000] - Total observation duration in milliseconds.
// @param {number} [intervalMilliseconds=250] - Delay between samples in milliseconds.
// @returns {Promise<Object|null>} Lowest observed heap sample, or null when unsupported.
export function lowestMemorySample(durationMilliseconds = 3000, intervalMilliseconds = 250) {
  if (!readMemorySample() || typeof setInterval === "undefined") return Promise.resolve(null);
  return new Promise(resolve => {
    let lowestSample = readMemorySample();
    const sample = () => {
      const currentSample = readMemorySample();
      if (currentSample && (!lowestSample || currentSample.usedMb < lowestSample.usedMb)) {
        lowestSample = currentSample;
      }
    };
    const intervalHandle = setInterval(sample, intervalMilliseconds);
    setTimeout(() => {
      sample();
      clearInterval(intervalHandle);
      resolve(lowestSample);
    }, durationMilliseconds);
  });
}

// ------------------------------------------------------------------------------------------
// @desc Bucket a heap-usage ratio into a coarse pressure label so aggregate analytics can group
//   samples without leaking exact byte counts. Thresholds are deliberately conservative because a
//   WKWebView can be killed well before the JS heap limit is reached.
// @param {number} usedRatio - Fraction of the JS heap limit in use (0..1).
// @returns {"low"|"moderate"|"high"|"critical"} Pressure bucket.
export function memoryPressureBucket(usedRatio) {
  if (usedRatio >= 0.9) return "critical";
  if (usedRatio >= 0.75) return "high";
  if (usedRatio >= 0.5) return "moderate";
  return "low";
}

// ------------------------------------------------------------------------------------------
// @desc Take a sample and emit it to the log buffer (which the DebugConsole widget renders) with a
//   caller-supplied label describing when it was taken. No-ops quietly when heap data is
//   unavailable so callers never need to branch on platform.
// @param {string} label - Context for the sample, e.g. "load-settle" or "interval".
// @returns {Object|null} The sample taken, or null when heap data is unavailable.
export function logMemorySample(label) {
  const sample = readMemorySample();
  if (!sample) return null;
  logIfEnabled(`[memory] ${ label }: used ${ sample.usedMb }MB / limit ${ sample.limitMb }MB `
    + `(${ Math.round(sample.usedRatio * 100) }%, ${ memoryPressureBucket(sample.usedRatio) })`);
  return sample;
}

// ------------------------------------------------------------------------------------------
// @desc Begin periodic heap sampling on an interval, logging each sample. Intended to run only when
//   the operator has opted into logging (the DebugConsole is the surface), so it is the caller's job
//   to gate the call. Returns a stop function; also no-ops (returning a no-op stopper) when heap
//   data is unavailable so nothing spins uselessly on iOS.
// @param {number} [intervalMs=15000] - Milliseconds between samples.
// @returns {function(): void} Call to stop sampling and clear the interval.
export function startMemorySampling(intervalMs = 15000) {
  if (!readMemorySample() || typeof setInterval === "undefined") return () => {};
  logMemorySample("sampling-start");
  const handle = setInterval(() => logMemorySample("interval"), intervalMs);
  return () => clearInterval(handle);
}

// ------------------------------------------------------------------------------------------
// @desc Round a number to a fixed number of decimal places, returning a Number (not a string) so
//   samples stay JSON- and comparison-friendly.
// @param {number} value - The value to round.
// @param {number} [places=1] - Decimal places to keep.
// @returns {number}
function round(value, places = 1) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
