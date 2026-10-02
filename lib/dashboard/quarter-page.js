// Which two quarters the Quarterly Planning pager is showing, and which loaded plan backs each card.
import { quarterLabel } from "constants/quarters";

// ----------------------------------------------------------------------------------------------
// @desc A card-shaped plan that has not been looked up yet. The widget shows it while the note search runs.
// @param {object} quarter - { label, quarter, year } for the card.
// @param {string|null} domainName - Active task domain display name.
// @returns {object} Plan with pending set, and no note.
export function pendingQuarterPlan(quarter, domainName) {
  return { ...quarter, domainName, hasAllMonthlyDetails: false, noteUUID: null, pending: true };
}

// ----------------------------------------------------------------------------------------------
// @desc The two quarters a pager offset shows, plus the quarters the side buttons visit.
//   Offset 0 is the current quarter beside the next one. Each step moves that pair by one quarter.
// @param {object} params - An object with the following properties:
//   - {number} anchorQuarter - The real current quarter, 1 through 4.
//   - {number} anchorYear - Year of the real current quarter.
//   - {number} pageOffset - Quarters the left card is shifted from the anchor. Negative is the past.
// @returns {object} earlier and later are the visible pair. previous and following are the side buttons.
export function quarterPageWindow({ anchorQuarter, anchorYear, pageOffset }) {
  const earlier = quarterShiftedBy({ quarter: anchorQuarter, year: anchorYear }, pageOffset);
  const later = quarterShiftedBy({ quarter: anchorQuarter, year: anchorYear }, pageOffset + 1);
  const previous = quarterShiftedBy({ quarter: anchorQuarter, year: anchorYear }, pageOffset - 1);
  const following = quarterShiftedBy({ quarter: anchorQuarter, year: anchorYear }, pageOffset + 2);
  return { earlier, following, later, previous };
}

// ----------------------------------------------------------------------------------------------
// @desc The plan object to render for one quarter on the current page. A quarter the dashboard already
//   loaded (the real current or next plan) wins over a page fetch, so a note mirrored into the current
//   quarter stays visible when that quarter is still on screen.
// @param {object} params - An object with the following properties:
//   - {object|null} currentPlan - Loaded plan for the real current quarter.
//   - {string|null} domainName - Active task domain display name.
//   - {object|null} nextPlan - Loaded plan for the real next quarter.
//   - {object|null} pagedPlans - { earlier, later, pageOffset } from the latest page fetch.
//   - {number} pageOffset - Quarters the left card is shifted from the anchor.
//   - {object} quarter - { label, quarter, year } the card should show.
// @returns {object} The plan the card renders.
export function quarterPlanForPage({ currentPlan, domainName, nextPlan, pagedPlans, pageOffset, quarter }) {
  const fetchedPlans = pagedPlans?.pageOffset === pageOffset ? [pagedPlans.earlier, pagedPlans.later] : [];
  const candidatePlans = [currentPlan, nextPlan].concat(fetchedPlans);
  const loadedPlan = candidatePlans.find(plan => quartersMatch(plan, quarter));
  if (loadedPlan) return loadedPlan;
  return pendingQuarterPlan(quarter, domainName);
}

// ----------------------------------------------------------------------------------------------
// @desc Move a quarter by a signed number of quarters, rolling Q4 into Q1 of the next year.
// @param {object} quarter - { quarter, year } to move from.
// @param {number} quarterDelta - Quarters to add. Negative steps into the past.
// @returns {{ label: string, quarter: number, year: number }} The quarter that far away.
export function quarterShiftedBy({ quarter, year }, quarterDelta) {
  const absoluteIndex = year * 4 + (quarter - 1) + quarterDelta;
  const shiftedYear = Math.floor(absoluteIndex / 4);
  const shiftedQuarter = ((absoluteIndex % 4) + 4) % 4 + 1;
  return { label: quarterLabel(shiftedYear, shiftedQuarter), quarter: shiftedQuarter, year: shiftedYear };
}

// ----------------------------------------------------------------------------------------------
// @desc Report whether two plans name the same calendar quarter.
// @param {object|null} plan - Plan carrying quarter and year.
// @param {object|null} otherPlan - Plan to compare against.
// @returns {boolean} True when both name the same quarter of the same year.
export function quartersMatch(plan, otherPlan) {
  if (!plan?.quarter || !plan?.year || !otherPlan?.quarter || !otherPlan?.year) return false;
  return plan.quarter === otherPlan.quarter && plan.year === otherPlan.year;
}
