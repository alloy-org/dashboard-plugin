// Devices at or below this many gigabytes of reported RAM are treated as memory-constrained. 4GB is
// the ceiling below which mid-range phones (and the WKWebView per-process Jetsam limit on iOS) start
// killing the embed under a full widget grid. navigator.deviceMemory is capped at 8 and quantized by
// the browser, so this compares against a coarse bucket, not a precise measurement.
const LOW_MEMORY_GB_THRESHOLD = 4;

// Fewer logical cores than this is a second, independent signal of a low-end device — used because
// navigator.deviceMemory is Chromium-only and absent on iOS Safari/WKWebView.
const LOW_CORE_COUNT_THRESHOLD = 4;

// Viewport widths at or below this are treated as phone-sized. Mirrors LARGE_PHONE_BREAKPOINT_PIXELS
// in dashboard-load.jsx so the two agree on what "phone" means.
const PHONE_VIEWPORT_WIDTH_PIXELS = 430;

// ------------------------------------------------------------------------------------------
// @desc Detect whether the current runtime is a mobile device, including iPadOS which reports a
//   desktop user agent but exposes touch points. This is the canonical implementation; other call
//   sites historically inlined the same regex.
// @returns {boolean} True when the runtime appears to be a phone or tablet.
export function isMobilePlatform() {
  if (typeof navigator === "undefined") return false;
  const userAgent = navigator.userAgent || "";
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent)) return true;
  return navigator.maxTouchPoints > 1 && /Macintosh/.test(userAgent);
}

// ------------------------------------------------------------------------------------------
// @desc Reported device RAM in gigabytes, when the browser exposes it (Chromium only). Safari and
//   iOS WKWebView do not implement navigator.deviceMemory, so this returns null there.
// @returns {number|null} Gigabytes (coarse, quantized) or null when unavailable.
export function deviceMemoryGb() {
  if (typeof navigator === "undefined") return null;
  const reported = navigator.deviceMemory;
  return typeof reported === "number" && reported > 0 ? reported : null;
}

// ------------------------------------------------------------------------------------------
// @desc Logical CPU core count when exposed, a rough proxy for device tier that is available more
//   widely than deviceMemory.
// @returns {number|null} Core count or null when unavailable.
export function hardwareConcurrency() {
  if (typeof navigator === "undefined") return null;
  const reported = navigator.hardwareConcurrency;
  return typeof reported === "number" && reported > 0 ? reported : null;
}

// ------------------------------------------------------------------------------------------
// @desc Capture the visible viewport dimensions, preferring the real device width because the
//   WKWebView iframe reports an inflated window.innerWidth (see constrainToDeviceWidth in
//   dashboard-load.jsx). Falls back gracefully when screen/window are unavailable.
// @returns {{ innerWidth: number|null, innerHeight: number|null, deviceWidth: number|null }}
export function viewportMetrics() {
  if (typeof window === "undefined") return { deviceWidth: null, innerHeight: null, innerWidth: null };
  const screenObject = typeof screen !== "undefined" ? screen : null;
  const deviceWidth = screenObject ? Math.min(screenObject.width, screenObject.height) : null;
  return { deviceWidth, innerHeight: window.innerHeight || null, innerWidth: window.innerWidth || null };
}

// ------------------------------------------------------------------------------------------
// @desc Classify the device into a coarse memory tier so callers (memory instrumentation,
//   lazy-mount gating) can decide how conservative to be. A device is "low" if any strong signal
//   says so: constrained RAM, few cores, or a phone-sized viewport on a mobile platform. It is
//   "high" only when it is clearly a desktop with ample resources. Everything else is "medium".
// @returns {"low"|"medium"|"high"} The device memory tier.
export function deviceTier() {
  const memoryGb = deviceMemoryGb();
  const cores = hardwareConcurrency();
  const mobile = isMobilePlatform();
  const { deviceWidth } = viewportMetrics();
  const phoneSized = deviceWidth != null && deviceWidth <= PHONE_VIEWPORT_WIDTH_PIXELS;

  if ((memoryGb != null && memoryGb <= LOW_MEMORY_GB_THRESHOLD)
    || (cores != null && cores <= LOW_CORE_COUNT_THRESHOLD)
    || (mobile && phoneSized)) {
    return "low";
  }
  if (!mobile && (memoryGb == null || memoryGb > LOW_MEMORY_GB_THRESHOLD)
    && (cores == null || cores > LOW_CORE_COUNT_THRESHOLD)) {
    return "high";
  }
  return "medium";
}

// ------------------------------------------------------------------------------------------
// @desc Whether the device is memory-constrained enough to warrant defensive behavior (crash
//   breadcrumbs, more aggressive lazy mounting). True for mobile devices and for any device that
//   classifies as the "low" tier.
// @returns {boolean}
export function isMemoryConstrainedDevice() {
  return isMobilePlatform() || deviceTier() === "low";
}

// ------------------------------------------------------------------------------------------
// @desc Assemble a single snapshot object describing the device, suitable for logging, Plausible
//   props, and the crash breadcrumb. Values that the browser does not expose are null rather than
//   omitted so downstream aggregation can distinguish "unknown" from "absent".
// @returns {Object} Device profile with tier, mobile flag, memory/cores, and viewport metrics.
export function deviceProfile() {
  const { deviceWidth, innerHeight, innerWidth } = viewportMetrics();
  return { cores: hardwareConcurrency(), deviceWidth, innerHeight, innerWidth,
    memoryGb: deviceMemoryGb(), mobile: isMobilePlatform(), tier: deviceTier() };
}

// ------------------------------------------------------------------------------------------
// @desc Publish the device profile onto window.__dashboardViewportDiag, the diagnostic hook that
//   dashboard.jsx already reads and logs at init. Populating it here means that read surfaces real
//   data (previously nothing in the source ever set it).
// @returns {Object|undefined} The published profile, or undefined when window is unavailable.
export function publishDeviceProfileDiagnostic() {
  if (typeof window === "undefined") return undefined;
  const profile = deviceProfile();
  window.__dashboardViewportDiag = profile;
  return profile;
}
