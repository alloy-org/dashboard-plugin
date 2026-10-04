// Verify the per-project sections of the quarterly task store round-trip, are written one project at a time, and
// that a background pass associates tasks, folds in provider-found tasks and superseded ideas, and picks its
// projects by the staleness window first and the cycling time budget after.
import { jest } from "@jest/globals";
import { taskRatingKey } from "plan-wizard/stack-rank/task-rating-cache";
import { guideHeadingRanges } from "plan-wizard/vision-guide-markdown";
import { collectProjectTasks } from "project-task-collection";
import { projectNeedsRefresh, projectsToRefresh, shouldRefreshAnotherProject } from "project-refresh-schedule";
import { initialProjectTaskStoreMarkdown, projectSectionHeadingText } from "project-task-store-markdown";
import { collectedIdeasMarkdown, openProjectTaskStore, projectTaskStoreNoteName, readCollectedProjectTasks, storedProjectRecords,
  writeProjectSection } from "project-task-store";
import QuarterProject from "quarter-project";
import { LEGACY_JEV_RATINGS_LABEL, SIMILARITY_SCORES_LABEL } from "quarter-project-serialization";

const scope = { domainName: "Work", domainUuid: "work-domain", quarter: 3, quarterKey: "2026-Q3", year: 2026 };
const quarterlyContent = "# Projects\n\n## Launch dashboard\n- Weekly rhythm: Two focused blocks per week\n- Outcome: Ship the date picker\n";

// ----------------------------------------------------------------------------------------------
// @desc Build a project as the store holds it, with overridable fields.
// @param {object} overrides - Fields to replace.
// @returns {QuarterProject} Project.
function storedProject(overrides = {}) {
  return new QuarterProject({ summary: "Launch dashboard", uuid: "project-uuid", lastAttemptedAt: "2026-09-18T12:00:00.000Z",
    ...overrides });
}

// ----------------------------------------------------------------------------------------------
// @desc Mock the app bridge with an in-memory note whose section writes are applied to the stored content,
//   modelling that replaceNoteContent takes a bare { uuid } and a { section } option. The domain's task snapshot
//   note is kept apart from the store note, whole, as the collection pass writes it.
// @param {object} options - { content, tasks }.
// @returns {object} App mock carrying `noteContent` and `snapshotContent` for assertions.
function storeApp({ content = null, tasks = [] } = {}) {
  const state = { noteContent: content, snapshotContent: null };
  const isSnapshotName = name => String(name || "").startsWith("Dashboard Task Snapshot");
  const app = {
    createNote: jest.fn(async name => (isSnapshotName(name) ? "snapshot-note" : "store-note")),
    filterNotes: jest.fn().mockResolvedValue([]),
    findNote: jest.fn(async ({ name } = {}) => {
      if (isSnapshotName(name)) return state.snapshotContent === null ? null : { uuid: "snapshot-note" };
      return state.noteContent === null ? null : { uuid: "store-note" };
    }),
    getNoteContent: jest.fn(async ({ uuid }) => (uuid === "snapshot-note" ? state.snapshotContent : state.noteContent) ?? ""),
    getTaskDomainTasks: jest.fn().mockResolvedValue(tasks),
    replaceNoteContent: jest.fn(async (handle, body, options) => {
      if (typeof handle?.uuid !== "string") throw new Error("Write received a non-uuid handle");
      if (handle.uuid === "snapshot-note") { state.snapshotContent = body; return true; }
      if (!options?.section) { state.noteContent = body; return true; }
      // Locate the section with the same parser the production code reasons about, so the mock cannot disagree
      // with guideHeadingRanges about where a section body begins and ends.
      const heading = options.section.heading;
      const range = guideHeadingRanges(state.noteContent).find(
        candidate => candidate.text === heading.text && candidate.level === heading.level);
      if (!range) throw new Error(`Section not found: ${ heading.text }`);
      state.noteContent = `${ state.noteContent.slice(0, range.bodyStart) }${ body }${ state.noteContent.slice(range.end) }`;
      return true;
    }),
  };
  Object.defineProperty(app, "noteContent", { get: () => state.noteContent });
  Object.defineProperty(app, "snapshotContent", { get: () => state.snapshotContent });
  return app;
}

