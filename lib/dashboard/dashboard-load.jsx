// [Claude claude-sonnet-4-6-authored file]
// Prompt summary: "standalone entry — dev runs app.init(), production calls callAmplenotePlugin('init') directly"
// [Claude claude-4.7-opus] Task: migrate dashboard-load entry from createElement to JSX
// Prompt: "translate this project to render components with JSX instead"
import { createRoot } from "react-dom/client";
import { IS_DEV_ENVIRONMENT } from "constants/settings";
import { createBrowserDevApp } from "util/browser-dev-app";
import DashboardApp from "./dashboard.jsx";

const LARGE_PHONE_BREAKPOINT_PIXELS = 430;
const LARGE_PHONE_VIEWPORT_CLASS_NAME = 'dashboard-large-phone-viewport';

// ------------------------------------------------------------------------------------------
// Workaround for WKWebView iframe sizing bug in the Amplenote iOS app.
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
      document.documentElement.style.removeProperty('--dashboard-viewport-width');
      document.body.style.maxWidth = '';
      document.body.style.overflowX = '';
      return;
    }
    const maximumWidthStyle = visibleWidth + 'px';
    document.documentElement.style.maxWidth = maximumWidthStyle;
    document.documentElement.style.overflowX = 'hidden';
    // Publish the real visible width so `position: fixed` overlays (e.g. the layout popup) can size to it
    // instead of 100vw, which the host inflates beyond the visible area. See config-popup.scss.
    document.documentElement.style.setProperty('--dashboard-viewport-width', maximumWidthStyle);
    document.body.style.maxWidth = maximumWidthStyle;
    document.body.style.overflowX = 'hidden';
  }
  apply();
  window.addEventListener('resize', apply);
})();

let app, initPromise;
if (IS_DEV_ENVIRONMENT) {
  app = createBrowserDevApp();
  initPromise = app.init();
} else {
  app = new Proxy({}, {
    get(_target, prop) {
      if (typeof prop === 'symbol') return undefined;
      return (...args) => window.callAmplenotePlugin(prop, ...args);
    },
  });
  initPromise = window.callAmplenotePlugin("init");
}

createRoot(document.getElementById("dashboard-root")).render(<DashboardApp app={app} initPromise={initPromise} />);
