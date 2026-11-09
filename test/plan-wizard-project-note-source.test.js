// Verify that a project on the Plan Builder projects page can be defined by a note: the note search ranks notes by how
// well their names match the project, the note's synopsis and tasks are read for the card, the link is stored on the
// project and survives later decisions, and the card shows the unlinked, reading, and trashed states.

import { jest } from "@jest/globals";
import { createPlanWizardApp } from "./fixtures/plan-wizard-app.js";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

await jest.unstable_mockModule("canvas-confetti", () => ({ default: jest.fn() }));

const { default: ProjectCard } = await import("dashboard/plan-wizard/project-card");
const { draftRowsFromProspects, emptyProjectRow, linkedRowUuidByNoteUuidFromRows, priorityRecordFromRow,
  prospectRecordsFromDraftRows } = await import("dashboard/plan-wizard/projects-step-fields");
const { progressRowsFromContext } = await import("dashboard/plan-wizard/wizard-progress-fields");
const { WIZARD_STEPS } = await import("dashboard/plan-wizard/wizard-steps");
const { resolvePlanScope } = await import("plan-wizard/plan-models");
const { readPlanGoals, savePlanProspects } = await import("plan-wizard/plan-wizard-service");
const { noteNameContainsWords, noteNameSimilarity, readProjectNoteCandidates } = await import("plan-wizard/project-note-candidates");
const { noteTaskSummary, readProjectNoteSynopsis, synopsisFromNoteContent } = await import("plan-wizard/project-note-synopsis");
const { quarterlyProgressProjects } = await import("project-progress-model");

const scope = resolvePlanScope({ domainName: "Work", domainUuid: "domain-work", quarter: 4, year: 2026 });

// ----------------------------------------------------------------------------------------------
// @desc Build a project record shaped for savePlanProspects.
// @param {object} fields - Overrides applied over a focused work project the user provided themselves.
// @returns {object} Prospect record.
function prospectRecord(fields) {
  return { approvalStatusEm: "humanProvided", capturedAt: "2026-09-11T10:00:00Z", priorityEm: "quarterFocus",
    substantiations: ["Named by you while planning this quarter."], userCategoryEm: "work", ...fields };
}

describe("finding notes to define a project", () => {
  it("scores the share of a project's meaningful words a note's name repeats", () => {
    expect(noteNameSimilarity("Mobile reliability release", "Mobile reliability release plan")).toBe(1);
    expect(noteNameSimilarity("Automate enterprise pipeline", "Enterprise pipeline automation")).toBe(1);
    expect(noteNameSimilarity("Mobile reliability release", "Grocery list")).toBe(0);
  });

  it("matches a note name containing every typed word, ignoring case", () => {
    expect(noteNameContainsWords("q1 rev", "Q1 Goal Review")).toBe(true);
    expect(noteNameContainsWords("q1 launch", "Q1 Goal Review")).toBe(false);
  });

  const handles = [
    { name: "Grocery list", updated: "2026-11-08T10:00:00Z", uuid: "grocery" },
    { name: "Mobile reliability release plan", tags: ["amplenote/mobile"], updated: "2026-11-01T10:00:00Z", uuid: "reliability" },
    { name: "Mobile AI features launch plan", updated: "2026-11-07T10:00:00Z", uuid: "ai" },
    { name: "Dashboard data", tags: ["plugins/dashboard"], updated: "2026-11-09T09:00:00Z", uuid: "plugin-note" },
  ];

  it("reads only notes with tasks, lists name matches first, recent notes after, and leaves out notes in use", async () => {
    const app = { filterNotes: jest.fn(async options => (options.query ? [] : handles)) };
    const found = await readProjectNoteCandidates(app, { linkedRowUuidByNoteUuid: { ai: "other-row" },
      now: new Date("2026-11-09T10:00:00Z"), projectName: "Mobile reliability release", searchText: "" });
    expect(app.filterNotes).toHaveBeenCalledWith({ group: "taskLists" }, "changed");
    expect(found.bestMatches.map(candidate => candidate.uuid)).toEqual(["reliability"]);
    expect(found.bestMatches[0].tagLabel).toBe("amplenote/mobile");
    expect(found.recentlyEdited.map(candidate => candidate.uuid)).toEqual(["grocery"]);
  });

  it("once text is typed, lists the newest notes whose names contain it, including older ones the host finds by name", async () => {
    const olderHandle = { name: "Mobile pricing 2025", updated: "2025-01-01T10:00:00Z", uuid: "older" };
    const app = { filterNotes: jest.fn(async options => (options.query ? [olderHandle] : handles)) };
    const found = await readProjectNoteCandidates(app, { now: new Date("2026-11-09T10:00:00Z"),
      projectName: "Mobile reliability release", searchText: "mobile" });
    expect(app.filterNotes).toHaveBeenCalledWith({ group: "taskLists", query: "mobile" });
    expect(found.bestMatches.map(candidate => candidate.uuid)).toEqual(["ai", "reliability", "older"]);
    expect(found.recentlyEdited).toEqual([]);
  });
});

