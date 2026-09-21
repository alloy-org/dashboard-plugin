// Decide which quarter the Quarterly Planning widget opens in Plan Builder. The header action stays on the
// current quarter until the next one is 15 days away, then it opens the upcoming quarter. A current-quarter
// card clicked in that same window, when this quarter has no plan yet, borrows the upcoming plan instead of
// starting an empty one for a quarter that is about to end.

export const UPCOMING_QUARTER_LEAD_DAYS = 15;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

// ----------------------------------------------------------------------------------------------
// @desc Choose the quarter the "Build plan" header action opens.
// @param {object} params - An object with the following properties:
//   - {Date} [now] - Clock to read; defaults to the current local time.
//   - {object|null} quarterlyPlans - The widget's current and next quarter plans.
// @returns {object|null} The plan whose quarter and year the wizard should open, or null when neither is known.
export function buildPlanTargetFromPlans({ now = new Date(), quarterlyPlans = null } = {}) {
  const currentPlan = quarterlyPlans?.current ?? null;
  const nextPlan = quarterlyPlans?.next ?? null;
  if (isWithinUpcomingQuarterLead({ now }) && nextPlan?.quarter && nextPlan?.year) return nextPlan;
  if (currentPlan?.quarter && currentPlan?.year) return currentPlan;
  if (nextPlan?.quarter && nextPlan?.year) return nextPlan;
  return null;
}

// ----------------------------------------------------------------------------------------------
// @desc Decide what a quarter card click should do. Outside the lead window, and for a quarter that already
//   has a plan, the card opens that quarter's wizard. Inside the window, a current quarter with no plan copies
//   the upcoming plan when one exists, and otherwise opens the upcoming quarter's wizard so its finished note
//   can be copied back.
// @param {object} params - An object with the following properties:
//   - {Date} [now] - Clock to read; defaults to the current local time.
//   - {object} plan - The card's plan, carrying quarter, year, and noteUUID.
//   - {object|null} quarterlyPlans - The widget's current and next quarter plans.
// @returns {object} An object with the following properties:
//   - {string} kind - "open-wizard" or "mirror-existing".
//   - {object|null} mirrorTarget - Current-quarter plan that should receive a copy of the upcoming plan.
//   - {object|null} quarterPlan - Quarter the wizard opens, when kind is "open-wizard".
//   - {object|null} sourcePlan - Upcoming plan whose note is copied, when kind is "mirror-existing".
export function currentQuarterCardAction({ now = new Date(), plan, quarterlyPlans = null } = {}) {
  const currentPlan = quarterlyPlans?.current ?? null;
  const nextPlan = quarterlyPlans?.next ?? null;
  const openWizard = (quarterPlan, mirrorTarget = null) => ({ kind: "open-wizard", mirrorTarget, quarterPlan, sourcePlan: null });
  const isCurrentQuarter = isSameQuarter(plan, currentPlan);
  const borrowsUpcomingPlan = isCurrentQuarter && !plan?.noteUUID && isWithinUpcomingQuarterLead({ now });
  if (!borrowsUpcomingPlan) return openWizard(plan);
  if (nextPlan?.noteUUID) return { kind: "mirror-existing", mirrorTarget: plan, quarterPlan: null, sourcePlan: nextPlan };
  if (nextPlan?.quarter && nextPlan?.year) return openWizard(nextPlan, plan);
  return openWizard(plan);
}

// ----------------------------------------------------------------------------------------------
// @desc Count whole local days from the start of today until the first day of the next quarter.
// @param {Date} [now] - Clock to read; defaults to the current local time.
// @returns {number} Days remaining. The day before a quarter starts is 1, because that quarter is already
//   current on the morning it begins.
export function daysUntilNextQuarter(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const nextStart = nextQuarterStartDate(now);
  return Math.round((nextStart.getTime() - today.getTime()) / MILLISECONDS_PER_DAY);
}

// ----------------------------------------------------------------------------------------------
// @desc Report whether two plans name the same calendar quarter.
// @param {object|null} plan - Plan carrying quarter and year.
// @param {object|null} otherPlan - Plan to compare against.
// @returns {boolean} True when both name the same quarter of the same year.
function isSameQuarter(plan, otherPlan) {
  if (!plan?.quarter || !plan?.year || !otherPlan?.quarter || !otherPlan?.year) return false;
  return plan.quarter === otherPlan.quarter && plan.year === otherPlan.year;
}

// ----------------------------------------------------------------------------------------------
// @desc Report whether the next quarter starts within the lead window, including its last day.
// @param {object} [params] - An object with the following properties:
//   - {number} [leadDays] - How many days before the next quarter counts as inside the window.
//   - {Date} [now] - Clock to read; defaults to the current local time.
// @returns {boolean} True when daysUntilNextQuarter is leadDays or fewer.
export function isWithinUpcomingQuarterLead({ leadDays = UPCOMING_QUARTER_LEAD_DAYS, now = new Date() } = {}) {
  return daysUntilNextQuarter(now) <= leadDays;
}

// ----------------------------------------------------------------------------------------------
// @desc First local midnight of the quarter after the one containing now.
// @param {Date} now - Clock to read.
// @returns {Date} January 1, April 1, July 1, or October 1, in the year that quarter belongs to.
function nextQuarterStartDate(now) {
  const quarterIndex = Math.floor(now.getMonth() / 3);
  const nextQuarterIndex = (quarterIndex + 1) % 4;
  const year = nextQuarterIndex === 0 ? now.getFullYear() + 1 : now.getFullYear();
  return new Date(year, nextQuarterIndex * 3, 1);
}
