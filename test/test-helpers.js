import dotenv from "dotenv"
import fetch from "isomorphic-fetch"
import pluginObject from "plugin"

dotenv.config();

const PLUGIN_INTERFACES = [ "appOption", "dailyJotOption", "imageOption", "insertText", "linkOption",
  "noteOption", "renderEmbed", "replaceText" ];

// --------------------------------------------------------------------------------------
export function mockPlugin() {
  const plugin = pluginObject;
  global.fetch = fetch;

  PLUGIN_INTERFACES.forEach(entryPointKey => {
    if (plugin[entryPointKey]) {
      Object.entries(plugin[entryPointKey]).forEach(([ functionName, checkAndRunOrFunction ]) => {
        if (checkAndRunOrFunction.check || checkAndRunOrFunction.run) {
          if (checkAndRunOrFunction.check) {
            plugin[entryPointKey][functionName].check = plugin[entryPointKey][functionName].check.bind(plugin);
          }
          if (checkAndRunOrFunction.run) {
            plugin[entryPointKey][functionName].run = plugin[entryPointKey][functionName].run.bind(plugin);
          }
        } else {
          plugin[entryPointKey][functionName] = plugin[entryPointKey][functionName].bind(plugin); // .insertText
        }
      });
    }
  });

  plugin.constants.isTestEnvironment = true;

  return plugin;
}