describe("project task store sections", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A rendered project section parses back into the record it was written from.
  it("round-trips a project record through its rendered section", () => {
    const record = storedProject({ completedTasks: [{ completedAt: "2026-09-14T10:00:00.000Z", taskUuid: "done-task" }],
      relatedTaskRecords: [{ taskText: "Draft release notes", taskUuid: "open-task" }],
      suggestedTasks: [{ generatedAt: "2026-09-18T12:00:00.000Z", taskText: "Audit widget memory" }] });
    const content = initialProjectTaskStoreMarkdown().replace("# Past projects",
      `## ${ record.summary } (project:${ record.uuid })\n\n${ record.toStoreSection() }\n# Past projects`);
    const { recordsByUuid, unreadableHeadings } = storedProjectRecords(content);
    expect(unreadableHeadings).toEqual([]);
    expect(recordsByUuid.get("project-uuid")).toMatchObject({ isActive: true, summary: "Launch dashboard" });
    expect(recordsByUuid.get("project-uuid").suggestedTasks[0].taskText).toBe("Audit widget memory");
    expect(recordsByUuid.get("project-uuid").completedTasks[0].taskUuid).toBe("done-task");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Task content arrives as raw note markdown, so a task carrying its own link or Rich Footnote
  //   reference must be flattened before it is wrapped in the task link, or the note renders bare
  //   `](https://...)` fragments where the brackets failed to pair.
  it("flattens markdown inside task text so the task link stays intact", () => {
    const body = storedProject({
      relatedTaskRecords: [{ taskText: "Implement the [Spiral as a dashboard component](https://www.amplenote.com/notes/abc)",
        taskUuid: "open-task" }],
      suggestedTasks: [{ generatedAt: "2026-09-18T12:00:00.000Z", taskText: "Check the spec before shipping" }] }).toStoreSection();
    expect(body).toContain("  - [Implement the Spiral as a dashboard component](https://www.amplenote.com/notes/tasks/open-task)");
    expect(body).toContain("  - Check the spec before shipping");
    const renderedLists = body.slice(0, body.indexOf("```"));
    expect(renderedLists).not.toContain("https://www.amplenote.com/notes/abc");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Amplenote footnote numbers are positional within the content being written, so references carried in
  //   from a suggested task are renumbered from 1 in first-cited order across the section, each with a definition.
  it("renumbers carried footnote references from one and defines each", () => {
    const body = storedProject({
      suggestedTasks: [{ generatedAt: "2026-09-18T12:00:00.000Z",
        taskText: "Revisit the [rollout plan][^2] alongside the [meter][^7]" }] }).toStoreSection();
    expect(body).toContain("  - Revisit the rollout plan[^1] alongside the meter[^2]");
    expect(body).toContain("\n[^1]: Referenced from the source task: rollout plan");
    expect(body).toContain("\n[^2]: Referenced from the source task: meter");
    expect(body.slice(0, body.indexOf("```"))).not.toContain("[^7]");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc An existing task's content arrives with its footnote definitions appended, including multiline
  //   captions and images. The task link already leads to those footnotes, so the entry is plain linked text.
  it("renders an existing task with Rich Footnotes as a plain-text link", () => {
    const taskText = "[Simple graph and 1,811 reactions][^3] [makes for a very short email headline][^4]\n\n"
      + "[^3]: [Simple graph and 1,811 reactions]()\n\n    Captured from linkedin.com at 4:11pm\n\n"
      + "    ![](https://images.amplenote.com/graph.png)\n\n"
      + "[^4]: [makes for a very short email headline]()\n\n    Captured from mail.google.com at 4:21pm\n";
    const body = storedProject({ relatedTaskRecords: [{ taskText, taskUuid: "open-task" }] }).toStoreSection();
    expect(body).toContain("  - [Simple graph and 1,811 reactions makes for a very short email headline]"
      + "(https://www.amplenote.com/notes/tasks/open-task)\n");
    expect(body.slice(0, body.indexOf("```"))).not.toContain("[^");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The existing tasks are written once, as their list, and read back from it with their hash scores; the
  //   payload no longer repeats them.
  it("reads existing tasks back from their list rather than the payload", () => {
    const rawText = "Implement the [Spiral](https://www.amplenote.com/notes/abc)";
    const record = storedProject({ relatedTaskRecords: [{ taskText: rawText, taskUuid: "open-task" },
      { taskText: "Draft release notes", taskUuid: "named-task" }], taskSimilarityScores: { "a1b2c3d4:open-task": 7.4 } });
    const body = record.toStoreSection();
    expect(body.slice(body.indexOf("```json"))).not.toContain("Implement the");
    const content = initialProjectTaskStoreMarkdown().replace("# Past projects",
      `## ${ projectSectionHeadingText(record) }\n\n${ body }\n# Past projects`);
    const { recordsByUuid } = storedProjectRecords(content);
    expect(recordsByUuid.get("project-uuid").relatedTaskRecords).toEqual([
      { matchScore: 7.4, taskText: "Implement the Spiral", taskUuid: "open-task" },
      { taskText: "Draft release notes", taskUuid: "named-task" }]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A section written before the similarity hash keeps its payload's task list, and its kept tasks' scores
  //   and sparse Jev ratings become hash entries, so nothing is rated again.
  it("folds a pre-hash section's scores into the similarity hash", () => {
    const payload = { relatedTaskRecords: [{ matchScore: 8.1, taskText: "Kept", taskUuid: "task-kept" },
      { matchScore: 5.2, taskText: "Below the bar", taskUuid: "task-low" }], relatedTasks: [], summary: "Launch",
      uuid: "project-1" };
    const legacySection = `- Last attempted: never\n\n\`\`\`json\n${ JSON.stringify(payload) }\n\`\`\`\n\n`
      + `${ LEGACY_JEV_RATINGS_LABEL }\n\n\`\`\`\n{"e5f6a7b8:task-cited":2.5}\n\`\`\`\n`;
    const record = QuarterProject.fromStoreSection(legacySection);
    expect(record.relatedTaskRecords.map(task => task.taskUuid)).toEqual(["task-kept", "task-low"]);
    expect(record.taskSimilarityScores).toEqual({ "e5f6a7b8:task-cited": 2.5,
      [taskRatingKey("Launch", { taskText: "Kept", taskUuid: "task-kept" })]: 8.1 });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A project summary carrying a link would split its heading in two and lose the section on the
  //   next write, so the heading is flattened the same way.
  it("flattens markdown in the project section heading", () => {
    const headingText = projectSectionHeadingText({ summary: "Ship [the dashboard](https://example.com)",
      uuid: "project-uuid" });
    expect(headingText).toBe("Ship the dashboard (project:project-uuid)");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The human-readable lists render beside the payload, so the note is readable without parsing JSON.
  it("renders the three task lists above the payload", () => {
    const body = storedProject({
      completedTasks: [{ completedAt: "2026-09-14T10:00:00.000Z", taskUuid: "done-task" }],
      relatedTaskRecords: [{ taskText: "Draft release notes", taskUuid: "open-task" }] }).toStoreSection();
    expect(body).toContain("- Last attempted: 2026-09-18T12:00:00.000Z");
    expect(body).toContain("Draft release notes");
    expect(body).toContain("- Suggested tasks\n  - (none yet)");
    expect(body).toContain("done-task");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Writing one project leaves every other project's section untouched, which is what makes a
  //   progressive pass safe to interrupt.
  it("keeps the similarity hash on one line in its own block, sorted by task UUID, out of the JSON payload", () => {
    const taskSimilarityScores = { "e5f6a7b8:task-2": 6.4, "a1b2c3d4:task-1": 7.1 };
    const markdown = new QuarterProject({ summary: "Launch", uuid: "project-1", relatedTasks: ["task-1", "task-named"],
      taskSimilarityScores }).toStoreSection();
    expect(markdown).toContain('\n```\n{"a1b2c3d4:task-1":7.1,"e5f6a7b8:task-2":6.4}\n```\n');
    expect(markdown.match(/^```json$/gm)).toHaveLength(1);
    expect(markdown).not.toMatch(/"taskSimilarityScores"/);
    const record = QuarterProject.fromStoreSection(markdown);
    expect(record.taskSimilarityScores).toEqual(taskSimilarityScores);
    expect(record.relatedTasks).toEqual(["task-named"]);
    const withoutScores = new QuarterProject({ summary: "Launch", uuid: "project-1" }).toStoreSection();
    expect(withoutScores).not.toContain(SIMILARITY_SCORES_LABEL);
    expect(QuarterProject.fromStoreSection(withoutScores).taskSimilarityScores).toEqual({});
  });

  it("says how many tasks the similarity search has reached", () => {
    const markdown = new QuarterProject({ summary: "Launch", uuid: "project-1", similaritySearchedTaskCount: 1000,
      similaritySearchPageCount: 2 }).toStoreSection();
    expect(markdown).toContain("- Last attempted: never\n- Searched 1000 tasks for similarity\n");
    expect(QuarterProject.fromStoreSection(markdown)).toMatchObject({ similaritySearchedTaskCount: 1000,
      similaritySearchPageCount: 2 });
  });

  it("adds and then replaces a single project section in place", async () => {
    const app = storeApp({ content: initialProjectTaskStoreMarkdown() });
    const store = await openProjectTaskStore(app, scope);
    let content = await writeProjectSection(app, { content: store.content, noteHandle: store.noteHandle,
      project: storedProject() });
    content = await writeProjectSection(app, { content, noteHandle: store.noteHandle,
      project: storedProject({ summary: "Second project", uuid: "second-uuid" }) });
    const updated = await writeProjectSection(app, { content, noteHandle: store.noteHandle,
      project: storedProject({ suggestedTasks: [{ generatedAt: "2026-09-19T00:00:00.000Z", taskText: "New idea" }] }) });
    const { recordsByUuid } = storedProjectRecords(updated);
    expect([...recordsByUuid.keys()].sort()).toEqual(["project-uuid", "second-uuid"]);
    expect(recordsByUuid.get("project-uuid").suggestedTasks[0].taskText).toBe("New idea");
    expect(recordsByUuid.get("second-uuid").summary).toBe("Second project");
    expect(app.noteContent).toContain("# Past projects");
    // The returned string is computed locally rather than re-read; drift between it and the note would make a
    // multi-project pass write each later project against stale offsets.
    expect(updated).toBe(app.noteContent);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A retired project is written beneath the "Past projects" root rather than deleted.
  it("writes retired projects under the past-projects root", async () => {
    const app = storeApp({ content: initialProjectTaskStoreMarkdown() });
    const store = await openProjectTaskStore(app, scope);
    const content = await writeProjectSection(app, { content: store.content, noteHandle: store.noteHandle,
      project: storedProject({ isActive: false }) });
    expect(storedProjectRecords(content).recordsByUuid.get("project-uuid").isActive).toBe(false);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A project whose isActive changed moves to the other root, keeping its neighbors where they were, and moves
  //   back when it returns to the plan.
  it("moves a project's section between the roots when its isActive changes", async () => {
    const app = storeApp({ content: initialProjectTaskStoreMarkdown() });
    const store = await openProjectTaskStore(app, scope);
    let content = await writeProjectSection(app, { content: store.content, noteHandle: store.noteHandle,
      project: storedProject() });
    content = await writeProjectSection(app, { content, noteHandle: store.noteHandle,
      project: storedProject({ summary: "Second project", uuid: "second-uuid" }) });
    const retired = await writeProjectSection(app, { content, noteHandle: store.noteHandle,
      project: storedProject({ isActive: false }) });
    const retiredRecords = storedProjectRecords(retired).recordsByUuid;
    expect(retired).toBe(app.noteContent);
    expect(retiredRecords.get("project-uuid").isActive).toBe(false);
    expect(retiredRecords.get("second-uuid").isActive).toBe(true);
    expect(retired.match(/\(project:project-uuid\)/g)).toHaveLength(1);
    const restored = await writeProjectSection(app, { content: retired, noteHandle: store.noteHandle,
      project: storedProject() });
    const restoredRecords = storedProjectRecords(restored).recordsByUuid;
    expect(restoredRecords.get("project-uuid").isActive).toBe(true);
    expect(restoredRecords.get("project-uuid").lastAttemptedAt).toBe("2026-09-18T12:00:00.000Z");
    expect(restored.trimEnd().endsWith("# Past projects")).toBe(true);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The fast read path reports nothing rather than creating a note when no pass has run yet.
  it("reads an absent store as empty without creating it", async () => {
    const app = storeApp();
    await expect(readCollectedProjectTasks(app, scope)).resolves.toEqual([]);
    expect(app.createNote).not.toHaveBeenCalled();
    expect(app.replaceNoteContent).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The store is plugin data rather than a note the user reads, so it is created archived.
  it("creates an absent store as an archived note", async () => {
    const app = storeApp();
    await openProjectTaskStore(app, scope);
    expect(app.createNote).toHaveBeenCalledWith(projectTaskStoreNoteName(scope), expect.any(Array), { archive: true });
  });
});


describe("project refresh scheduling", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A project refreshed inside the three-day window is current; one older than it, or never refreshed,
  //   is due.
  it("treats only aged-out and unrefreshed projects as due", () => {
    const now = new Date("2026-09-19T12:00:00.000Z");
    expect(projectNeedsRefresh(undefined, now)).toBe(true);
    expect(projectNeedsRefresh({ lastAttemptedAt: "2026-09-18T06:00:00.000Z" }, now)).toBe(false);
    expect(projectNeedsRefresh({ lastAttemptedAt: "2026-09-15T06:00:00.000Z" }, now)).toBe(true);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc While anything is stale the pass takes every stale project, oldest first, and leaves current ones
  //   alone; the cycling regime never selects while catch-up work remains.
  it("selects every stale project, oldest refresh first", () => {
    const now = new Date("2026-09-19T12:00:00.000Z");
    const projects = [{ uuid: "recent" }, { uuid: "ancient" }, { uuid: "current" }];
    const recordsByUuid = new Map([["recent", { lastAttemptedAt: "2026-09-15T00:00:00.000Z" }],
      ["ancient", { lastAttemptedAt: "2026-09-01T00:00:00.000Z" }],
      ["current", { lastAttemptedAt: "2026-09-19T00:00:00.000Z" }]]);
    const { orderedProjects, regimeEm } = projectsToRefresh({ now, projects, recordsByUuid });
    expect(regimeEm).toBe("catchUp");
    expect(orderedProjects.map(project => project.uuid)).toEqual(["ancient", "recent"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc With nothing stale, the pass cycles: every project is offered in oldest-first order so the budget
  //   decides how far the load gets, and the oldest is always the one it starts from.
  it("cycles through every project once none are stale", () => {
    const now = new Date("2026-09-19T12:00:00.000Z");
    const projects = [{ uuid: "newer" }, { uuid: "older" }];
    const recordsByUuid = new Map([["newer", { lastAttemptedAt: "2026-09-19T06:00:00.000Z" }],
      ["older", { lastAttemptedAt: "2026-09-18T06:00:00.000Z" }]]);
    const { orderedProjects, regimeEm } = projectsToRefresh({ now, projects, recordsByUuid });
    expect(regimeEm).toBe("cycle");
    expect(orderedProjects.map(project => project.uuid)).toEqual(["older", "newer"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A cycling pass always refreshes one project, keeps going while its twenty seconds remain, and stops
  //   once they are spent. A catch-up pass is never stopped by the budget.
  it("spends its budget before stopping a cycling pass", () => {
    expect(shouldRefreshAnotherProject({ elapsedMilliseconds: 0, refreshedCount: 0, regimeEm: "cycle" })).toBe(true);
    expect(shouldRefreshAnotherProject({ elapsedMilliseconds: 8000, refreshedCount: 1, regimeEm: "cycle" })).toBe(true);
    expect(shouldRefreshAnotherProject({ elapsedMilliseconds: 21000, refreshedCount: 1, regimeEm: "cycle" })).toBe(false);
    expect(shouldRefreshAnotherProject({ elapsedMilliseconds: 99000, refreshedCount: 4, regimeEm: "catchUp" })).toBe(true);
  });
});

describe("background project task collection", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A first pass associates the project's open tasks, moves its completion into its own list, records
  //   the refresh timestamp, and stores the generated ideas.
  it("collects tasks, completions, and generated ideas on a first pass", async () => {
    const app = storeApp({ tasks: [
      { content: "Launch dashboard date picker", noteUUID: "source-note", uuid: "open-task" },
      { completedAt: 1789552800, content: "Launch dashboard polish", uuid: "finished-task" }] });
    const ideaGenerator = jest.fn().mockResolvedValue({ failureReason: null, foundTasks: [],
      suggestedTasks: [{ beforeTask: null, generatedAt: "2026-09-19T12:00:00.000Z", taskText: "Audit widget memory before ship" }] });
    const now = new Date("2026-09-19T12:00:00.000Z");
    const result = await collectProjectTasks(app, { domainName: scope.domainName, domainUuid: scope.domainUuid,
      ideaGenerator, now, quarterlyContent });
    expect(result).toMatchObject({ attempted: 1, failures: 0 });
    const stored = [...storedProjectRecords(app.noteContent).recordsByUuid.values()][0];
    expect(stored.lastAttemptedAt).toBe(now.toISOString());
    expect(stored.relatedTaskRecords).toEqual([{ taskText: "Launch dashboard date picker", taskUuid: "open-task" }]);
    expect(stored.completedTasks[0].taskUuid).toBe("finished-task");
    expect(stored.suggestedTasks[0].taskText).toBe("Audit widget memory before ship");
    expect(ideaGenerator).toHaveBeenCalledTimes(1);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A task the local name match never sees is associated when the provider attributes it, and the
  //   candidate pool it drew from is not persisted into the store note.
  it("associates tasks the provider attributes to the project", async () => {
    const app = storeApp({ tasks: [{ content: "Launch dashboard date picker", uuid: "open-task" },
      { content: "Rework the week grid header", uuid: "unmatched-task" }] });
    const ideaGenerator = jest.fn(async (_app, { project }) => {
      expect(project.candidateTaskRecords.map(task => task.taskUuid)).toContain("unmatched-task");
      return { failureReason: null, foundTasks: [{ taskText: "Rework the week grid header", taskUuid: "unmatched-task" }],
        suggestedTasks: [] };
    });
    await collectProjectTasks(app, { domainName: scope.domainName, domainUuid: scope.domainUuid, ideaGenerator,
      now: new Date("2026-09-19T12:00:00.000Z"), quarterlyContent });
    const stored = [...storedProjectRecords(app.noteContent).recordsByUuid.values()][0];
    expect(stored.relatedTaskRecords.map(task => task.taskUuid).sort()).toEqual(["open-task", "unmatched-task"]);
    expect(stored.relatedTasks).toContain("unmatched-task");
    expect(stored.candidateTaskRecords).toEqual([]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc With a Jev ranker, the tasks it accepts join the project before ideas are requested and the provider is
  //   offered no pool. Accepted tasks are remembered in the similarity hash rather than in relatedTasks.
  it("associates the tasks Jev accepts and leaves the provider only ideas to suggest", async () => {
    const app = storeApp({ tasks: [{ content: "Launch dashboard date picker", uuid: "open-task" },
      { content: "Rework the week grid header", uuid: "ranked-task" }, { content: "Tidy widget CSS", uuid: "lead-task" }] });
    const rankProject = jest.fn().mockResolvedValue({ acceptedTasks: [
      { matchScore: 8.2, taskText: "Rework the week grid header", taskUuid: "ranked-task" },
      { matchScore: 4.1, taskText: "Tidy widget CSS", taskUuid: "lead-task" }], failureReason: null, minimumMatchScore: 3,
      searchProgress: { similaritySearchPageCount: 1, similaritySearchedTaskCount: 2 },
      taskSimilarityScores: { "a1b2c3d4:ranked-task": 8.2 } });
    const rankerFactory = jest.fn().mockResolvedValue({ rankProject });
    const ideaGenerator = jest.fn(async (_app, { project }) => {
      expect(project.candidateTaskRecords).toEqual([]);
      expect(project.relatedTaskRecords.map(task => task.taskUuid)).toEqual(["open-task", "ranked-task", "lead-task"]);
      return { failureReason: null, foundTasks: [], suggestedTasks: [] };
    });
    const now = new Date("2026-09-19T12:00:00.000Z");
    await collectProjectTasks(app, { domainName: scope.domainName, domainUuid: scope.domainUuid, ideaGenerator, now,
      quarterlyContent, rankerFactory });
    expect(rankerFactory.mock.calls[0][1]).toMatchObject({ refineDictionary: true });
    expect(rankProject.mock.calls[0][1]).toEqual([{ taskText: "Launch dashboard date picker", taskUuid: "open-task" }]);
    const stored = [...storedProjectRecords(app.noteContent).recordsByUuid.values()][0];
    expect(stored.relatedTaskRecords.find(task => task.taskUuid === "ranked-task").matchScore).toBe(8.2);
    expect(stored.relatedTasks).not.toContain("ranked-task");
    expect(stored.relatedTasks).not.toContain("lead-task");
    expect(stored.lastRankedAt).toBe(now.toISOString());
    expect(stored).toMatchObject({ similaritySearchedTaskCount: 2, similaritySearchPageCount: 1,
      taskSimilarityScores: { "a1b2c3d4:ranked-task": 8.2 } });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc An older task edited after a project's ranking is pooled on the next pass, though its creation time predates
  //   the ranking. The project's watermark advances only with a complete ranking, so a ranking with missed batches
  //   leaves the edit to be pooled again.
  it("pools older tasks edited since the project's last complete ranking", async () => {
    const oldTask = { content: "Tidy the backlog", createdAt: 1, uuid: "old-task" };
    const app = storeApp({ tasks: [oldTask] });
    const ranking = { acceptedTasks: [], failureReason: null, minimumMatchScore: null, rankingIncomplete: false,
      searchProgress: null, taskSimilarityScores: {} };
    const rankProject = jest.fn().mockResolvedValue(ranking);
    const rankerFactory = jest.fn().mockResolvedValue({ rankProject, scorerEm: "jev" });
    const ideaGenerator = jest.fn().mockResolvedValue({ failureReason: null, foundTasks: [], suggestedTasks: [] });
    const options = { domainName: scope.domainName, domainUuid: scope.domainUuid, ideaGenerator, quarterlyContent,
      rankerFactory };
    const storedSimilarity = () => [...storedProjectRecords(app.noteContent).recordsByUuid.values()][0].refreshState.similarity;
    await collectProjectTasks(app, { ...options, now: new Date("2026-09-19T12:00:00.000Z") });
    expect(rankProject.mock.calls[0][2].changedTaskRecords).toEqual([]);
    const baseline = storedSimilarity();
    expect(baseline).toMatchObject({ succeededAt: "2026-09-19T12:00:00.000Z", watermark: { sequence: 1 } });
    expect(JSON.parse(app.snapshotContent.match(/```json\n([\s\S]*?)\n```/)[1]).snapshotId).toBe(baseline.watermark.snapshotId);

    const editedTask = { ...oldTask, content: "Rework the week grid header" };
    app.getTaskDomainTasks.mockResolvedValue([editedTask]);
    rankProject.mockResolvedValueOnce({ ...ranking, rankingIncomplete: true });
    await collectProjectTasks(app, { ...options, now: new Date("2026-09-20T12:00:00.000Z") });
    expect(rankProject.mock.calls[1][2].changedTaskRecords).toEqual([{ taskText: "Rework the week grid header",
      taskUuid: "old-task" }]);
    expect(storedSimilarity()).toEqual(baseline);

    await collectProjectTasks(app, { ...options, now: new Date("2026-09-21T12:00:00.000Z") });
    expect(rankProject.mock.calls[2][2].changedTaskRecords).toHaveLength(1);
    expect(storedSimilarity().watermark.sequence).toBe(2);
    await collectProjectTasks(app, { ...options, now: new Date("2026-09-22T12:00:00.000Z") });
    expect(rankProject.mock.calls[3][2].changedTaskRecords).toEqual([]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A ranking that fails outright hands attribution back to the provider, as though no Jev key were set.
  it("offers the provider its pool when Jev ranking fails", async () => {
    const app = storeApp({ tasks: [{ content: "Rework the week grid header", uuid: "unmatched-task" }] });
    const rankerFactory = jest.fn().mockResolvedValue({ rankProject: jest.fn().mockRejectedValue(new Error("CORS")) });
    const ideaGenerator = jest.fn(async (_app, { project }) => {
      expect(project.candidateTaskRecords.map(task => task.taskUuid)).toEqual(["unmatched-task"]);
      return { failureReason: null, foundTasks: [], suggestedTasks: [] };
    });
    const result = await collectProjectTasks(app, { domainName: scope.domainName, domainUuid: scope.domainUuid,
      ideaGenerator, now: new Date("2026-09-19T12:00:00.000Z"), quarterlyContent, rankerFactory });
    expect(result).toMatchObject({ attempted: 1, failures: 0 });
    expect(ideaGenerator).toHaveBeenCalledTimes(1);
    expect([...storedProjectRecords(app.noteContent).recordsByUuid.values()][0].lastRankedAt).toBeNull();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc An idea naming an earlier one in beforeTask replaces it where it stood, so the user judges one
  //   refined suggestion rather than two phrasings of it. An idea naming nothing is added alongside.
  it("replaces a superseded idea in place and appends a new one", async () => {
    const app = storeApp({ tasks: [] });
    const firstGenerator = jest.fn().mockResolvedValue({ failureReason: null, foundTasks: [],
      suggestedTasks: [{ beforeTask: null, generatedAt: "2026-09-19T12:00:00.000Z", taskText: "Audit widget memory" },
        { beforeTask: null, generatedAt: "2026-09-19T12:00:00.000Z", taskText: "Draft the release notes" }] });
    const options = { domainName: scope.domainName, domainUuid: scope.domainUuid, quarterlyContent };
    await collectProjectTasks(app, { ...options, ideaGenerator: firstGenerator, now: new Date("2026-09-19T12:00:00.000Z") });
    const secondGenerator = jest.fn().mockResolvedValue({ failureReason: null, foundTasks: [],
      suggestedTasks: [{ beforeTask: "Audit widget memory", generatedAt: "2026-09-23T12:00:00.000Z", taskText: "Audit widget memory and cap the cache" },
        { beforeTask: null, generatedAt: "2026-09-23T12:00:00.000Z", taskText: "Wire the date picker to the store" }] });
    await collectProjectTasks(app, { ...options, ideaGenerator: secondGenerator, now: new Date("2026-09-23T12:00:00.000Z") });
    const stored = [...storedProjectRecords(app.noteContent).recordsByUuid.values()][0];
    expect(stored.suggestedTasks.map(idea => idea.taskText)).toEqual(["Audit widget memory and cap the cache",
      "Draft the release notes", "Wire the date picker to the store"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A second load inside the three-day window still refreshes one project, because the cycling regime
  //   keeps the store moving rather than going idle whenever every project is current.
  it("refreshes the oldest project on a load with nothing stale", async () => {
    const app = storeApp({ tasks: [] });
    const ideaGenerator = jest.fn().mockResolvedValue({ failureReason: null, foundTasks: [], suggestedTasks: [] });
    const options = { domainName: scope.domainName, domainUuid: scope.domainUuid, ideaGenerator, quarterlyContent };
    await collectProjectTasks(app, { ...options, now: new Date("2026-09-19T12:00:00.000Z") });
    const second = await collectProjectTasks(app, { ...options, now: new Date("2026-09-19T14:00:00.000Z") });
    expect(second).toMatchObject({ attempted: 1, regimeEm: "cycle" });
    expect(ideaGenerator).toHaveBeenCalledTimes(2);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A cycling pass whose budget is already spent still refreshes its first project and then stops,
  //   which is what keeps one load from walking the whole quarter's projects.
  it("stops a cycling pass after one project once its budget is spent", async () => {
    const app = storeApp({ tasks: [] });
    const ideaGenerator = jest.fn().mockResolvedValue({ failureReason: null, foundTasks: [], suggestedTasks: [] });
    const twoProjectContent = `${ quarterlyContent }\n## Second project\n- Weekly rhythm: One block per week\n- Outcome: Ship it\n`;
    const options = { domainName: scope.domainName, domainUuid: scope.domainUuid, ideaGenerator,
      quarterlyContent: twoProjectContent };
    await collectProjectTasks(app, { ...options, now: new Date("2026-09-19T12:00:00.000Z") });
    ideaGenerator.mockClear();
    const cycling = await collectProjectTasks(app, { ...options, elapsedMilliseconds: () => 25000,
      now: new Date("2026-09-19T13:00:00.000Z") });
    expect(cycling).toMatchObject({ attempted: 1, regimeEm: "cycle" });
    expect(ideaGenerator).toHaveBeenCalledTimes(1);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc An unmounting dashboard stops the pass without leaving the store half-written for that project.
  it("stops between projects when the dashboard goes away", async () => {
    const app = storeApp({ tasks: [] });
    const ideaGenerator = jest.fn().mockResolvedValue({ failureReason: null, foundTasks: [], suggestedTasks: [] });
    const result = await collectProjectTasks(app, { domainName: scope.domainName, domainUuid: scope.domainUuid,
      ideaGenerator, now: new Date("2026-09-19T12:00:00.000Z"), quarterlyContent, shouldContinue: () => false });
    expect(result).toMatchObject({ attempted: 0 });
    expect(ideaGenerator).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Stored ideas reach the agenda prompt only for projects that actually hold them.
  it("renders collected ideas for the agenda prompt", () => {
    const records = [storedProject({ suggestedTasks: [{ generatedAt: "2026-09-19T12:00:00.000Z", taskText: "Audit widget memory" }] }),
      storedProject({ summary: "Empty project", uuid: "empty-uuid" })];
    const markdown = collectedIdeasMarkdown(records);
    expect(markdown).toContain("Launch dashboard (project:project-uuid)");
    expect(markdown).toContain("  - Audit widget memory");
    expect(markdown).not.toContain("Empty project");
    expect(collectedIdeasMarkdown([])).toBe("");
  });
});
