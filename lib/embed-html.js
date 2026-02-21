import { clientBase64 } from "client-bundle";
import { compiledCSS } from "css-content";

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
