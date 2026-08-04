import { SETTING_KEYS } from "constants/settings";
import { pluginSettings } from "plugin-data";

// ----------------------------------------------------------------------------------------------
// @desc Resolve the active Task Domain uuid/name (and which domain owns legacy plan migration) from
//   plugin settings, falling back to app.getTaskDomains() when the cache is empty.
// @param {object} app - Amplenote app bridge.
// @returns {Promise<{ domainName: string|null, domainUuid: string|null, domains: Array<{name: string, uuid: string}>,
//   migrationDomainName: string|null }>}
export async function activeTaskDomainInfo(app) {
  const rawValue = pluginSettings()[SETTING_KEYS.TASK_DOMAINS];
  let parsedSettings = {};
  try { parsedSettings = rawValue ? JSON.parse(rawValue) : {}; } catch { parsedSettings = {}; }
  let domains = Array.isArray(parsedSettings.domains) ? parsedSettings.domains.filter(d => d?.uuid) : [];
  let domainUuid = parsedSettings.selectedDomainUuid || null;

  if (!domainUuid || domains.length === 0) {
    let freshDomains = null;
    if (typeof app.getTaskDomains === "function") {
      freshDomains = await app.getTaskDomains().catch(() => null);
    }
    if (Array.isArray(freshDomains) && freshDomains.length > 0) {
      domains = freshDomains.filter(d => d?.uuid).map(d => ({ name: d.name, uuid: d.uuid }));
      if (!domainUuid) domainUuid = defaultDomainUuid(domains);
    }
  }

  const selected = domains.find(domain => domain.uuid === domainUuid) || null;
  const migrationDomainName = migrationDomainNameFromDomains(domains);
  return { domainName: selected?.name || null, domainUuid: domainUuid || null, domains, migrationDomainName };
}

// ----------------------------------------------------------------------------------------------
// @desc Prefer the "Work" domain UUID when present, otherwise the first domain in the list.
// @param {Array<{name?: string, uuid: string}>|null|undefined} domains
// @returns {string|null}
export function defaultDomainUuid(domains) {
  if (!Array.isArray(domains) || domains.length === 0) return null;
  const work = domains.find(domain => domain.name === "Work");
  return work ? work.uuid : domains[0].uuid;
}

// ----------------------------------------------------------------------------------------------
// @desc Return task UUIDs visible in the given task domain for callers that need to scope task-derived data.
// @param {object} app - Amplenote app bridge.
// @param {string|null} domainUuid - Task domain UUID.
// @returns {Promise<Set<string>|null>} Task UUID set, or null when no domain/list is available.
// [OpenAI GPT-5.5] Task: share task-domain UUID filtering for completed-task analysis
export async function domainTaskUuidSet(app, domainUuid) {
  if (!domainUuid || typeof app.getTaskDomainTasks !== "function") return null;
  const tasks = await app.getTaskDomainTasks(domainUuid).catch(() => null);
  if (!Array.isArray(tasks)) return null;
  return new Set(tasks.map(task => task?.uuid).filter(Boolean));
}

// ----------------------------------------------------------------------------------------------
// @desc Domain name used when migrating a legacy "${label} Plan" note — Work if present, else the first
//   domain encountered in the Dashboard domain list.
// @param {Array<{name?: string, uuid: string}>|null|undefined} domains
// @returns {string|null}
export function migrationDomainNameFromDomains(domains) {
  if (!Array.isArray(domains) || domains.length === 0) return null;
  const work = domains.find(domain => domain.name === "Work");
  return (work || domains[0])?.name || null;
}
