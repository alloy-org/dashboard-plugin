// Verify scoped goal validation, timestamp merges, and inference independence.

import { GoalSet, IntentPossibility, copyJsonValue, normalizedTimestamp, resolvePlanScope } from "plan-wizard/plan-models";
import { mergeGoalSets, mergeIntentPossibilities } from "plan-wizard/vision-guide-merge";

const scope = resolvePlanScope({ domainName: "Work", domainUuid: "domain-work", quarter: 4, year: 2026 });
const goal = { capturedAt: "2026-09-06", domainUuid: scope.domainUuid, goalRank: 1, goalText: "Grow revenue",
  quarterKey: scope.quarterKey, taskDomain: "Work", userCategoryEm: "work", uuid: "goal-1" };
const possibility = { confidence: 6, intent: "Grow revenue", sourceKind: "inferred", substantiation: "Recent product tasks",
  userCategoryEm: "work", uuid: "possibility-1" };

// ----------------------------------------------------------------------------------------------
// @desc Verify quarter defaults and explicit historical reads do not depend on UTC midnight.
// December planning naturally selects next year's guide.
test("resolves next quarter, explicit quarters, and All Notes without conflating category and domain", () => {
  expect(resolvePlanScope({ date: new Date(2026, 8, 30) })).toMatchObject({ domainName: "All Notes", domainUuid: null, quarter: 4, year: 2026 });
  for (const day of [14, 15, 31]) expect(resolvePlanScope({ date: new Date(2026, 11, day) })).toMatchObject({ quarter: 1, year: 2027 });
  expect(resolvePlanScope({ date: new Date(2027, 0, 1), quarter: 4, year: 2026 })).toMatchObject({ quarter: 4, year: 2026 });
  expect(() => resolvePlanScope({ quarter: 4 })).toThrow("both");
  expect(() => resolvePlanScope({ domainUuid: "work" })).toThrow("domainName");
});

// ----------------------------------------------------------------------------------------------
// @desc Reject invalid captures, categories, ranks, confidence, scope, and dishonest default evidence.
// Invalid caller data should fail before the repository creates a note.
test("validates goal and suggestion contracts", () => {
  expect(new GoalSet({ ...goal, userCategoryEm: "personal" }, scope).taskDomain).toBe("Work");
  expect(normalizedTimestamp("2026-09-06")).toBe("2026-09-06T00:00:00.000Z");
  expect(() => normalizedTimestamp("2026-02-30")).toThrow();
  expect(() => normalizedTimestamp("2026-09-06T12:00:00")).toThrow();
  for (const update of [{ goalRank: 0 }, { goalText: " " }, { domainUuid: "other" }, { userCategoryEm: "professional" }]) {
    expect(() => new GoalSet({ ...goal, ...update }, scope)).toThrow();
  }
  expect(() => new IntentPossibility({ ...possibility, confidence: 11 })).toThrow("confidence");
  expect(() => new IntentPossibility({ ...possibility, evidence: ["made up"], sourceKind: "default" })).toThrow("evidence");
  expect(() => copyJsonValue({ lost: undefined })).toThrow("JSON");
  expect(() => copyJsonValue({ score: NaN })).toThrow("finite");
  expect(() => copyJsonValue({ capturedAt: new Date() })).toThrow("JSON");
});

// ----------------------------------------------------------------------------------------------
// @desc Rehydrate actual native classes from persisted JSON and validate them again after an edit.
test("uses validating native classes with plain JSON storage", () => {
  const chosenGoal = new GoalSet(goal, scope);
  const inferredIntent = new IntentPossibility(possibility);
  expect(chosenGoal).toBeInstanceOf(GoalSet);
  expect(inferredIntent).toBeInstanceOf(IntentPossibility);
  expect(new GoalSet(JSON.parse(JSON.stringify(chosenGoal)), scope)).toEqual(chosenGoal);
  expect(new IntentPossibility(JSON.parse(JSON.stringify(inferredIntent)))).toEqual(inferredIntent);
  chosenGoal.goalRank = -1;
  expect(() => new GoalSet(chosenGoal, scope)).toThrow("goalRank");
});

// ----------------------------------------------------------------------------------------------
// @desc Exercise newest-capture wins, stable IDs, deterministic ties, unknown fields, and category uniqueness.
// Preserve existing human data on stale or repeated upserts.
test("merges human goals by rank and category without replacing other slots", () => {
  const existing = mergeGoalSets([], [{ ...goal, explanation: "Keep this extension" }], scope);
  const incoming = [{ capturedAt: "2026-09-07", goalRank: 1, goalText: "More revenue", userCategoryEm: "work" },
    { capturedAt: "2026-09-07", goalRank: 1, goalText: "Walk outdoors", userCategoryEm: "personal" }];
  const merged = mergeGoalSets(existing, incoming, scope);
  expect(merged).toHaveLength(2);
  expect(merged.find(item => item.userCategoryEm === "work")).toMatchObject({ explanation: "Keep this extension", goalText: "More revenue", uuid: "goal-1" });
  expect(mergeGoalSets(merged, [goal], scope)).toEqual(merged);
  expect(mergeGoalSets(merged, [{ ...incoming[0], goalText: "Conflicting tie" }], scope)).toEqual(merged);
  expect(existing[0].goalText).toBe("Grow revenue");
});

// ----------------------------------------------------------------------------------------------
// @desc Keep deletion records until a newer explicit edit revives a goal.
// Omitting a goal is not a deletion and stale clients cannot resurrect it.
test("preserves deletion tombstones against delayed updates", () => {
  const existing = mergeGoalSets([], [goal], scope);
  const deleted = mergeGoalSets(existing, [{ ...goal, capturedAt: "2026-09-08", goalText: "", isDeleted: true }], scope);
  expect(mergeGoalSets(deleted, [goal], scope)[0].isDeleted).toBe(true);
  expect(mergeGoalSets(deleted, [], scope)).toEqual(deleted);
  const revived = mergeGoalSets(deleted, [{ ...goal, capturedAt: "2026-09-09", isDeleted: false }], scope);
  expect(revived[0].isDeleted).toBe(false);
});

// ----------------------------------------------------------------------------------------------
// @desc Refresh suggestion evidence without changing stable IDs or accepting old inference responses.
// Snapshot updates are separate from all chosen-goal merges.
test("merges one inference snapshot with bounded, unique suggestions", () => {
  const existing = { generatedAt: "2026-09-06T00:00:00.000Z", possibilities: [possibility] };
  const incoming = { generatedAt: "2026-09-07", possibilities: [{ ...possibility, confidence: 8 }] };
  expect(mergeIntentPossibilities(existing, incoming, "work").possibilities[0]).toMatchObject({ confidence: 8, uuid: "possibility-1" });
  expect(mergeIntentPossibilities(existing, { ...incoming, generatedAt: "2026-09-05" }, "work")).toBe(existing);
  expect(() => mergeIntentPossibilities(existing, { ...incoming, possibilities: [possibility, possibility] }, "work")).toThrow("Duplicate");
  expect(() => mergeIntentPossibilities(existing, incoming, "personal")).toThrow("category");
});
