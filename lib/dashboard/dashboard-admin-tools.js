// Decide whether the Dashboard's admin and developer tools are available: the Debug Console, its Queue inspector, and
// widget memory measurement. They are on when the Debug Console setting is "true", in a development bundle, when the
// page is served by the local dev server, or for the plugin installation the Dashboard's developers use. Every tool
// reads this one policy, so an entry point and the diagnostics behind it can never disagree. It inspects only the
// current user's own Dashboard; it is not an authorization check for anything served by a host.
import { IS_DEV_ENVIRONMENT, SETTING_KEYS } from "constants/settings";
import { pluginContext } from "plugin-data";
import { servedFromDevServer } from "util/dev-environment";

// The plugin installation used by the Dashboard's developers, which always has the tools.
export const ADMIN_TOOLS_PLUGIN_UUID = "6da03574-0f4b-11f1-ba9e-11ba9c716f59";

// ------------------------------------------------------------------------------------------
// @desc Apply the availability policy to explicit facts about the environment.
// @param {object} facts - An object with the following properties:
//   - {*} debugConsoleSetting - The Debug Console setting's stored value; only "true", ignoring surrounding space, enables
//   - {boolean} developmentBundle - Whether the bundle was built for development
//   - {boolean} devServerHosted - Whether the page is served by the local dev server
//   - {string|null} pluginUuid - The running plugin installation's UUID
// @returns {object} { designatedPlugin, developmentBundle, devServerHosted, enabled, settingEnabled }: whether the tools
//   are enabled, and each fact that can enable them, for logging which one did.
export function adminToolsAvailability({ debugConsoleSetting, developmentBundle, devServerHosted, pluginUuid }) {
  const settingEnabled = String(debugConsoleSetting ?? "").trim() === "true";
  const designatedPlugin = pluginUuid === ADMIN_TOOLS_PLUGIN_UUID;
  const enabled = settingEnabled || Boolean(developmentBundle) || Boolean(devServerHosted) || designatedPlugin;
  return { designatedPlugin, developmentBundle: Boolean(developmentBundle), devServerHosted: Boolean(devServerHosted), enabled,
    settingEnabled };
}

// ------------------------------------------------------------------------------------------
// @desc Apply the availability policy to the running Dashboard embed: its settings, build, page location, and plugin.
// @param {object|null} configParams - The Dashboard's plugin settings.
// @returns {object} As adminToolsAvailability returns, plus { pluginUuid, settingValue } for logging.
export function dashboardAdminToolsAvailability(configParams) {
  const pluginUuid = pluginContext().pluginUUID || null;
  const settingValue = configParams?.[SETTING_KEYS.DEBUG_CONSOLE];
  const availability = adminToolsAvailability({ debugConsoleSetting: settingValue, developmentBundle: IS_DEV_ENVIRONMENT,
    devServerHosted: servedFromDevServer(), pluginUuid });
  return { ...availability, pluginUuid, settingValue };
}
