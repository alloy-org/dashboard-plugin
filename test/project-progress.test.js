// Verify quarterly identity persistence, completion evidence, and guaranteed due-project suggestions.
import { jest } from "@jest/globals";
import { GUIDE_SCHEMA_VERSION } from "plan-wizard/plan-models";
import { initialVisionGuideMarkdown } from "plan-wizard/vision-guide-markdown";
import { readVisionGuide } from "plan-wizard/vision-guide-repository";
import { ensureDueProjectSuggestions } from "project-agenda-suggestions";
import { projectMatchesTask, projectProgressEvidence, projectWithTaskEvidence, quarterlyProgressProjects } from "project-progress-model";
import { loadProjectProgress } from "project-progress-service";

const targetDate = new Date(2026, 8, 18);
const scope = { domainName: "Work", domainUuid: "work-domain", quarter: 3, quarterKey: "2026-Q3", year: 2026 };
const quarterlyContent = "# Projects\n\n## Launch dashboard\n- Weekly rhythm: Two focused blocks per week\n- Outcome: Ship the date picker\n";

// ----------------------------------------------------------------------------------------------
// @desc Build a hand-authored project with its persisted UUID and optionally overridden evidence.
// @param {object} overrides - Fields to replace on the sample project.
// @returns {object} Project record.
function projectRecord(overrides = {}) {
  return { blocksPerWeek: 2, completedTasks: [], relatedTasks: ["source-task"], summary: "Launch dashboard",
    uuid: "project-uuid", ...overrides };
}

