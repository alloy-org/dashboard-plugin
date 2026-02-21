import { createElement } from "react";
import ReactDOM from "react-dom";
import DashboardApp from "./app.js";

const root = ReactDOM.createRoot(document.getElementById("dashboard-root"));
root.render(createElement(DashboardApp));
