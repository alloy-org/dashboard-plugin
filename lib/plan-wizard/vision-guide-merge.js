// Merge ranked human goals and independent inference snapshots.
import { GoalSet, IntentPossibility, normalizedTimestamp, planningRecordUuid, requireRecord } from "plan-wizard/plan-models";
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
// @desc Compare detached JSON data independent of property insertion order.
// @returns {boolean} Whether payloads are equivalent.
// Idempotent retries should not create another note revision.
export function samePlanningData(first, second) {
  return stableJson(first) === stableJson(second);
}
