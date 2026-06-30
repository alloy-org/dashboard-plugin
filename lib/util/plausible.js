// [Claude claude-opus-4-8-authored file]
// Task: thin wrapper for firing Plausible custom events from dashboard components
// Prompt: "enable plausible() custom events from within the dashboard component"
import { IS_DEV_ENVIRONMENT } from "constants/settings";

// ------------------------------------------------------------------------------------------
// @desc Fire a Plausible "Dashboard Action" custom event with the given action name and props.
//   Suppressed in the dev environment. Safe no-op if the Plausible script has not loaded (e.g. network/CSP blocked it
//   inside the embed sandbox) — early calls are otherwise queued on window.plausible.q by the bootstrap stub in
//   embed-html.js and flushed once the script loads. Attribution comes from the data-domain attribute on the script tag
//   (amplenote.com), not from the embed's URL, so the event registers correctly despite the iframe's opaque origin.
// @param {string} action - Short identifier for the action taken (e.g. "victory-value-click")
// @param {Object} [props={}] - Additional custom properties to attach to the event
// @returns {void}
// [Claude claude-opus-4-8] Task: track dashboard interactions via Plausible
export function trackDashboardAction(action, props = {}) {
  if (typeof window === "undefined" || typeof window.plausible !== "function") return;
  window.plausible("Dashboard Action", { props: { action, ...props } });
}
