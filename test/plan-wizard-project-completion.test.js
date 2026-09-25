// Verify that marking a project Complete is stored in the Vision Guide, designated in the quarterly plan note, and
// honored by every suggestion surface that reads either one: the agenda's project progress and the plan content
// that Proposed Agenda and Dream Task send to the model. Also covers the projects page's Status control and the
// rule that lets a well-stocked plan skip project discovery.

import { jest } from "@jest/globals";
import { createPlanWizardApp } from "./fixtures/plan-wizard-app.js";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

const confettiMock = jest.fn();
await jest.unstable_mockModule("canvas-confetti", () => ({ default: confettiMock }));

const { defaultQuarterlyTemplate } = await import("constants/quarters");
const { default: ProjectCard } = await import("dashboard/plan-wizard/project-card");
const { completionRecordFromRow, draftRowsFromProspects, hasEnoughPacedProjects, priorityRecordFromRow } =
  await import("dashboard/plan-wizard/projects-step-fields");
const { draftPacesFromProspects } = await import("dashboard/plan-wizard/pace-cards-step-fields");
const { resolvePlanScope } = await import("plan-wizard/plan-models");
const { readPlanGoals, savePlanProspects } = await import("plan-wizard/plan-wizard-service");
const { COMPLETE_MARKER, contentWithoutCompletedProjects, isCompleteMarkedText } =
  await import("plan-wizard/quarterly-plan-markdown");
const { quarterlyPlanPublication } = await import("plan-wizard/quarterly-plan-publication");
const { publishQuarterlyPlan } = await import("plan-wizard/quarterly-plan-publisher");
const { quarterlyProgressProjects } = await import("project-progress-model");

const scope = resolvePlanScope({ domainName: "Work", domainUuid: "domain-work", quarter: 4, year: 2026 });
const planNoteName = "Q4 2026 Work Plan";

// ----------------------------------------------------------------------------------------------
// @desc Build a project record shaped for savePlanProspects.
// @param {object} fields - Overrides applied over a focused work project the user provided themselves.
// @returns {object} Prospect record.
function prospectRecord(fields) {
  return { approvalStatusEm: "humanProvided", capturedAt: "2026-09-11T10:00:00Z", focusMonths: ["2026-11"],
    paceEm: "twoFocusedBlocks", preferredWeekdays: ["tuesday"], priorityEm: "quarterFocus",
    substantiations: ["Named by you while planning this quarter."], userCategoryEm: "work", ...fields };
}

// ----------------------------------------------------------------------------------------------
// @desc Seed an app holding the scope's quarterly plan note, created from the standard template.
// @returns {object} { app, planNoteContent } where planNoteContent reads the note's current markdown.
function appWithPlanNote() {
  const app = createPlanWizardApp();
  app.notes.push({ archived: false, content: defaultQuarterlyTemplate("Q4 2026", 4), localUuid: "local-plan",
    name: planNoteName, tags: ["plugins/dashboard", "planning/quarterly"], uuid: "plan-note" });
  return { app, planNoteContent: () => app.notes.find(note => note.uuid === "plan-note").content };
}

describe("completing a project in the Vision Guide", () => {
  it("stores completedAt, keeps it through a later priority save, and clears it when reopened", async () => {
    const app = createPlanWizardApp();
    await savePlanProspects(app, { ...scope, prospects: [prospectRecord({ summary: "Ship diff-view v2", uuid: "ship" })] });
    const [row] = draftRowsFromProspects((await readPlanGoals(app, scope)).prospects);
    expect(row.completedAt).toBeNull();

    await savePlanProspects(app, { ...scope, prospects: [completionRecordFromRow(row, "2026-09-20T15:00:00Z",
      "2026-09-20T15:00:00Z")] });
    let stored = (await readPlanGoals(app, scope)).prospects[0];
    expect(stored.completedAt).toBe("2026-09-20T15:00:00.000Z");
    expect(stored.priorityEm).toBe("quarterFocus");

    await savePlanProspects(app, { ...scope, prospects: [priorityRecordFromRow(row, "stayWarm", "2026-09-21T15:00:00Z")] });
    stored = (await readPlanGoals(app, scope)).prospects[0];
    expect(stored).toMatchObject({ completedAt: "2026-09-20T15:00:00.000Z", priorityEm: "stayWarm" });

    await savePlanProspects(app, { ...scope, prospects: [completionRecordFromRow(row, null, "2026-09-22T15:00:00Z")] });
    stored = (await readPlanGoals(app, scope)).prospects[0];
    expect(stored.completedAt).toBeNull();
  });

  it("drops a completed project from the pace page", () => {
    const prospects = [prospectRecord({ summary: "Live", uuid: "live" }),
      prospectRecord({ completedAt: "2026-09-20T15:00:00Z", summary: "Finished", uuid: "finished" })];
    expect(draftPacesFromProspects(prospects).map(draft => draft.uuid)).toEqual(["live"]);
  });
});

