// Builds the dashboard's init payload: tasks, mood, quarterly plans, and settings, fetched plugin-side and sent
// across the bridge to the embed. Plugin-side code has the real app.settings, so nothing here uses pluginSettings().
// Every branch soft-fails to a usable default, recorded on initFailures, so one unavailable Amplenote API degrades a
// single widget rather than leaving the dashboard stuck on "Loading…".
import { DEFAULT_DASHBOARD_COMPONENTS, SETTING_KEYS, widgetConfigKey } from "constants/settings"
import { emptyQuarterlyPlans, findQuarterlyPlans } from "quarterly-plan-service"
import { fetchTasksForDomain, resolveTaskDomains } from "task-domain-service"
import { logIfEnabled, setLoggingEnabled } from "util/log"
import { persistPromotedQuarterlyPlanToggles } from "util/quarterly-plan-toggles"
import { taskSummaryFromTasks } from "util/task-victory-summary"

// How far back the Mood widget's ratings reach.
const MOOD_RATINGS_LOOKBACK_SECONDS = 60 * 60 * 24 * 14;
// How long the dashboard load waits for app.context.refreshSettings before using the settings it already has.
const SETTINGS_REFRESH_TIMEOUT_MS = 3000;
// Widgets whose config the init payload carries, parsed from each widget's JSON setting.
const WIDGET_CONFIG_IDS = ["victory-value", "calendar", "quotes", "mood", "note-peek", "recent-notes"];
// Plain string settings the init payload carries, with the value used when unset.
const STRING_SETTING_DEFAULTS = { [SETTING_KEYS.BACKGROUND_IMAGE_MODE]: 'cover', [SETTING_KEYS.BACKGROUND_IMAGE_URL]: '',
  [SETTING_KEYS.CONSOLE_LOGGING]: '', [SETTING_KEYS.DEBUG_CONSOLE]: '', [SETTING_KEYS.LLM_API_KEY_ANTHROPIC]: '',
  [SETTING_KEYS.LLM_API_KEY_GEMINI]: '', [SETTING_KEYS.LLM_API_KEY_GROK]: '', [SETTING_KEYS.LLM_API_KEY_OPENAI]: '',
  [SETTING_KEYS.LLM_PROVIDER_MODEL]: '' };

