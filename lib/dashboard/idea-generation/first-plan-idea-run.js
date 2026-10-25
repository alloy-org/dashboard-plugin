// Remember which quarters' first Plan Builder Done has started a "Generate ideas" run, so finishing a quarter's plan for
// the first time generates ideas for its projects before the user's first calendar visit, and later Done clicks leave
// the day's runs to the user. The quarter keys are kept in a plugin setting, since the Dashboard embed has no web
// storage. Host-compatible.
import { SETTING_KEYS } from "constants/settings";
import { pluginSettings, updatePluginSetting } from "plugin-data";

// ----------------------------------------------------------------------------------------------
// @desc The key one domain's quarter is remembered by.
// @param {object} options - { domainUuid, quarter, year }: a null domainUuid names All Notes.
// @returns {string} Such as "2026-Q4:all" or "2026-Q4:<domain uuid>".
export function firstPlanIdeaRunKey({ domainUuid = null, quarter, year }) {
  return `${ year }-Q${ quarter }:${ domainUuid || "all" }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Read the remembered quarter keys from a setting value.
// @param {string|null|undefined} settingValue - The setting's JSON, as stored.
// @returns {Array<string>} The keys; empty when the value is missing or unreadable.
export function firstPlanIdeaRunKeys(settingValue) {
  if (!settingValue) return [];
  try {
    const parsed = JSON.parse(settingValue);
    const keys = Array.isArray(parsed) ? parsed.filter(key => typeof key === "string") : [];
    return keys;
  } catch {
    return [];
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Whether a quarter's first Done has already started its run, as the plugin's settings hold it now.
// @param {object} quarterScope - { domainUuid, quarter, year }.
// @returns {boolean} True once a run was recorded for that quarter.
export function hasStartedFirstPlanIdeaRun(quarterScope) {
  const keys = firstPlanIdeaRunKeys(pluginSettings()[SETTING_KEYS.FIRST_PLAN_IDEA_RUNS]);
  return keys.includes(firstPlanIdeaRunKey(quarterScope));
}

// ----------------------------------------------------------------------------------------------
// @desc Remember that a quarter's first Done started its run, through app.setSetting and the embed's settings cache.
// @param {object} app - Amplenote API.
// @param {object} quarterScope - { domainUuid, quarter, year }.
// @returns {Promise<void>} Resolves once the setting is saved.
export async function recordFirstPlanIdeaRun(app, quarterScope) {
  const keys = firstPlanIdeaRunKeys(pluginSettings()[SETTING_KEYS.FIRST_PLAN_IDEA_RUNS]);
  const key = firstPlanIdeaRunKey(quarterScope);
  if (keys.includes(key)) return;
  const serialized = JSON.stringify([...keys, key]);
  updatePluginSetting(SETTING_KEYS.FIRST_PLAN_IDEA_RUNS, serialized);
  await app.setSetting(SETTING_KEYS.FIRST_PLAN_IDEA_RUNS, serialized);
}
