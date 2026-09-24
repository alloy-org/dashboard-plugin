// Choose which quarter's plan note and Plan Builder projects drive agenda suggestions. Near the end of a quarter,
// Plan Builder opens the upcoming quarter, so a user who has only built that plan would otherwise be offered
// suggestions from the ending quarter's plan, which Plan Builder never touched.
import { isWithinUpcomingQuarterLead } from "build-plan-quarter";
import { resolvePlanScope } from "plan-wizard/plan-models";
import { isBuilderMarkedText, planSectionRange, projectBlocksFromBody } from "plan-wizard/quarterly-plan-markdown";
import { readVisionGuide } from "plan-wizard/vision-guide-repository";
import { logIfEnabled } from "util/log";
import { resolveQuarterlyPlanNote } from "util/quarterly-plan-notes";

const LIVE_PRIORITY_EMS = ["quarterFocus", "monthFocus", "stayWarm"];
const RETIRED_APPROVAL_STATUS_EMS = ["humanRejected", "humanRetired"];

// ----------------------------------------------------------------------------------------------
// @desc Resolve the quarter whose plan should seed suggestions for a target day. This is the target day's own
//   quarter, except within the lead window before the next quarter begins (the window Plan Builder uses to open
//   the upcoming quarter): there, when only the upcoming quarter carries Plan Builder projects, it wins.
// @param {object} app - Host-compatible Amplenote app bridge.
// @param {object} options - An object with the following properties:
//   - {boolean} allowLegacyMigration - Passed through to resolveQuarterlyPlanNote
//   - {string|null} domainName - Active Task Domain name
//   - {string|null} domainUuid - Active Task Domain UUID
//   - {Date} targetDate - Local day being planned
// @returns {Promise<object>} An object with the following properties:
//   - {string|null} planContent - Markdown of the chosen quarter's plan note, or null when it has none
//   - {object|null} planNote - Handle of the chosen plan note
//   - {number} quarter - Chosen quarter, 1 through 4
//   - {number} year - Chosen quarter's year
export async function resolveProjectPlanQuarter(app, { allowLegacyMigration, domainName, domainUuid, targetDate }) {
  const currentQuarter = Math.floor(targetDate.getMonth() / 3) + 1;
  const current = await _quarterPlan(app, { allowLegacyMigration, domainName, quarter: currentQuarter,
    year: targetDate.getFullYear() });
  if (!isWithinUpcomingQuarterLead({ now: targetDate })) return current;

  const nextQuarter = currentQuarter === 4 ? 1 : currentQuarter + 1;
  const nextYear = currentQuarter === 4 ? targetDate.getFullYear() + 1 : targetDate.getFullYear();
  const next = await _quarterPlan(app, { allowLegacyMigration, domainName, quarter: nextQuarter, year: nextYear });
  const [currentHasProjects, nextHasProjects] = await Promise.all([
    _hasPlanBuilderProjects(app, { domainName, domainUuid, plan: current }),
    _hasPlanBuilderProjects(app, { domainName, domainUuid, plan: next })]);
  const chosen = nextHasProjects && !currentHasProjects ? next : current;
  logIfEnabled("[project-plan-quarter] end-of-quarter plan choice", { chosenQuarter: `Q${ chosen.quarter } ${ chosen.year }`,
    currentHasProjects, nextHasProjects });
  return chosen;
}

// ----------------------------------------------------------------------------------------------
// @desc Load one quarter's plan note and its markdown.
// @param {object} app - Host-compatible Amplenote app bridge.
// @param {object} options - { allowLegacyMigration, domainName, quarter, year }.
// @returns {Promise<object>} { planContent, planNote, quarter, year }.
async function _quarterPlan(app, { allowLegacyMigration, domainName, quarter, year }) {
  const planNote = await resolveQuarterlyPlanNote(app, allowLegacyMigration, domainName, `Q${ quarter } ${ year }`);
  const planContent = planNote ? (await app.getNoteContent({ uuid: planNote.uuid })) || null : null;
  return { planContent, planNote, quarter, year };
}

// ----------------------------------------------------------------------------------------------
// @desc Report whether a quarter has projects from Plan Builder, either published into its plan note (a project
//   heading carrying the builder marker) or still held as live prospects in that quarter's vision guide.
// @param {object} app - Host-compatible Amplenote app bridge.
// @param {object} options - { domainName, domainUuid, plan } where plan comes from _quarterPlan.
// @returns {Promise<boolean>} True when at least one Plan Builder project belongs to the quarter.
async function _hasPlanBuilderProjects(app, { domainName, domainUuid, plan }) {
  const content = plan.planContent || "";
  const section = planSectionRange(content, "Projects");
  const { blocks } = projectBlocksFromBody(section ? content.slice(section.bodyStart, section.end) : "");
  if (blocks.some(block => isBuilderMarkedText(block.headingText))) return true;
  try {
    const scope = resolvePlanScope({ domainName, domainUuid, quarter: plan.quarter, year: plan.year });
    const guide = await readVisionGuide(app, scope);
    const envelopes = [guide?.workProspects, guide?.personalProspects].filter(Boolean);
    const prospects = envelopes.flatMap(envelope => envelope.prospects || []);
    return prospects.some(prospect => prospect.quarterKey === scope.quarterKey
      && !RETIRED_APPROVAL_STATUS_EMS.includes(prospect.approvalStatusEm) && LIVE_PRIORITY_EMS.includes(prospect.priorityEm));
  } catch (error) {
    logIfEnabled("[project-plan-quarter] vision guide unavailable", error?.message);
    return false;
  }
}