describe("quarterly project evidence", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Re-reading a hand-authored plan preserves its identity and derives a stated weekly target.
  it("keeps project UUIDs stable across refreshes", () => {
    const first = quarterlyProgressProjects({ guide: null, previousProjects: [], quarterlyContent, scope });
    const second = quarterlyProgressProjects({ guide: null, previousProjects: first, quarterlyContent, scope });
    expect(second[0].uuid).toBe(first[0].uuid);
    expect(second[0].blocksPerWeek).toBe(2);
    expect(second[0].nextAction).toContain("Ship the date picker");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Explicit Plan Builder decisions carry their UUID, pace, and task links into agenda evidence.
  it("reuses selected Builder projects and excludes retired or other-quarter projects", () => {
    const selected = { approvalStatusEm: "humanAffirmed", paceEm: "twoFocusedBlocks", priorityEm: "quarterFocus",
      quarterKey: scope.quarterKey, relatedTasks: ["source-task"], summary: "Launch dashboard", uuid: "builder-project" };
    const guide = { workProspects: { prospectTasks: [], prospects: [selected,
      { ...selected, approvalStatusEm: "humanRetired", summary: "Retired", uuid: "retired" },
      { ...selected, quarterKey: "2026-Q4", summary: "Next quarter", uuid: "next-quarter" }] } };
    const projects = quarterlyProgressProjects({ guide, previousProjects: [], quarterlyContent, scope });
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({ blocksPerWeek: 2, relatedTasks: ["source-task"], uuid: "builder-project" });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A linked task counts once even when both its source and dated agenda checkbox were completed.
  it("counts actual completions once and excludes future completions", () => {
    const project = projectRecord({ completedTasks: [
      { completedAt: "2026-09-16T12:00:00Z", taskUuid: "source-task" },
      { completedAt: "2026-09-16T14:00:00Z", sourceTaskUuid: "source-task", taskUuid: "agenda-task" },
      { completedAt: "2026-09-22T12:00:00Z", taskUuid: "future-task" }] });
    expect(projectProgressEvidence(project, targetDate)).toMatchObject({ completedPastWeek: 1, completedThisWeek: 1, due: true });
    expect(projectProgressEvidence(project, targetDate).reason).toContain("2 blocks per week");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Dismissal and reopening are not progress, while older observations remain available for later dates.
  it("removes reopened evidence and retains unobserved completions", () => {
    const project = projectRecord({ completedTasks: [{ completedAt: "2026-09-16T12:00:00Z", taskUuid: "source-task" },
      { completedAt: "2026-08-01T12:00:00Z", taskUuid: "old-task" }] });
    const updated = projectWithTaskEvidence(project, [{ uuid: "source-task" },
      { completedAt: 1789740000, content: "Launch dashboard", dismissedAt: 1789740000, uuid: "dismissed-task" }]);
    expect(updated.completedTasks).toEqual([{ completedAt: "2026-08-01T12:00:00Z", taskUuid: "old-task" }]);
    expect(projectMatchesTask(project, { content: "Unrelated work", uuid: "unrelated" })).toBe(false);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Historical completions and future-month allocations never create false overdue claims.
  it("marks a neglected project due but respects focus months", () => {
    expect(projectProgressEvidence(projectRecord(), targetDate).due).toBe(true);
    expect(projectProgressEvidence(projectRecord({ focusMonths: ["2026-10"] }), targetDate).due).toBe(false);
  });
});

describe("project suggestion fallback", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc An empty model reply cannot omit a project with no completed action in the past week.
  it("adds a real project task in a free slot with the recorded pace reason", () => {
    const project = { ...projectRecord(), ...projectProgressEvidence(projectRecord(), targetDate) };
    const result = ensureDueProjectSuggestions([], { nowMinutes: null,
      obligations: [{ durationMinutes: 120, startMinutes: 540 }], projects: [project], targetDate,
      tasks: [{ taskText: "Build the picker", taskUuid: "source-task" }] });
    expect(result.activities[0]).toMatchObject({ projectUuid: "project-uuid", startTime: "11:00", taskUuid: "source-task" });
    expect(result.activities[0].reason).toContain("0 related task(s)");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A completely occupied day yields an untimed action rather than an overlapping calendar proposal.
  it("keeps full-day project suggestions untimed", () => {
    const project = { ...projectRecord(), due: true, reason: "No completed task this week" };
    const result = ensureDueProjectSuggestions([], { nowMinutes: null,
      obligations: [{ durationMinutes: 540, startMinutes: 540 }], projects: [project], targetDate, tasks: [] });
    expect(result.activities).toEqual([]);
    expect(result.unscheduledProjects[0].projectUuid).toBe(project.uuid);
  });
});

describe("project progress note", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Optional agenda progress skips retired and future guides, while strict readers still reject them and no notes are rewritten.
  it.each([1, GUIDE_SCHEMA_VERSION + 1])("skips schema %s without modifying guide or progress records", async schemaVersion => {
    const note = { name: "Work Mission Builder Vision Guide 2026", uuid: "guide-note" };
    const content = initialVisionGuideMarkdown(scope).replace(`"schemaVersion": ${ GUIDE_SCHEMA_VERSION }`, `"schemaVersion": ${ schemaVersion }`);
    const app = { createNote: jest.fn(), filterNotes: jest.fn().mockResolvedValue([note]), findNote: jest.fn().mockResolvedValue(note),
      getNoteContent: jest.fn().mockResolvedValue(content), replaceNoteContent: jest.fn() };
    await expect(loadProjectProgress(app, { domainName: scope.domainName, domainUuid: scope.domainUuid, quarterlyContent, targetDate }))
      .resolves.toEqual({ candidates: [], markdown: "", projects: [] });
    await expect(readVisionGuide(app, scope)).rejects.toMatchObject({ code: "VISION_GUIDE_UNSUPPORTED_SCHEMA" });
    expect(app.findNote.mock.calls.every(([query]) => query.uuid === note.uuid)).toBe(true);
    expect(app.createNote).not.toHaveBeenCalled();
    expect(app.replaceNoteContent).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Bridge failures remain visible instead of silently disabling project evidence.
  it("propagates lookup failures unrelated to schema compatibility", async () => {
    const app = { filterNotes: jest.fn().mockRejectedValue(new Error("Connection failed")) };
    await expect(loadProjectProgress(app, { domainName: scope.domainName, domainUuid: scope.domainUuid, quarterlyContent, targetDate }))
      .rejects.toThrow("Connection failed");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Initial generation records a quarter's real completion evidence and stable source task references.
  it("creates the quarter-scoped note with persisted UUIDs and completion timestamps", async () => {
    const app = { createNote: jest.fn().mockResolvedValue("progress-note"), filterNotes: jest.fn().mockResolvedValue([]),
      findNote: jest.fn().mockResolvedValue(null), getCompletedTasks: jest.fn().mockResolvedValue([
        { completedAt: 1789552800, content: "Launch dashboard", uuid: "finished-task" }]),
      getTaskDomainTasks: jest.fn().mockResolvedValue([{ content: "Launch dashboard date picker", noteUUID: "source-note", uuid: "open-task" }]),
      replaceNoteContent: jest.fn().mockResolvedValue(undefined) };
    const result = await loadProjectProgress(app, { domainName: scope.domainName, domainUuid: scope.domainUuid, quarterlyContent, targetDate });
    expect(app.createNote.mock.calls[0][0]).toBe("Project Builder Q3 2026 Work Progress");
    const markdown = app.replaceNoteContent.mock.calls[0][1];
    expect(markdown).toContain(result.projects[0].uuid);
    expect(markdown).toContain('"completedAt"');
    expect(result.projects[0].relatedTasks).toEqual(["finished-task", "open-task"]);
    expect(app.getCompletedTasks.mock.calls[0][2]).toEqual({ taskDomainUUID: "work-domain" });
  });
});
