// Merge ranked human goals, independent inference snapshots, and the projects those goals are pursued through.
import ActionProspect from "plan-wizard/action-prospect";
import GoalSet from "plan-wizard/goal-set";
import IntentPossibility from "plan-wizard/intent-possibility";
import { normalizedTimestamp, planningRecordUuid, requireRecord } from "plan-wizard/plan-models";
import { stableJson } from "util/json-utility";

// ----------------------------------------------------------------------------------------------
// @desc Identify the rank/category slot within an already scoped quarter.
// @param {object} goal - GoalSet or input update.
// @returns {string} Slot key.
// Match the uniqueness rule in the brainstorming note.
export function goalSlotKey(goal) {
  return `${ goal.userCategoryEm }:${ goal.goalRank }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Upsert explicit goal changes; omissions do not delete, and equal timestamps preserve existing data.
// @param {Array<object>} existing - Persisted goals, including deletion tombstones.
// @param {Array<object>} incoming - Full goal updates; UUID and scope may be omitted on input.
// @param {object} scope - Resolved domain/quarter identity.
// @returns {Array<object>} Sorted complete stored goals with extension fields preserved.
// Stable slots, timestamps, and tombstones protect decisions from retries and stale callers.
export function mergeGoalSets(existing, incoming, scope) {
  if (!Array.isArray(incoming)) throw new Error("goals must be an array");
  const goalsBySlot = new Map(existing.map(goal => [goalSlotKey(goal), new GoalSet(goal, scope)]));
  for (const input of incoming) {
    requireRecord(input);
    const previous = goalsBySlot.get(goalSlotKey(input));
    const candidate = new GoalSet({ ...previous, ...input, domainUuid: input.domainUuid === undefined ? scope.domainUuid : input.domainUuid,
      quarterKey: input.quarterKey ?? scope.quarterKey, taskDomain: scope.domainName,
      uuid: input.uuid ?? previous?.uuid ?? planningRecordUuid() }, scope);
    if (previous && candidate.capturedAt <= previous.capturedAt) continue;
    goalsBySlot.set(goalSlotKey(candidate), candidate);
  }
  const goals = [...goalsBySlot.values()];
  if (new Set(goals.map(goal => goal.uuid)).size !== goals.length) throw new Error("Goal UUIDs must be unique within a quarter");
  const sortedGoals = goals.sort((first, second) => first.userCategoryEm.localeCompare(second.userCategoryEm) || first.goalRank - second.goalRank);
  return sortedGoals;
}

// ----------------------------------------------------------------------------------------------
// @desc Replace one category's inference snapshot only when its generation timestamp is newer.
// @param {object} existing - { generatedAt, possibilities } persisted envelope.
// @param {object} incoming - { generatedAt, possibilities }; at most three suggestions, no human decisions.
// @param {string} userCategoryEm - Category targeted by this operation.
// @returns {object} New snapshot retaining extension fields and identities for unchanged suggestion text.
// Refreshing suggestions never writes the picked-goals section.
export function mergeIntentPossibilities(existing, incoming, userCategoryEm) {
  requireRecord(incoming);
  const generatedAt = normalizedTimestamp(incoming.generatedAt);
  if (!Array.isArray(incoming.possibilities) || incoming.possibilities.length > 3) throw new Error("Provide at most three possibilities");
  const existingByText = new Map(existing.possibilities.map(possibility => [possibility.intent.toLowerCase(), possibility]));
  const possibilities = incoming.possibilities.map(input => {
    requireRecord(input);
    const previous = existingByText.get(input.intent?.trim().toLowerCase());
    const possibility = new IntentPossibility({ ...previous, ...input, userCategoryEm: input.userCategoryEm ?? userCategoryEm,
      uuid: input.uuid ?? previous?.uuid ?? planningRecordUuid() });
    if (possibility.userCategoryEm !== userCategoryEm) throw new Error("Possibility category does not match section");
    return possibility;
  });
  if (new Set(possibilities.map(item => item.uuid)).size !== possibilities.length) throw new Error("Duplicate possibility UUID");
  if (new Set(possibilities.map(item => item.intent.toLowerCase())).size !== possibilities.length) throw new Error("Duplicate possibility text");
  if (existing.generatedAt && generatedAt <= existing.generatedAt) return existing;
  return { ...existing, ...incoming, generatedAt, possibilities };
}

// ----------------------------------------------------------------------------------------------
// @desc Upsert prospects by stable identity rather than by a slot, since a project has no rank and its summary is
//   user-renameable. A newer capture replaces the stored record; an older or tied one is ignored, so a discovery
//   refresh arriving after the user edited a project cannot undo that edit.
// @param {Array<object>} existing - Persisted prospects for one category.
// @param {Array<object>} incoming - Prospect updates; a missing UUID mints a new identity.
// @param {object} scope - Resolved planning scope, supplying the quarter a new prospect belongs to.
// @param {string} userCategoryEm - Category whose leaf is being written.
// @returns {Array<object>} Complete stored prospects, sorted by summary for stable note diffs.
// A human decision outranks an inference: a stored humanProvided or human-judged record is never demoted by a
// later awaitingJudgement proposal for the same identity.
export function mergeActionProspects(existing, incoming, scope, userCategoryEm) {
  if (!Array.isArray(incoming)) throw new Error("prospects must be an array");
  const prospectsByUuid = new Map(existing.map(prospect => [prospect.uuid, new ActionProspect(prospect, { quarterKey: prospect.quarterKey })]));
  for (const input of incoming) {
    requireRecord(input);
    const previous = prospectsByUuid.get(input.uuid);
    const quarterKey = input.quarterKey ?? previous?.quarterKey ?? scope.quarterKey;
    const candidate = new ActionProspect({ ...previous, ...input, quarterKey, userCategoryEm,
      uuid: input.uuid ?? previous?.uuid ?? planningRecordUuid() }, { quarterKey });
    if (previous && candidate.capturedAt <= previous.capturedAt) continue;
    const isUnjudgedProposal = candidate.approvalStatusEm === "awaitingJudgement";
    if (previous && previous.approvalStatusEm !== "awaitingJudgement" && isUnjudgedProposal) continue;
    prospectsByUuid.set(candidate.uuid, candidate);
  }
  const prospects = [...prospectsByUuid.values()];
  const sortedProspects = prospects.sort((first, second) => first.summary.localeCompare(second.summary));
  return sortedProspects;
}

// ----------------------------------------------------------------------------------------------
// @desc Replace a quarter-wide answer only when the incoming capture is newer, matching how every other stored
//   decision resolves a conflict.
// @param {object|null} existing - Stored { capturedAt, text }, or null when unanswered.
// @param {object} incoming - Proposed { capturedAt, text }.
// @returns {object|null} Whichever answer should be stored.
export function mergeQuarterAnswer(existing, incoming) {
  requireRecord(incoming);
  const capturedAt = normalizedTimestamp(incoming.capturedAt);
  if (existing && capturedAt <= existing.capturedAt) return existing;
  return { ...incoming, capturedAt };
}

// ----------------------------------------------------------------------------------------------
// @desc Compare detached JSON data independent of property insertion order.
// @returns {boolean} Whether payloads are equivalent.
// Idempotent retries should not create another note revision.
export function samePlanningData(first, second) {
  return stableJson(first) === stableJson(second);
}
