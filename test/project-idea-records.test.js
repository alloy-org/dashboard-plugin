// Verify the idea records a project keeps: text-only ideas read as open ones with stable identities, a store section
// keeps decided ideas and completion text while listing only open ideas, generated ideas merge by identity and record
// what they replace, ideas the user took on are recognized, and the idea prompt carries the project's intents, its
// completed work, and its idea history.
import { jest } from "@jest/globals";
import { projectIntentTexts } from "project-collection-steps";
import { IDEA_STATUSES, ideaIdFor, ideasAcceptedByTasks, MAXIMUM_DECIDED_IDEAS, mergedIdeaRecords,
  normalizedIdeaRecords, openIdeas } from "project-idea-records";
import { generateProjectTaskIdeas, MAXIMUM_PROMPT_COMPLETIONS } from "project-task-ideas";
import QuarterProject, { observedCompletionRecord } from "quarter-project";
import { ideasInputRevision } from "quarter-project-refresh-state";
import { textDigest } from "util/text-digest";

const PROJECT_UUID = "project-uuid";

// ----------------------------------------------------------------------------------------------
// @desc Build a project with overridable fields.
// @param {object} [overrides] - Fields to replace.
// @returns {QuarterProject} Project.
function project(overrides = {}) {
  return new QuarterProject({ summary: "Launch dashboard", uuid: PROJECT_UUID, ...overrides });
}

