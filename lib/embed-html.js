/**
 * [Claude-authored file]
 * Created: 2026-02-20 | Model: claude-sonnet-4-5-20250929
 * Task: Generate self-contained HTML for Amplenote embed
 * Prompt summary: "build embed HTML that inlines the client bundle and CSS"
 */
import { clientScript } from "client-bundle";
import { compiledCSS } from "css-content";
import { buildSentryLoaderScripts } from "util/sentry-loader";

const SENTRY_DSN = (typeof process !== "undefined" && process.env.SENTRY_DSN) || "";

// ------------------------------------------------------------------------------------------
// @desc Produce the self-contained embed document, with the compiled stylesheet and the client bundle inlined.
// @returns {string} A complete HTML document
// The bundle is written into a plain <script> element rather than a `data:text/javascript;base64,` script URL. The
// encoding costs a third more bytes, and those bytes land in the plugin note's code block, which every Amplenote
// client parses and holds in memory when the note is opened. What base64 bought was immunity from the HTML
// tokenizer, which reads `<!--`, `<script` and `</script` inside a script element as markup; inline-script-safety.js
// now buys the same immunity by failing the build when the bundle contains an arrangement of those that would
// corrupt the document. See that file for why the arrangement is a live risk rather than a theoretical one.
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
  </script>${ buildSentryLoaderScripts({ dsn: SENTRY_DSN, environment: "dashboard-embed" }) }
</head>
<body>
  <div id="dashboard-root"></div>
  <script type="text/javascript">${clientScript}</script>
</body>
</html>`);
}
