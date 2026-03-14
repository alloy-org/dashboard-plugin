/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Amplenote dashboard plugin entry point
 * Prompt summary: "build an Amplenote plugin with embed rendering and action dispatch"
 */
import { buildEmbedHTML } from "./embed-html"
import { SETTING_KEYS } from "constants/settings"
import { fetchDashboardData } from "data-service"
import { analyzeDreamTasks } from "dream-task-service"
import { logIfEnabled, setLoggingEnabled } from "util/log"

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
    try {
      return buildEmbedHTML();
    } catch (error) {
      logIfEnabled("Dashboard renderEmbed error:", error);
      return `<div style="padding:20px;color:red;">Dashboard failed to load: ${error.message}</div>`;
    }
  },

  // --------------------------------------------------------------------------------------
  // Embed Communication Bridge
  // --------------------------------------------------------------------------------------
  // [Claude] Task: streamlined onEmbedCall — standard API pass-through + custom bridge actions
  // Prompt: "widgets call standard API methods directly; plugin.js bridges them to the real app"
  // Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
  /**
   * Central message-passing bridge between the dashboard React embed and the
   * Amplenote host app. Every method call on the `app` Proxy in the embed
   * resolves here via `window.callAmplenotePlugin(method, ...args)`.
   *
   * Standard Amplenote API methods are forwarded directly. Custom actions
   * (configure, dreamTaskAnalyze, init) contain plugin-specific logic.
   *
   * @param {object} app - Amplenote app interface
   * @param {string} actionType - Method name or custom action identifier
   * @param {...*} args - Positional arguments from the embed call
   * @returns {Promise<*>} Resolves to the action result, or `{ error }` on failure.
   */
  async onEmbedCall(app, actionType, ...args) {
    setLoggingEnabled(app.settings[SETTING_KEYS.CONSOLE_LOGGING]);
    try {
      switch (actionType) {
        // ── Custom bridge actions ──────────────────────────────────
        case "configure":
          return await this._handleConfigure(app, args[0]);

        case "dreamTaskAnalyze":
          return await analyzeDreamTasks(app, this);

        case "init":
          return await fetchDashboardData(app);

        // ── Standard Amplenote API pass-through ────────────────────
        case "attachNoteMedia":
          return await app.attachNoteMedia(args[0], args[1]);

        case "createNote":
          return await app.createNote(args[0], args[1]);

        case "filterNotes":
          return await app.filterNotes(args[0]);

        case "findNote":
          return await app.findNote(args[0]);

        case "getCompletedTasks":
          return await app.getCompletedTasks(args[0], args[1]);

        case "getMoodRatings":
          return await app.getMoodRatings(args[0], args[1]);

        case "getNoteContent":
          return await app.getNoteContent({ uuid: args[0] });

        case "getNoteSections":
          return await app.getNoteSections({ uuid: args[0] });

        case "getNoteTasks":
          return await app.getNoteTasks({ uuid: args[0] }, args[1] || {});

        case "getTaskDomains":
          return await app.getTaskDomains();

        case "getTaskDomainTasks":
          return await app.getTaskDomainTasks(args[0]);

        case "insertNoteContent":
          return await app.insertNoteContent(args[0], args[1], args[2] || {});

        case "navigate":
          return await app.navigate(args[0]);

        case "recordMoodRating":
          return await app.recordMoodRating(args[0]);

        case "replaceNoteContent":
          return await app.replaceNoteContent({ uuid: args[0] }, args[1], args[2] || {});

        case "setSetting":
          return await app.setSetting(args[0], args[1]);

        default:
          logIfEnabled(`Unknown embed action: ${actionType}`);
          return null;
      }
    } catch (error) {
      logIfEnabled(`onEmbedCall error (${actionType}):`, error);
      return { error: error.message };
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

    await app.setSetting(`dashboard_${widgetId}_config`, JSON.stringify(
      Array.isArray(result) ? result : [result]
    ));
    return result;
  }
};

export default plugin;
