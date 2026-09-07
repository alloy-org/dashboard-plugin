// Verify scoped goal validation, timestamp merges, inference independence, and the project records that carry a
// quarter's intents into concrete work.

import ActionProspect from "plan-wizard/action-prospect";
import GoalSet from "plan-wizard/goal-set";
import IntentPossibility from "plan-wizard/intent-possibility";
import { copyJsonValue, isDeclinedActionProspect, isValidatedActionProspect, normalizedTimestamp,
  resolvePlanScope } from "plan-wizard/plan-models";
import ProspectTask from "plan-wizard/prospect-task";
import { mergeActionProspects, mergeGoalSets, mergeIntentPossibilities,
  mergeQuarterAnswer } from "plan-wizard/vision-guide-merge";

const scope = resolvePlanScope({ domainName: "Work", domainUuid: "domain-work", quarter: 4, year: 2026 });
const goal = { capturedAt: "2026-09-06", domainUuid: scope.domainUuid, goalRank: 1, goalText: "Grow revenue",
  quarterKey: scope.quarterKey, taskDomain: "Work", userCategoryEm: "work", uuid: "goal-1" };
const possibility = { confidence: 6, intent: "Grow revenue", sourceKind: "inferred", substantiation: "Recent product tasks",
  userCategoryEm: "work", uuid: "possibility-1" };
const prospect = { approvalStatusEm: "humanProvided", capturedAt: "2026-09-06", quarterKey: scope.quarterKey,
  substantiation: "Named while planning", summary: "Rebuild the ingestion pipeline", userCategoryEm: "work", uuid: "prospect-1" };
const prospectTask = { approvalStatus: "awaitingJudgement", matchScore: 7, prospectUuid: "prospect-1",
  substantiation: "Follows from the project", taskText: "Draft the ingestion schema", uuid: "prospect-task-1" };

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


// ----------------------------------------------------------------------------------------------
// @desc Validate the project record's enums, its links, and the provenance rule that keeps a project the user
//   named from claiming evidence no inference produced.
// A prospect is the bridge between an intent and the work that serves it, so its links must stay unambiguous.
test("validates prospect enums, links, and user-provided provenance", () => {
  const stored = new ActionProspect(prospect, scope);
  expect(stored.priorityEm).toBe(null);
  expect(stored.preferredWeekdays).toEqual([]);
  expect(stored.decidedAt).toBe(null);
  expect(stored).toMatchObject({ approvalStatusEm: "humanProvided", deadlineOn: null, paceEm: null,
    preferredDows: [], primaryNote: null, priorityEm: null, relatedNotes: [], relatedTasks: [],
    substantiations: ["Named while planning"] });
  expect(stored.refreshedProspectAt).toBe("2026-09-06T00:00:00.000Z");
  expect(stored.refreshedTasksAt).toBe("2026-09-06T00:00:00.000Z");
  expect(new ActionProspect(copyJsonValue(stored), scope).summary).toBe("Rebuild the ingestion pipeline");

  expect(stored.approvalStatus).toBeUndefined();
  expect(stored.priority).toBeUndefined();
  expect(() => new ActionProspect({ ...prospect, approvalStatusEm: "maybe" }, scope)).toThrow("approvalStatusEm");
  expect(() => new ActionProspect({ ...prospect, priorityEm: "urgent" }, scope)).toThrow("priorityEm");
  expect(() => new ActionProspect({ ...prospect, paceEm: "sprint" }, scope)).toThrow("paceEm");
  expect(() => new ActionProspect({ ...prospect, paceEm: "deadlineSprint", deadlineOn: "2026-13-40" }, scope))
    .toThrow("deadlineOn");
  expect(new ActionProspect({ ...prospect, paceEm: "twoFocusedBlocks", deadlineOn: "2026-10-15",
    preferredWeekdays: ["tuesday", "thursday"] }, scope)).toMatchObject({ deadlineOn: null, paceEm: "twoFocusedBlocks",
    preferredDows: ["tuesday", "thursday"] });
  expect(new ActionProspect({ ...prospect, deadlineOn: "2026-10-15", paceEm: "deadlineSprint" }, scope).deadlineOn)
    .toBe("2026-10-15");
  expect(() => new ActionProspect({ ...prospect, preferredWeekdays: ["Monday"] }, scope)).toThrow("preferredWeekdays");
  expect(() => new ActionProspect({ ...prospect, preferredWeekdays: ["monday", "monday"] }, scope)).toThrow("unique");
  expect(() => new ActionProspect({ ...prospect, focusMonths: ["2026-13"] }, scope)).toThrow("focusMonths");
  expect(() => new ActionProspect({ ...prospect, linkedGoalUuids: ["goal-1", "goal-1"] }, scope)).toThrow("unique");
  expect(() => new ActionProspect({ ...prospect, evidence: [{ taskUuid: "task-1" }] }, scope)).toThrow("cannot claim inferred evidence");
  expect(() => new ActionProspect({ ...prospect, quarterKey: "2026-Q1" }, scope)).toThrow("scope does not match");
});

