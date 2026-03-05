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
  navigateToNote,
  navigateToTask,
  navigateToUrl,
  runQuickAction,
  switchTaskDomain,
  refreshTaskDomains
} from "./data-service"
import { PLUGIN_NAME, SETTING_KEYS, DASHBOARD_COMPONENTS } from "./constants/settings"

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
  /**
   * Central message-passing bridge between the dashboard React embed and the
   * Amplenote host app. Every `callPlugin(actionType, ...args)` call from the
   * embed resolves here.
   *
   * @param {object} app - Amplenote app interface
   * @param {string} actionType - Identifies which action to execute. Must be one of
   *   the string literals handled by the switch below.
   * @param {...*} args - Action-specific positional arguments (see each case).
   *
   * Actions (alphabetical):
   *
   * @param {"configure"}            actionType - Open a widget configure prompt.
   *   args[0] {string} widgetId
   *
   * @param {"createQuarterlyPlan"}  actionType - Create or navigate to a quarterly plan note.
   *   args[0] {object} quarterInfo  { label, year, quarter }
   *
   * @param {"fetchQuotes"}          actionType - Generate inspirational quotes via LLM.
   *   args[0] {string|null} planContent  Optional quarterly-plan text used as context.
   *
   * @param {"filterNotes"}          actionType - Return noteHandles matching filter criteria.
   *   args[0] {object} filterParams  Passed directly to app.filterNotes (tag, query, group).
   *
   * @param {"getCompletedTasks"}    actionType - Return tasks completed within a time range.
   *   args[0] {number} from  Unix timestamp (seconds), inclusive start.
   *   args[1] {number} to    Unix timestamp (seconds), exclusive end.
   *
   * @param {"getMoodRatings"}       actionType - Return mood ratings within a time range.
   *   args[0] {number} from  Unix timestamp (seconds).
   *   args[1] {number} [to]  Unix timestamp (seconds), optional.
   *
   * @param {"getNoteContent"}       actionType - Return the markdown content of a note.
   *   args[0] {string} noteUUID
   *
   * @param {"getNoteTasks"}         actionType - Return open tasks for a note.
   *   args[0] {string} noteUUID
   *   args[1] {object} [options]  e.g. { includeDone: true }
   *
   * @param {"getTaskDomains"}       actionType - Return the user's configured task domains,
   *   each with a `notes` array of noteHandles and a `uuid`.
   *
   * @param {"getTaskDomainTasks"}   actionType - Return all tasks belonging to a task domain.
   *   args[0] {string} taskDomainUUID
   *
   * @param {"init"}                 actionType - Fetch and return all initial dashboard data.
   *
   * @param {"navigateToNote"}       actionType - Navigate the host app to a note.
   *   args[0] {string} noteUUID
   *
   * @param {"navigateToTask"}       actionType - Navigate the host app to a specific task.
   *   args[0] {string} noteUUID
   *   args[1] {string} taskUUID
   *
   * @param {"navigateToUrl"}        actionType - Navigate the host app to an arbitrary URL.
   *   args[0] {string} url
   *
   * @param {"quickAction"}          actionType - Run a named quick action.
   *   args[0] {string} actionName
   *
   * @param {"refreshTaskDomains"}   actionType - Force-refresh the cached task domain list
   *   and return { domains, activeTaskDomain }.
   *
   * @param {"removeBackgroundImage"} actionType - Clear the persisted background image URL
   *   and mode settings.
   *
   * @param {"saveBackgroundImageUrl"} actionType - Persist the background image URL setting.
   *   args[0] {string} url  Pass empty string to clear.
   *
   * @param {"saveBackgroundMode"}   actionType - Persist the background image display mode.
   *   args[0] {string} mode  One of: 'cover' | 'contain' | 'repeat' | 'repeat-x' | 'repeat-y' | 'no-repeat'
   *
   * @param {"saveLayout"}           actionType - Persist the ordered dashboard widget layout.
   *   args[0] {Array<object>} layout  Array of widget config objects.
   *
   * @param {"saveSetting"}          actionType - Persist a single widget setting value.
   *   args[0] {string} widgetId
   *   args[1] {*}      value     Stored as JSON under `dashboard_<widgetId>_config`.
   *
   * @param {"setActiveTaskDomain"}  actionType - Switch the active task domain and return
   *   fresh task data for that domain.
   *   args[0] {string} domainUUID
   *
   * @param {"uploadBackgroundImage"} actionType - Upload an image file and return its URL.
   *   args[0] {string} dataURL  Base64 data URL of the image to attach to the plugin note.
   *
   * @returns {Promise<*>} Resolves to the action result, or `{ error: string }` on failure.
   */
  async onEmbedCall(app, actionType, ...args) {
    // console.log("Dashboard onEmbedCall:", { actionType, args });
    try {
      switch (actionType) {
        case "configure":
          return await this._handleConfigure(app, args[0]);

        case "createQuarterlyPlan":
          return await createQuarterlyPlan(app, args[0]);

        case "fetchQuotes":
          return await fetchQuotes(app, args[0]);

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

        // [Claude] Task: expose getTaskDomains and getNoteTasks for the Recent Notes widget
        // Prompt: "replace AI & Plugins widget with Recent Notes showing notes whose tasks have gone stale"
        // Date: 2026-03-04 | Model: claude-4.6-sonnet-medium-thinking
        case "getNoteTasks":
          return await app.getNoteTasks({ uuid: args[0] }, args[1] || {});

        case "getTaskDomains":
          return await app.getTaskDomains();

        case "getTaskDomainTasks":
          return await app.getTaskDomainTasks(args[0]);

        case "init":
          return await fetchDashboardData(app);

        case "navigateToNote":
          return await navigateToNote(app, args[0]);

        case "navigateToTask":
          return await navigateToTask(app, args[0], args[1]);

        case "navigateToUrl":
          return await navigateToUrl(app, args[0]);

        case "quickAction":
          return await runQuickAction(app, args[0]);

        // [Claude] Task: task domain switching and refresh actions
        // Prompt: "allow user to choose which Task Domain their dashboard focuses on"
        // Date: 2026-02-21 | Model: claude-opus-4-6
        case "refreshTaskDomains":
          return await refreshTaskDomains(app);

        case "removeBackgroundImage":
          await app.setSetting(SETTING_KEYS.BACKGROUND_IMAGE_URL, "");
          await app.setSetting(SETTING_KEYS.BACKGROUND_IMAGE_MODE, "");
          return true;

        // [Claude] Task: upload background image via attachNoteMedia; do NOT persist until user clicks Save (avoids host re-mount/reload)
        // Prompt: "add background image upload option to DashboardSettings"
        // Date: 2026-03-01 | Model: claude-4.6-opus-high-thinking
        case "saveBackgroundImageUrl": {
          const url = args[0];
          await app.setSetting(SETTING_KEYS.BACKGROUND_IMAGE_URL, url || "");
          if (!url) await app.setSetting(SETTING_KEYS.BACKGROUND_IMAGE_MODE, "");
          return true;
        }

        case "saveBackgroundMode":
          await app.setSetting(SETTING_KEYS.BACKGROUND_IMAGE_MODE, args[0]);
          return true;

        case "saveLayout":
          await app.setSetting(DASHBOARD_COMPONENTS, JSON.stringify(args[0]));
          return true;

        // [Claude] Task: save widget config from inline popup without native prompt
        // Prompt: "popup component that pops up setting options upon clicking Configure"
        // Date: 2026-02-22 | Model: claude-opus-4-6
        case "saveSetting":
          await app.setSetting(
            `dashboard_${args[0]}_config`,
            JSON.stringify(Array.isArray(args[1]) ? args[1] : [args[1]])
          );
          return true;

        case "setActiveTaskDomain":
          return await switchTaskDomain(app, args[0]);

        case "uploadBackgroundImage": {
          const dataURL = args[0];
          const pluginNoteUUID = app.context.pluginUUID;
          const fileURL = await app.attachNoteMedia({ uuid: pluginNoteUUID }, dataURL);
          return fileURL;
        }

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
