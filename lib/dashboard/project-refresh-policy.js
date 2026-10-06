// Share the project's refresh age policy across queued task association and idea planning.
import { dateFromDateInput } from "util/date-utility";

// Refresh project evidence after three days even when no explicit input change was observed.
export const PROJECT_STALENESS_HOURS = 72;

// ----------------------------------------------------------------------------------------------
// @desc Decide whether a project has gone long enough without a refresh to be worth a provider call.
// @param {object} record - Stored project record, or undefined when the project is new to the store.
// @param {Date} now - Current time.
// @returns {boolean} True when the project has never been refreshed or its last refresh has aged out.
export function projectNeedsRefresh(record, now) {
  if (!record?.lastAttemptedAt) return true;
  const lastRefresh = dateFromDateInput(record.lastAttemptedAt, { throwOnInvalid: false });
  if (!lastRefresh) return true;
  return now.getTime() - lastRefresh.getTime() >= PROJECT_STALENESS_HOURS * 60 * 60 * 1000;
}

