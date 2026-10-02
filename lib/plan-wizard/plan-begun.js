// Whether Plan Builder already holds answers for a quarter, so Quarterly Planning can leave the
// "Set your plan" splash once the user has started, before or without a quarterly plan note.
import { quarterLabel } from "constants/quarters";
import { readPlanGoals } from "plan-wizard/plan-wizard-service";
import { findQuarterPlan } from "quarterly-plan-service";
import { logIfEnabled } from "util/log";

// ----------------------------------------------------------------------------------------------
// @desc Read the text of a stored quarter answer. An unanswered question is empty.
// @param {object|null} answer - Stored { text }, or null.
// @returns {string} Trimmed text, or an empty string.
function storedAnswerText(answer) {
  return typeof answer?.text === "string" ? answer.text.trim() : "";
}

// ----------------------------------------------------------------------------------------------
// @desc Report whether a planning context holds a saved goal, quarter name, daily bar, or a project that
//   is still in the quarter. A project marked Not now, rejected, or retired does not count.
// @param {object|null} planningContext - Context from readPlanGoals, or null when the guide is missing.
// @returns {boolean} True once this quarter's plan has been begun.
export function planAnswersHaveBegun(planningContext) {
  if (!planningContext) return false;
  const savedGoals = (planningContext.goals ?? []).filter(goal => goal?.goalText?.trim());
  if (savedGoals.length > 0) return true;
  if (storedAnswerText(planningContext.quarterName)) return true;
  if (storedAnswerText(planningContext.dailySufficiency)) return true;
  const keptProspects = (planningContext.prospects ?? []).filter(prospect => {
    if (!prospect?.summary?.trim()) return false;
    if (["humanRejected", "humanRetired"].includes(prospect.approvalStatusEm)) return false;
    return prospect.priorityEm !== "notNow";
  });
  return keptProspects.length > 0;
}

// ----------------------------------------------------------------------------------------------
// @desc Look up the quarter's saved answers and its plan note. Either one means the splash should step aside.
//   A failed lookup is treated as not begun, so the splash stays reachable.
// @param {object} app - Amplenote app interface.
// @param {object} scope - { domainName, domainUuid, quarter, year }. domainUuid null is every note.
// @returns {Promise<object>} { begun, noteUUID, quarter, year }. noteUUID is null until a plan note exists.
export async function resolveBegunQuarterPlan(app, { domainName = null, domainUuid = null, quarter, year }) {
  const planDomainName = domainUuid ? domainName : null;
  let planningContext = null;
  try {
    planningContext = await readPlanGoals(app, { domainName, domainUuid, quarter, year });
  } catch (readError) {
    logIfEnabled("[planning] could not read saved plan answers", readError?.message || readError);
  }
  let noteUUID = null;
  try {
    const label = quarterLabel(year, quarter);
    const plan = await findQuarterPlan(app, { domainName: planDomainName, label, quarter, year });
    noteUUID = plan?.noteUUID ?? null;
  } catch (lookupError) {
    logIfEnabled("[planning] could not look up the quarter's plan note", lookupError?.message || lookupError);
  }
  return { begun: planAnswersHaveBegun(planningContext) || !!noteUUID, noteUUID, quarter, year };
}
