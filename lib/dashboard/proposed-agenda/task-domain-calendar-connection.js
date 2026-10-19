// The Task Domains settings page; taskDomainUUID expands that domain's card when the page loads.
const TASK_CALENDAR_SETTINGS_URL = "https://www.amplenote.com/task_calendar";

// ----------------------------------------------------------------------------------------------
// @desc Whether the given Task Domain has at least one external calendar connected. The answer comes from
//   app.getTaskDomains(), which gives each domain a `hasConnectedCalendar` boolean that the plugin API docs don't list.
//   Older Amplenote clients don't set it at all, so a missing value counts as unknown, never as "not connected".
// @param {object} app - Amplenote app interface
// @param {string|null} domainUuid - The Task Domain to check, or null when the dashboard has no domain selected
// @returns {Promise<boolean|null>} true or false as reported by Amplenote, or null when the domain, the field, or
//   app.getTaskDomains() itself is unavailable
export async function taskDomainHasConnectedCalendar(app, domainUuid) {
  if (!domainUuid || typeof app?.getTaskDomains !== "function") return null;

  const domains = await app.getTaskDomains();
  const domain = Array.isArray(domains) ? domains.find(candidate => candidate?.uuid === domainUuid) : null;
  const connection = typeof domain?.hasConnectedCalendar === "boolean" ? domain.hasConnectedCalendar : null;
  return connection;
}

// ----------------------------------------------------------------------------------------------
// @desc The Amplenote Task Domains settings URL with the given domain's card expanded, where its calendars are connected.
// @param {string} domainUuid - The Task Domain to show
// @returns {string} Settings page URL
export function taskDomainCalendarSettingsUrl(domainUuid) {
  return `${ TASK_CALENDAR_SETTINGS_URL }?taskDomainUUID=${ encodeURIComponent(domainUuid) }`;
}
