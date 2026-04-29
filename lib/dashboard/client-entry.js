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

const LARGE_PHONE_BREAKPOINT_PIXELS = 430;
const LARGE_PHONE_VIEWPORT_CLASS_NAME = 'dashboard-large-phone-viewport';

// ------------------------------------------------------------------------------------------
// [Claude] Task: constrain iframe to real device width when WKWebView inflates the layout viewport
// Prompt: "use screen.width to fix mobile app iframe being wider than visible area"
// Date: 2026-03-17 | Model: claude-4.6-opus-high-thinking
//
// @description Workaround for a WKWebView iframe sizing bug in the Amplenote iOS app.
//   When this plugin's HTML is loaded inside an iframe in the native app's WKWebView,
//   the iframe's layout viewport is inflated beyond the visible device width (e.g., 743px
//   on a 430px-wide iPhone 15 Pro Max). Every CSS-based width metric — window.innerWidth,
//   document.documentElement.clientWidth, and even 100vw — reports the inflated value,
//   making CSS media queries and viewport units useless for responsive layout. The only
//   reliable metric is screen.width/screen.height, which report the true device dimensions.
//
//   This function detects the mismatch (screen dimension < window.innerWidth) and clamps
//   html/body max-width to the real device width via inline styles. It re-evaluates on
//   resize to handle orientation changes. On desktop browsers and mobile Safari — where the
//   iframe width matches the device — the guard condition prevents any styles from being
//   applied.
//
//   The hard-coded large-phone constant mirrors `$breakpoint-large-phone` in SCSS. The root
//   class is necessary because an inflated iframe layout viewport prevents normal CSS media
//   queries from matching on iPhone 15 Pro Max; shared breakpoint mixins use this class as
//   the same mobile-phone signal when `screen.width` is the only accurate width available.
//
//   This entire IIFE can be removed if the host app (Amplenote) fixes the iframe sizing so
//   that the layout viewport matches the visible width, e.g., by setting an explicit
//   `width: 100%` on the <iframe> element relative to a correctly-configured WKWebView
//   viewport, or by passing the device width into the iframe's viewport meta tag.
// ------------------------------------------------------------------------------------------
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

// [Claude] Task: resolve app object — dev creates simulated app, production uses Amplenote bridge
// Prompt: "Proxy supports settings property so widgets can read app.settings[KEY] directly"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
const app = IS_DEV_ENVIRONMENT
  ? createBrowserDevApp()
  : new Proxy({ settings: {} }, {
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

const root = createRoot(document.getElementById("dashboard-root"));
root.render(createElement(DashboardApp, { app }));
