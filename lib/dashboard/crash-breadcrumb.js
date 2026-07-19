/**
 * [Claude claude-opus-4-8 (1M context)-authored file]
 * Created: 2026-07-19 | Model: claude-opus-4-8 (1M context)
 * Task: Detect out-of-memory crashes on mobile, which no JavaScript error handler can catch.
 * Prompt summary: "instrument memory usage" — on iOS the WKWebView WebContent process is killed by
 *   Jetsam under memory pressure, so the only reliable signal is a breadcrumb persisted BEFORE the
 *   heavy render and stamped as settled only AFTER a clean load. If the next launch finds an
 *   unstamped breadcrumb, the prior session almost certainly died mid-render.
 *
 * Persistence goes through app.setSetting (the host bridge) rather than localStorage: the embed runs
 * from a data: URL, whose opaque origin makes localStorage throw a SecurityError.
 */
import { SETTING_KEYS } from "constants/settings";
import { logIfEnabled } from "util/log";
import { snapDashboardAction } from "util/plausible";

// ------------------------------------------------------------------------------------------
// @desc Parse a persisted breadcrumb setting value, tolerating a pre-parsed object, a JSON string,
//   or missing/garbage input.
// @param {*} rawValue - Value read from the settings snapshot for SETTING_KEYS.RENDER_BREADCRUMB.
// @returns {Object|null} Parsed breadcrumb object, or null when absent/unparseable.
export function parseBreadcrumb(rawValue) {
  if (!rawValue) return null;
  if (typeof rawValue === "object") return rawValue;
  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------------------------------
// @desc Inspect the breadcrumb left by the previous session (carried in the init settings snapshot)
//   to decide whether that session crashed before it finished loading. A breadcrumb that was never
//   stamped with settledAt means the prior render never reached a clean settle — the strongest
//   available proxy for an out-of-memory kill. A stamped breadcrumb means the prior session loaded
//   fine. Note: a user who closes the dashboard mid-load also leaves an unstamped breadcrumb, so
//   treat this as a strong-but-not-certain crash signal, best interpreted alongside device tier.
// @param {Object} settingsSnapshot - The settings map from the init payload.
// @returns {{ crashed: boolean, breadcrumb: Object }|null} Result, or null when no breadcrumb exists.
export function detectPriorCrash(settingsSnapshot) {
  const breadcrumb = parseBreadcrumb(settingsSnapshot?.[SETTING_KEYS.RENDER_BREADCRUMB]);
  if (!breadcrumb) return null;
  return { breadcrumb, crashed: breadcrumb.settledAt == null };
}

// ------------------------------------------------------------------------------------------
// @desc If the previous session appears to have crashed, log it and fire a Plausible event carrying
//   the fingerprint (widget count, device tier) so aggregate analysis can correlate crashes with
//   layouts and device classes. Safe no-op when there is no breadcrumb or the prior session settled.
// @param {Object} settingsSnapshot - The settings map from the init payload.
// @returns {Object|null} The crashing breadcrumb when a crash was reported, else null.
export function reportPriorCrashIfAny(settingsSnapshot) {
  const detection = detectPriorCrash(settingsSnapshot);
  if (!detection || !detection.crashed) return null;
  const { breadcrumb } = detection;
  logIfEnabled(`[crash-breadcrumb] prior session did not reach load-settle — likely OOM. `
    + `widgets:${ breadcrumb.widgetCount } tier:${ breadcrumb.tier } mobile:${ breadcrumb.mobile }`,
    breadcrumb.widgetIds);
  snapDashboardAction("dashboardPriorCrash", { cores: breadcrumb.cores ?? "unknown",
    memoryGb: breadcrumb.memoryGb ?? "unknown", tier: breadcrumb.tier ?? "unknown",
    widgetCount: breadcrumb.widgetCount ?? 0 });
  return breadcrumb;
}

// ------------------------------------------------------------------------------------------
// @desc Persist a breadcrumb describing the render we are ABOUT to attempt, with settledAt left null
//   so a crash before settle is detectable next launch. Writes through the host bridge and mirrors
//   into the embed cache. Callers should gate this to memory-constrained devices to avoid a settings
//   write on every desktop load. Bridge errors propagate so callers can distinguish a failed
//   persistence operation from a successful breadcrumb write.
// @param {Object} app - The Amplenote app bridge.
// @param {{ widgetIds: string[], deviceProfile: Object, startedAt: number }} details - Fingerprint.
// @returns {Promise<Object|null>} The written breadcrumb, or null when the write failed.
export async function writeRenderBreadcrumb(app, { deviceProfile, startedAt, widgetIds }) {
  const breadcrumb = { cores: deviceProfile?.cores ?? null, memoryGb: deviceProfile?.memoryGb ?? null,
    mobile: !!deviceProfile?.mobile, settledAt: null, startedAt, tier: deviceProfile?.tier ?? null,
    widgetCount: widgetIds.length, widgetIds };
  await app.setSetting(SETTING_KEYS.RENDER_BREADCRUMB, JSON.stringify(breadcrumb));
  return breadcrumb;
}

// ------------------------------------------------------------------------------------------
// @desc Stamp the current breadcrumb as settled once the dashboard has loaded cleanly, so the next
//   launch does not misread this session as a crash. Rewrites the whole record (settings storage is
//   last-write-wins) rather than trying to patch it.
// @param {Object} app - The Amplenote app bridge.
// @param {{ widgetIds: string[], deviceProfile: Object, startedAt: number, settledAt: number }} details
// @returns {Promise<void>}
export async function stampBreadcrumbSettled(app, { deviceProfile, settledAt, startedAt, widgetIds }) {
  const breadcrumb = { cores: deviceProfile?.cores ?? null, memoryGb: deviceProfile?.memoryGb ?? null,
    mobile: !!deviceProfile?.mobile, settledAt, startedAt, tier: deviceProfile?.tier ?? null,
    widgetCount: widgetIds.length, widgetIds };
  await app.setSetting(SETTING_KEYS.RENDER_BREADCRUMB, JSON.stringify(breadcrumb));
}
