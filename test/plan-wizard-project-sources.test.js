// Exercise what the project sources page is built from: the summary of discovery's evidence, the project rows with
// their served-task counts and cadence marks, the thin-evidence threshold, and the service reporting sources before
// the provider answers.

import { MINIMUM_CONSIDERED_SOURCES, hasThinSources, projectTaskItems,
  sourceProjectRows } from "dashboard/plan-wizard/project-sources-page-fields";
import { jest } from "@jest/globals";
import { resolvePlanScope } from "plan-wizard/plan-models";
import { readPlanProjectSources, refreshPlanActionProspects, savePlanGoals } from "plan-wizard/plan-wizard-service";
import { MAXIMUM_SOURCE_NOTES, projectSourcesFromEvidence, withNamedSourceNotes } from "plan-wizard/project-sources";
import { createPlanWizardApp } from "./fixtures/plan-wizard-app.js";

const referenceDate = new Date("2026-09-06T12:00:00.000Z");
const scope = resolvePlanScope({ domainName: "Work", domainUuid: "domain-work", quarter: 4, year: 2026 });

// ----------------------------------------------------------------------------------------------
// @desc Build a task evidence reference in the shape collectProspectEvidence produces.
// @param {string} taskUuid - Task identity.
// @param {string} noteUuid - Identity of the note holding the task.
// @param {string} noteName - That note's name.
// @returns {object} Evidence reference.
function reference(taskUuid, noteUuid, noteName) {
  return { completedAt: null, noteName, noteUuid, taskUuid, text: `Task ${ taskUuid }` };
}

// ----------------------------------------------------------------------------------------------
// @desc Build a stored project for row tests.
// @param {object} overrides - Fields to replace on the default record.
// @returns {object} ActionProspect-shaped record.
function prospect(overrides = {}) {
  return { approvalStatusEm: "awaitingJudgement", evidence: [], paceEm: null, priorityEm: null, summary: "Project",
    userCategoryEm: "work", uuid: "prospect-1", ...overrides };
}

describe("projectSourcesFromEvidence", () => {
  it("counts distinct tasks and notes across every signal and merges important tasks into the ranked notes", () => {
    const evidence = { activeNotes: [{ completedTaskCount: 1, noteName: "Support log", noteUuid: "note-support", openTaskCount: 4 }],
      chosenGoals: [{ goalRank: 1, goalText: "Cut support load", userCategoryEm: "work", uuid: "goal-1" }],
      completedReferences: [reference("task-a", "note-support", "Support log")],
      importantReferences: [reference("task-b", "note-hiring", "Hiring"), reference("task-c", "note-hiring", "Hiring"),
        reference("task-d", "note-support", "Support log")],
      recentReferences: [reference("task-a", "note-support", "Support log"), reference("task-e", "note-inbox", "Inbox")] };

    const sources = projectSourcesFromEvidence(evidence);

    expect(sources.consideredTaskCount).toBe(5);
    expect(sources.consideredNoteCount).toBe(3);
    expect(sources.intents).toEqual([{ goalText: "Cut support load", userCategoryEm: "work", uuid: "goal-1" }]);
    expect(sources.notes).toEqual([
      { completedTaskCount: 1, importantTaskCount: 1, noteName: "Support log", noteUuid: "note-support", openTaskCount: 4 },
      { completedTaskCount: 0, importantTaskCount: 2, noteName: "Hiring", noteUuid: "note-hiring", openTaskCount: 0 },
    ]);
    expect(Object.keys(sources.taskByUuid).sort()).toEqual(["task-a", "task-b", "task-c", "task-d", "task-e"]);
    expect(sources.taskByUuid["task-b"]).toEqual({ completedAt: null, isImportant: true, noteName: "Hiring",
      noteUuid: "note-hiring", text: "Task task-b" });
    expect(sources.taskByUuid["task-e"].isImportant).toBe(false);
  });

  it("names untitled notes by looking up their handles, leaving named notes alone", async () => {
    const sources = projectSourcesFromEvidence({ activeNotes: [], chosenGoals: [], completedReferences: [],
      importantReferences: [reference("task-a", "note-a", null), reference("task-b", "note-b", "Kept name")],
      recentReferences: [] });
    const app = { findNote: jest.fn(async ({ uuid }) => ({ name: uuid === "note-a" ? "Looked up" : "Wrong" })) };

    const namedSources = await withNamedSourceNotes(app, sources);

    expect(namedSources.notes.map(note => note.noteName)).toEqual(["Looked up", "Kept name"]);
    expect(namedSources.taskByUuid["task-a"].noteName).toBe("Looked up");
    expect(app.findNote).toHaveBeenCalledTimes(1);
  });

  it("caps the listed notes", () => {
    const importantReferences = Array.from({ length: MAXIMUM_SOURCE_NOTES + 3 }, (unused, index) =>
      reference(`task-${ index }`, `note-${ index }`, `Note ${ index }`));
    const sources = projectSourcesFromEvidence({ activeNotes: [], chosenGoals: [], completedReferences: [],
      importantReferences, recentReferences: [] });
    expect(sources.notes).toHaveLength(MAXIMUM_SOURCE_NOTES);
    expect(sources.consideredNoteCount).toBe(MAXIMUM_SOURCE_NOTES + 3);
  });
});

