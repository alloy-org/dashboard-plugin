// Expose host-compatible goal storage and retrieval for future wizard/agenda consumers.

import { collectIntentEvidence } from "plan-wizard/intent-evidence";
import { inferIntentPossibilities } from "plan-wizard/intent-inference";
import { USER_CATEGORIES, assertUserCategory, copyJsonValue, resolvePlanScope } from "plan-wizard/plan-models";
import { discoverActionProspects } from "plan-wizard/prospect-discovery";
import { collectProspectEvidence } from "plan-wizard/prospect-evidence";

// The quarter-wide answers stored beside the picked goals rather than on any single project.
export const QUARTER_ANSWER_KEYS = ["dailySufficiency", "quarterName"];
import { mergeActionProspects, mergeGoalSets, mergeIntentPossibilities,
  mergeQuarterAnswer } from "plan-wizard/vision-guide-merge";
import { readVisionGuide, updateVisionGuideSection, writeProspectPlacementSections } from "plan-wizard/vision-guide-repository";
import { logIfEnabled } from "util/log";

// ----------------------------------------------------------------------------------------------
// @desc Present live goals separately from inference and deletion tombstones.
// @param {object|null} guide - Stored snapshot, or null if no initialized note exists.
// @param {object} scope - Domain and planning period.
// @returns {object} Serializable consumer view; goalRecords and prospectRecords include the records a reader must
//   not treat as live work — deletion tombstones, and rejected or retired projects — so an editor can reconcile
//   them while a recommendation consumer reads only goals and prospects.
// Read-only consumers cannot mistake a guess, a deletion, or a rejected project for chosen work.
function planningContextFromGuide(guide, scope) {
  const goalRecords = guide?.goals.goals ?? [];
  const activeGoals = goalRecords.filter(goal => !goal.isDeleted);
  const goals = activeGoals.sort((first, second) => first.userCategoryEm.localeCompare(second.userCategoryEm) || first.goalRank - second.goalRank);
  const possibilities = { personal: guide?.personal.possibilities ?? [], work: guide?.work.possibilities ?? [] };
  const generatedAt = { personal: guide?.personal.generatedAt ?? null, work: guide?.work.generatedAt ?? null };
  const storedProspects = (guide?.workProspects.prospects ?? []).concat(guide?.personalProspects.prospects ?? []);
  const quarterProspects = storedProspects.filter(prospect => prospect.quarterKey === scope.quarterKey);
  const liveProspects = quarterProspects.filter(prospect => !["humanRejected", "humanRetired"]
    .includes(prospect.approvalStatusEm));
  const dailySufficiency = guide?.goals.dailySufficiency ?? null;
  const quarterName = guide?.goals.quarterName ?? null;
  return { dailySufficiency, generatedAt, goalRecords, goals, noteUuid: guide?.noteUuid ?? null, possibilities,
    prospectRecords: quarterProspects, prospects: liveProspects, quarterName, scope };
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
// @desc Collect evidence, infer both categories of suggestion, and persist each category's snapshot. Inference
//   is slow enough that the guide can change while it runs, so each category is saved through the ordinary
//   merge path, which re-reads the note at merge time and leaves picked goals untouched. A category that
//   produced nothing usable is skipped rather than saved as an empty snapshot that would overwrite older,
//   still-useful suggestions.
// @param {object} app - Amplenote host app or embed proxy.
// @param {object} options - Scope, plus { promptRunner, referenceDate } for deterministic tests.
// @returns {Promise<object>} Planning context, extended with { failureReason, occupationHypothesis }.
// The wizard's first run calls this; a read-only consumer keeps using readPlanGoals and never invokes inference.
export async function refreshPlanIntentPossibilities(app, options = {}) {
  const scope = resolvePlanScope(options);
  const evidence = await collectIntentEvidence(app, scope, { referenceDate: options.referenceDate ?? new Date() });
  const inference = await inferIntentPossibilities(app, evidence, scope, { promptRunner: options.promptRunner });
  const generatedAt = evidence.coverage.collectedAt;
  let planningContext = await readPlanGoals(app, scope);
  for (const userCategoryEm of USER_CATEGORIES) {
    const possibilities = inference[userCategoryEm];
    if (!possibilities.length) continue;
    planningContext = await savePlanIntentPossibilities(app, { ...scope, generatedAt, possibilities, userCategoryEm });
  }
  return { ...planningContext, failureReason: inference.failureReason, occupationHypothesis: inference.occupationHypothesis };
}

// ----------------------------------------------------------------------------------------------
// @desc Discover the candidate projects a quarter's chosen intents could be carried out through, and persist them
//   as proposals awaiting the user's judgement. Discovery reads the intents the user picked on the wizard's first
//   page, so it runs only once something is saved to carry: with no goals stored there is nothing for a project
//   to advance, and the caller is told that rather than shown candidates grounded in nothing.
// @param {object} app - Amplenote host app or embed proxy.
// @param {object} options - Scope, plus { promptRunner, referenceDate } for deterministic tests.
// @returns {Promise<object>} Planning context, extended with { failureReason }.
// Proposals are written through savePlanProspects like any other prospect, which is what keeps a candidate the
// user already judged from returning to awaiting judgement.
export async function refreshPlanActionProspects(app, options = {}) {
  const scope = resolvePlanScope(options);
  const contextStart = performance.now();
  const planningContext = await readPlanGoals(app, scope);
  const evidenceStart = performance.now();
  const evidence = await collectProspectEvidence(app, scope, planningContext,
    { referenceDate: options.referenceDate ?? new Date() });
  const discoveryStart = performance.now();
  const discovery = await discoverActionProspects(app, evidence, scope, { promptRunner: options.promptRunner });
  const saveStart = performance.now();
  // The page's one-minute budget covers every phase below, not only the provider call. Reporting them separately
  // is what distinguishes a prompt that needs shrinking from an evidence pass that spent the budget before the
  // provider was ever reached.
  const phaseTiming = { goalReadMs: Number((evidenceStart - contextStart).toFixed(1)),
    evidenceCollectionMs: Number((discoveryStart - evidenceStart).toFixed(1)),
    discoveryMs: Number((saveStart - discoveryStart).toFixed(1)) };
  if (!discovery.prospects.length) {
    logIfEnabled("[plan-wizard] project discovery produced nothing", { ...phaseTiming,
      failureReason: discovery.failureReason, totalMs: Number((saveStart - contextStart).toFixed(1)) });
    return { ...planningContext, failureReason: discovery.failureReason };
  }
  const savedContext = await savePlanProspects(app, { ...scope, prospects: discovery.prospects });
  logIfEnabled("[plan-wizard] project discovery complete", { ...phaseTiming,
    prospectSaveMs: Number((performance.now() - saveStart).toFixed(1)),
    prospectCount: discovery.prospects.length,
    totalMs: Number((performance.now() - contextStart).toFixed(1)) });
  return { ...savedContext, failureReason: discovery.failureReason };
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

// ----------------------------------------------------------------------------------------------
// @desc Upsert the projects a quarter's intents will be carried out through. Each prospect is stored in its
//   category's leaf, so a professional project and a personal one never contend for the same section write.
//   Placement buckets under the month tree are then rewritten for every saved record — including empty ones —
//   so a UUID that moved cannot remain in a previous heading. Pace-only saves skip that rewrite; they do not
//   change which bucket a project belongs in, and rewriting the category tree is what overflowed the write limit.
// @param {object} app - Amplenote host app or embed proxy.
// @param {object} options - Scope plus prospects:[{ approvalStatusEm, capturedAt, summary, userCategoryEm, uuid?, ... }].
//   Pass updatePlacement: false when only paceEm, preferredWeekdays, or deadlineOn changed.
// @returns {Promise<object>} Verified planning context; omitted prospects remain unchanged.
// Discovery and the wizard write through this same path, which is what lets an inferred proposal and a
// user-provided project coexist in one list without either overwriting the other.
export async function savePlanProspects(app, options) {
  const scope = resolvePlanScope(options);
  const incoming = copyJsonValue(options.prospects);
  if (!Array.isArray(incoming)) throw new Error("prospects must be an array");
  const shouldUpdatePlacement = options.updatePlacement !== false;
  let guide = null;
  for (const userCategoryEm of USER_CATEGORIES) {
    const categoryProspects = incoming.filter(prospect => prospect.userCategoryEm === userCategoryEm);
    if (!categoryProspects.length) continue;
    const kind = userCategoryEm === "work" ? "workProspects" : "personalProspects";
    guide = await updateVisionGuideSection(app, kind, scope,
      previous => ({ ...previous, prospects: mergeActionProspects(previous.prospects, categoryProspects, scope, userCategoryEm) }));
  }
  if (shouldUpdatePlacement) {
    for (const incomingProspect of incoming) {
      const kind = incomingProspect.userCategoryEm === "work" ? "workProspects" : "personalProspects";
      const storedProspects = guide?.[kind]?.prospects ?? [];
      const stored = storedProspects.find(prospect => prospect.uuid === incomingProspect.uuid);
      if (stored) guide = await writeProspectPlacementSections(app, stored, scope);
    }
  }
  if (!guide) return readPlanGoals(app, scope);
  return planningContextFromGuide(guide, scope);
}

// ----------------------------------------------------------------------------------------------
// @desc Save one of the quarter-wide answers that belong to the whole plan rather than to a single project: the
//   name the user gives the quarter, and the bar that tells them a day's work is done.
// @param {object} app - Amplenote host app or embed proxy.
// @param {object} options - Scope plus { answerKey, capturedAt, text }; answerKey is quarterName or dailySufficiency.
// @returns {Promise<object>} Verified planning context.
// These share the picked-goals leaf because they share its scope; an older capture never displaces a newer one.
export async function savePlanQuarterAnswer(app, options) {
  const scope = resolvePlanScope(options);
  const { answerKey } = options;
  if (!QUARTER_ANSWER_KEYS.includes(answerKey)) throw new Error(`answerKey must be one of ${ QUARTER_ANSWER_KEYS.join(", ") }`);
  const incoming = copyJsonValue({ capturedAt: options.capturedAt, text: options.text });
  mergeQuarterAnswer(null, incoming);
  const guide = await updateVisionGuideSection(app, "goals", scope,
    previous => ({ ...previous, [answerKey]: mergeQuarterAnswer(previous[answerKey], incoming) }));
  return planningContextFromGuide(guide, scope);
}
