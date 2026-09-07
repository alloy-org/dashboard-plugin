// Exercise goal storage through real repository, merge, service, and host dispatch.

import { createPlanWizardApp } from "./fixtures/plan-wizard-app.js";
import { readPlanGoals, savePlanGoals, savePlanIntentPossibilities } from "plan-wizard/plan-wizard-service";
import { guideSectionRange } from "plan-wizard/vision-guide-markdown";
import { validatedSectionPayload } from "plan-wizard/vision-guide-repository";
import plugin from "plugin";

const scope = { domainName: "Work", domainUuid: "domain-work", quarter: 4, year: 2026 };
const goal = { capturedAt: "2026-09-06T12:30:00Z", goalRank: 1, goalText: "Grow revenue", userCategoryEm: "work" };
const personalGoal = { ...goal, goalText: "Get outside weekly", userCategoryEm: "personal" };
const inference = { generatedAt: "2026-09-06", possibilities: [{ confidence: 6, intent: "Grow revenue", sourceKind: "inferred",
  substantiation: "Several completed product tasks" }], userCategoryEm: "work" };

// ----------------------------------------------------------------------------------------------
// @desc Remove an owned subtree to simulate a user's accidental heading deletion.
// @param {object} note - Mutable mock note.
// @param {string} text - Heading to remove with descendants.
// Recovery tests begin from persisted content rather than a fabricated repository return.
function removeSection(note, text) {
  const range = guideSectionRange(note.content, text);
  note.content = `${ note.content.slice(0, range.start) }${ note.content.slice(range.end) }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Reading nonexistent storage and rejecting invalid requests have no note side effects.
// Recommendation reads are safe before the wizard has ever been used.
test("reads missing guides without creating them and rejects invalid input before creation", async () => {
  const app = createPlanWizardApp();
  await expect(readPlanGoals(app, scope)).resolves.toMatchObject({ goals: [], noteUuid: null, possibilities: { personal: [], work: [] } });
  await expect(savePlanGoals(app, { ...scope, goals: [{ ...goal, goalRank: 0 }] })).rejects.toThrow("goalRank");
  await expect(savePlanIntentPossibilities(app, { ...scope, ...inference, generatedAt: "bad date" })).rejects.toThrow();
  expect(app.createNote).not.toHaveBeenCalled();
  expect(app.replaceNoteContent).not.toHaveBeenCalled();
});

// ----------------------------------------------------------------------------------------------
// @desc Identify the category and project title when one stored ActionProspect fails validation.
test("adds project context to stored prospect validation errors", () => {
  const payload = { prospectTasks: [], prospects: [{ capturedAt: "2026-09-07T18:08:27.184Z",
    quarterKey: "2026-Q4", substantiations: ["Worth considering"], summary: "Broken project",
    userCategoryEm: "work", uuid: "broken-project" }] };
  expect(() => validatedSectionPayload("workProspects", payload, { quarterKey: "2026-Q4" }))
    .toThrow('Professional project "Broken project" is invalid: approvalStatusEm');
});

// ----------------------------------------------------------------------------------------------
// @desc Create an archived guide, write a single leaf, and read it after forgetting caller state.
// Archive discovery must be explicit, and every write must specify a section.
test("creates archived storage and round-trips both categories through targeted writes", async () => {
  const app = createPlanWizardApp();
  const saved = await savePlanGoals(app, { ...scope, goals: [goal, personalGoal] });
  expect(saved.goals).toHaveLength(2);
  expect(app.createNote).toHaveBeenCalledWith("Work Mission Builder Vision Guide 2026", expect.any(Array), { archive: true });
  expect(app.replaceNoteContent.mock.calls[0][2]).toEqual({ section: { heading: null } });
  expect(app.replaceNoteContent.mock.calls[1][2]).toEqual({ section: { heading: { level: 3, text: "Q4 2026 Picked intents" } } });
  for (const call of app.replaceNoteContent.mock.calls) expect(call[2].section).toBeDefined();
  const reloaded = await readPlanGoals(app, scope);
  expect(reloaded).toEqual(saved);
  expect(app.filterNotes).toHaveBeenCalledWith(expect.objectContaining({ group: "archived" }));
});

// ----------------------------------------------------------------------------------------------
// @desc Domain identity survives display-name changes while other domains, quarters, and years remain separate.
// Next-quarter edits never replace the current quarter's goals.
test("isolates quarters, years, and stable domains even when names collide or change", async () => {
  const app = createPlanWizardApp();
  await savePlanGoals(app, { ...scope, goals: [goal] });
  await savePlanGoals(app, { ...scope, goals: [{ ...goal, goalText: "Q3 outcome" }], quarter: 3 });
  await savePlanGoals(app, { ...scope, domainUuid: "another-work", goals: [personalGoal] });
  await savePlanGoals(app, { ...scope, goals: [goal], quarter: 1, year: 2027 });
  expect(app.notes).toHaveLength(3);
  expect((await readPlanGoals(app, { ...scope, domainName: "Business" })).goals[0].goalText).toBe("Grow revenue");
  expect((await readPlanGoals(app, { ...scope, quarter: 3 })).goals[0].goalText).toBe("Q3 outcome");
  expect((await readPlanGoals(app, { ...scope, domainUuid: "another-work" })).goals[0].userCategoryEm).toBe("personal");
});

// ----------------------------------------------------------------------------------------------
// @desc Preserve chosen goals across refreshed guesses and avoid note revisions for exact/stale retries.
// Inference is never an implicit human choice.
test("keeps inference separate, reuses suggestion IDs, and ignores stale or repeated captures", async () => {
  const app = createPlanWizardApp();
  await savePlanGoals(app, { ...scope, goals: [goal] });
  const inferred = await savePlanIntentPossibilities(app, { ...scope, ...inference });
  expect(inferred.goals[0].goalText).toBe("Grow revenue");
  expect(inferred.possibilities.work).toHaveLength(1);
  const writes = app.replaceNoteContent.mock.calls.length;
  await savePlanGoals(app, { ...scope, goals: [goal] });
  await savePlanIntentPossibilities(app, { ...scope, ...inference });
  expect(app.replaceNoteContent).toHaveBeenCalledTimes(writes);
  const refreshed = await savePlanIntentPossibilities(app, { ...scope, ...inference, generatedAt: "2026-09-07" });
  expect(refreshed.possibilities.work[0].uuid).toBe(inferred.possibilities.work[0].uuid);
  const deleted = await savePlanGoals(app, { ...scope, goals: [{ ...goal, capturedAt: "2026-09-08", goalText: "", isDeleted: true }] });
  expect(deleted.goals).toEqual([]);
  expect(deleted.goalRecords[0].isDeleted).toBe(true);
  expect((await savePlanGoals(app, { ...scope, goals: [goal] })).goals).toEqual([]);
});

// ----------------------------------------------------------------------------------------------
// @desc Serialize initial creation and independent updates sharing a domain/year.
// Both concurrent caller updates must survive their read/merge/write cycles.
test("concurrent local saves create one note and retain both categories and suggestions", async () => {
  const app = createPlanWizardApp();
  await Promise.all([
    savePlanGoals(app, { ...scope, goals: [goal] }),
    savePlanGoals(app, { ...scope, goals: [personalGoal] }),
    savePlanIntentPossibilities(app, { ...scope, ...inference }),
  ]);
  const saved = await readPlanGoals(app, scope);
  expect(app.createNote).toHaveBeenCalledTimes(1);
  expect(saved.goals).toHaveLength(2);
  expect(saved.possibilities.work).toHaveLength(1);
});

// ----------------------------------------------------------------------------------------------
// @desc Recover deleted leaves/ancestors through the nearest existing section while retaining unrelated content.
// Structural writes preserve siblings and still use explicit section descriptors.
test.each(["Q4 2026 Picked intents", "Intents picked", "Top-line intent"])("repairs missing %s through its ancestor", async heading => {
  const app = createPlanWizardApp();
  await savePlanGoals(app, { ...scope, goals: [goal] });
  app.notes[0].content += "\n# My annotations\nDo not overwrite.\n";
  removeSection(app.notes[0], heading);
  const restored = await savePlanGoals(app, { ...scope, goals: [goal] });
  expect(restored.goals[0].goalText).toBe(goal.goalText);
  expect(app.notes[0].content).toContain("# My annotations\nDo not overwrite.");
  expect(app.notes).toHaveLength(1);
});

// ----------------------------------------------------------------------------------------------
// @desc Preserve JSON extension fields and prose when updating an already-populated leaf.
// Human annotations remain outside the owned fenced payload.
test("preserves prose, Rich Footnote definitions, and unknown goal fields", async () => {
  const app = createPlanWizardApp();
  await savePlanGoals(app, { ...scope, goals: [{ ...goal, customEvidence: { noteUuid: "source-note" } }] });
  app.notes[0].content = app.notes[0].content.replace("### Q4 2026 Picked intents\n", "### Q4 2026 Picked intents\nMy [reason][^1].\n");
  app.notes[0].content += "\n[^1]: [reason]()\n    Keep this footnote.\n";
  const saved = await savePlanGoals(app, { ...scope, goals: [{ ...goal, capturedAt: "2026-09-07", goalText: "New outcome" }] });
  expect(saved.goals[0].customEvidence).toEqual({ noteUuid: "source-note" });
  expect(app.notes[0].content).toContain("My [reason][^1].");
  expect(app.notes[0].content).toContain("Keep this footnote.");
});

// ----------------------------------------------------------------------------------------------
// @desc Reject ambiguous, corrupt, or future-schema notes without replacing any content.
// Errors never silently become empty goals or a new competing guide.
test.each(["payload", "heading", "schema", "duplicate"])("refuses %s corruption without mutations", async corruption => {
  const app = createPlanWizardApp();
  await savePlanGoals(app, { ...scope, goals: [goal] });
  if (corruption === "payload") app.notes[0].content = app.notes[0].content.replace('"goalText": "Grow revenue"', '"goalText": invalid');
  if (corruption === "heading") app.notes[0].content += "\n### Q4 2026 Picked intents\n```json\n{\"goals\":[]}\n```\n";
  if (corruption === "schema") app.notes[0].content = app.notes[0].content.replace('"schemaVersion": 1', '"schemaVersion": 2');
  if (corruption === "duplicate") app.notes.push({ ...app.notes[0], uuid: "duplicate" });
  const before = app.notes.map(note => note.content);
  const writes = app.replaceNoteContent.mock.calls.length;
  await expect(readPlanGoals(app, scope)).rejects.toThrow();
  await expect(savePlanGoals(app, { ...scope, goals: [goal] })).rejects.toThrow();
  expect(app.notes.map(note => note.content)).toEqual(before);
  expect(app.replaceNoteContent).toHaveBeenCalledTimes(writes);
  expect(app.createNote).toHaveBeenCalledTimes(1);
});

