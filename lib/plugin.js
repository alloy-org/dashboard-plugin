/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Amplenote dashboard plugin entry point
 * Prompt summary: "build an Amplenote plugin with embed rendering and action dispatch"
 */
import { buildEmbedHTML } from "./embed-html"
import {
  fetchDashboardData,
  createQuarterlyPlan,
  fetchQuotes,
  navigateToNote
} from "./data-service"
import { PLUGIN_NAME, SETTING_KEYS } from "./constants/settings"

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
      console.error("Dashboard renderEmbed error:", error);
      return `<div style="padding:20px;color:red;">Dashboard failed to load: ${error.message}</div>`;
    }
  },

  // --------------------------------------------------------------------------------------
  // Embed Communication Bridge
  // --------------------------------------------------------------------------------------
  async onEmbedCall(app, actionType, ...args) {
    try {
      switch (actionType) {
        case "init":
          return await fetchDashboardData(app);

        case "getTaskDomainTasks":
          return await app.getTaskDomainTasks(args[0]);

        case "getMoodRatings":
          return await app.getMoodRatings(args[0], args[1]);

        case "filterNotes":
          return await app.filterNotes(args[0]);

        case "createQuarterlyPlan":
          return await createQuarterlyPlan(app, args[0]);

        case "navigateToNote":
          return await navigateToNote(app, args[0]);

        case "configure":
          return await this._handleConfigure(app, args[0]);

        case "fetchQuotes":
          return await fetchQuotes(app, args[0]);

        case "getNoteContent":
          return await app.getNoteContent({ uuid: args[0] });

        default:
          console.error(`Unknown embed action: ${actionType}`);
          return null;
      }
    } catch (error) {
      console.error(`onEmbedCall error (${actionType}):`, error);
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
