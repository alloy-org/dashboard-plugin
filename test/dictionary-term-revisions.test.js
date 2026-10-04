// Verify the record of when each dictionary definition last changed: the first observation is a baseline that marks
// nothing changed, a later one moves every added, rewritten, or removed term to one new sequence and leaves the note
// alone when nothing changed, positions from another record count from its baseline, and only open tasks whose text
// names a changed term are found for re-rating.
import DashboardNoteWriter from "dashboard/work-queue/dashboard-note-writer";
import { observedTermRevisions, termChangedTaskRecords, termRevisionsNoteName, termRevisionsPosition,
  termsChangedSince } from "plan-wizard/stack-rank/dictionary-term-revisions";
import { maintenanceApp } from "./project-maintenance-test-app";

const YEAR = 2026;

// ----------------------------------------------------------------------------------------------
// @desc Observe a dictionary with a writer of its own, so tests do not share queued updates.
// @param {object} app - From maintenanceApp.
// @param {object} dictionary - Definitions keyed by term.
// @returns {Promise<object>} The record as saved.
function observed(app, dictionary) {
  return observedTermRevisions(app, { dictionary, noteWriter: new DashboardNoteWriter(), year: YEAR });
}

describe("dictionary term revisions", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc The first record takes every term as its baseline, so a project with no recorded position re-rates nothing.
  it("starts from a baseline that marks no term changed", async () => {
    const app = maintenanceApp({ tasks: [] });
    const revisions = await observed(app, { Amplenote: "The notes app.", Dashboard: "The home pane." });
    expect(revisions).toMatchObject({ schemaVersion: 1, sequence: 0 });
    expect(Object.keys(revisions.terms).sort()).toEqual(["amplenote", "dashboard"]);
    expect(termsChangedSince(revisions, undefined)).toEqual([]);
    expect(app.noteContent(termRevisionsNoteName(YEAR))).toContain(revisions.revisionsId);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A rewritten, an added, and a removed term all move to the next sequence together; an unchanged term keeps
  //   its own, and observing the same dictionary again writes nothing.
  it("moves added, rewritten, and removed terms to one new sequence", async () => {
    const app = maintenanceApp({ tasks: [] });
    const baseline = await observed(app, { Amplenote: "The notes app.", Dashboard: "The home pane.", Jots: "The journal." });
    const position = termRevisionsPosition(baseline);
    const changed = await observed(app, { Amplenote: "The notes app.", dashboard: "The plugin's home pane.", Widget: "A card." });
    expect(changed.sequence).toBe(1);
    expect(termsChangedSince(changed, position).sort()).toEqual(["dashboard", "jots", "widget"]);
    expect(changed.terms.jots).toEqual({ digest: null, sequence: 1 });
    expect(changed.terms.amplenote.sequence).toBe(0);
    const writtenContent = app.noteContent(termRevisionsNoteName(YEAR));
    const unchanged = await observed(app, { Amplenote: "The notes app.", dashboard: "The plugin's home pane.", Widget: "A card." });
    expect(unchanged).toEqual(changed);
    expect(termsChangedSince(unchanged, termRevisionsPosition(changed))).toEqual([]);
    expect(app.noteContent(termRevisionsNoteName(YEAR))).toBe(writtenContent);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A position taken from a different record counts from this record's baseline.
  it("counts a position from another record from the baseline", async () => {
    const app = maintenanceApp({ tasks: [] });
    await observed(app, { Dashboard: "The home pane." });
    const revisions = await observed(app, { Dashboard: "The plugin's home pane." });
    expect(termsChangedSince(revisions, { revisionsId: "replaced", sequence: 7 })).toEqual(["dashboard"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Only open tasks naming a changed term as a whole word, in any case, are found.
  it("finds the open tasks that name a changed term", () => {
    const tasks = [
      { content: "Tune the Widget grid", uuid: "named" },
      { content: "Rewidgetize everything", uuid: "inside-a-word" },
      { completedAt: 1789552800, content: "Ship widget", uuid: "completed" },
      { content: "Errand", uuid: "unrelated" },
    ];
    expect(termChangedTaskRecords(tasks, ["widget"])).toEqual([{ taskText: "Tune the Widget grid", taskUuid: "named" }]);
    expect(termChangedTaskRecords(tasks, [])).toEqual([]);
  });
});
