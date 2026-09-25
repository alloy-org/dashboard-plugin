// Remember which quarterly plans feed task suggestions. Each quarter card in the Quarterly Planning widget has a
// checkbox whose stored state is true (checked), false (the user unchecked it), or null (never set: the plan did not
// exist yet, or it was written more than UPCOMING_QUARTER_LEAD_DAYS before its quarter began). A null state reads as
// checked once the quarter is that close, and the dashboard load writes true so the user sees it and can uncheck it.
// The states live in one plugin setting as JSON: { [domainUuid or "all-notes"]: { "Q4 2026": true } }.
import { UPCOMING_QUARTER_LEAD_DAYS } from "dashboard/build-plan-quarter";
import { daysUntilQuarterStart, hasQuarterEnded, quarterAfter, quarterFromDate, quarterFromLabel,
  quarterLabel } from "constants/quarters";
import { SETTING_KEYS } from "constants/settings";
import { logIfEnabled } from "util/log";

const ALL_NOTES_DOMAIN_KEY = "all-notes";

// ----------------------------------------------------------------------------------------------
// @desc The key a Task Domain's toggles are stored under. All Notes, which has no domain UUID, gets its own key.
// @param {string|null} domainUuid - Active Task Domain UUID, or null for All Notes.
// @returns {string} Key into the stored toggles object.
function _domainKey(domainUuid) {
  return domainUuid || ALL_NOTES_DOMAIN_KEY;
}

// ----------------------------------------------------------------------------------------------
// @desc List the quarters whose plans should be sent to the LLM when suggesting tasks for a day. Candidates are the
//   day's own quarter and the one after it, each kept only while isQuarterPlanEnabled holds for it.
// @param {object} params - An object with the following properties:
//   - {string|null} domainUuid - Active Task Domain UUID, or null for All Notes.
//   - {Date} targetDate - Local day being planned; decides which quarters are past or near.
//   - {object} toggles - Parsed toggles from quarterlyPlanTogglesFromSetting.
// @returns {Array<{ label: string, quarter: number, year: number }>} Enabled quarters, earliest first.
export function enabledSuggestionQuarters({ domainUuid, targetDate, toggles }) {
  const ownQuarter = quarterFromDate(targetDate);
  const candidateQuarters = [ownQuarter, quarterAfter(ownQuarter)];
  const enabledQuarters = candidateQuarters.filter(({ quarter, year }) => isQuarterPlanEnabled({ now: targetDate,
    quarter, storedState: storedQuarterToggle(toggles, { domainUuid, quarter, year }), year }));
  return enabledQuarters;
}

// ----------------------------------------------------------------------------------------------
// @desc Decide whether a quarter's plan counts toward task suggestions. A past quarter never does. Otherwise a
//   stored true or false wins, and a null state counts once the quarter begins within the lead window, which
//   includes a quarter that has already begun.
// @param {object} params - An object with the following properties:
//   - {Date} [now] - Clock to read; defaults to the current local time.
//   - {number} quarter - Quarter number, 1 through 4.
//   - {boolean|null} storedState - The quarter's stored checkbox state.
//   - {number} year - Year the quarter belongs to.
// @returns {boolean} True when the quarter's plan should be used.
export function isQuarterPlanEnabled({ now = new Date(), quarter, storedState, year }) {
  if (hasQuarterEnded({ now, quarter, year })) return false;
  if (typeof storedState === "boolean") return storedState;
  return daysUntilQuarterStart({ now, quarter, year }) <= UPCOMING_QUARTER_LEAD_DAYS;
}

