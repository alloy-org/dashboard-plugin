/**
 * [Claude-authored file]
 * Created: 2026-08-07 | Model: claude-opus-5[1m]
 * Task: Shared embed-side Sentry loader snippet, emitted into both the production embed HTML and the dev shell
 * Prompt summary: "Does development environment load Sentry? It seems like it should so we can test it along with the rest"
 *
 * Deliberately imports nothing. The production build reaches this through esbuild's bare "util/*" specifiers, but
 * dev/dev-server.js imports it as a plain Node ESM file by relative path, where those specifiers do not resolve.
 */

// Cap on events held while the async CDN SDK is still in flight. The queue exists so a failure during bundle
// evaluation or first mount — the mobile symptom this reporting was added for — is not lost simply because the SDK
// had not arrived yet. It is bounded because a boot loop could otherwise retain events indefinitely on a device
// already under memory pressure. Interpolated into the loader snippet below so both halves agree.
export const MAX_QUEUED_SENTRY_EVENTS = 20;

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
// @param {Object} options - Loader options with the following properties:
// - {string} dsn - Sentry DSN; an empty value suppresses the loader entirely
// - {string} environment - Sentry `environment` tag, which is what separates dev events from real user reports
//   within the shared project ("dashboard-embed" in production, "dashboard-dev" from the dev server)
// @returns {string} Loader script tags, or an empty string when no DSN is configured (no runtime cost at all)
export function buildSentryLoaderScripts({ dsn, environment }) {
  if (!dsn) return "";
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
        window.Sentry.init({ defaultIntegrations: false, dsn: ${ JSON.stringify(dsn) }, environment: ${ JSON.stringify(environment) }, integrations: [] });
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
