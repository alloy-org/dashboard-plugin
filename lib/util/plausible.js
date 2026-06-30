// [Claude claude-opus-4-8-authored file]
// Task: thin wrapper for firing Plausible custom events from dashboard components
// Prompt: "enable plausible() custom events from within the dashboard component"
import { logIfEnabled } from "util/log"

// ------------------------------------------------------------------------------------------
// @desc Fire a Plausible "Dashboard Action" custom event with the given action name and props.
//   Safe no-op if the Plausible script has not loaded (e.g. network/CSP blocked it inside the embed
//   sandbox) — early calls are otherwise queued on window.plausible.q by the bootstrap stub in embed-html.js
//   and flushed once the script loads, and any throw is swallowed so a failed tracker can never break the
//   calling interaction. Attribution comes from the data-domain attribute on the script tag (amplenote.com),
//   not from the embed's URL, so the event registers correctly despite the iframe's opaque origin.
// @param {string} action - Short identifier for the action taken (e.g. "victory-value-click")
// @param {Object} [props={}] - Additional custom properties to attach to the event
export function snapDashboardAction(action, props = {}) {
  if (typeof window === "undefined" || typeof window.plausible !== "function") return;
  try {
    window.plausible("Dashboard Action", { props: { action, ...props } });
  } catch (error) {
    // Analytics must never break a user interaction; the tracker may be absent, queued, or CSP-blocked.
    logIfEnabled(`[Plausible] Failed to capture dashboard action "${ action }":`, error);
  }
}