describe("designating a completed project in the quarterly plan note", () => {
  const prospects = [prospectRecord({ summary: "Ship diff-view v2", uuid: "ship" }),
    prospectRecord({ completedAt: "2026-09-20T15:00:00Z", priorityEm: "notNow", summary: "Close one large customer",
      uuid: "close" })];

  it("publishes a completed project apart from the live ones and out of Not This Quarter", () => {
    const publication = quarterlyPlanPublication({ prospects }, scope);
    expect(publication.projects.map(project => project.summary)).toEqual(["Ship diff-view v2"]);
    expect(publication.completedProjects.map(project => project.summary)).toEqual(["Close one large customer"]);
    expect(publication.notThisQuarter).toEqual([]);
  });

  it("marks the block Complete, keeps it off the weekday and month lines, and strips it for suggestion prompts", async () => {
    const { app, planNoteContent } = appWithPlanNote();
    await publishQuarterlyPlan(app, { ...scope, planningContext: { prospects } });
    const content = planNoteContent();
    expect(content).toContain(`## Close one large customer ${ COMPLETE_MARKER }\n- Status: Completed 2026-09-20`);
    expect(content).toMatch(/- Tuesdays:.*Ship diff-view v2/);
    expect(content).not.toMatch(/- Tuesdays:.*Close one large customer/);
    expect(content).not.toMatch(/- Focus:.*Close one large customer/);

    const promptContent = contentWithoutCompletedProjects(content);
    expect(promptContent).toContain("## Ship diff-view v2");
    expect(promptContent).not.toContain("Close one large customer");
    expect(contentWithoutCompletedProjects(promptContent)).toBe(promptContent);
  });

  it("recognizes the marker after Amplenote escapes its brackets", () => {
    expect(isCompleteMarkedText("Close one large customer \\[builder: complete\\]")).toBe(true);
    expect(isCompleteMarkedText("Ship diff-view v2 [builder]")).toBe(false);
  });
});

describe("agenda project progress", () => {
  it("excludes a project marked Complete, whether read from the guide or from the plan note heading", () => {
    const quarterKey = scope.quarterKey;
    const live = { ...prospectRecord({ summary: "Ship diff-view v2", uuid: "ship" }), quarterKey, relatedTasks: [] };
    const finished = { ...live, completedAt: "2026-09-20T15:00:00Z", summary: "Close one large customer", uuid: "close" };
    const guide = { workProspects: { prospectTasks: [], prospects: [live, finished] } };
    const quarterlyContent = `# Projects\n\n## Close one large customer ${ COMPLETE_MARKER }\n- Status: Completed 2026-09-20\n\n`
      + "## Hand-written finished work [builder: complete]\n- Weekly rhythm: Two focused blocks per week\n";
    const projects = quarterlyProgressProjects({ guide, previousProjects: [], quarterlyContent, scope });
    expect(projects.map(project => project.uuid)).toEqual(["ship"]);
  });
});

