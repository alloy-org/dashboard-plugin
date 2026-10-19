// Limit "Generate ideas" to IDEA_GENERATION_DAILY_MAXIMUM runs per local day. Each run's start time is kept in a
// plugin setting, pruned to the last two days, since the Dashboard embed has no web storage. Host-compatible.
import { SETTING_KEYS } from "constants/settings";
import { pluginSettings, updatePluginSetting } from "plugin-data";

// The most runs a user may start in one local day.
export const IDEA_GENERATION_DAILY_MAXIMUM = 2;
// How long a run's start time is kept.
const RUN_TIME_RETENTION_MILLISECONDS = 2 * 24 * 60 * 60 * 1000;

// ----------------------------------------------------------------------------------------------
// @desc Read the stored run start times from a setting value.
// @param {string|null|undefined} settingValue - The setting's JSON, as stored.
// @returns {Array<string>} ISO times; empty when the value is missing or unreadable.
export function ideaGenerationRunTimes(settingValue) {
  if (!settingValue) return [];
  try {
    const parsed = JSON.parse(settingValue);
    const runTimes = Array.isArray(parsed) ? parsed.filter(time => typeof time === "string" && Number.isFinite(Date.parse(time))) : [];
    return runTimes;
  } catch {
    return [];
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Whether another run may start today, and which of the day's runs it would be.
// @param {Array<string>} runTimes - ISO start times, from ideaGenerationRunTimes.
// @param {Date} now - Current time.
// @returns {object} { allowed, maximum, runNumber, usedCount }: runNumber is the number the next run would be, held at
//   maximum once the day's runs are spent.
export function ideaGenerationRunAllowance(runTimes, now) {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const todayRunTimes = runTimes.filter(time => Date.parse(time) >= dayStart && Date.parse(time) <= now.getTime());
  const usedCount = todayRunTimes.length;
  const allowed = usedCount < IDEA_GENERATION_DAILY_MAXIMUM;
  return { allowed, maximum: IDEA_GENERATION_DAILY_MAXIMUM, runNumber: Math.min(usedCount + 1, IDEA_GENERATION_DAILY_MAXIMUM), usedCount };
}

// ----------------------------------------------------------------------------------------------
// @desc The allowance as the plugin's settings hold it now.
// @param {Date} now - Current time.
// @returns {object} From ideaGenerationRunAllowance.
export function currentIdeaGenerationAllowance(now) {
  return ideaGenerationRunAllowance(ideaGenerationRunTimes(pluginSettings()[SETTING_KEYS.IDEA_GENERATION_RUNS]), now);
}

// ----------------------------------------------------------------------------------------------
// @desc The run times to store once a run starts at now: the earlier ones from the last two days, then now.
// @param {Array<string>} runTimes - ISO start times.
// @param {Date} now - Current time.
// @returns {Array<string>} ISO times, oldest first.
export function runTimesWithRun(runTimes, now) {
  const keptRunTimes = runTimes.filter(time => now.getTime() - Date.parse(time) < RUN_TIME_RETENTION_MILLISECONDS);
  return [...keptRunTimes, now.toISOString()];
}

// ----------------------------------------------------------------------------------------------
// @desc Record a run starting now, through app.setSetting and the embed's settings cache.
// @param {object} app - Amplenote API.
// @param {Date} now - Current time.
// @returns {Promise<object>} The allowance of this run: { allowed, maximum, runNumber, usedCount } as it stood before
//   the run was recorded, so runNumber names this run.
export async function recordIdeaGenerationRun(app, now) {
  const runTimes = ideaGenerationRunTimes(pluginSettings()[SETTING_KEYS.IDEA_GENERATION_RUNS]);
  const allowance = ideaGenerationRunAllowance(runTimes, now);
  const serialized = JSON.stringify(runTimesWithRun(runTimes, now));
  await app.setSetting(SETTING_KEYS.IDEA_GENERATION_RUNS, serialized);
  updatePluginSetting(SETTING_KEYS.IDEA_GENERATION_RUNS, serialized);
  return allowance;
}
