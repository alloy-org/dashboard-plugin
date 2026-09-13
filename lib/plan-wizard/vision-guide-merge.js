// Merge ranked human goals, independent inference snapshots, and the projects those goals are pursued through.
import ActionProspect from "plan-wizard/action-prospect";
import GoalSet from "plan-wizard/goal-set";
import IntentPossibility from "plan-wizard/intent-possibility";
import { DERIVED_PROSPECT_FIELDS, normalizedTimestamp, planningRecordUuid, requireRecord } from "plan-wizard/plan-models";
import { matchingStoredProspect } from "plan-wizard/prospect-similarity";
import { stableJson } from "util/json-utility";

// How many proposals one project keeps a record of. Eleven passes over a single evidence bundle produced eleven
// restatements of one idea, so the trail has to be bounded; at roughly 200 characters an entry this is the point
// past which provenance would start to cost more than the records it explains.
const MAXIMUM_PROSPECT_PROVENANCE_ENTRIES = 24;

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
// @desc Upsert prospects, treating a proposal that cites substantially the tasks a stored project already cites
//   as a restatement of that project rather than as a new one. A newer capture replaces the stored record; an
//   older or tied one is ignored, so a discovery refresh arriving after the user edited a project cannot undo
//   that edit. Either way the stored record absorbs what the restatement cited and who proposed it.
// @param {Array<object>} existing - Persisted prospects for one category.
// @param {Array<object>} incoming - Prospect updates; a missing UUID mints a new identity.
// @param {object} scope - Resolved planning scope, supplying the quarter a new prospect belongs to.
// @param {string} userCategoryEm - Category whose leaf is being written.
// @returns {Array<object>} Complete stored prospects, sorted by summary for stable note diffs.
// A human decision outranks an inference: a stored humanProvided or human-judged record is never demoted by a
// later awaitingJudgement proposal for the same identity.
// Matching used to be UUID equality alone, and discovery derived a UUID by hashing the summary, so every
//   rewording of one idea arrived as a project nobody had ever judged. Forty-nine such records reached one
//   category leaf, among them eight spellings of the same Diff Digest launch, and the leaf grew past the write
//   limit. Evidence overlap is what recognizes those as one project; see prospect-similarity.js.
export function mergeActionProspects(existing, incoming, scope, userCategoryEm) {
  if (!Array.isArray(incoming)) throw new Error("prospects must be an array");
  const prospectsByUuid = new Map(existing.map(prospect => [prospect.uuid, new ActionProspect(prospect, { quarterKey: prospect.quarterKey })]));
  for (const input of incoming) {
    requireRecord(input);
    // A proposal arrives without a quarter and takes the scope's, so matching has to assume that quarter too;
    // otherwise every new proposal compares against nothing and no restatement is ever recognized.
    const scopedInput = { ...input, quarterKey: input.quarterKey ?? scope.quarterKey };
    const previous = matchingStoredProspect([...prospectsByUuid.values()], scopedInput);
    const quarterKey = previous?.quarterKey ?? scopedInput.quarterKey;
    const inheritedFields = { ...previous };
    for (const field of DERIVED_PROSPECT_FIELDS) delete inheritedFields[field];
    const evidence = mergedProspectEvidence(previous, input);
    const provenance = mergedProspectProvenance(previous, input);
    const uuid = previous?.uuid ?? input.uuid ?? planningRecordUuid();
    const candidate = new ActionProspect({ ...inheritedFields, ...input, evidence, provenance, quarterKey,
      userCategoryEm, uuid }, { quarterKey });
    const isUnjudgedProposal = candidate.approvalStatusEm === "awaitingJudgement";
    const humanDecisionStands = previous && previous.approvalStatusEm !== "awaitingJudgement" && isUnjudgedProposal;
    const isStaleCapture = previous && candidate.capturedAt <= previous.capturedAt;
    // A restatement that does not get to change the record still says something about it: which tasks it also
    // resolves, and that a pass proposed it again. Discarding the whole input would throw both away.
    const winner = previous && (humanDecisionStands || isStaleCapture)
      ? new ActionProspect({ ...inheritedFields, evidence, provenance }, { quarterKey: previous.quarterKey })
      : candidate;
    prospectsByUuid.set(winner.uuid, withResolvedProvenanceRoles(winner));
  }
  const prospects = [...prospectsByUuid.values()];
  const sortedProspects = prospects.sort((first, second) => first.summary.localeCompare(second.summary));
  return sortedProspects;
}

// ----------------------------------------------------------------------------------------------
// @desc Combine the citations a stored project and an incoming proposal make, so a project merged from several
//   restatements names every task any of them said it would resolve.
// @param {object|null} previous - Stored project, or null for a project being created.
// @param {object} input - Incoming proposal or edit.
// @returns {Array<object>} Deduplicated evidence records, stored order first.
// This is what the page counts when it says how many tasks a project addresses, so folding duplicates together
//   raises that number instead of scattering it across near-identical records.
function mergedProspectEvidence(previous, input) {
  const inputEvidence = Array.isArray(input?.evidence) ? input.evidence : [];
  if (!previous) return inputEvidence;
  const previousEvidence = Array.isArray(previous.evidence) ? previous.evidence : [];
  const combinedEvidence = [...previousEvidence, ...inputEvidence];
  const evidenceByCitation = new Map(combinedEvidence.map(entry => [`${ entry?.taskUuid ?? "" }::${ entry?.noteUuid ?? "" }`, entry]));
  return [...evidenceByCitation.values()];
}

// ----------------------------------------------------------------------------------------------
// @desc Combine the provenance a stored project carries with whatever the incoming proposal brought, keeping the
//   audit trail bounded.
// @param {object|null} previous - Stored project, or null for a project being created.
// @param {object} input - Incoming proposal or edit.
// @returns {Array<object>} Deduplicated provenance entries, oldest first.
// The oldest entry is always retained because it names the pass that first raised the project; the cap discards
//   from the middle, where one more restatement of an idea already recorded a dozen times adds least.
function mergedProspectProvenance(previous, input) {
  const previousProvenance = Array.isArray(previous?.provenance) ? previous.provenance : [];
  const inputProvenance = Array.isArray(input?.provenance) ? input.provenance : [];
  const combinedProvenance = [...previousProvenance, ...inputProvenance];
  const entriesByIdentity = new Map(combinedProvenance.map(entry =>
    [`${ entry?.contributedAt ?? "" }::${ entry?.promptSource ?? "" }::${ entry?.summary ?? "" }`, entry]));
  const uniqueEntries = [...entriesByIdentity.values()];
  if (uniqueEntries.length <= MAXIMUM_PROSPECT_PROVENANCE_ENTRIES) return uniqueEntries;
  return [uniqueEntries[0], ...uniqueEntries.slice(-(MAXIMUM_PROSPECT_PROVENANCE_ENTRIES - 1))];
}

// ----------------------------------------------------------------------------------------------
// @desc Restate which provenance entries originated the project and which were folded into it, deciding by the
//   summary the merged project ended up carrying.
// @param {object} prospect - Merged project.
// @returns {ActionProspect} The same project with provenance roles agreeing with its current summary.
// Deriving the roles rather than carrying them forward keeps them honest through a rename or a consolidation
//   pass, where the entry that was the originator a moment ago is now one contributor among several.
function withResolvedProvenanceRoles(prospect) {
  const provenance = prospect.provenance.map(entry =>
    ({ ...entry, role: entry.summary === prospect.summary ? "originator" : "mergedContributor" }));
  return new ActionProspect({ ...prospect, provenance }, { quarterKey: prospect.quarterKey });
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
