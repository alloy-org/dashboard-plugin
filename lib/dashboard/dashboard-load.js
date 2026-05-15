// [Claude claude-sonnet-4-6-authored file]
// Prompt summary: "standalone entry — dev runs app.init(), production calls callAmplenotePlugin('init') directly"
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { IS_DEV_ENVIRONMENT } from "constants/settings";
import { createBrowserDevApp } from "util/browser-dev-app";
import DashboardApp from "./dashboard.js";

const LARGE_PHONE_BREAKPOINT_PIXELS = 430;
const LARGE_PHONE_VIEWPORT_CLASS_NAME = 'dashboard-large-phone-viewport';

// ------------------------------------------------------------------------------------------
// Workaround for WKWebView iframe sizing bug in the Amplenote iOS app.
// When this plugin's HTML is loaded inside an iframe in WKWebView, the iframe's layout
// viewport is inflated beyond the visible device width (e.g., 743px on a 430px iPhone).
// Every CSS width metric reports the inflated value; only screen.width/screen.height are
// accurate. This clamps html/body max-width to the real device width and re-evaluates on
// orientation change. Remove if the host app fixes the iframe sizing.
(function constrainToDeviceWidth() {
  function apply() {
    const realDeviceWidth = Math.min(screen.width, screen.height);
    const visibleWidth = window.matchMedia('(orientation: landscape)').matches
      ? Math.max(screen.width, screen.height)
      : realDeviceWidth;
    document.documentElement.classList.toggle(LARGE_PHONE_VIEWPORT_CLASS_NAME, visibleWidth <= LARGE_PHONE_BREAKPOINT_PIXELS);
    if (visibleWidth >= window.innerWidth) {
      document.documentElement.style.maxWidth = '';
      document.documentElement.style.overflowX = '';
      document.body.style.maxWidth = '';
      document.body.style.overflowX = '';
      return;
    }
    const maximumWidthStyle = visibleWidth + 'px';
    document.documentElement.style.maxWidth = maximumWidthStyle;
    document.documentElement.style.overflowX = 'hidden';
    document.body.style.maxWidth = maximumWidthStyle;
    document.body.style.overflowX = 'hidden';
  }
  apply();
  window.addEventListener('resize', apply);
})();

// ------------------------------------------------------------------------------------------
// In dev: the browser dev app has a built-in init() that returns mock dashboard data.
// In production: call the plugin action directly — window.callAmplenotePlugin routes this
// to plugin.onEmbedCall("init") which runs fetchDashboardData on the plugin side.
// Either way the promise is started before React mounts so the fetch overlaps with render.
let app, initPromise;
if (IS_DEV_ENVIRONMENT) {
  app = createBrowserDevApp();
  initPromise = app.init();
} else {
  app = new Proxy({ settings: {} }, {
    get(target, prop) {
      if (prop === 'settings') return target.settings;
      if (typeof prop === 'symbol') return undefined;
      return (...args) => window.callAmplenotePlugin(prop, ...args);
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
  initPromise = window.callAmplenotePlugin("init");
}

createRoot(document.getElementById("dashboard-root")).render(createElement(DashboardApp, { app, initPromise }));
