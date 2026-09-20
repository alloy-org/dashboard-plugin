// Verify the per-project sections of the quarterly task store round-trip, are written one project at a time, and
// that a background pass associates tasks, folds in provider-found tasks and superseded ideas, and picks its
// projects by the staleness window first and the cycling time budget after.
import { jest } from "@jest/globals";
import { guideHeadingRanges } from "plan-wizard/vision-guide-markdown";
import { collectProjectTasks } from "project-task-collection";
import { projectNeedsRefresh, projectsToRefresh, shouldRefreshAnotherProject } from "project-refresh-schedule";
import { initialProjectTaskStoreMarkdown, projectSectionMarkdown } from "project-task-store-markdown";
import { collectedIdeasMarkdown, openProjectTaskStore, readCollectedProjectTasks, storedProjectRecords,
  writeProjectSection } from "project-task-store";

const scope = { domainName: "Work", domainUuid: "work-domain", quarter: 3, quarterKey: "2026-Q3", year: 2026 };
const quarterlyContent = "# Projects\n\n## Launch dashboard\n- Weekly rhythm: Two focused blocks per week\n- Outcome: Ship the date picker\n";

// ----------------------------------------------------------------------------------------------
// @desc Build a store-shaped project record with overridable lists.
// @param {object} overrides - Fields to replace.
// @returns {object} Project record.
function storeRecord(overrides = {}) {
  return { completedTasks: [], lastAttemptedAt: "2026-09-18T12:00:00.000Z", relatedTaskRecords: [],
    relatedTasks: [], suggestedTasks: [], summary: "Launch dashboard", uuid: "project-uuid", ...overrides };
}

// ----------------------------------------------------------------------------------------------
// @desc Mock the app bridge with an in-memory note whose section writes are applied to the stored content,
//   modelling that replaceNoteContent takes a bare { uuid } and a { section } option.
// @param {object} options - { content, tasks }.
// @returns {object} App mock carrying `noteContent` for assertions.
function storeApp({ content = null, tasks = [] } = {}) {
  const state = { noteContent: content };
  const app = {
    createNote: jest.fn().mockResolvedValue("store-note"),
    filterNotes: jest.fn().mockResolvedValue([]),
    findNote: jest.fn(async () => (state.noteContent === null ? null : { uuid: "store-note" })),
    getNoteContent: jest.fn(async () => state.noteContent ?? ""),
    getTaskDomainTasks: jest.fn().mockResolvedValue(tasks),
    replaceNoteContent: jest.fn(async (handle, body, options) => {
      if (typeof handle?.uuid !== "string") throw new Error("Write received a non-uuid handle");
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
  return app;
}

describe("project task store sections", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A rendered project section parses back into the record it was written from.
  it("round-trips a project record through its rendered section", () => {
    const record = storeRecord({ completedTasks: [{ completedAt: "2026-09-14T10:00:00.000Z", taskUuid: "done-task" }],
      relatedTaskRecords: [{ taskText: "Draft release notes", taskUuid: "open-task" }],
      suggestedTasks: [{ generatedAt: "2026-09-18T12:00:00.000Z", taskText: "Audit widget memory" }] });
    const content = initialProjectTaskStoreMarkdown().replace("# Past projects",
      `## ${ record.summary } (project:${ record.uuid })\n\n${ projectSectionMarkdown(record) }\n# Past projects`);
    const { recordsByUuid, unreadableHeadings } = storedProjectRecords(content);
    expect(unreadableHeadings).toEqual([]);
    expect(recordsByUuid.get("project-uuid")).toMatchObject({ isActive: true, summary: "Launch dashboard" });
    expect(recordsByUuid.get("project-uuid").suggestedTasks[0].taskText).toBe("Audit widget memory");
    expect(recordsByUuid.get("project-uuid").completedTasks[0].taskUuid).toBe("done-task");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The human-readable lists render beside the payload, so the note is readable without parsing JSON.
  it("renders the three task lists above the payload", () => {
    const body = projectSectionMarkdown(storeRecord({
      completedTasks: [{ completedAt: "2026-09-14T10:00:00.000Z", taskUuid: "done-task" }],
      relatedTaskRecords: [{ taskText: "Draft release notes", taskUuid: "open-task" }] }));
    expect(body).toContain("- Last attempted: 2026-09-18T12:00:00.000Z");
    expect(body).toContain("Draft release notes");
    expect(body).toContain("- Suggested tasks\n  - (none yet)");
    expect(body).toContain("done-task");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Writing one project leaves every other project's section untouched, which is what makes a
  //   progressive pass safe to interrupt.
  it("adds and then replaces a single project section in place", async () => {
    const app = storeApp({ content: initialProjectTaskStoreMarkdown() });
    const store = await openProjectTaskStore(app, scope);
    let content = await writeProjectSection(app, { content: store.content, noteHandle: store.noteHandle,
      project: storeRecord() });
    content = await writeProjectSection(app, { content, noteHandle: store.noteHandle,
      project: storeRecord({ summary: "Second project", uuid: "second-uuid" }) });
    const updated = await writeProjectSection(app, { content, noteHandle: store.noteHandle,
      project: storeRecord({ suggestedTasks: [{ generatedAt: "2026-09-19T00:00:00.000Z", taskText: "New idea" }] }) });
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
    const content = await writeProjectSection(app, { content: store.content, isActive: false,
      noteHandle: store.noteHandle, project: storeRecord() });
    expect(storedProjectRecords(content).recordsByUuid.get("project-uuid").isActive).toBe(false);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The fast read path reports nothing rather than creating a note when no pass has run yet.
  it("reads an absent store as empty without creating it", async () => {
    const app = storeApp();
    await expect(readCollectedProjectTasks(app, scope)).resolves.toEqual([]);
    expect(app.createNote).not.toHaveBeenCalled();
    expect(app.replaceNoteContent).not.toHaveBeenCalled();
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
    expect(stored.candidateTaskRecords).toBeUndefined();
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
    const records = [storeRecord({ suggestedTasks: [{ generatedAt: "2026-09-19T12:00:00.000Z", taskText: "Audit widget memory" }] }),
      storeRecord({ summary: "Empty project", uuid: "empty-uuid" })];
    const markdown = collectedIdeasMarkdown(records);
    expect(markdown).toContain("Launch dashboard (project:project-uuid)");
    expect(markdown).toContain("  - Audit widget memory");
    expect(markdown).not.toContain("Empty project");
    expect(collectedIdeasMarkdown([])).toBe("");
  });
});
