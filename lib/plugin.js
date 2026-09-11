/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Amplenote dashboard plugin entry point
 * Prompt summary: "build an Amplenote plugin with embed rendering and action dispatch"
 */
import { SETTING_KEYS, widgetConfigKey } from "constants/settings"
import { suggestScheduledTasksFromDashboard } from "dashboard/proposed-agenda-suggest-action"
import { fetchDashboardData } from "data-service"
import { evaluateDebugExpression } from "util/debug-evaluate"
import { logIfEnabled, setLoggingEnabled } from "util/log"
import { snapHostAction } from "util/plausible-host"
import { buildEmbedHTML } from "./embed-html"

// ----------------------------------------------------------------------------------------------
// @desc Whole seconds elapsed since a start timestamp, for reporting how long a host action ran.
// @param {number} startedAtMs - Epoch milliseconds captured when the action began.
// @returns {number} Elapsed time in seconds, rounded to the nearest second.
function _durationSecondsSince(startedAtMs) {
  return Math.round((Date.now() - startedAtMs) / 1000);
}

// [Claude] Task: plugin object with appOption, renderEmbed, and onEmbedCall dispatch
// Prompt: "build an Amplenote plugin with embed rendering and action dispatch"
// Date: 2026-02-17 | Model: claude-sonnet-4-5-20250929
const plugin = {
  // --------------------------------------------------------------------------------------
  // Constants
  // --------------------------------------------------------------------------------------
  constants: {},

  // --------------------------------------------------------------------------------------
  // App Options — Quick Open menu entries
  // --------------------------------------------------------------------------------------
  appOption: {
    "Open Dashboard": async function(app) {
      await app.openSidebarEmbed(1.5);
    },
    "Open Dashboard (Full)": async function(app) {
      await app.openEmbed();
    }
  },

  // --------------------------------------------------------------------------------------
  // Embed Rendering
  // --------------------------------------------------------------------------------------
  async renderEmbed(app) {
    console.debug("Rendering Dashboard plugin embed");

    try {
      return buildEmbedHTML();
    } catch (error) {
      console.error("Dashboard renderEmbed error:", error);
      return `<div style="padding:20px;color:red;">Dashboard failed to load: ${error.message}</div>`;
    }
  },

  // --------------------------------------------------------------------------------------
  // Calendar Suggestions
  // --------------------------------------------------------------------------------------
  // ------------------------------------------------------------------------------------------
  // @desc Generate calendar suggestions through Proposed Agenda, degrading failures to an empty result.
  // @param {object} app - Amplenote app interface.
  // @param {object} params - { endAt, schedulableTasks, scheduledTasks, startAt, taskDomain } from the host;
  //   endAt/startAt are unix seconds bounding the calendar view.
  // @returns {Promise<Array<object>>} Suggestions as { endAt, explanation, startAt, taskUUID|task }.
  async suggestScheduledTasks(app, params) {
    setLoggingEnabled(app.settings?.[SETTING_KEYS.CONSOLE_LOGGING]);
    logIfEnabled("[Dashboard] suggestScheduledTasks requested", {
      endAt: params?.endAt ?? null,
      schedulableTaskCount: params?.schedulableTasks?.length || 0,
      scheduledTaskCount: params?.scheduledTasks?.length || 0,
      startAt: params?.startAt ?? null,
      taskDomain: params?.taskDomain ?? null,
    });
    const startedAtMs = Date.now();
    try {
      const suggestions = await suggestScheduledTasksFromDashboard(app, params);
      await snapHostAction("suggestScheduledTasks", { count: suggestions?.length || 0, durationSeconds: _durationSecondsSince(startedAtMs), outcome: "success" });
      return suggestions;
    } catch (error) {
      logIfEnabled("suggestScheduledTasks failed:", error);
      console.error("Dashboard suggestScheduledTasks error:", error);
      await snapHostAction("suggestScheduledTasks", { durationSeconds: _durationSecondsSince(startedAtMs), outcome: "error" });
      return [];
    }
  },

  // --------------------------------------------------------------------------------------
  // Embed Communication Bridge
  // --------------------------------------------------------------------------------------
  // ----------------------------------------------------------------------------------------------
  // @desc Dispatch dashboard actions and forward other calls to the host API.
  // @param {object} app - Amplenote app interface.
  // @param {string} actionType - API method name or custom action identifier.
  // @param {...*} args - Positional arguments from the embed call.
  // @returns {Promise<*>} Action result or an embedCallFailed envelope for reliable mobile error handling.
  async onEmbedCall(app, actionType, ...args) {
    try {
      setLoggingEnabled(app.settings?.[SETTING_KEYS.CONSOLE_LOGGING]);
      switch (actionType) {
        case "attachNoteMedia":
          const noteHandle = { uuid: app.context.noteUUID };
          logIfEnabled(`[plugin] attachNoteMedia called — uploading to plugin note ${noteHandle.uuid}`);
          const result = await app.attachNoteMedia(noteHandle, args[1]);
          logIfEnabled(`[plugin] attachNoteMedia result:`, result ? '(URL received)' : '(no URL)');
          return result;
        case "configure":
          return await this._handleConfigure(app, args[0]);
        // Runs operator-entered text against the host app, so the Debug Console can ask the real API what it
        // accepts. Reachable only from that widget, which the dashboard renders for debug/dev sessions.
        case "debugEvaluate":
          return await evaluateDebugExpression(app, args[0]);
        case "init":
          return await fetchDashboardData(app);
        default:
          if (typeof app[actionType] === "function") {
            return await app[actionType](...args);
          }
          logIfEnabled(`Unknown embed action: ${actionType}`);
          return null;
      }
    } catch (error) {
      // Mobile hosts do not reliably reject callAmplenotePlugin when onEmbedCall throws, which is what leaves the
      // embed stuck on its loading spinner. Always resolve with an error envelope instead: `error` drives the
      // dashboard's error banner, `embedCallFailed` lets the embed tell a genuine bridge failure apart from a service
      // result that merely happens to carry an `error` key, and `errorStack` ferries the plugin-side frames across the
      // bridge — the embed cannot reconstruct them, and without them every bridge failure groups under one Sentry
      // stack. Falling back to String(error) keeps non-Error throws readable.
      logIfEnabled(`onEmbedCall error (${ actionType }):`, error);
      return { embedCallFailed: true, error: error?.message || String(error) || `onEmbedCall(${ actionType }) failed`,
        errorAction: actionType, errorStack: error?.stack || null };
    }
  },

  // --------------------------------------------------------------------------------------
  // Private Methods
  // --------------------------------------------------------------------------------------
  async _handleConfigure(app, widgetId) {
    const configs = {
      "victory-value": {
        title: "Configure Victory Value",
        inputs: [
          { label: "Time range", type: "radio", options: [
              { label: "This week", value: "week" },
              { label: "This month", value: "month" },
              { label: "Last 30 days", value: "30days" }
            ]},
          { label: "Show mood overlay", type: "checkbox", value: true }
        ]
      },
      "calendar": {
        title: "Configure Calendar",
        inputs: [
          { label: "Week starts on", type: "radio", options: [
              { label: "Sunday", value: "0" },
              { label: "Monday", value: "1" }
            ]}
        ]
      },
      "quotes": {
        title: "Configure Quotes",
        inputs: [
          { label: "Quote style", type: "radio", options: [
              { label: "Motivational", value: "motivational" },
              { label: "Philosophical", value: "philosophical" },
              { label: "From quarterly goals", value: "goals" }
            ]}
        ]
      }
    };

    const config = configs[widgetId];
    if (!config) return null;

    const result = await app.prompt(config.title, { inputs: config.inputs });
    if (!result) return null;

    await app.setSetting(widgetConfigKey(widgetId), JSON.stringify(
      Array.isArray(result) ? result : [result]
    ));
    return result;
  }
};

export default plugin;