describe("skipping discovery for a well-stocked plan", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Build count paced prospects in one category.
  // @param {string} userCategoryEm - work or personal.
  // @param {number} count - How many to build.
  // @param {object} fields - Overrides applied to each.
  // @returns {Array<object>} Prospect records.
  function pacedProspects(userCategoryEm, count, fields = {}) {
    const indexes = Array.from({ length: count }, (unused, index) => index);
    return indexes.map(index => prospectRecord({ summary: `${ userCategoryEm } ${ index }`, userCategoryEm,
      uuid: `${ userCategoryEm }-${ index }`, ...fields }));
  }

  it("skips at seven paced professional or three paced personal projects", () => {
    expect(hasEnoughPacedProjects(pacedProspects("work", 6))).toBe(false);
    expect(hasEnoughPacedProjects(pacedProspects("work", 7))).toBe(true);
    expect(hasEnoughPacedProjects(pacedProspects("personal", 2))).toBe(false);
    expect(hasEnoughPacedProjects(pacedProspects("personal", 3))).toBe(true);
  });

  it("does not count projects without a pace, declined, or completed", () => {
    const prospects = [...pacedProspects("work", 4), ...pacedProspects("work", 1, { paceEm: null }),
      ...pacedProspects("work", 1, { priorityEm: "notNow" }),
      ...pacedProspects("work", 1, { completedAt: "2026-09-20T15:00:00Z" })];
    expect(hasEnoughPacedProjects(prospects.map((prospect, index) => ({ ...prospect, uuid: `work-${ index }` })))).toBe(false);
  });
});

describe("ProjectCard Status control", () => {
  let container = null;
  let root = null;

  beforeEach(() => {
    confettiMock.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Render one stored project card with the given completion handler.
  // @param {Function} onSetCompletion - Resolves to whether the completion saved.
  // @param {object} rowFields - Overrides applied to the stored row.
  function renderCard(onSetCompletion, rowFields = {}) {
    const [row] = draftRowsFromProspects([prospectRecord({ summary: "Ship diff-view v2", uuid: "ship", ...rowFields })]);
    act(() => {
      root.render(createElement(ProjectCard, { isDisabled: false, onChangeSummary: jest.fn(), onReject: jest.fn(),
        onSetCompletion, onSetPriority: jest.fn(async () => true), row }));
    });
  }

  it("marks the project Done, darkens the card, disables emphasis, and celebrates", async () => {
    const onSetCompletion = jest.fn(async () => true);
    const rectSpy = jest.spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue({ height: 200, left: 0, top: 0, width: 300 });
    renderCard(onSetCompletion);
    const statusButton = container.querySelector(".project-row-status-button");
    expect(statusButton.textContent).toContain("Complete");

    await act(async () => statusButton.click());
    expect(onSetCompletion).toHaveBeenCalledWith(expect.objectContaining({ uuid: "ship" }), true);
    expect(container.querySelector(".project-row").classList.contains("project-row--completed")).toBe(true);
    expect(statusButton.textContent).toContain("Done");
    expect(statusButton.getAttribute("aria-pressed")).toBe("true");
    const priorityButtons = [...container.querySelectorAll(".project-row-priority-button")];
    expect(priorityButtons.every(button => button.disabled && button.getAttribute("aria-pressed") === "false")).toBe(true);
    expect(confettiMock).toHaveBeenCalledTimes(1);
    rectSpy.mockRestore();
  });

  it("reverts and skips the celebration when the save fails, and reopens a finished project without one", async () => {
    renderCard(jest.fn(async () => false));
    await act(async () => container.querySelector(".project-row-status-button").click());
    expect(container.querySelector(".project-row").classList.contains("project-row--completed")).toBe(false);

    const onSetCompletion = jest.fn(async () => true);
    renderCard(onSetCompletion, { completedAt: "2026-09-20T15:00:00Z" });
    expect(container.querySelector(".project-row-status-button").textContent).toContain("Done");
    await act(async () => container.querySelector(".project-row-status-button").click());
    expect(onSetCompletion).toHaveBeenCalledWith(expect.objectContaining({ uuid: "ship" }), false);
    expect(container.querySelector(".project-row-status-button").textContent).toContain("Complete");
    expect(confettiMock).not.toHaveBeenCalled();
  });
});
