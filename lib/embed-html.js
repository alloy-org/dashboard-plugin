import { clientBundle } from "client-bundle";

export function buildEmbedHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    /* Styles will be added later */
  </style>
</head>
<body>
  <div id="dashboard-root"></div>

  <script src="https://esm.sh/react@18?bundle"></script>
  <script src="https://esm.sh/react-dom@18?bundle"></script>
  <script>
    // Bridge helper
    const callPlugin = (action, ...args) => window.callAmplenotePlugin(action, ...args);

    ${clientBundle}
  </script>
</body>
</html>`;
}
