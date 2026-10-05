/**
 * [Claude-authored file]
 * Created: 2026-02-20 | Model: claude-sonnet-4-5-20250929
 * Task: Generate self-contained HTML for Amplenote embed
 * Prompt summary: "build embed HTML that inlines the client bundle and CSS"
 */
import { compressedClientScript } from "client-bundle";
import { compressedCSS } from "css-content";
import { buildSentryLoaderScripts } from "util/sentry-loader";

const SENTRY_DSN = (typeof process !== "undefined" && process.env.SENTRY_DSN) || "";

// Inflates the two payload elements and installs them: the stylesheet first, so the bundle's first render is styled.
// The bundle runs from a script element's textContent, which executes like an inline script without passing through
// the HTML tokenizer. A browser without DecompressionStream (Safari before 16.4) gets a visible message instead of a
// blank embed, and the rethrown error reaches the Sentry loader's unhandledrejection listener.
const PAYLOAD_LOADER_SCRIPT = `
    (function () {
      function inflatePayload(elementId) {
        var binaryText = atob(document.getElementById(elementId).textContent);
        var bytes = new Uint8Array(binaryText.length);
        for (var index = 0; index < binaryText.length; index++) bytes[index] = binaryText.charCodeAt(index);
        var inflatedStream = new Blob([ bytes ]).stream().pipeThrough(new DecompressionStream("gzip"));
        return new Response(inflatedStream).text();
      }
      function showLoadFailure(error) {
        console.error("[dashboard] failed to unpack the dashboard bundle", error);
        var root = document.getElementById("dashboard-root");
        if (root) root.textContent = "The dashboard could not load in this app version. Updating the app or OS should fix it.";
        throw error;
      }
      Promise.resolve().then(function () {
        if (typeof DecompressionStream !== "function") throw new Error("DecompressionStream is not supported");
        return Promise.all([ inflatePayload("dashboard-css-payload"), inflatePayload("dashboard-script-payload") ]);
      }).then(function (payloadTexts) {
        var styleElement = document.createElement("style");
        styleElement.textContent = payloadTexts[0];
        document.head.appendChild(styleElement);
        var scriptElement = document.createElement("script");
        scriptElement.textContent = payloadTexts[1];
        document.body.appendChild(scriptElement);
      }).catch(showLoadFailure);
    })();
  `;

// ------------------------------------------------------------------------------------------
// @desc Produce the self-contained embed document, carrying the compiled stylesheet and the client bundle as gzipped
//   base64 payloads that PAYLOAD_LOADER_SCRIPT inflates and installs once the document has parsed.
// @returns {string} A complete HTML document
// Both payloads land in the plugin note's code block, which every Amplenote client parses and holds in memory when the
// note is opened, so their size matters more than the few milliseconds spent inflating them. They sit in
// `type="text/plain"` script elements, which the browser neither executes nor parses as JavaScript, and base64's
// alphabet holds nothing the HTML tokenizer could read as markup.
export function buildEmbedHTML() {
  return (`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
  <script type="text/plain" id="dashboard-css-payload">${ compressedCSS }</script>
  <script type="text/plain" id="dashboard-script-payload">${ compressedClientScript }</script>
  <script type="text/javascript">${ PAYLOAD_LOADER_SCRIPT }</script>
</body>
</html>`);
}
