/**
 * [Claude-authored file]
 * Created: 2026-02-20 | Model: claude-sonnet-4-5-20250929
 * Task: Generate self-contained HTML for Amplenote embed
 * Prompt summary: "build embed HTML that inlines the client bundle and CSS"
 */
import { clientBase64 } from "client-bundle";
import { compiledCSS } from "css-content";

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
  <!-- [Claude claude-opus-4-8] Task: load Plausible analytics for the dashboard embed -->
  <!-- Prompt: "enable plausible() custom events from within the dashboard component" -->
  <!-- Absolute proxy URL (the embed iframe is not same-origin with amplenote.com, so a relative -->
  <!-- /plausible-proxy path would not resolve); data-domain attributes events to the registered site. -->
  <!-- autoCapturePageviews is disabled because location.href inside the embed is a junk data: URL. -->
  <script defer data-domain="amplenote.com" src="https://www.amplenote.com/plausible-proxy/js/script.js"></script>
  <script>
    window.plausible = window.plausible || function () { (window.plausible.q = window.plausible.q || []).push(arguments); };
    window.plausible.init = window.plausible.init || function (options) { window.plausible.o = options || {}; };
    window.plausible.init({ autoCapturePageviews: false });
  </script>
</head>
<body>
  <div id="dashboard-root"></div>
  <script type="text/javascript" src="data:text/javascript;base64,${clientBase64}"></script>
</body>
</html>`);
}
