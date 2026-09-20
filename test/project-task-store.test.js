// Verify the per-project sections of the quarterly task store round-trip, are written one project at a time,
// and that a background pass associates tasks, moves completions, and respects its staleness window.
import { jest } from "@jest/globals";
import { guideHeadingRanges } from "plan-wizard/vision-guide-markdown";
import { collectProjectTasks, projectNeedsAttempt } from "project-task-collection";
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

describe("background project task collection", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A project attempted inside the staleness window is left alone; one never attempted is always due.
  it("treats only aged-out and unattempted projects as due", () => {
    const now = new Date("2026-09-19T12:00:00.000Z");
    expect(projectNeedsAttempt(undefined, now)).toBe(true);
    expect(projectNeedsAttempt({ lastAttemptedAt: "2026-09-19T06:00:00.000Z" }, now)).toBe(false);
    expect(projectNeedsAttempt({ lastAttemptedAt: "2026-09-17T06:00:00.000Z" }, now)).toBe(true);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A first pass associates the project's open tasks, moves its completion into its own list, records
  //   the attempt timestamp, and stores the generated ideas.
  it("collects tasks, completions, and generated ideas on a first pass", async () => {
    const app = storeApp({ tasks: [
      { content: "Launch dashboard date picker", noteUUID: "source-note", uuid: "open-task" },
      { completedAt: 1789552800, content: "Launch dashboard polish", uuid: "finished-task" }] });
    const ideaGenerator = jest.fn().mockResolvedValue({ failureReason: null,
      suggestedTasks: [{ generatedAt: "2026-09-19T12:00:00.000Z", taskText: "Audit widget memory before ship" }] });
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
  // @desc A second pass within the staleness window spends no provider call and rewrites nothing.
  it("skips projects refreshed inside the staleness window", async () => {
    const app = storeApp({ tasks: [{ content: "Launch dashboard date picker", uuid: "open-task" }] });
    const ideaGenerator = jest.fn().mockResolvedValue({ failureReason: null,
      suggestedTasks: [{ generatedAt: "2026-09-19T12:00:00.000Z", taskText: "Audit widget memory before ship" }] });
    const options = { domainName: scope.domainName, domainUuid: scope.domainUuid, ideaGenerator, quarterlyContent };
    await collectProjectTasks(app, { ...options, now: new Date("2026-09-19T12:00:00.000Z") });
    const writeCount = app.replaceNoteContent.mock.calls.length;
    const second = await collectProjectTasks(app, { ...options, now: new Date("2026-09-19T14:00:00.000Z") });
    expect(second).toMatchObject({ attempted: 0, skipped: 1 });
    expect(ideaGenerator).toHaveBeenCalledTimes(1);
    expect(app.replaceNoteContent.mock.calls.length).toBe(writeCount);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc An unmounting dashboard stops the pass without leaving the store half-written for that project.
  it("stops between projects when the dashboard goes away", async () => {
    const app = storeApp({ tasks: [] });
    const ideaGenerator = jest.fn().mockResolvedValue({ failureReason: null, suggestedTasks: [] });
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
