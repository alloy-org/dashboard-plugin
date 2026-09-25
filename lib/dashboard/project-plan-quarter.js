// Choose which quarters' plan notes and Plan Builder projects drive task suggestions. A quarter counts when its
// Quarterly Planning checkbox is enabled (see util/quarterly-plan-toggles): the target day's own quarter by default,
// the upcoming quarter once it is within the lead window or the user checked it, and never a quarter the user
// unchecked or one that has already ended.
import { SETTING_KEYS } from "constants/settings";
import { pluginSettings } from "plugin-data";
import { logIfEnabled } from "util/log";
import { resolveQuarterlyPlanNote } from "util/quarterly-plan-notes";
import { enabledSuggestionQuarters, quarterlyPlanTogglesFromSetting } from "util/quarterly-plan-toggles";

// ----------------------------------------------------------------------------------------------
// @desc Join the plans of several quarters into one block of markdown for an LLM prompt. A single plan is returned
//   unchanged, so a prompt built from one quarter reads exactly as it did before quarters could be combined.
// @param {Array<object>} plans - Entries from loadEnabledQuarterlyPlans, each with label and content.
// @returns {string|null} Combined markdown, or null when no plan has content.
export function combinedQuarterlyContent(plans) {
  const plansWithContent = plans.filter(plan => plan.content);
  if (plansWithContent.length === 0) return null;
  if (plansWithContent.length === 1) return plansWithContent[0].content;
  const sections = plansWithContent.map(plan => `### Plan for ${ plan.label }\n${ plan.content }`);
  return sections.join("\n\n");
}

// ----------------------------------------------------------------------------------------------
// @desc Load the plan note of every quarter whose checkbox is enabled for a target day.
// @param {object} app - Host-compatible Amplenote app bridge.
// @param {object} options - An object with the following properties:
//   - {boolean} allowLegacyMigration - Passed through to resolveQuarterlyPlanNote
//   - {string|null} domainName - Active Task Domain name
//   - {string|null} domainUuid - Active Task Domain UUID
//   - {Date} targetDate - Local day being planned
//   - {object} [toggles] - Parsed checkbox states; defaults to the value in the plugin settings snapshot
// @returns {Promise<Array<object>>} Earliest quarter first, each with the following properties:
//   - {string} label - Quarter label, e.g. "Q4 2026"
//   - {string|null} planContent - Markdown of the quarter's plan note, or null when it has none
//   - {object|null} planNote - Handle of the quarter's plan note
//   - {number} quarter - Quarter, 1 through 4
//   - {number} year - Quarter's year
export async function loadEnabledQuarterlyPlans(app, { allowLegacyMigration, domainName, domainUuid, targetDate,
    toggles = null }) {
  const resolvedToggles = toggles || quarterlyPlanTogglesFromSetting(pluginSettings()[SETTING_KEYS.QUARTERLY_PLAN_TOGGLES]);
  const quarters = enabledSuggestionQuarters({ domainUuid, targetDate, toggles: resolvedToggles });
  const plans = await Promise.all(quarters.map(quarter => _quarterPlan(app, { allowLegacyMigration, domainName, ...quarter })));
  logIfEnabled("[project-plan-quarter] enabled quarterly plans", { quarters: plans.map(plan => plan.label),
    withNotes: plans.filter(plan => plan.planNote).map(plan => plan.label) });
  return plans;
}

// ----------------------------------------------------------------------------------------------
// @desc Load one quarter's plan note and its markdown.
// @param {object} app - Host-compatible Amplenote app bridge.
// @param {object} options - { allowLegacyMigration, domainName, label, quarter, year }.
// @returns {Promise<object>} { label, planContent, planNote, quarter, year }.
async function _quarterPlan(app, { allowLegacyMigration, domainName, label, quarter, year }) {
  const planNote = await resolveQuarterlyPlanNote(app, allowLegacyMigration, domainName, label);
  const planContent = planNote ? (await app.getNoteContent({ uuid: planNote.uuid })) || null : null;
  return { label, planContent, planNote, quarter, year };
}