// ----------------------------------------------------------------------------------------------
// @desc Fetch everything the dashboard renders. Domain resolution runs in parallel with mood and settings, and the
//   task and plan fetches chain straight off it, so they start as soon as the domain UUID is known rather than
//   waiting on every other fetch.
// @param {Object} app - Amplenote app interface (plugin-side)
// @returns {Promise<Object>} taskSummaryFromTasks's fields plus activeTaskDomain, context, currentDate, initFailures,
//   moodRatings, pluginNoteUUID, quarterlyPlans, settings, and taskDomains
export async function fetchDashboardData(app) {
  setLoggingEnabled(app.settings?.[SETTING_KEYS.CONSOLE_LOGGING]);
  const startedAt = Date.now();
  const initFailures = [];
  logIfEnabled('[fetchDashboardData] starting — launching domain + mood/plans/settings in parallel');
  const now = new Date();

  const domainPromise = _softFailed({ domains: [], selectedDomainUuid: null }, initFailures, resolveTaskDomains(app), "init-domains");
  const tasksPromise = domainPromise.then(domainInfo => {
    logIfEnabled(`[fetchDashboardData] domain resolved in ${ Date.now() - startedAt }ms, uuid=${ domainInfo.selectedDomainUuid } — fetching tasks`);
    return _softFailed([], initFailures, fetchTasksForDomain(app, domainInfo.selectedDomainUuid), "init-tasks");
  });
  const plansPromise = domainPromise.then(domainInfo =>
    _softFailed(emptyQuarterlyPlans(domainInfo), initFailures, findQuarterlyPlans(app, domainInfo), "init-plans"));
  const moodFromUnixSeconds = Math.floor(Date.now() / 1000) - MOOD_RATINGS_LOOKBACK_SECONDS;
  const moodPromise = _softFailed([], initFailures, _moodRatings(app, moodFromUnixSeconds), "init-mood");
  const settingsPromise = _softFailed({}, initFailures, _readDashboardSettings(app), "init-settings");
  const togglesPromise = _quarterlyPlanTogglesAfterRefresh(app, { domainPromise, plansPromise });

  const [taskDomainInfo, moodRatings, quarterlyPlans, settings, domainTasks, quarterlyPlanToggles] = await Promise.all([
    domainPromise, moodPromise, plansPromise, settingsPromise, tasksPromise, togglesPromise]);
  settings[SETTING_KEYS.QUARTERLY_PLAN_TOGGLES] = quarterlyPlanToggles;
  logIfEnabled(`[fetchDashboardData] all resolved in ${ Date.now() - startedAt }ms — ${ domainTasks.length } tasks, ${ moodRatings.length } mood ratings`);

  const noteUUID = app.context?.noteUUID || null;
  return { ...taskSummaryFromTasks(now, domainTasks), activeTaskDomain: taskDomainInfo.selectedDomainUuid,
    context: { noteUUID, pluginUUID: app.context?.pluginUUID || null }, currentDate: now.toISOString(), initFailures,
    moodRatings, pluginNoteUUID: noteUUID, quarterlyPlans, settings, taskDomains: taskDomainInfo.domains };
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Normalize a soft-failed init branch into a serializable record the embed can forward to Sentry. This code
//   runs plugin-side, where the embed's Sentry client does not exist, so failures ride back on the init payload. The
//   stack travels with them because it is the only way the Sentry event can point at the Amplenote call that threw.
// @param {Error|*} error - Thrown value from a soft-failed init branch
// @param {string} source - Stable label for the branch that failed, e.g. "init-domains", used as the Sentry action tag
// @returns {{ message: string, source: string, stack: string|null }}
function _initFailureRecord(error, source) {
  return { message: error?.message || String(error) || source, source, stack: error?.stack || null };
}

// ----------------------------------------------------------------------------------------------
// @desc Recent mood ratings. A non-array result counts as empty, because every consumer indexes into this list.
// @param {number} fromUnixSeconds - Start of the ratings window, in Unix seconds (not milliseconds)
// @returns {Promise<Array<Object>>}
async function _moodRatings(app, fromUnixSeconds) {
  const moodRatings = await app.getMoodRatings(fromUnixSeconds);
  logIfEnabled("Mood ratings", moodRatings, "from", fromUnixSeconds);
  return Array.isArray(moodRatings) ? moodRatings : [];
}

// ----------------------------------------------------------------------------------------------
// @desc Read the quarterly plan checkbox states from freshly synced settings, then promote any shown quarter whose
//   plan now sits inside the lead window. Settings sync on a slow tier, so the checkbox another device changed
//   would otherwise be stale here; the refresh is bounded so a slow request cannot hold up the dashboard.
// @param {Object} params - { domainPromise, plansPromise }, resolving to the domain info and { current, next } plans
// @returns {Promise<string>} The toggles setting's JSON, "{}" when it could not be read
async function _quarterlyPlanTogglesAfterRefresh(app, { domainPromise, plansPromise }) {
  try {
    const [latestSettings, domainInfo, quarterlyPlans] = await Promise.all([_refreshedSettings(app), domainPromise, plansPromise]);
    const rawSetting = latestSettings?.[SETTING_KEYS.QUARTERLY_PLAN_TOGGLES] ?? app.settings?.[SETTING_KEYS.QUARTERLY_PLAN_TOGGLES];
    const plans = [quarterlyPlans?.current, quarterlyPlans?.next];
    return await persistPromotedQuarterlyPlanToggles(app, { domainUuid: domainInfo.selectedDomainUuid, plans, rawSetting });
  } catch (error) {
    logIfEnabled('[fetchDashboardData] quarterly plan toggles unavailable:', error);
    return app.settings?.[SETTING_KEYS.QUARTERLY_PLAN_TOGGLES] || "{}";
  }
}

// ----------------------------------------------------------------------------------------------
// @desc The settings the embed needs at load: each widget's parsed config, the plain string settings, and the widget
//   layout. A missing or corrupt layout is replaced with the default layout and saved, so the next load finds it.
// @returns {Promise<Object>} Settings keyed by setting name
async function _readDashboardSettings(app) {
  const settings = {};
  for (const widgetId of WIDGET_CONFIG_IDS) {
    const key = widgetConfigKey(widgetId);
    try {
      settings[key] = app.settings[key] ? JSON.parse(app.settings[key]) : null;
    } catch {
      settings[key] = null;
    }
  }
  for (const [key, defaultValue] of Object.entries(STRING_SETTING_DEFAULTS)) settings[key] = app.settings[key] || defaultValue;

  let componentLayout = null;
  try {
    componentLayout = app.settings[SETTING_KEYS.DASHBOARD_COMPONENTS] ? JSON.parse(app.settings[SETTING_KEYS.DASHBOARD_COMPONENTS]) : null;
  } catch {
    componentLayout = null;
  }
  if (!Array.isArray(componentLayout) || componentLayout.length === 0) {
    componentLayout = DEFAULT_DASHBOARD_COMPONENTS.map(component => ({ ...component }));
    await app.setSetting(SETTING_KEYS.DASHBOARD_COMPONENTS, JSON.stringify(componentLayout));
  }
  settings[SETTING_KEYS.DASHBOARD_COMPONENTS] = componentLayout;
  return settings;
}

// ----------------------------------------------------------------------------------------------
// @desc Ask Amplenote for the latest plugin settings, falling back to the possibly stale app.settings when the host
//   lacks app.context.refreshSettings, the request fails, or it takes longer than SETTINGS_REFRESH_TIMEOUT_MS.
// @returns {Promise<Object>} Settings keyed by setting name
async function _refreshedSettings(app) {
  if (typeof app.context?.refreshSettings !== "function") return app.settings || {};
  let timeoutId = null;
  const timeout = new Promise(resolve => { timeoutId = setTimeout(() => resolve(null), SETTINGS_REFRESH_TIMEOUT_MS); });
  try {
    const latestSettings = await Promise.race([app.context.refreshSettings(), timeout]);
    return latestSettings || app.settings || {};
  } catch (error) {
    logIfEnabled('[fetchDashboardData] refreshSettings failed:', error);
    return app.settings || {};
  } finally {
    clearTimeout(timeoutId);
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Resolve to `fallback` when `promise` rejects, recording the failure for the embed to report.
// @param {*} fallback - The value the failed branch's widget can render
// @param {Array<Object>} initFailures - Collector of _initFailureRecord entries
// @param {Promise<*>} promise - The branch's fetch
// @param {string} source - The branch's label, e.g. "init-tasks"
// @returns {Promise<*>}
function _softFailed(fallback, initFailures, promise, source) {
  return promise.catch(error => {
    logIfEnabled(`[fetchDashboardData] ${ source } failed:`, error);
    initFailures.push(_initFailureRecord(error, source));
    return fallback;
  });
}
