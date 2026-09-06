// Expose host-compatible goal storage and retrieval for future wizard/agenda consumers.

import { assertUserCategory, copyJsonValue, resolvePlanScope } from "plan-wizard/plan-models";
import { mergeGoalSets, mergeIntentPossibilities } from "plan-wizard/vision-guide-merge";
import { readVisionGuide, updateVisionGuideSection } from "plan-wizard/vision-guide-repository";

// ----------------------------------------------------------------------------------------------
// @desc Present live goals separately from inference and deletion tombstones.
// @param {object|null} guide - Stored snapshot, or null if no initialized note exists.
// @param {object} scope - Domain and planning period.
// @returns {object} Serializable consumer view; goalRecords includes tombstones for editing/reconciliation.
// Read-only consumers cannot mistake a guess or a deletion for a chosen goal.
function planningContextFromGuide(guide, scope) {
  const goalRecords = guide?.goals.goals ?? [];
  const activeGoals = goalRecords.filter(goal => !goal.isDeleted);
  const goals = activeGoals.sort((first, second) => first.userCategoryEm.localeCompare(second.userCategoryEm) || first.goalRank - second.goalRank);
  const possibilities = { personal: guide?.personal.possibilities ?? [], work: guide?.work.possibilities ?? [] };
  const generatedAt = { personal: guide?.personal.generatedAt ?? null, work: guide?.work.generatedAt ?? null };
  return { generatedAt, goalRecords, goals, noteUuid: guide?.noteUuid ?? null, possibilities, scope };
}

// ----------------------------------------------------------------------------------------------
// @desc Read selected-quarter goals and cached suggestions without creating notes or invoking inference.
// @param {object} app - Amplenote host app.
// @param {object} options - { domainName?, domainUuid?, quarter?, year? }; omitted period defaults to next quarter.
// @returns {Promise<object>} Planning context with an empty state when the guide is missing.
// First read path for the wizard, agenda, and later Quarterly Goals template adapter.
export async function readPlanGoals(app, options = {}) {
  const scope = resolvePlanScope(options);
  const guide = await readVisionGuide(app, scope);
  return planningContextFromGuide(guide, scope);
}

// ----------------------------------------------------------------------------------------------
// @desc Upsert ranked human choices; supply isDeleted:true to clear a slot without allowing stale resurrection.
// @param {object} app - Amplenote host app.
// @param {object} options - Scope plus goals:[{ capturedAt, goalRank, goalText, isDeleted?, userCategoryEm, uuid? }].
// @returns {Promise<object>} Verified current goals and suggestions; omitted goals remain unchanged.
// Explicit timestamps make caller retries safe; suggestions never implicitly become choices.
export async function savePlanGoals(app, options) {
  const scope = resolvePlanScope(options);
  const incoming = copyJsonValue(options.goals);
  mergeGoalSets([], incoming, scope);
  const guide = await updateVisionGuideSection(app, "goals", scope,
    previous => ({ ...previous, goals: mergeGoalSets(previous.goals, incoming, scope) }));
  return planningContextFromGuide(guide, scope);
}

// ----------------------------------------------------------------------------------------------
// @desc Save a newer inference snapshot for one category, never touching picked goals or the other category.
// @param {object} app - Amplenote host app.
// @param {object} options - Scope plus { generatedAt, possibilities, userCategoryEm }; at most three possibilities.
// @returns {Promise<object>} Verified planning context.
// Accept externally generated candidates; LLM inference is a later subsystem.
export async function savePlanIntentPossibilities(app, options) {
  const scope = resolvePlanScope(options);
  const category = assertUserCategory(options.userCategoryEm);
  const incoming = copyJsonValue({ generatedAt: options.generatedAt, possibilities: options.possibilities });
  mergeIntentPossibilities({ generatedAt: null, possibilities: [] }, incoming, category);
  const guide = await updateVisionGuideSection(app, category, scope, previous => mergeIntentPossibilities(previous, incoming, category));
  return planningContextFromGuide(guide, scope);
}