describe("reading the note that defines a project", () => {
  it("takes the opening prose as the synopsis, passing over headings and tasks", () => {
    const content = "# Plan\n\n- [ ] Fix sync<!-- {\"uuid\":\"t1\"} -->\n\nReliability **first**, then planning friction.\n\n"
      + "Paid AI turns on once sync and loading fixes have held for two weeks.";
    expect(synopsisFromNoteContent(content)).toBe("Reliability first, then planning friction. Paid AI turns on once sync "
      + "and loading fixes have held for two weeks.");
  });

  it("lists the latest finished task, then open tasks in note order, and counts all but dismissed ones", () => {
    const tasks = [{ completedAt: 100, content: "Old done", uuid: "a" }, { content: "Next one", uuid: "b" },
      { completedAt: 200, content: "Recent done", uuid: "c" }, { content: "Dismissed", dismissedAt: 5, uuid: "d" },
      { content: "Then this", uuid: "e" }];
    const summary = noteTaskSummary(tasks);
    expect(summary.listedTasks.map(task => task.text)).toEqual(["Recent done", "Next one", "Then this"]);
    expect(summary.doneCount).toBe(2);
    expect(summary.taskCount).toBe(4);
  });

  it("reports a note findNote no longer returns as missing", async () => {
    const app = { findNote: jest.fn(async () => null) };
    await expect(readProjectNoteSynopsis(app, "gone")).resolves.toBeNull();
  });
});

describe("storing a project's note", () => {
  it("saves primaryNoteUuid, keeps it through a priority decision, clears it when named by hand, and passes it on", async () => {
    const app = createPlanWizardApp();
    const linkedRow = { ...emptyProjectRow("work"), isDirty: true, primaryNoteUuid: "plan-note-uuid",
      projectSourceEm: "note", summary: "Mobile reliability release plan" };
    await savePlanProspects(app, { ...scope, prospects: prospectRecordsFromDraftRows([linkedRow], "2026-09-12T10:00:00Z") });
    let [storedRow] = draftRowsFromProspects((await readPlanGoals(app, scope)).prospects);
    expect(storedRow.primaryNoteUuid).toBe("plan-note-uuid");
    expect(storedRow.projectSourceEm).toBe("note");

    await savePlanProspects(app, { ...scope, prospects: [priorityRecordFromRow(storedRow, "stayWarm", "2026-09-13T10:00:00Z")] });
    const guideProspects = (await readPlanGoals(app, scope)).prospects;
    expect(guideProspects[0].primaryNoteUuid).toBe("plan-note-uuid");
    const projects = quarterlyProgressProjects({ guide: { workProspects: { prospects: guideProspects } }, previousProjects: [],
      quarterlyContent: "", scope });
    expect(projects[0].taskLinkReason({ noteUUID: "plan-note-uuid", uuid: "task" })).toBe("primaryNote");

    [storedRow] = draftRowsFromProspects(guideProspects);
    const namedRow = { ...storedRow, isDirty: true, primaryNoteUuid: null, projectSourceEm: "name" };
    await savePlanProspects(app, { ...scope, prospects: prospectRecordsFromDraftRows([namedRow], "2026-09-14T10:00:00Z") });
    expect((await readPlanGoals(app, scope)).prospects[0].primaryNoteUuid).toBeNull();
  });

  it("maps each linked note to its row and reports note-defined projects in the sidebar", () => {
    const rows = [{ primaryNoteUuid: "note-a", uuid: "row-a" }, { primaryNoteUuid: null, uuid: "row-b" }];
    expect(linkedRowUuidByNoteUuidFromRows(rows)).toEqual({ "note-a": "row-a" });
    const prospects = [prospectRecord({ primaryNoteUuid: "note-a", summary: "A", uuid: "a" }),
      prospectRecord({ primaryNoteUuid: "note-b", summary: "B", uuid: "b" }), prospectRecord({ summary: "C", uuid: "c" })];
    const progressRows = progressRowsFromContext({ currentStepKey: "projects", planningContext: { goals: [], prospects },
      wizardSteps: WIZARD_STEPS });
    expect(progressRows.find(row => row.key === "projects").noteSummary).toBe("2 defined by notes");
  });
});

