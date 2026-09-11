// Host-side transport for Plausible custom events, used by plugin actions that run outside the embed iframe
// and therefore have no window.plausible tracker to queue against.
import { logIfEnabled } from "util/log"

// Attribution is by configured domain rather than request origin, matching the data-domain on the embed's
// tracker script in embed-html.js.
const PLAUSIBLE_DOMAIN = "amplenote.com";
// Shares the custom event name the embed fires, so host and widget actions land in one Plausible bucket and
// are told apart by their `action` prop.
const PLAUSIBLE_EVENT_NAME = "Dashboard Action";
// The proxy path the embed posts to. amplenote.com/api/event is a 404 page with no CORS headers, so the
// endpoint must stay pinned here exactly as it is in embed-html.js.
const PLAUSIBLE_EVENT_ENDPOINT = "https://www.amplenote.com/plausible-proxy/api/event";
// Every host event shares one synthetic URL: the host has no location to report, and pageview capture is
// disabled, so this field exists only because the events API requires it.
const PLAUSIBLE_HOST_URL = "https://www.amplenote.com/dashboard-plugin/host";
// Analytics must never hold up a host action, so a stalled proxy is abandoned rather than awaited.
const PLAUSIBLE_TIMEOUT_MS = 3000;

// ----------------------------------------------------------------------------------------------
// @desc Post a Plausible "Dashboard Action" event directly to the proxy endpoint, so host-side plugin actions
//   can be instrumented alongside the events the embed fires through window.plausible. Resolves either way
//   and never throws: analytics must not break the action that reported it. No-ops when `fetch` is missing
//   (the host sandbox the production bundle test runs in), abandons a request that outlives
//   PLAUSIBLE_TIMEOUT_MS, and swallows every network, CORS, and proxy failure.
// @param {string} action - Short identifier for the action taken (e.g. "suggestScheduledTasks")
// @param {Object} [props={}] - Additional custom properties to attach to the event; values should be strings,
//   numbers, or booleans, as Plausible discards other types.
// @returns {Promise<boolean>} True when the proxy accepted the event, false when it was skipped or failed.
export async function snapHostAction(action, props = {}) {
  if (typeof fetch !== "function") return false;
  const eventPayload = { domain: PLAUSIBLE_DOMAIN, name: PLAUSIBLE_EVENT_NAME, props: { action, ...props },
    url: PLAUSIBLE_HOST_URL };
  try {
    const response = await _responseFromEventPost(eventPayload);
    if (response?.ok) return true;
    logIfEnabled(`[Plausible] Proxy refused host action "${ action }":`, response?.status ?? "timed out");
    return false;
  } catch (error) {
    logIfEnabled(`[Plausible] Failed to capture host action "${ action }":`, error?.message || error);
    return false;
  }
}

// ----------------------------------------------------------------------------------------------
// Private
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc POST one event body to the Plausible proxy, giving up once PLAUSIBLE_TIMEOUT_MS has elapsed.
// @param {Object} eventPayload - Plausible events API body ({ domain, name, props, url }).
// @returns {Promise<Response|null>} The proxy response, or null when the request outlived the timeout.
async function _responseFromEventPost(eventPayload) {
  const abortController = typeof AbortController === "function" ? new AbortController() : null;
  let timeoutId = null;
  const timeoutPromise = new Promise(resolve => {
    timeoutId = setTimeout(() => { abortController?.abort(); resolve(null); }, PLAUSIBLE_TIMEOUT_MS);
  });
  const requestPromise = fetch(PLAUSIBLE_EVENT_ENDPOINT, { body: JSON.stringify(eventPayload),
    headers: { "Content-Type": "application/json" }, keepalive: true, method: "POST",
    signal: abortController?.signal });
  // The timeout can win the race, which would leave the abort rejection unhandled without this handler.
  requestPromise.catch(() => null);
  try {
    return await Promise.race([requestPromise, timeoutPromise]);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}
