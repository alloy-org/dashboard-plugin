/**
 * [Claude-authored file]
 * Created: 2026-02-20 | Model: claude-sonnet-4-5-20250929
 * Task: Generate self-contained HTML for Amplenote embed
 * Prompt summary: "build embed HTML that inlines the client bundle and CSS"
 */
import { clientBase64 } from "client-bundle";
import { compiledCSS } from "css-content";
import { MAX_QUEUED_SENTRY_EVENTS } from "util/sentry-reporting";

const SENTRY_DSN = (typeof process !== "undefined" && process.env.SENTRY_DSN) || "";
const SENTRY_CDN_URL = "https://browser.sentry-cdn.com/8.55.0/bundle.min.js";

// ------------------------------------------------------------------------------------------
// @desc Optional embed-side Sentry loader, emitted only when a DSN was configured at build time. Three properties of
//   this snippet matter for the mobile failures it exists to catch. (1) The SDK is fetched async, so a slow or
//   CSP-blocked CDN can never delay dashboard boot. (2) The window error listeners are installed synchronously here,
//   ahead of the client bundle, so an exception thrown while the bundle's modules evaluate — before any of our own
//   JavaScript could have registered a handler — is still recorded. (3) Events raised before the SDK arrives are
//   queued rather than dropped, then flushed on init; the client bundle registers a richer drain hook when it loads,
//   and this snippet drains the queue itself when it did not (i.e. when the bundle is what failed).
//   Sentry's default integrations stay off on purpose: this embed already fights iOS Jetsam kills (see
//   dashboard/crash-breadcrumb.js), and the default console/DOM/fetch instrumentation would wrap browser APIs and
//   retain breadcrumbs for every interaction on exactly the devices with the least memory to spare.
// @returns {string} Loader script tags, or an empty string when no DSN is configured (no runtime cost at all)
function sentryEmbedScripts() {
  if (!SENTRY_DSN) return "";
  return `
  <!-- Embed-side Sentry, separate from the host app's, for visibility into exceptions inside the plugin iframe. -->
  <script>
    (function () {
      window.__dashboardSentryQueue = [];
      function queueEvent(entry) {
        if (!Array.isArray(window.__dashboardSentryQueue)) return;
        if (window.__dashboardSentryQueue.length < ${ MAX_QUEUED_SENTRY_EVENTS }) window.__dashboardSentryQueue.push(entry);
      }
      function sendEvent(entry) {
        if (!window.Sentry || typeof window.Sentry.withScope !== "function") return;
        window.Sentry.withScope(function (scope) {
          var tags = entry.tags || {};
          for (var tagName in tags) { if (tags[tagName] != null) scope.setTag(tagName, String(tags[tagName])); }
          if (entry.level) scope.setLevel(entry.level);
          if (entry.error) window.Sentry.captureException(entry.error);
          else if (entry.message) window.Sentry.captureMessage(String(entry.message));
        });
      }
      function reportEvent(errorLike, source) {
        var error = errorLike instanceof Error ? errorLike : new Error(String(errorLike));
        var entry = { error: error, tags: { "dashboard.source": source } };
        if (window.__dashboardSentryReady === true) sendEvent(entry); else queueEvent(entry);
      }
      window.addEventListener("error", function (event) { reportEvent(event.error || event.message, "window-error"); });
      window.addEventListener("unhandledrejection", function (event) { reportEvent(event.reason, "unhandledrejection"); });
      window.__initDashboardSentry = function () {
        if (!window.Sentry || typeof window.Sentry.init !== "function") {
          console.error("[sentry] SDK loaded without an init(); dashboard exceptions will not be reported");
          return;
        }
        window.Sentry.init({ defaultIntegrations: false, dsn: ${ JSON.stringify(SENTRY_DSN) }, environment: "dashboard-embed", integrations: [] });
        window.__dashboardSentryReady = true;
        if (typeof window.__dashboardDrainSentryQueue === "function") { window.__dashboardDrainSentryQueue(); return; }
        var queued = window.__dashboardSentryQueue || [];
        window.__dashboardSentryQueue = null;
        for (var index = 0; index < queued.length; index += 1) sendEvent(queued[index]);
      };
    })();
  </script>
  <script async crossorigin="anonymous" src="${ SENTRY_CDN_URL }"
    onload="window.__initDashboardSentry()"
    onerror="console.error('[sentry] CDN SDK failed to load (404/CSP/network); dashboard exceptions will not be reported')"></script>`;
}

// [Claude] Task: produce self-contained HTML string with inlined CSS and base64 client JS
// Prompt: "build embed HTML that inlines the client bundle and CSS"
// Date: 2026-02-20 | Model: claude-sonnet-4-5-20250929
export function buildEmbedHTML() {
  return (`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${compiledCSS}</style>
  <!-- autoCapturePageviews is disabled because location.href inside the embed is a junk data: URL. -->
  <!-- data-api / endpoint must be pinned to the proxy path: the script otherwise auto-derives the event -->
  <!-- endpoint as origin + /api/event, hitting amplenote.com's 404 page (no CORS headers) instead of the proxy. -->
  <script defer data-domain="amplenote.com" data-api="https://www.amplenote.com/plausible-proxy/api/event" src="https://www.amplenote.com/plausible-proxy/js/script.js"></script>
  <script>
    window.plausible = window.plausible || function () { (window.plausible.q = window.plausible.q || []).push(arguments); };
    window.plausible.init = window.plausible.init || function (options) { window.plausible.o = options || {}; };
    window.plausible.init({ autoCapturePageviews: false, endpoint: "https://www.amplenote.com/plausible-proxy/api/event" });
  </script>
  <!-- [Claude claude-opus-4-8] Task: surface Plausible tracker load failures (otherwise events queue silently forever) -->
  <script>
    (function () {
      var scriptEl = document.querySelector('script[src="https://www.amplenote.com/plausible-proxy/js/script.js"]');
      if (!scriptEl) return;
      scriptEl.addEventListener("error", function (event) {
        console.error("[plausible] failed to load (404/CSP/network); Dashboard Action events will not be delivered", event);
      });
    })();
  </script>${ sentryEmbedScripts() }
</head>
<body>
  <div id="dashboard-root"></div>
  <script type="text/javascript" src="data:text/javascript;base64,${clientBase64}"></script>
</body>
</html>`);
}