describe("ProjectCard note source", () => {
  let container = null;
  let root = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Render one project card for a row, with an app whose reads the test controls.
  // @param {object} app - Fake Amplenote app.
  // @param {object} rowFields - Overrides applied to an empty work row.
  // @returns {object} The onChangeRow mock.
  function renderCard(app, rowFields) {
    const onChangeRow = jest.fn();
    const row = { ...emptyProjectRow("work"), isStored: true, ...rowFields };
    act(() => {
      root.render(createElement(ProjectCard, { app, isDisabled: false, onChangeRow, onReject: jest.fn(),
        onSetCompletion: jest.fn(), onSetPriority: jest.fn(async () => true), row }));
    });
    return onChangeRow;
  }

  it("outlines a project meant to be defined by a note in red while no note is linked", () => {
    renderCard({}, { projectSourceEm: "note", summary: "Bolster iPad differentiation" });
    const field = container.querySelector(".project-source-field");
    expect(field.classList.contains("project-source-field--unlinked")).toBe(true);
    expect(container.querySelector(".project-source-unlinked").textContent).toBe("Bolster iPad differentiation");
  });

  it("switches to the note search when Define with a note is chosen", () => {
    const onChangeRow = renderCard({ filterNotes: jest.fn(async () => []) }, { summary: "Bolster iPad" });
    act(() => container.querySelector(".project-source-toggle").click());
    const noteOption = [...container.querySelectorAll(".project-source-menu-option")]
      .find(option => option.textContent.includes("Define with a note"));
    act(() => noteOption.click());
    expect(onChangeRow).toHaveBeenCalledWith(expect.any(String), { projectSourceEm: "note" });
  });

  it("closes the note search on Escape, wherever focus is, without passing the Escape on to Plan Builder", () => {
    const outerEscapes = jest.fn();
    document.addEventListener("keydown", outerEscapes);
    renderCard({ filterNotes: jest.fn(async () => []) }, { projectSourceEm: "note", summary: "Bolster iPad" });
    act(() => container.querySelector(".project-source-unlinked").click());
    expect(container.querySelector(".project-source-search")).not.toBeNull();
    act(() => { document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })); });
    expect(container.querySelector(".project-source-search")).toBeNull();
    expect(outerEscapes).not.toHaveBeenCalled();
    document.removeEventListener("keydown", outerEscapes);
  });

  it("reopens the note search when a linked note's name is clicked, and opens the note from the arrow", () => {
    const app = { filterNotes: jest.fn(async () => []), findNote: jest.fn(() => new Promise(() => {})), navigate: jest.fn() };
    renderCard(app, { primaryNoteUuid: "goal-note", projectSourceEm: "note", summary: "Q1 Goal Review" });
    act(() => container.querySelector(".project-source-note-open").click());
    expect(app.navigate).toHaveBeenCalledWith("https://www.amplenote.com/notes/goal-note");
    act(() => container.querySelector(".project-source-note-change").click());
    expect(container.querySelector(".project-source-search")).not.toBeNull();
    expect(container.querySelector(".project-note-menu-scope").textContent).toBe("Recently changed notes with tasks shown");
    expect(container.querySelector(".project-note-menu-keys").textContent).toContain("esc keep current note");
  });

  it("shows a reading placeholder, then the trashed notice when the note is gone", async () => {
    let resolveFind = null;
    const app = { findNote: jest.fn(() => new Promise(resolve => { resolveFind = resolve; })) };
    renderCard(app, { primaryNoteUuid: "trashed-note", projectSourceEm: "note", summary: "Mobile AI features" });
    expect(container.querySelector(".project-note-synopsis--reading").textContent).toContain("Reading “Mobile AI features”");
    await act(async () => resolveFind(null));
    expect(container.querySelector(".project-note-synopsis--trashed").textContent).toContain("moved to trash");
    expect(container.querySelector(".project-source-field--trashed")).not.toBeNull();
  });
});