// ----------------------------------------------------------------------------------------------
// @desc Failed initial writes leave an empty archived note that a later attempt can finish.
// A rejected job must not poison the local queue or create another datastore.
test("recovers from failed bootstrap and rejects false-success verification", async () => {
  const app = createPlanWizardApp();
  app.replaceNoteContent.mockResolvedValueOnce(false);
  await expect(savePlanGoals(app, { ...scope, goals: [goal] })).rejects.toThrow("replacement failed");
  expect(app.notes).toHaveLength(1);
  expect((await savePlanGoals(app, { ...scope, goals: [goal] })).goals).toHaveLength(1);
  app.replaceNoteContent.mockResolvedValueOnce(true);
  await expect(savePlanGoals(app, { ...scope, goals: [{ ...goal, capturedAt: "2026-09-07" }] })).rejects.toThrow("verification failed");
});

// ----------------------------------------------------------------------------------------------
// @desc Empty notes left by failed creation still belong to their original domain, regardless of display name.
test("does not adopt another domain's interrupted initialization", async () => {
  const app = createPlanWizardApp();
  app.replaceNoteContent.mockResolvedValueOnce(false);
  await expect(savePlanGoals(app, { ...scope, goals: [goal] })).rejects.toThrow();
  await savePlanGoals(app, { ...scope, domainUuid: "another-domain", goals: [personalGoal] });
  const recovered = await savePlanGoals(app, { ...scope, domainName: "Business", goals: [goal] });
  expect(app.notes).toHaveLength(2);
  expect(recovered.goals[0].goalText).toBe("Grow revenue");
});

