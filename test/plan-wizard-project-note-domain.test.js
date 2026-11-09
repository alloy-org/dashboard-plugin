// Verify that a note picked to define a project joins the Task Domain being planned before the project takes it: a
// note the domain already lists is left alone, one outside it is included directly and tagged todo, a refusal leaves
// the project as it was while the field turns red and offers Retry or Cancel, and the pick's time and note name are
// stored with the project through to the QuarterProject the Task Suggester reads.

import { jest } from "@jest/globals";
import { createPlanWizardApp } from "./fixtures/plan-wizard-app.js";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

await jest.unstable_mockModule("canvas-confetti", () => ({ default: jest.fn() }));

const { default: ProjectCard } = await import("dashboard/plan-wizard/project-card");
const { draftRowsFromProspects, emptyProjectRow, priorityRecordFromRow,
  prospectRecordsFromDraftRows } = await import("dashboard/plan-wizard/projects-step-fields");
const { resolvePlanScope } = await import("plan-wizard/plan-models");
const { readPlanGoals, savePlanProspects } = await import("plan-wizard/plan-wizard-service");
const { includeNoteInTaskDomain } = await import("plan-wizard/task-domain-fallback");
const { quarterlyProgressProjects } = await import("project-progress-model");

const DOMAIN_UUID = "domain-work";
const LINKED_AT = "2026-11-09T10:00:00.000Z";
const scope = resolvePlanScope({ domainName: "Work", domainUuid: DOMAIN_UUID, quarter: 4, year: 2026 });

// ----------------------------------------------------------------------------------------------
// @desc An app whose Work domain lists the given notes and grows when a note is included.
// @param {object} options - An object with the following properties:
//   - {Array<string>} [domainNoteUuids] - Notes the domain lists at first
//   - {Function} [addTaskDomainNote] - Replaces the inclusion, which otherwise adds the note and resolves true
// @returns {object} App mock.
function domainApp({ addTaskDomainNote = null, domainNoteUuids = [] } = {}) {
  const listedNoteUuids = [...domainNoteUuids];
  const includeNote = async (domainUuid, { uuid }) => {
    listedNoteUuids.push(uuid);
    return true;
  };
  return { addNoteTag: jest.fn(async () => true), addTaskDomainNote: jest.fn(addTaskDomainNote || includeNote),
    getTaskDomains: jest.fn(async () => [{ name: "Work", notes: listedNoteUuids.map(uuid => ({ uuid })), uuid: DOMAIN_UUID }]) };
}

describe("including a project note in the Task Domain", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A listed note and All Notes need no write; a note outside the domain is included, then tagged todo.
  it("includes only a note the domain does not already list", async () => {
    const app = domainApp({ domainNoteUuids: ["listed-note"] });
    await expect(includeNoteInTaskDomain(app, { domainUuid: DOMAIN_UUID, noteUuid: "listed-note" }))
      .resolves.toEqual({ isIncluded: true, wasAdded: false });
    await expect(includeNoteInTaskDomain(app, { domainUuid: null, noteUuid: "outside-note" }))
      .resolves.toEqual({ isIncluded: true, wasAdded: false });
    expect(app.addTaskDomainNote).not.toHaveBeenCalled();
    await expect(includeNoteInTaskDomain(app, { domainUuid: DOMAIN_UUID, noteUuid: "outside-note" }))
      .resolves.toEqual({ isIncluded: true, wasAdded: true });
    expect(app.addTaskDomainNote).toHaveBeenCalledWith(DOMAIN_UUID, { uuid: "outside-note" });
    expect(app.addNoteTag).toHaveBeenCalledWith({ uuid: "outside-note" }, "todo");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A declined inclusion counts when the domain then lists the note; a refusal or a throw does not.
  it("reports whether the domain holds the note after a declined or failed inclusion", async () => {
    const listedAnyway = domainApp({ addTaskDomainNote: async () => false });
    listedAnyway.getTaskDomains.mockResolvedValueOnce([{ notes: [], uuid: DOMAIN_UUID }])
      .mockResolvedValueOnce([{ notes: [{ uuid: "tagged-note" }], uuid: DOMAIN_UUID }]);
    await expect(includeNoteInTaskDomain(listedAnyway, { domainUuid: DOMAIN_UUID, noteUuid: "tagged-note" }))
      .resolves.toEqual({ isIncluded: true, wasAdded: false });
    const refusing = domainApp({ addTaskDomainNote: async () => false });
    await expect(includeNoteInTaskDomain(refusing, { domainUuid: DOMAIN_UUID, noteUuid: "shared-note" }))
      .resolves.toEqual({ isIncluded: false, wasAdded: false });
    const throwing = domainApp({ addTaskDomainNote: async () => { throw new Error("Shared note cannot be included"); } });
    await expect(includeNoteInTaskDomain(throwing, { domainUuid: DOMAIN_UUID, noteUuid: "shared-note" }))
      .resolves.toEqual({ isIncluded: false, wasAdded: false });
    expect(refusing.addNoteTag).not.toHaveBeenCalled();
  });
});

describe("storing when a project's note was picked", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc The link time and note name survive a priority decision, reach the QuarterProject, and clear with the note.
  it("keeps the pick's time and note name with the project", async () => {
    const app = createPlanWizardApp();
    const linkedRow = { ...emptyProjectRow("work"), isDirty: true, primaryNoteLinkedAt: LINKED_AT,
      primaryNoteName: "Garden redesign", primaryNoteUuid: "garden-note", projectSourceEm: "note", summary: "Garden redesign" };
    await savePlanProspects(app, { ...scope, prospects: prospectRecordsFromDraftRows([linkedRow], "2026-11-09T10:00:00Z") });
    let [storedRow] = draftRowsFromProspects((await readPlanGoals(app, scope)).prospects);
    expect(storedRow).toMatchObject({ primaryNoteLinkedAt: LINKED_AT, primaryNoteName: "Garden redesign" });

    await savePlanProspects(app, { ...scope, prospects: [priorityRecordFromRow(storedRow, "quarterFocus", "2026-11-09T11:00:00Z")] });
    const guideProspects = (await readPlanGoals(app, scope)).prospects;
    const [project] = quarterlyProgressProjects({ guide: { workProspects: { prospects: guideProspects } }, previousProjects: [],
      quarterlyContent: "", scope });
    expect(project).toMatchObject({ primaryNoteLinkedAt: LINKED_AT, primaryNoteName: "Garden redesign",
      primaryNoteUuid: "garden-note" });

    [storedRow] = draftRowsFromProspects(guideProspects);
    const namedRow = { ...storedRow, isDirty: true, primaryNoteUuid: null, projectSourceEm: "name" };
    await savePlanProspects(app, { ...scope, prospects: prospectRecordsFromDraftRows([namedRow], "2026-11-09T12:00:00Z") });
    const [namedProspect] = (await readPlanGoals(app, scope)).prospects;
    expect(namedProspect).toMatchObject({ primaryNoteLinkedAt: null, primaryNoteName: null, primaryNoteUuid: null });
  });
});

