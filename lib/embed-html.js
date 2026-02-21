import { dashboardAppCode } from "dashboard/app";
import { victoryValueCode } from "dashboard/victory-value";
import { agendaCode } from "dashboard/agenda";
import { calendarCode } from "dashboard/calendar";
import { planningCode } from "dashboard/planning";
import { moodCode } from "dashboard/mood";
import { quotesCode } from "dashboard/quotes";
import { aiPluginsCode } from "dashboard/ai-plugins";
import { quickActionsCode } from "dashboard/quick-actions";
import { widgetWrapperCode } from "dashboard/widget-wrapper";
// import { themeCSS } from "./styles/theme";
// import { gridCSS } from "./styles/grid";
// import { widgetsCSS } from "./styles/widgets";

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

    // Widget components (bundled by esbuild from dashboard/ files)
    ${widgetWrapperCode}
    ${victoryValueCode}
    ${agendaCode}
    ${calendarCode}
    ${planningCode}
    ${moodCode}
    ${quotesCode}
    ${aiPluginsCode}
    ${quickActionsCode}
    ${dashboardAppCode}

    // Mount
    const root = ReactDOM.createRoot(document.getElementById('dashboard-root'));
    root.render(React.createElement(DashboardApp));
  </script>
</body>
</html>`;
}