describe("idea records", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A legacy text-only idea is open, and every read derives the same identity for it, so readers agree on it
  //   before any write stores one; fields a newer version wrote survive.
  it("reads text-only ideas as open ideas with stable identities", () => {
    const legacy = [{ generatedAt: "2026-09-18T12:00:00.000Z", taskText: "Audit widget memory" },
      { taskText: "  " }, { futureField: 7, taskText: "Audit widget memory." }];
    const first = normalizedIdeaRecords(legacy, { projectUuid: PROJECT_UUID });
    const second = normalizedIdeaRecords(legacy, { projectUuid: PROJECT_UUID });
    expect(first).toEqual(second);
    expect(first).toEqual([{ acceptedTaskUuid: null, decidedAt: null, generatedAt: "2026-09-18T12:00:00.000Z",
      ideaId: ideaIdFor(PROJECT_UUID, "Audit widget memory"), noteUuid: null, projectUuid: PROJECT_UUID, sourceRevision: null,
      status: IDEA_STATUSES.open, supersedesIdeaId: null, taskText: "Audit widget memory" }]);
    const kept = normalizedIdeaRecords([{ futureField: 7, taskText: "Cap the cache" }], { projectUuid: PROJECT_UUID });
    expect(kept[0].futureField).toBe(7);
    expect(openIdeas([{ taskText: "Unnormalized" }])).toHaveLength(1);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The store keeps decided ideas and the project's intents in its payload but lists only open ideas, and lists
  //   a completion by its text when it has one.
  it("round-trips decided ideas, linked intents, and completion text through the store section", () => {
    const stored = project({ completedTasks: [{ completedAt: "2026-09-10T12:00:00.000Z", taskText: "Ship the picker",
      taskUuid: "done-1" }, { completedAt: "2026-09-11T12:00:00.000Z", taskUuid: "done-2" }], linkedGoalUuids: ["goal-1"],
      suggestedTasks: [{ taskText: "Audit widget memory" }, { decidedAt: "2026-09-12T12:00:00.000Z",
        status: IDEA_STATUSES.dismissed, taskText: "Rewrite the dashboard" }] });
    const section = stored.toStoreSection();
    expect(section).toContain("  - Audit widget memory\n");
    expect(section).not.toContain("  - Rewrite the dashboard\n");
    expect(section).toContain("  - Ship the picker — completed 2026-09-10");
    expect(section).toContain("  - done-2 — completed 2026-09-11");
    const reread = QuarterProject.fromStoreSection(section);
    expect(reread.suggestedTasks).toEqual(stored.suggestedTasks);
    expect(reread.linkedGoalUuids).toEqual(["goal-1"]);
    expect(reread.completedTasks[0].taskText).toBe("Ship the picker");
    expect(stored.toProgressRecord().linkedGoalUuids).toEqual(["goal-1"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A refinement replaces the open idea it names and records it; a rewording of a decided idea is not added back;
  //   each new idea records the revision it was generated from.
  it("merges generated ideas by identity and records what they replace", () => {
    const kept = normalizedIdeaRecords([{ taskText: "Audit widget memory" }, { decidedAt: "2026-09-12T12:00:00.000Z",
      status: IDEA_STATUSES.dismissed, taskText: "Rewrite the dashboard" }], { projectUuid: PROJECT_UUID });
    const returned = [{ beforeTask: "audit widget memory", generatedAt: "2026-09-19T12:00:00.000Z",
      taskText: "Audit widget memory and cap the cache" }, { beforeTask: null, generatedAt: "2026-09-19T12:00:00.000Z",
      taskText: "Rewrite the Dashboard!" }];
    const { addedCount, ideas } = mergedIdeaRecords(kept, returned, { projectUuid: PROJECT_UUID, sourceRevision: "abcd1234" });
    expect(addedCount).toBe(1);
    expect(ideas.map(idea => idea.taskText)).toEqual(["Audit widget memory and cap the cache", "Rewrite the dashboard"]);
    expect(ideas[0]).toMatchObject({ sourceRevision: "abcd1234", status: IDEA_STATUSES.open,
      supersedesIdeaId: ideaIdFor(PROJECT_UUID, "Audit widget memory") });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Decided history is bounded to the most recently decided ideas, and open ideas are always kept.
  it("keeps only the most recently decided ideas", () => {
    const decided = Array.from({ length: MAXIMUM_DECIDED_IDEAS + 2 }, (unused, index) => ({
      decidedAt: `2026-09-${ String(index + 1).padStart(2, "0") }T00:00:00.000Z`, status: IDEA_STATUSES.accepted,
      taskText: `Decided idea ${ index }` }));
    const kept = normalizedIdeaRecords([{ taskText: "Open idea" }, ...decided], { projectUuid: PROJECT_UUID });
    const { ideas } = mergedIdeaRecords(kept, [], { projectUuid: PROJECT_UUID, sourceRevision: null });
    expect(ideas).toHaveLength(MAXIMUM_DECIDED_IDEAS + 1);
    expect(ideas[0].taskText).toBe("Open idea");
    expect(ideas.some(idea => idea.taskText === "Decided idea 0")).toBe(false);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc An open idea that has become an open task is accepted with that task's UUID rather than forgotten.
  it("accepts an open idea the user turned into a task", () => {
    const ideas = normalizedIdeaRecords([{ taskText: "Audit widget memory" }, { taskText: "Cap the cache" }],
      { projectUuid: PROJECT_UUID });
    const updated = ideasAcceptedByTasks(ideas, { decidedAt: "2026-09-19T12:00:00.000Z",
      openTaskRecords: [{ taskText: "Audit widget memory.", taskUuid: "task-9" }] });
    expect(updated[0]).toMatchObject({ acceptedTaskUuid: "task-9", decidedAt: "2026-09-19T12:00:00.000Z",
      status: IDEA_STATUSES.accepted });
    expect(updated[1].status).toBe(IDEA_STATUSES.open);
  });
});

describe("idea generation context", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc The prompt leads with the project's intents and lists its completed work and idea history, saying how much of
  //   the history it left out; an answer restating completed work or a turned-down idea is dropped.
  it("describes intents, completions, and decided ideas, and drops restated ideas", async () => {
    const completions = Array.from({ length: MAXIMUM_PROMPT_COMPLETIONS + 2 }, (unused, index) => ({
      completedAt: `2026-08-${ String(index % 28 + 1).padStart(2, "0") }T00:00:00.000Z`, taskText: `Finished step ${ index }`,
      taskUuid: `done-${ index }` }));
    const subject = project({ completedTasks: [...completions, { completedAt: "2026-08-01T00:00:00.000Z", taskUuid: "old" }],
      suggestedTasks: [{ taskText: "Audit widget memory" }, { decidedAt: "2026-09-01T00:00:00.000Z",
        status: IDEA_STATUSES.dismissed, taskText: "Rewrite the dashboard" }, { acceptedTaskUuid: "task-9",
        decidedAt: "2026-09-02T00:00:00.000Z", status: IDEA_STATUSES.accepted, taskText: "Sketch the picker" }] });
    const promptRunner = jest.fn().mockResolvedValue({ foundTasks: [], ideas: [{ beforeTask: null, taskText: "rewrite the dashboard" },
      { beforeTask: null, taskText: "Finished step 3" }, { beforeTask: null, taskText: "Benchmark the date picker" }] });
    const result = await generateProjectTaskIdeas({}, { intentTexts: ["Grow paying users", "Ship weekly"],
      project: subject, promptRunner, quarterlyContext: null });
    const prompt = promptRunner.mock.calls[0][1];
    expect(prompt).toContain("This project serves these intents the user chose for the quarter, most important first:\n"
      + "- Grow paying users\n- Ship weekly");
    expect(prompt).toContain("- Finished step 27 (completed 2026-08-28)");
    expect(prompt).not.toContain("- Finished step 0 ");
    expect(prompt).toContain("- (2 earlier completed task(s) not listed here)");
    expect(prompt).toContain("- (1 completed task(s) recorded without their text)");
    expect(prompt).toContain("Earlier ideas the user took on as tasks:\n- Sketch the picker");
    expect(prompt).toContain("Do not suggest these again, reworded or not:\n- Rewrite the dashboard");
    expect(result.suggestedTasks.map(idea => idea.taskText)).toEqual(["Benchmark the date picker"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The prompt lists the recently updated task notes, the project's own note first, and asks each idea to name one;
  //   an idea keeps a note the prompt offered, falls back to the project's note for one it did not, and the merged
  //   record stores the note so the calendar can create the task there.
  it("files each idea in an offered note, falling back to the project's note", async () => {
    const subject = project({ primaryNoteUuid: "project-note" });
    const destinationNotes = [{ name: "Inbox", uuid: "inbox-note" }, { name: "Launch dashboard", uuid: "project-note" }];
    const promptRunner = jest.fn().mockResolvedValue({ foundTasks: [], ideas: [
      { beforeTask: null, noteUuid: "inbox-note", taskText: "Email the beta testers" },
      { beforeTask: null, noteUuid: "invented-note", taskText: "Benchmark the date picker" },
      { beforeTask: null, taskText: "Draft the release notes" }] });
    const result = await generateProjectTaskIdeas({}, { destinationNotes, project: subject, promptRunner, quarterlyContext: null });
    const prompt = promptRunner.mock.calls[0][1];
    expect(prompt).toContain("each shown as [uuid] name:\n- [project-note] Launch dashboard (this project's own note)\n"
      + "- [inbox-note] Inbox\n");
    expect(prompt).toContain(`"noteUuid": "..."`);
    expect(result.suggestedTasks.map(idea => idea.noteUuid)).toEqual(["inbox-note", "project-note", "project-note"]);
    const { ideas } = mergedIdeaRecords([], result.suggestedTasks, { projectUuid: PROJECT_UUID, sourceRevision: "rev" });
    expect(ideas.map(idea => idea.noteUuid)).toEqual(["inbox-note", "project-note", "project-note"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Without notes to offer, the prompt asks for no note and ideas take the project's note, or none without one.
  it("asks for no note when none are offered", async () => {
    const promptRunner = jest.fn().mockResolvedValue({ foundTasks: [], ideas: [{ beforeTask: null, taskText: "Email the beta testers" }] });
    const result = await generateProjectTaskIdeas({}, { project: project(), promptRunner, quarterlyContext: null });
    expect(promptRunner.mock.calls[0][1]).not.toContain("noteUuid");
    expect(result.suggestedTasks[0].noteUuid).toBeNull();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Linked intents are read from the guide by rank, leaving out deleted ones and ones the guide no longer holds.
  it("reads a project's linked intents from the guide by rank", () => {
    const guide = { goals: { goals: [{ goalRank: 2, goalText: "Ship weekly", isDeleted: false, uuid: "goal-2" },
      { goalRank: 1, goalText: "Grow paying users", isDeleted: false, uuid: "goal-1" },
      { goalRank: 3, goalText: "", isDeleted: true, uuid: "goal-3" },
      { goalRank: 4, goalText: "Unlinked", isDeleted: false, uuid: "goal-4" }] } };
    const linked = project({ linkedGoalUuids: ["goal-2", "goal-1", "goal-3", "goal-gone"] });
    expect(projectIntentTexts(guide, linked)).toEqual(["Grow paying users", "Ship weekly"]);
    expect(projectIntentTexts(null, linked)).toEqual([]);
    expect(projectIntentTexts(guide, project())).toEqual([]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A project linked to no intent keeps the ideas revision it had before intents were read, so ideas are not all
  //   regenerated at once; linking an intent changes it.
  it("changes the ideas revision only for projects linked to intents", () => {
    const unlinked = project({ nextAction: "Ship it", relatedTaskRecords: [{ taskText: "Open task", taskUuid: "task-1" }] });
    expect(ideasInputRevision(unlinked)).toBe(textDigest(JSON.stringify(["Launch dashboard", "Ship it", ["task-1"]])));
    const linked = project({ linkedGoalUuids: ["goal-1"], nextAction: "Ship it",
      relatedTaskRecords: [{ taskText: "Open task", taskUuid: "task-1" }] });
    expect(ideasInputRevision(linked)).not.toBe(ideasInputRevision(unlinked));
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A completion keeps the text and note it was recorded with when observed again without them, and a completion
  //   first observed without text records none.
  it("records completion text and note, keeping what an earlier observation saw", () => {
    const task = { completedAt: 1789552800, content: "Ship the picker", noteUUID: "note-1", uuid: "done-1" };
    const first = observedCompletionRecord(task);
    expect(first).toMatchObject({ noteUuid: "note-1", taskText: "Ship the picker", taskUuid: "done-1" });
    const again = observedCompletionRecord({ completedAt: 1789552800, content: "", uuid: "done-1" }, first);
    expect(again).toMatchObject({ noteUuid: "note-1", taskText: "Ship the picker" });
    const textless = observedCompletionRecord({ completedAt: 1789552800, uuid: "done-2" });
    expect(Object.keys(textless).sort()).toEqual(["completedAt", "sourceTaskUuid", "taskUuid"]);
  });
});