describe("picking a note outside the Task Domain", () => {
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
  // @desc Render a card meant to be defined by a note, open its search, and create a note from it.
  // @param {object} app - Fake Amplenote app, given note creation and an empty note search.
  // @returns {Promise<object>} The onChangeRow mock.
  async function pickNewNote(app) {
    Object.assign(app, { createNote: jest.fn(async () => "garden-note"), filterNotes: jest.fn(async () => []),
      findNote: jest.fn(() => new Promise(() => {})) });
    const onChangeRow = jest.fn();
    const row = { ...emptyProjectRow("work"), isStored: true, projectSourceEm: "note", summary: "Garden redesign" };
    act(() => {
      root.render(createElement(ProjectCard, { app, domainName: "Work", domainUuid: DOMAIN_UUID, isDisabled: false, onChangeRow,
        onReject: jest.fn(), onSetCompletion: jest.fn(), onSetPriority: jest.fn(async () => true), row }));
    });
    act(() => container.querySelector(".project-source-unlinked").click());
    await act(async () => container.querySelector(".project-note-menu-create").click());
    return onChangeRow;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc A note the domain takes is linked with the time it was picked and its name.
  it("links the note once the domain includes it", async () => {
    const app = domainApp();
    const onChangeRow = await pickNewNote(app);
    expect(app.addTaskDomainNote).toHaveBeenCalledWith(DOMAIN_UUID, { uuid: "garden-note" });
    expect(onChangeRow).toHaveBeenCalledWith(expect.any(String), { primaryNoteLinkedAt: expect.any(String),
      primaryNoteName: "Garden redesign", primaryNoteUuid: "garden-note", projectSourceEm: "note", summary: "Garden redesign" });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A refused note turns the field red with an exclamation; Cancel drops it, and Retry links it once it joins.
  it("offers Retry or Cancel when the domain will not take the note", async () => {
    const app = domainApp({ addTaskDomainNote: async () => false });
    const onChangeRow = await pickNewNote(app);
    expect(container.querySelector(".project-source-field--inclusion-failed")).not.toBeNull();
    expect(container.querySelector(".project-source-inclusion-mark").textContent).toBe("!");
    expect(container.querySelector(".project-source-inclusion-message").textContent).toContain("the Work Task Domain");
    expect(onChangeRow).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ primaryNoteUuid: "garden-note" }));

    const buttonNamed = label => [...container.querySelectorAll(".project-source-inclusion-actions button")]
      .find(button => button.textContent === label);
    act(() => buttonNamed("Cancel").click());
    expect(container.querySelector(".project-source-field--inclusion-failed")).toBeNull();
    expect(container.querySelector(".project-source-unlinked").textContent).toBe("Garden redesign");

    act(() => container.querySelector(".project-source-unlinked").click());
    await act(async () => container.querySelector(".project-note-menu-create").click());
    app.addTaskDomainNote.mockResolvedValueOnce(true);
    await act(async () => buttonNamed("Retry").click());
    expect(onChangeRow).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ primaryNoteUuid: "garden-note" }));
    expect(container.querySelector(".project-source-field--inclusion-failed")).toBeNull();
  });
});
