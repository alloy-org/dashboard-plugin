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
  // @desc The stored payload leaves out day evidence, the assigned tasks its lists carry, and the suggestion log its
  //   headings carry, and the progress record leaves out the fields the store owns.
  it("persists neither day evidence, assigned tasks, nor the suggestion log in the store payload", () => {
    const project = new QuarterProject({ summary: "Launch dashboard", uuid: "project-uuid", blocksPerWeek: 2,
      lastRankedAt: "2026-09-10T12:00:00.000Z", relatedTasks: ["kept-task", "similar-task"],
      taskSimilarityScores: { "digest:similar-task": SIMILAR_TASK_MINIMUM_SCORE } });
    project.setProgressEvidence(new Date(2026, 8, 18));
    expect(project.due).toBe(true);
    const storeRecord = project.toStoreRecord();
    expect(storeRecord).not.toHaveProperty("relatedTasks");
    expect(storeRecord).not.toHaveProperty("taskSuggestions");
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
      relatedTaskRecords: [{ linkedBy: "assigned", taskText: "Build the picker", taskUuid: "open-task" },
        { matchScore: 6.5, taskText: "Wire the export", taskUuid: "similar-task" }], relatedTasks: ["open-task"] });
    project.recordShownTasks(["open-task"], "2026-09-18T12:00:00.000Z");
    const restored = QuarterProject.fromStoreSection(project.toStoreSection(), { isActive: false });
    expect(restored).toMatchObject({ blocksPerWeek: 2, isActive: false, relatedTasks: ["open-task"], uuid: "project-uuid" });
    expect(restored.relatedTaskRecords).toEqual(project.relatedTaskRecords);
    expect(restored.taskSuggestions).toEqual(project.taskSuggestions);
    expect(QuarterProject.fromStoreSection("No payload here")).toBeNull();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Each refresh operation records its own success. A success without a watermark keeps the previous one, an
  //   operation this version does not record is refused, and entries a newer version wrote are kept.
  it("records each refresh operation's success separately", () => {
    const project = new QuarterProject({ summary: "Launch dashboard", uuid: "project-uuid",
      refreshState: { futureOperation: { succeededAt: "2026-09-01T12:00:00.000Z" }, malformed: "text" } });
    expect(project.refreshState).toEqual({ futureOperation: { succeededAt: "2026-09-01T12:00:00.000Z" } });
    const watermark = { sequence: 4, snapshotId: "index" };
    project.recordRefreshSuccess("similarity", { inputRevision: "abc12345", succeededAt: "2026-09-10T12:00:00.000Z", watermark });
    const afterSimilarity = project.refreshState;
    project.recordRefreshSuccess("similarity", { inputRevision: "abc12345", succeededAt: "2026-09-11T12:00:00.000Z" });
    project.recordRefreshSuccess("ideas", { inputRevision: null, succeededAt: "2026-09-11T12:00:00.000Z" });
    expect(project.refreshState.similarity).toEqual({ inputRevision: "abc12345", succeededAt: "2026-09-11T12:00:00.000Z",
      watermark });
    expect(project.refreshState.ideas.watermark).toBeNull();
    expect(project.refreshState.futureOperation).toBeDefined();
    expect(afterSimilarity.ideas).toBeUndefined();
    expect(() => project.recordRefreshSuccess("unknown", { succeededAt: "2026-09-11T12:00:00.000Z" })).toThrow("Unknown");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The revision and refresh state are store-owned: written to the store payload, read back from its section,
  //   adopted by a guide project, and defaulted for a section written before they existed.
  it("persists its revision and refresh state in the store", () => {
    const project = new QuarterProject({ summary: "Launch dashboard", uuid: "project-uuid", projectRevision: 3 });
    project.recordRefreshSuccess("similarity", { inputRevision: "abc12345", succeededAt: "2026-09-10T12:00:00.000Z",
      watermark: { sequence: 2, snapshotId: "index" } });
    expect(project.toProgressRecord()).not.toHaveProperty("refreshState");
    const restored = QuarterProject.fromStoreSection(project.toStoreSection());
    expect(restored).toMatchObject({ projectRevision: 3, refreshState: project.refreshState });
    const guideProject = new QuarterProject({ summary: "Launch dashboard", uuid: "project-uuid" });
    guideProject.adoptStoreFields(restored);
    expect(guideProject).toMatchObject({ projectRevision: 3, refreshState: project.refreshState });
    const legacySection = project.toStoreSection().replace(/```json\n([\s\S]*?)\n```/, (fence, payloadText) => {
      const { projectRevision, refreshState, ...legacyPayload } = JSON.parse(payloadText);
      return `\`\`\`json\n${ JSON.stringify(legacyPayload) }\n\`\`\``;
    });
    expect(legacySection).not.toContain("refreshState");
    expect(QuarterProject.fromStoreSection(legacySection)).toMatchObject({ projectRevision: 0, refreshState: {} });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The revision advances when readers' fields change, not when only refresh bookkeeping or the shown-task log
  //   does, and a project's first write starts it at one.
  it("advances its revision only for changes readers consume", () => {
    const previous = new QuarterProject({ summary: "Launch dashboard", uuid: "project-uuid", projectRevision: 2 });
    const bookkeeping = previous.detachedCopy();
    bookkeeping.setAttemptedAt("2026-09-12T12:00:00.000Z");
    bookkeeping.recordShownTasks(["open-task"], "2026-09-12T12:00:00.000Z");
    bookkeeping.recordRefreshSuccess("similarity", { inputRevision: null, succeededAt: "2026-09-12T12:00:00.000Z" });
    bookkeeping.advanceProjectRevision(previous);
    expect(bookkeeping.projectRevision).toBe(2);
    const changed = previous.detachedCopy();
    changed.setSuggestedTasks([{ generatedAt: "2026-09-12T12:00:00.000Z", taskText: "Audit widget memory" }]);
    changed.advanceProjectRevision(previous);
    expect(changed.projectRevision).toBe(3);
    const created = new QuarterProject({ summary: "New project", uuid: "new-uuid" });
    created.advanceProjectRevision(null);
    expect(created.projectRevision).toBe(1);
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
