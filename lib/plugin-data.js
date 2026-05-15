// [Claude claude-opus-4-7-authored file]
// Prompt summary: "embed-side singleton for plugin settings/context; replaces shadow-mutation of the Amplenote `app` proxy"

// ------------------------------------------------------------------------------------------
// The dashboard embed runs in an iframe and talks to the host Amplenote app over a postMessage
// bridge. The real `app.settings` and `app.context` live on the plugin side.
// The embed's `fetchDashboardData` init payload carries snapshots of both, and
// this module stores them so embed code has a synchronous source of truth.
//
// Do NOT use this in code that runs plugin-side (plugin.js, fetchDashboardData, and the
// internal `_helper` functions in data-service.js called from there). Plugin-side code has the
// real `app.settings` / `app.context` available directly.
const _data = { settings: {}, context: {} };

// ------------------------------------------------------------------------------------------
// @desc Replace the embed's cached settings/context with values from the init payload.
// @param {{ settings?: Object, context?: Object }} initData - From fetchDashboardData return.
export function setPluginData(initData) {
  if (initData.settings) _data.settings = initData.settings;
  if (initData.context) _data.context = initData.context;
}

// ------------------------------------------------------------------------------------------
// @desc Embed-side accessor for the plugin's settings snapshot.
// @returns {Object} The current settings object (mutable — same reference returned every call).
export function pluginSettings() {
  return _data.settings;
}

// ------------------------------------------------------------------------------------------
// @desc Embed-side accessor for the plugin's context snapshot (pluginUUID, noteUUID, etc.).
// @returns {Object} The current context object.
export function pluginContext() {
  return _data.context;
}

// ------------------------------------------------------------------------------------------
// @desc Mirror a setting write into the embed-side cache so synchronous readers see it
//   immediately after the embed calls `app.setSetting(key, value)`.
//
//   You can see the intended pairing at lib/dashboard/dashboard.js:333-334 and :362-381: each app.setSetting(...) is followed by an updatePluginSetting(...)
//   for the same key. The app.setSetting does the real write; the updatePluginSetting keeps the in-memory snapshot from going stale until the next init/reload
//   refreshes it. Drop the updatePluginSetting and the write still persists, but widgets reading pluginSettings() will see the old value until the dashboard
//   reloads. Drop the app.setSetting and nothing persists — the change vanishes on reload.
//
//   So treat updatePluginSetting as "tell the local cache what I just wrote across the bridge," never as a substitute for the write itself.
// @param {string} key
// @param {*} value
export function updatePluginSetting(key, value) {
  _data.settings[key] = value;
}