// ----------------------------------------------------------------------------------------------
// @desc Bring stored toggles up to date for the quarters the dashboard shows. A quarter with a plan note and a null
//   state becomes true once it is inside the lead window, and entries for quarters that have ended are dropped.
// @param {object} toggles - Parsed toggles from quarterlyPlanTogglesFromSetting.
// @param {object} params - An object with the following properties:
//   - {string|null} domainUuid - Active Task Domain UUID, or null for All Notes.
//   - {Date} [now] - Clock to read; defaults to the current local time.
//   - {Array<object>} plans - Quarterly plans carrying quarter, year, and noteUUID.
// @returns {{ changed: boolean, toggles: object }} Updated toggles, and whether they differ from the input.
export function promotedQuarterlyPlanToggles(toggles, { domainUuid, now = new Date(), plans }) {
  let changed = false;
  const updated = {};
  for (const [domainKey, statesByLabel] of Object.entries(toggles || {})) {
    const liveEntries = Object.entries(statesByLabel || {}).filter(([label]) => {
      const parsed = quarterFromLabel(label);
      return parsed && !hasQuarterEnded({ now, ...parsed });
    });
    if (liveEntries.length !== Object.keys(statesByLabel || {}).length) changed = true;
    if (liveEntries.length) updated[domainKey] = Object.fromEntries(liveEntries);
  }
  for (const plan of plans || []) {
    if (!plan?.noteUUID || !plan.quarter || !plan.year) continue;
    const storedState = storedQuarterToggle(updated, { domainUuid, quarter: plan.quarter, year: plan.year });
    if (storedState !== null || !isQuarterPlanEnabled({ now, quarter: plan.quarter, storedState, year: plan.year })) continue;
    const domainKey = _domainKey(domainUuid);
    updated[domainKey] = { ...updated[domainKey], [quarterLabel(plan.year, plan.quarter)]: true };
    changed = true;
  }
  return { changed, toggles: updated };
}

// ----------------------------------------------------------------------------------------------
// @desc Apply promotedQuarterlyPlanToggles to the stored setting and write it back when anything changed. Used by
//   the plugin-side dashboard load and by the embed's Task Domain switch, both of which pass their own settings.
// @param {object} app - Amplenote app interface or embed proxy; only setSetting is called.
// @param {object} params - An object with the following properties:
//   - {string|null} domainUuid - Active Task Domain UUID, or null for All Notes.
//   - {Array<object>} plans - Quarterly plans carrying quarter, year, and noteUUID.
//   - {string|null} rawSetting - Current value of SETTING_KEYS.QUARTERLY_PLAN_TOGGLES.
// @returns {Promise<string>} The setting's JSON after promotion, whether or not it was written.
export async function persistPromotedQuarterlyPlanToggles(app, { domainUuid, plans, rawSetting }) {
  const { changed, toggles } = promotedQuarterlyPlanToggles(quarterlyPlanTogglesFromSetting(rawSetting), { domainUuid, plans });
  const serialized = JSON.stringify(toggles);
  if (!changed) return serialized;
  try {
    await app.setSetting(SETTING_KEYS.QUARTERLY_PLAN_TOGGLES, serialized);
    logIfEnabled("[quarterly-plan-toggles] promoted toggles saved", toggles);
  } catch (error) {
    logIfEnabled("[quarterly-plan-toggles] could not save promoted toggles", error?.message);
  }
  return serialized;
}

// ----------------------------------------------------------------------------------------------
// @desc Parse the stored toggles setting, treating a missing or malformed value as no toggles at all.
// @param {string|object|null} rawSetting - Value of SETTING_KEYS.QUARTERLY_PLAN_TOGGLES.
// @returns {object} Toggles keyed by domain key, then by quarter label.
export function quarterlyPlanTogglesFromSetting(rawSetting) {
  if (!rawSetting) return {};
  try {
    const parsed = typeof rawSetting === "string" ? JSON.parse(rawSetting) : rawSetting;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Record the user's choice for one quarter's checkbox.
// @param {object} toggles - Parsed toggles from quarterlyPlanTogglesFromSetting.
// @param {object} params - { domainUuid, enabled, quarter, year } where enabled is the new checkbox state.
// @returns {object} A new toggles object; the input is not modified.
export function quarterlyPlanTogglesWithState(toggles, { domainUuid, enabled, quarter, year }) {
  const domainKey = _domainKey(domainUuid);
  const domainStates = { ...toggles?.[domainKey], [quarterLabel(year, quarter)]: !!enabled };
  return { ...toggles, [domainKey]: domainStates };
}

// ----------------------------------------------------------------------------------------------
// @desc Read one quarter's stored checkbox state.
// @param {object} toggles - Parsed toggles from quarterlyPlanTogglesFromSetting.
// @param {object} params - { domainUuid, quarter, year }.
// @returns {boolean|null} The stored state, or null when none has been recorded.
export function storedQuarterToggle(toggles, { domainUuid, quarter, year }) {
  const value = toggles?.[_domainKey(domainUuid)]?.[quarterLabel(year, quarter)];
  return typeof value === "boolean" ? value : null;
}
