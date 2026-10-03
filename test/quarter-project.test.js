// Verify the QuarterProject contract: its constructor's defaults, its setters, and the records its notes persist.
import { SIMILAR_TASK_MINIMUM_SCORE } from "plan-wizard/stack-rank/task-rating-cache";
import QuarterProject from "quarter-project";

describe("QuarterProject", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Unset fields are null and collections are empty, and a project cannot exist without its identity.
  it("defaults every field and requires a summary and uuid", () => {
    const project = new QuarterProject({ summary: "Launch dashboard", uuid: "project-uuid" });
    expect(project).toMatchObject({ blocksPerWeek: null, completedTasks: [], due: null, focusMonths: [], isActive: true,
      relatedTasks: [], taskSimilarityScores: {} });
    expect(() => new QuarterProject({ uuid: "project-uuid" })).toThrow("summary and a uuid");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A persisted record's nulls take the constructor's defaults, and from() reuses an instance it is handed.
  it("reads plain records and reuses instances", () => {
    const project = QuarterProject.from({ focusMonths: null, summary: "Launch dashboard", undeclaredField: "stale",
      uuid: "project-uuid" });
    expect(project.focusMonths).toEqual([]);
    expect(project).not.toHaveProperty("undeclaredField");
    expect(QuarterProject.from(project)).toBe(project);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A guide project takes the store's fields but keeps its own completions when it has any.
  it("adopts store-owned fields", () => {
    const completion = { completedAt: "2026-09-16T12:00:00.000Z", taskUuid: "guide-task" };
    const project = new QuarterProject({ summary: "Launch dashboard", uuid: "project-uuid", completedTasks: [completion] });
    const stored = new QuarterProject({ summary: "Launch dashboard", uuid: "project-uuid", isActive: false,
      lastRankedAt: "2026-09-10T12:00:00.000Z", taskSuggestions: [{ suggestedAt: "2026-09-11T12:00:00.000Z", taskUuid: "shown" }] });
    project.adoptStoreFields(stored);
    expect(project).toMatchObject({ completedTasks: [completion], isActive: false, lastRankedAt: "2026-09-10T12:00:00.000Z" });
    expect(project.taskSuggestions).toHaveLength(1);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The stored payload leaves out day evidence and the tasks the similarity hash already associates, and
  //   the progress record leaves out the fields the store owns.
  it("persists neither day evidence nor hash-similar related tasks", () => {
    const project = new QuarterProject({ summary: "Launch dashboard", uuid: "project-uuid", blocksPerWeek: 2,
      lastRankedAt: "2026-09-10T12:00:00.000Z", relatedTasks: ["kept-task", "similar-task"],
      taskSimilarityScores: { "digest:similar-task": SIMILAR_TASK_MINIMUM_SCORE } });
    project.setProgressEvidence(new Date(2026, 8, 18));
    expect(project.due).toBe(true);
    const storeRecord = project.toStoreRecord();
    expect(storeRecord.relatedTasks).toEqual(["kept-task"]);
    expect(storeRecord).not.toHaveProperty("due");
    expect(storeRecord).not.toHaveProperty("taskSimilarityScores");
    const progressRecord = project.toProgressRecord();
    expect(progressRecord).not.toHaveProperty("due");
    expect(progressRecord).not.toHaveProperty("lastRankedAt");
    expect(progressRecord.relatedTasks).toEqual(["kept-task", "similar-task"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A project survives a round trip through its store section.
  it("reads back the store section it renders", () => {
    const project = new QuarterProject({ summary: "Launch dashboard", uuid: "project-uuid", blocksPerWeek: 2,
      relatedTaskRecords: [{ taskText: "Build the picker", taskUuid: "open-task" }], relatedTasks: ["open-task"] });
    project.recordShownTasks(["open-task"], "2026-09-18T12:00:00.000Z");
    const restored = QuarterProject.fromStoreSection(project.toStoreSection(), { isActive: false });
    expect(restored).toMatchObject({ blocksPerWeek: 2, isActive: false, relatedTasks: ["open-task"], uuid: "project-uuid" });
    expect(restored.relatedTaskRecords).toEqual(project.relatedTaskRecords);
    expect(restored.taskSuggestions).toEqual(project.taskSuggestions);
    expect(QuarterProject.fromStoreSection("No payload here")).toBeNull();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A hash-similar task counts as a match unless the caller is a ranking pass re-checking it.
  it("matches hash-similar tasks except when asked to leave them out", () => {
    const project = new QuarterProject({ summary: "Launch dashboard", uuid: "project-uuid",
      taskSimilarityScores: { "digest:similar-task": 9 } });
    const task = { content: "Unrelated wording", uuid: "similar-task" };
    expect(project.matchesTask(task)).toBe(true);
    expect(project.matchesTask(task, { includeSimilarTasks: false })).toBe(false);
  });
});