describe("sourceProjectRows", () => {
  it("lists kept projects by tasks served, marking the ones whose cadence is chosen", () => {
    const rows = sourceProjectRows([
      prospect({ summary: "Named project", uuid: "prospect-named", approvalStatusEm: "humanProvided" }),
      prospect({ evidence: [{ noteUuid: "note-a", taskUuid: "task-a" }, { noteUuid: "note-a", taskUuid: "task-b" },
        { noteUuid: "note-a", taskUuid: "task-a" }], paceEm: "twoFocusedBlocks", summary: "Paced project", uuid: "prospect-paced" }),
      prospect({ evidence: [{ taskUuid: "task-c" }], priorityEm: "notNow", summary: "Parked", uuid: "prospect-parked" }),
      prospect({ summary: "  ", uuid: "prospect-blank" }),
    ]);

    expect(rows).toEqual([
      { paceLabel: "Two focused blocks per week", servedTaskCount: 2, servedTaskUuids: ["task-a", "task-b"],
        summary: "Paced project", userCategoryEm: "work", uuid: "prospect-paced" },
      { paceLabel: null, servedTaskCount: 0, servedTaskUuids: [], summary: "Named project", userCategoryEm: "work",
        uuid: "prospect-named" },
    ]);
  });
});

describe("projectTaskItems", () => {
  it("lists a project's cited tasks with important and open work first, counting the ones not read", () => {
    const [projectRow] = sourceProjectRows([prospect({ evidence: [{ taskUuid: "task-done" }, { taskUuid: "task-open" },
      { taskUuid: "task-key" }, { taskUuid: "task-gone" }] })]);
    const taskByUuid = { "task-done": { completedAt: "2026-09-01T00:00:00Z", isImportant: false, text: "Done" },
      "task-key": { completedAt: null, isImportant: true, text: "Key" },
      "task-open": { completedAt: null, isImportant: false, text: "Open" } };

    const { tasks, unreadTaskCount } = projectTaskItems(projectRow, { taskByUuid });

    expect(tasks.map(task => task.uuid)).toEqual(["task-key", "task-open", "task-done"]);
    expect(unreadTaskCount).toBe(1);
  });
});

describe("hasThinSources", () => {
  it("warns below the combined threshold and not before sources exist", () => {
    expect(hasThinSources(null)).toBe(false);
    expect(hasThinSources({ consideredNoteCount: 2, consideredTaskCount: MINIMUM_CONSIDERED_SOURCES - 3 })).toBe(true);
    expect(hasThinSources({ consideredNoteCount: 2, consideredTaskCount: MINIMUM_CONSIDERED_SOURCES - 2 })).toBe(false);
  });
});

describe("service", () => {
  it("reports sources before the provider is asked, and can read them without a provider call", async () => {
    const app = createPlanWizardApp();
    await savePlanGoals(app, { ...scope, goals: [{ capturedAt: "2026-09-06T11:00:00Z", goalRank: 1,
      goalText: "Cut support load in half", userCategoryEm: "work" }] });
    const secondsAgo = days => Math.round((referenceDate.getTime() - days * 86400000) / 1000);
    app.tasks.push({ completedAt: secondsAgo(2), content: "Answer a ticket", createdAt: secondsAgo(5), important: false,
      noteName: "Support log", noteUUID: "note-support", uuid: "task-a" });
    const events = [];
    const promptRunner = async () => {
      events.push("provider");
      return { prospects: [] };
    };

    const discovered = await refreshPlanActionProspects(app, { ...scope, onProgress: progress => events.push(progress),
      promptRunner, referenceDate });

    expect(events[0].projectSources).toMatchObject({ consideredNoteCount: 1, consideredTaskCount: 1 });
    expect(events[1]).toBe("provider");
    expect(discovered.projectSources).toEqual(events[0].projectSources);
    const readSources = await readPlanProjectSources(app, { ...scope, referenceDate });
    expect(readSources).toEqual(events[0].projectSources);
  });
});
