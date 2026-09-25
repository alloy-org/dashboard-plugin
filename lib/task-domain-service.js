// Keeps the dashboard's Task Domain list and selection, cached in the `dashboard_task_domains` setting as
// { domains, lastRetrieved, selectedDomainUuid }, and fetches the selected domain's tasks.
// resolveTaskDomains runs plugin-side during the dashboard load and reads the real app.settings. refreshTaskDomains
// and switchTaskDomain are called from the embed, whose app proxy carries no settings, so they read pluginSettings().
import { SETTING_KEYS, TASK_DOMAIN_STALE_MS } from "constants/settings"
import { pluginSettings, updatePluginSetting } from "plugin-data"
import { findQuarterlyPlans } from "quarterly-plan-service"
import { fetchDomainOrAllNotesTasks } from "util/all-notes-tasks"
import { logIfEnabled } from "util/log"
import { persistPromotedQuarterlyPlanToggles } from "util/quarterly-plan-toggles"
import { defaultDomainUuid } from "util/task-domain-utility"
import { taskSummaryFromTasks } from "util/task-victory-summary"

// ----------------------------------------------------------------------------------------------
// @desc Fetch a domain's open tasks, or every note's tasks when no domain could be resolved, so a user without Task
//   Domains still sees their tasks.
// @param {Object} app - Amplenote app interface
// @param {string|null} domainUuid - The Task Domain, or null for the all-notes fallback
// @returns {Promise<Array<Object>>} Tasks
export async function fetchTasksForDomain(app, domainUuid) {
  const startedAt = Date.now();
  const tasks = await fetchDomainOrAllNotesTasks(app, domainUuid, { includeDone: false });
  logIfEnabled(`[fetchTasksForDomain] ${ domainUuid ? `getTaskDomainTasks(${ domainUuid })` : "all-notes fallback" } returned ${ tasks.length } tasks in ${ Date.now() - startedAt }ms`);
  return tasks;
}

// ----------------------------------------------------------------------------------------------
// @desc Re-read the domain list from Amplenote whatever the cache's age. getTaskDomains() can throw or resolve to an
//   error object instead of an array when the host fails; the previously stored domains are then kept rather than
//   wiped, which a user pressing refresh on a bad connection would otherwise lose.
// @param {Object} app - Amplenote app interface (embed-side)
// @returns {Promise<{ activeTaskDomain: string|null, domains: Array<Object> }>}
export async function refreshTaskDomains(app) {
  logIfEnabled('[refreshTaskDomains] Starting domain refresh');
  const storedDomains = _storedTaskDomainsFromSetting(pluginSettings()[SETTING_KEYS.TASK_DOMAINS]);

  let domainsResponse = null;
  try {
    domainsResponse = await app.getTaskDomains();
  } catch (error) {
    logIfEnabled('[refreshTaskDomains] getTaskDomains() threw', error);
  }
  _logTaskDomainsResponse('[refreshTaskDomains]', domainsResponse);

  if (Array.isArray(domainsResponse)) {
    storedDomains.domains = _domainsFromResponse(domainsResponse);
    storedDomains.lastRetrieved = Date.now();
  } else {
    logIfEnabled('[refreshTaskDomains] API returned no usable domains; keeping previously stored domains');
    storedDomains.domains = Array.isArray(storedDomains.domains) ? storedDomains.domains : [];
  }
  _selectDefaultDomainUnlessPresent(storedDomains);

  await app.setSetting(SETTING_KEYS.TASK_DOMAINS, JSON.stringify(storedDomains));
  logIfEnabled(`[refreshTaskDomains] Refresh complete — ${ storedDomains.domains.length } domains, active: ${ storedDomains.selectedDomainUuid }`);
  return { activeTaskDomain: storedDomains.selectedDomainUuid, domains: storedDomains.domains };
}

// ----------------------------------------------------------------------------------------------
// @desc The domain list and selection for the dashboard load: the cached setting while it is fresher than
//   TASK_DOMAIN_STALE_MS, otherwise a fresh getTaskDomains() written back to the cache. Always leaves a domain
//   selected when any exist.
// @param {Object} app - Amplenote app interface (plugin-side)
// @returns {Promise<Object>} The stored { domains, lastRetrieved, selectedDomainUuid }
export async function resolveTaskDomains(app) {
  const storedDomains = _storedTaskDomainsFromSetting(app.settings[SETTING_KEYS.TASK_DOMAINS]);
  const isStale = !storedDomains.lastRetrieved || (Date.now() - storedDomains.lastRetrieved > TASK_DOMAIN_STALE_MS);
  const hasDomains = Array.isArray(storedDomains.domains) && storedDomains.domains.length > 0;
  if (hasDomains && !isStale && storedDomains.selectedDomainUuid) return storedDomains;

  if (!hasDomains || isStale) {
    logIfEnabled(`[resolveTaskDomains] cache ${ hasDomains ? 'stale' : 'empty' } — calling getTaskDomains()`);
    const startedAt = Date.now();
    const domainsResponse = await app.getTaskDomains();
    _logTaskDomainsResponse(`[resolveTaskDomains] (${ Date.now() - startedAt }ms)`, domainsResponse);
    storedDomains.domains = _domainsFromResponse(domainsResponse);
    storedDomains.lastRetrieved = Date.now();
  }
  _selectDefaultDomainUnlessPresent(storedDomains);

  await app.setSetting(SETTING_KEYS.TASK_DOMAINS, JSON.stringify(storedDomains));
  return storedDomains;
}

