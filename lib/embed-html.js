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
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${compiledCSS}</style>
</head>
<body>
  <div id="dashboard-root"></div>
  <script type="text/javascript">
    const callPlugin = (action, ...args) => window.callAmplenotePlugin(action, ...args);
  </script>
  <script type="text/javascript" src="data:text/javascript;base64,${clientBase64}"></script>
</body>
</html>`;
}