// ----------------------------------------------------------------------------------------------
// @desc Keep a candidate action's identity independent of any Amplenote task, and its approval independent of
//   whether it has been scheduled.
// Approving work does not put it on a calendar, so the two states are validated separately.
test("validates prospect task identity, scoring, and schedule independence", () => {
  const stored = new ProspectTask(prospectTask);
  expect(stored.taskUuid).toBe(null);
  expect(stored.scheduleStatus).toBe("unscheduled");
  expect(stored.proposalCount).toBe(1);
  expect(new ProspectTask(copyJsonValue(stored)).uuid).toBe("prospect-task-1");

  const approved = new ProspectTask({ ...prospectTask, approvalStatus: "humanApproved" });
  expect(approved.scheduleStatus).toBe("unscheduled");
  expect(() => new ProspectTask({ ...prospectTask, matchScore: 11 })).toThrow("matchScore");
  expect(() => new ProspectTask({ ...prospectTask, durationMinutes: 0 })).toThrow("durationMinutes");
  expect(() => new ProspectTask({ ...prospectTask, proposalCount: 0 })).toThrow("proposalCount");
  expect(() => new ProspectTask({ ...prospectTask, scheduleStatus: "scheduled" })).toThrow("scheduledStartAt");
  expect(() => new ProspectTask({ ...prospectTask, prospectUuid: "" })).toThrow("prospectUuid");
});

// ----------------------------------------------------------------------------------------------
// @desc Merge projects by identity, and protect a human decision from a later inference that has not seen it.
// Discovery reruns must never silently undo what the user chose about a project.
test("merges prospects by identity without letting inference overwrite a decision", () => {
  const existing = mergeActionProspects([], [prospect], scope, "work");
  expect(existing).toHaveLength(1);

  const renamed = mergeActionProspects(existing, [{ ...prospect, capturedAt: "2026-09-08", summary: "Rebuild ingestion" }], scope, "work");
  expect(renamed[0]).toMatchObject({ summary: "Rebuild ingestion", uuid: "prospect-1" });

  const stale = mergeActionProspects(renamed, [{ ...prospect, capturedAt: "2026-09-07", summary: "Stale name" }], scope, "work");
  expect(stale[0].summary).toBe("Rebuild ingestion");

  const proposal = { ...prospect, approvalStatusEm: "awaitingJudgement", capturedAt: "2026-09-09", substantiation: "Inferred later" };
  expect(mergeActionProspects(renamed, [proposal], scope, "work")[0].approvalStatusEm).toBe("humanProvided");

  const rejected = mergeActionProspects(renamed, [{ ...prospect, approvalStatusEm: "humanRejected",
    capturedAt: "2026-09-10" }], scope, "work");
  expect(rejected[0].approvalStatusEm).toBe("humanRejected");
  expect(mergeActionProspects(rejected, [proposal], scope, "work")[0].approvalStatusEm).toBe("humanRejected");
});

// ----------------------------------------------------------------------------------------------
// @desc Classify Not now / Remove as declined and Focus / Keep warm as validated, so placement and pace can
//   treat an unchosen project as still awaiting a decision.
test("classifies declined and validated prospects for placement and pace", () => {
  expect(isDeclinedActionProspect({ approvalStatusEm: "humanRejected" })).toBe(true);
  expect(isDeclinedActionProspect({ approvalStatusEm: "humanProvided", priorityEm: "notNow" })).toBe(true);
  expect(isDeclinedActionProspect({ approvalStatusEm: "humanProvided", priorityEm: "quarterFocus" })).toBe(false);
  expect(isValidatedActionProspect({ priorityEm: "quarterFocus" })).toBe(true);
  expect(isValidatedActionProspect({ priorityEm: "stayWarm" })).toBe(true);
  expect(isValidatedActionProspect({ priorityEm: null })).toBe(false);
  expect(isValidatedActionProspect({ priorityEm: "notNow" })).toBe(false);
});

// ----------------------------------------------------------------------------------------------
// @desc Resolve the two quarter-wide answers by capture time, the same way every other stored decision resolves.
test("keeps the newest quarter-wide answer", () => {
  const stored = mergeQuarterAnswer(null, { capturedAt: "2026-09-06", text: "The Shipping Quarter" });
  expect(stored.text).toBe("The Shipping Quarter");

  const newer = mergeQuarterAnswer(stored, { capturedAt: "2026-09-08", text: "Fewer, Bigger Things" });
  expect(newer.text).toBe("Fewer, Bigger Things");
  expect(mergeQuarterAnswer(newer, { capturedAt: "2026-09-07", text: "Stale" })).toBe(newer);
  expect(() => mergeQuarterAnswer(null, { capturedAt: "not a date", text: "x" })).toThrow();
});