// ----------------------------------------------------------------------------------------------
// @desc Reject soft bridge errors and missing notes rather than creating storage from an unavailable read.
// Mobile's error envelopes must not masquerade as empty arrays or successful writes.
test("surfaces bridge failures without creating replacement notes", async () => {
  const app = createPlanWizardApp();
  app.filterNotes.mockResolvedValueOnce({ embedCallFailed: true, error: "Offline" });
  await expect(savePlanGoals(app, { ...scope, goals: [goal] })).rejects.toThrow("Offline");
  expect(app.createNote).not.toHaveBeenCalled();
  await savePlanGoals(app, { ...scope, goals: [goal] });
  app.replaceNoteContent.mockResolvedValueOnce({ embedCallFailed: true, error: "Readonly" });
  await expect(savePlanGoals(app, { ...scope, goals: [{ ...goal, capturedAt: "2026-09-07" }] })).rejects.toThrow("Readonly");
});

// ----------------------------------------------------------------------------------------------
// @desc Use ordinary API calls through the generic bridge without registering any datastore-specific actions.
test("service works with the generic embed bridge and surfaces mobile errors", async () => {
  const app = createPlanWizardApp();
  const bridge = new Proxy({}, { get: (target, method) => (...args) => plugin.onEmbedCall(app, method, ...args) });
  const saved = await savePlanGoals(bridge, { ...scope, goals: [goal] });
  expect(saved.goals).toHaveLength(1);
  expect(await readPlanGoals(bridge, scope)).toEqual(saved);
  app.getNoteContent.mockRejectedValueOnce(new Error("Content unavailable"));
  await expect(readPlanGoals(bridge, scope)).rejects.toThrow("Content unavailable");
});
