// Exercise the shared admin tools policy: the Debug Console setting, a development bundle, the local dev server, and
// the designated plugin installation each enable the tools, and nothing else does.
import { ADMIN_TOOLS_PLUGIN_UUID, adminToolsAvailability, dashboardAdminToolsAvailability } from "dashboard-admin-tools";
import { SETTING_KEYS } from "constants/settings";
import { setPluginData } from "plugin-data";

// Facts under which the tools are unavailable.
const OFF = { debugConsoleSetting: "", developmentBundle: false, devServerHosted: false, pluginUuid: "other-plugin" };

describe("adminToolsAvailability", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Each fact alone enables the tools and is named as the reason.
  it("enables the tools for each qualifying fact on its own", () => {
    expect(adminToolsAvailability(OFF).enabled).toBe(false);
    expect(adminToolsAvailability({ ...OFF, debugConsoleSetting: " true " })).toMatchObject({ enabled: true, settingEnabled: true });
    expect(adminToolsAvailability({ ...OFF, developmentBundle: true })).toMatchObject({ developmentBundle: true, enabled: true });
    expect(adminToolsAvailability({ ...OFF, devServerHosted: true })).toMatchObject({ devServerHosted: true, enabled: true });
    expect(adminToolsAvailability({ ...OFF, pluginUuid: ADMIN_TOOLS_PLUGIN_UUID })).toMatchObject({ designatedPlugin: true,
      enabled: true });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Only the exact setting value "true" enables the tools, matching the Debug Console's original rule.
  it("ignores other setting values", () => {
    for (const debugConsoleSetting of [undefined, null, "false", "yes", "TRUE", true]) {
      const expected = debugConsoleSetting === true;
      expect(adminToolsAvailability({ ...OFF, debugConsoleSetting }).enabled).toBe(expected);
    }
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The Dashboard's reading of its environment applies the same policy to its settings and plugin context.
  it("reads the Dashboard's settings and plugin context", () => {
    setPluginData({ context: { pluginUUID: "other-plugin" } });
    const offAvailability = dashboardAdminToolsAvailability({ [SETTING_KEYS.DEBUG_CONSOLE]: "false" });
    expect(offAvailability).toMatchObject({ pluginUuid: "other-plugin", settingEnabled: false, settingValue: "false" });
    expect(dashboardAdminToolsAvailability({ [SETTING_KEYS.DEBUG_CONSOLE]: "true" }).enabled).toBe(true);
    setPluginData({ context: { pluginUUID: ADMIN_TOOLS_PLUGIN_UUID } });
    expect(dashboardAdminToolsAvailability(null)).toMatchObject({ designatedPlugin: true, enabled: true });
    setPluginData({ context: {} });
  });
});