// ----------------------------------------------------------------------------------------------
// @desc Make `domainUuid` the dashboard's Task Domain and return what the task and planning widgets show for it:
//   its tasks, its quarterly plans, and its quarterly plan checkboxes after promotion.
// @param {Object} app - Amplenote app interface (embed-side)
// @param {string} domainUuid - The Task Domain chosen
// @returns {Promise<Object>} taskSummaryFromTasks's fields plus activeTaskDomain and quarterlyPlans
export async function switchTaskDomain(app, domainUuid) {
  const storedDomains = _storedTaskDomainsFromSetting(pluginSettings()[SETTING_KEYS.TASK_DOMAINS]);
  storedDomains.selectedDomainUuid = domainUuid;
  await app.setSetting(SETTING_KEYS.TASK_DOMAINS, JSON.stringify(storedDomains));
  updatePluginSetting(SETTING_KEYS.TASK_DOMAINS, JSON.stringify(storedDomains));

  const domainTasks = await fetchTasksForDomain(app, domainUuid);
  const quarterlyPlans = await findQuarterlyPlans(app, { domains: storedDomains.domains || [], selectedDomainUuid: domainUuid });
  const quarterlyPlanToggles = await persistPromotedQuarterlyPlanToggles(app, { domainUuid,
    plans: [quarterlyPlans.current, quarterlyPlans.next], rawSetting: pluginSettings()[SETTING_KEYS.QUARTERLY_PLAN_TOGGLES] });
  updatePluginSetting(SETTING_KEYS.QUARTERLY_PLAN_TOGGLES, quarterlyPlanToggles);

  return { ...taskSummaryFromTasks(new Date(), domainTasks), activeTaskDomain: domainUuid, quarterlyPlans };
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Keep only the name and uuid of each domain getTaskDomains() returned; a non-array response yields none.
// @returns {Array<{ name: string, uuid: string }>}
function _domainsFromResponse(domainsResponse) {
  const domainsWithUuid = (Array.isArray(domainsResponse) ? domainsResponse : []).filter(domain => domain && domain.uuid);
  const namedDomains = domainsWithUuid.map(domain => ({ name: domain.name, uuid: domain.uuid }));
  return namedDomains;
}

// ----------------------------------------------------------------------------------------------
// @desc Log the raw value app.getTaskDomains() resolved to in full, so a host-side failure (an error object instead
//   of an array) can be diagnosed from the console.
// @param {string} prefix - Log prefix identifying the caller, e.g. "[refreshTaskDomains]"
// @param {*} response - The exact value app.getTaskDomains() resolved to
function _logTaskDomainsResponse(prefix, response) {
  const isArray = Array.isArray(response);
  const count = isArray ? response.length : 0;
  const type = response === null ? 'null' : isArray ? 'array' : typeof response;
  const keys = response && typeof response === 'object' && !isArray ? Object.keys(response) : null;
  let serialized;
  try { serialized = JSON.stringify(response); } catch { serialized = String(response); }
  logIfEnabled(`${ prefix } getTaskDomains() returned ${ count } domains (type=${ type }${ keys ? `, keys=[${ keys.join(',') }]` : '' })`,
    { raw: response, serialized });
}

// ----------------------------------------------------------------------------------------------
// @desc Replace a selection that is missing, or names a domain no longer in the list, with the default domain.
// @param {Object} storedDomains - The stored setting, mutated in place
function _selectDefaultDomainUnlessPresent(storedDomains) {
  const domains = storedDomains.domains || [];
  const selectedStillExists = storedDomains.selectedDomainUuid && domains.some(domain => domain.uuid === storedDomains.selectedDomainUuid);
  if (selectedStillExists) return;

  logIfEnabled(`[taskDomains] selection ${ storedDomains.selectedDomainUuid } is not among ${ domains.length } domains; picking the default`);
  storedDomains.selectedDomainUuid = defaultDomainUuid(domains);
}

// ----------------------------------------------------------------------------------------------
// @desc Parse the stored Task Domain setting; an absent or corrupt value starts from an empty object.
// @param {string|undefined} rawSetting - The setting's JSON
// @returns {Object} { domains?, lastRetrieved?, selectedDomainUuid? }
function _storedTaskDomainsFromSetting(rawSetting) {
  try {
    return rawSetting ? JSON.parse(rawSetting) : {};
  } catch (error) {
    logIfEnabled('[taskDomains] stored task-domains setting did not parse; starting fresh', { error, rawSetting });
    return {};
  }
}
