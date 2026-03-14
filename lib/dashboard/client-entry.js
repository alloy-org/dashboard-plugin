/**
 * [Claude-authored file]
 * Created: 2026-02-20 | Model: claude-sonnet-4-5-20250929
 * Task: React entry point — mounts DashboardApp into #dashboard-root
 * Prompt summary: "client entry that creates a React root and renders the dashboard app"
 */
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { IS_DEV_ENVIRONMENT } from "constants/settings";
import { createBrowserDevApp } from "util/browser-dev-app";
import DashboardApp from "./dashboard.js";

// [Claude] Task: resolve app object — dev creates simulated app, production uses Amplenote bridge
// Prompt: "only in dev do we need to create a simulated app; in production the app flows from renderEmbed"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
const app = IS_DEV_ENVIRONMENT
  ? createBrowserDevApp()
  : new Proxy({}, {
      get(_, method) {
        if (typeof method === 'symbol') return undefined;
        return (...args) => window.callAmplenotePlugin(method, ...args);
      }
    });

const root = createRoot(document.getElementById("dashboard-root"));
root.render(createElement(DashboardApp, { app }));
