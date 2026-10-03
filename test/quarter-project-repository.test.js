// Exercise QuarterProjectRepository: detached reads, plan-versus-store authority, and field-level result commits.
import { jest } from "@jest/globals";
import { guideHeadingRanges } from "plan-wizard/vision-guide-markdown";
import { initialProjectTaskStoreMarkdown } from "project-task-store-markdown";
import QuarterProject from "quarter-project";
import QuarterProjectRepository from "quarter-project-repository";
import DashboardNoteWriter from "dashboard/work-queue/dashboard-note-writer";

const scope = { domainName: "Work", domainUuid: "work-domain", quarter: 3, quarterKey: "2026-Q3", year: 2026 };

// ----------------------------------------------------------------------------------------------
// @desc A store note holding the given projects under Active projects.
// @param {Array<QuarterProject>} projects - Projects to render.
// @returns {string} Store note markdown.
function storeContent(projects) {
  const sections = projects.map(project => `## ${ project.summary } (project:${ project.uuid })\n\n${ project.toStoreSection() }\n`);
  return initialProjectTaskStoreMarkdown().replace("# Past projects", `${ sections.join("") }# Past projects`);
}

// ----------------------------------------------------------------------------------------------
// @desc Mock the app bridge with one in-memory store note whose section writes are applied to its content.
// @param {object} [options] - { content = null }: null when the store does not exist yet.
// @returns {object} App mock carrying `noteContent` for assertions.
function storeApp({ content = null } = {}) {
  const state = { noteContent: content };
  const app = {
    context: { refreshNotesList: jest.fn().mockResolvedValue(true) },
    createNote: jest.fn(async () => { state.noteContent = ""; return "store-note"; }),
    findNote: jest.fn(async () => (state.noteContent === null ? null : { uuid: "store-note" })),
    getNoteContent: jest.fn(async () => state.noteContent ?? ""),
    replaceNoteContent: jest.fn(async (handle, body, options) => {
      if (!options?.section) { state.noteContent = body; return true; }
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

// ----------------------------------------------------------------------------------------------
// @desc A project as the store holds it, with overridable fields.
// @param {object} [overrides] - Fields to replace.
// @returns {QuarterProject} Project.
function storedProject(overrides = {}) {
  return new QuarterProject({ summary: "Launch dashboard", uuid: "project-uuid",
    relatedTaskRecords: [{ taskText: "Draft release notes", taskUuid: "open-task" }],
    taskSuggestions: [{ suggestedAt: "2026-09-01T12:00:00.000Z", taskUuid: "open-task" }], ...overrides });
}

// ----------------------------------------------------------------------------------------------
// @desc A Vision Guide holding one live work project with a chosen pace.
// @returns {object} Guide with workProspects.
function guideWithProject() {
  return { workProspects: { prospectTasks: [], prospects: [{ approvalStatusEm: "humanApproved", focusMonths: [],
    paceEm: "twoFocusedBlocks", preferredWeekdays: ["monday"], priorityEm: "quarterFocus", quarterKey: "2026-Q3",
    relatedTasks: [], summary: "Launch dashboard", uuid: "project-uuid" }] } };
}

describe("QuarterProjectRepository reads", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Each read parses the note afresh, after refreshing the notes list, so one caller's edits never reach another.
  it("hands every reader its own instances after refreshing the notes list", async () => {
    const app = storeApp({ content: storeContent([storedProject()]) });
    const repository = new QuarterProjectRepository({ app, noteWriter: new DashboardNoteWriter({ app }) });
    const [first] = await repository.readStored(scope);
    first.relatedTaskRecords.push({ taskText: "Edited in memory", taskUuid: "other-task" });
    const [second] = await repository.readStored(scope);
    expect(second.relatedTaskRecords.map(task => task.taskUuid)).toEqual(["open-task"]);
    expect(app.context.refreshNotesList).toHaveBeenCalledTimes(1);
    expect(app.context.refreshNotesList.mock.invocationCallOrder[0]).toBeLessThan(
      app.getNoteContent.mock.invocationCallOrder[0]);
    await expect(repository.readOne(scope, "project-uuid")).resolves.toMatchObject({ summary: "Launch dashboard" });
    await expect(repository.readOne(scope, "missing-uuid")).resolves.toBeNull();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Live projects take their pace from the guide and their task evidence from the store, sharing no collection
  //   with the stored projects returned beside them.
  it("joins live projects to the store without sharing collections", async () => {
    const app = storeApp({ content: storeContent([storedProject({ blocksPerWeek: 5 })]) });
    const repository = new QuarterProjectRepository({ app, noteWriter: new DashboardNoteWriter({ app }) });
    const { projects, storedProjects } = await repository.readMany(scope, { guide: guideWithProject() });
    expect(projects[0]).toMatchObject({ blocksPerWeek: 2, paceEm: "twoFocusedBlocks", uuid: "project-uuid" });
    expect(projects[0].taskSuggestions).toEqual(storedProjects[0].taskSuggestions);
    expect(projects[0].taskSuggestions).not.toBe(storedProjects[0].taskSuggestions);
    expect(projects[0].relatedTaskRecords).not.toBe(storedProjects[0].relatedTaskRecords);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Two requests planning different dates each set day evidence on their own copy, leaving the original as read.
  it("keeps day evidence for different dates on separate copies", () => {
    const original = storedProject({ blocksPerWeek: 1,
      completedTasks: [{ completedAt: "2026-09-15T12:00:00.000Z", taskUuid: "done-task" }] });
    const monday = original.detachedCopy();
    const nextMonday = original.detachedCopy();
    monday.setProgressEvidence(new Date(2026, 8, 15));
    nextMonday.setProgressEvidence(new Date(2026, 8, 22));
    expect(monday.due).toBe(false);
    expect(nextMonday.due).toBe(true);
    expect(original.due).toBeNull();
    expect(monday.completedTasks).not.toBe(original.completedTasks);
  });
});

describe("QuarterProjectRepository results", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Two passes started from the same snapshot each change one field; both changes survive, because each result
  //   is applied to the project as the store holds it when written rather than to the snapshot.
  it("keeps both of two overlapping results that change different fields", async () => {
    const app = storeApp({ content: storeContent([storedProject()]) });
    const repository = new QuarterProjectRepository({ app, noteWriter: new DashboardNoteWriter({ app }) });
    const scores = { "abc123:open-task": 8 };
    await Promise.all([
      repository.applyResult(scope, { apply: project => project.setSimilarityScores(scores), projectUuid: "project-uuid" }),
      repository.recordShownTasks(scope, { shownAt: "2026-09-20T12:00:00.000Z",
        suggestions: [{ projectUuid: "project-uuid", summary: "Launch dashboard", taskUuid: "open-task" }] }),
    ]);
    const stored = await repository.readOne(scope, "project-uuid");
    expect(stored.taskSimilarityScores).toEqual(scores);
    expect(stored.taskSuggestions.map(entry => entry.suggestedAt)).toEqual(["2026-09-01T12:00:00.000Z",
      "2026-09-20T12:00:00.000Z"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A pass holding a live project writes that project's plan fields, but the store-owned fields come from the
  //   store as it stands, so the suggestion log another pass appended is not rolled back to the pass's snapshot.
  it("writes a source project's plan fields over the store's latest store-owned fields", async () => {
    const app = storeApp({ content: storeContent([storedProject()]) });
    const repository = new QuarterProjectRepository({ app, noteWriter: new DashboardNoteWriter({ app }) });
    const { projects } = await repository.readMany(scope, { guide: guideWithProject() });
    await repository.recordShownTasks(scope, { shownAt: "2026-09-20T12:00:00.000Z",
      suggestions: [{ projectUuid: "project-uuid", taskUuid: "open-task" }] });
    const written = await repository.applyResult(scope, { apply: project => project.setAttemptedAt("2026-09-21T00:00:00.000Z"),
      sourceProject: projects[0] });
    const stored = await repository.readOne(scope, "project-uuid");
    expect(stored).toMatchObject({ blocksPerWeek: 2, lastAttemptedAt: "2026-09-21T00:00:00.000Z" });
    expect(stored.taskSuggestions).toHaveLength(2);
    expect(written).not.toBe(projects[0]);
    expect(projects[0].lastAttemptedAt).toBeNull();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A result that fails while being applied writes nothing, and the next result to the note still lands.
  it("leaves the store untouched when a result fails, without blocking the next", async () => {
    const app = storeApp({ content: storeContent([storedProject()]) });
    const repository = new QuarterProjectRepository({ app, noteWriter: new DashboardNoteWriter({ app }) });
    const before = app.noteContent;
    const failed = repository.applyResult(scope, { apply: () => { throw new Error("invalid result"); },
      projectUuid: "project-uuid" });
    const next = repository.applyResult(scope, { apply: project => project.setAttemptedAt("2026-09-21T00:00:00.000Z"),
      projectUuid: "project-uuid" });
    await expect(failed).rejects.toThrow("invalid result");
    expect(app.noteContent).toBe(before);
    await next;
    expect(app.replaceNoteContent).toHaveBeenCalledTimes(1);
    expect(app.noteContent).not.toBe(before);
    await expect(repository.readOne(scope, "project-uuid")).resolves.toMatchObject({
      lastAttemptedAt: "2026-09-21T00:00:00.000Z" });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Retiring a project moves it beneath Past projects, where readers see it inactive; a live source project
  //   moves it back.
  it("retires a project into Past projects and restores it from the live plan", async () => {
    const app = storeApp({ content: storeContent([storedProject()]) });
    const repository = new QuarterProjectRepository({ app, noteWriter: new DashboardNoteWriter({ app }) });
    await repository.applyResult(scope, { apply: project => project.setActive(false), projectUuid: "project-uuid" });
    await expect(repository.readStored(scope)).resolves.toEqual([]);
    await expect(repository.readOne(scope, "project-uuid")).resolves.toMatchObject({ isActive: false,
      taskSuggestions: storedProject().taskSuggestions });
    const { projects } = await repository.readMany(scope, { guide: guideWithProject() });
    await repository.applyResult(scope, { apply: project => project.setActive(true), sourceProject: projects[0] });
    await expect(repository.readOne(scope, "project-uuid")).resolves.toMatchObject({ blocksPerWeek: 2, isActive: true });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A project the store has never held is created, along with the store itself, from its summary and UUID.
  it("creates the store and a new project's section", async () => {
    const app = storeApp();
    const repository = new QuarterProjectRepository({ app, noteWriter: new DashboardNoteWriter({ app }) });
    await repository.recordShownTasks(scope, { shownAt: "2026-09-20T12:00:00.000Z",
      suggestions: [{ projectUuid: "new-project", summary: "Write the handbook", taskUuid: "task-1" },
        { projectUuid: "new-project", taskUuid: "task-2" }] });
    const stored = await repository.readOne(scope, "new-project");
    expect(app.createNote).toHaveBeenCalledTimes(1);
    expect(stored.summary).toBe("Write the handbook");
    expect(stored.taskSuggestions.map(entry => entry.taskUuid)).toEqual(["task-1", "task-2"]);
  });
});
