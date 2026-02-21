/**
 * [Claude-authored file]
 * Created: 2026-02-20 | Model: claude-sonnet-4-5-20250929
 * Task: React entry point — mounts DashboardApp into #dashboard-root
 * Prompt summary: "client entry that creates a React root and renders the dashboard app"
 */
import { createElement } from "react";
import ReactDOM from "react-dom";
import DashboardApp from "./app.js";

const root = ReactDOM.createRoot(document.getElementById("dashboard-root"));
root.render(createElement(DashboardApp));
