// Verify that the decisions a user makes in Plan Builder reach the quarterly plan note they actually read, and
// that publishing them never costs the user anything they wrote in that note themselves. The central case walks
// a partly filled-in plan note through the wizard's pages in order and then asserts the note holds the sum of
// both: every sentence the user typed before the wizard ran, plus each decision the wizard captured.

import { defaultQuarterlyTemplate } from "constants/quarters";
import { resolvePlanScope } from "plan-wizard/plan-models";
import { savePlanGoals, savePlanProspects, savePlanQuarterAnswer } from "plan-wizard/plan-wizard-service";
import { BUILDER_MARKER, KEEP_WARM_MARKER } from "plan-wizard/quarterly-plan-markdown";
import { mergedQuarterlyPlanContent } from "plan-wizard/quarterly-plan-merge";
import { quarterlyPlanPublication } from "plan-wizard/quarterly-plan-publication";
import { publishQuarterlyPlan } from "plan-wizard/quarterly-plan-publisher";
import { createPlanWizardApp } from "./fixtures/plan-wizard-app.js";

const scope = resolvePlanScope({ domainName: "Work", domainUuid: "domain-work", quarter: 4, year: 2026 });
const planNoteName = "Q4 2026 Work Plan";

// The sentences the user wrote into the plan note before ever opening the wizard. Each one is asserted to
// survive publication, since a merge that quietly drops them would defeat the point of merging at all.
const USER_AUTHORED_LINES = ["- [ ] Renew the SOC 2 audit", "## Hire a second support engineer",
  "- Outcome: Offer signed by December 1", "- Mondays: deep work; code review", "- Wednesdays: meetings",
  "- Focus: settle the hiring loop", "Which projects need time on my calendar this week?",
  "- Lessons learned:"];

// ----------------------------------------------------------------------------------------------
// @desc Build the plan note a user has already partly filled in: the template, plus their own outcome, their
//   own project block, their day-striping categories, and a month focus they wrote by hand.
// @returns {string} Note markdown.
function provisionalPlanNoteContent() {
  const template = defaultQuarterlyTemplate("Q4 2026", 4);
  return template
    .replace("- [ ] [Top outcome]\n- [ ] [Top outcome]\n- [ ] [Top outcome]",
      "- [ ] Renew the SOC 2 audit\n- [ ] [Top outcome]")
    .replace("## [Project 1]\n- Outcome:\n- Why now:",
      "## Hire a second support engineer\n- Outcome: Offer signed by December 1\n- Why now: Support queue is one deep")
    .replace("- Mondays: \n- Tuesdays: ", "- Mondays: deep work; code review\n- Tuesdays: deep work")
    .replace("- Wednesdays: ", "- Wednesdays: meetings")
    .replace("## October\n- Focus:", "## October\n- Focus: settle the hiring loop");
}

// ----------------------------------------------------------------------------------------------
// @desc Seed an app holding one non-archived quarterly plan note for the scope under test.
// @param {string} content - Initial note markdown.
// @returns {object} An object with the following properties:
//   - {object} app - Plan wizard app fixture.
//   - {Function} planNoteContent - Reads the plan note's current markdown.
function appWithPlanNote(content) {
  const app = createPlanWizardApp();
  app.notes.push({ archived: false, content, localUuid: "local-plan", name: planNoteName,
    tags: ["plugins/dashboard", "planning/quarterly"], uuid: "plan-note" });
  return { app, planNoteContent: () => app.notes.find(note => note.uuid === "plan-note").content };
}

// ----------------------------------------------------------------------------------------------
// @desc Build a project record shaped for savePlanProspects.
// @param {object} fields - Overrides applied over a work project the user provided themselves.
// @returns {object} Prospect record.
function prospectRecord(fields) {
  return { approvalStatusEm: "humanProvided", capturedAt: "2026-09-11T10:00:00Z",
    substantiations: ["Named by you while planning this quarter."], userCategoryEm: "work", ...fields };
}

describe("quarterlyPlanPublication", () => {
  it("publishes only the projects the user ratified, and sorts focus ahead of keep warm", () => {
    const prospects = [
      { focusMonths: [], preferredWeekdays: [], priorityEm: "stayWarm", substantiations: ["Warm"],
        summary: "Warm project", userCategoryEm: "work" },
      { focusMonths: [], preferredWeekdays: [], priorityEm: "quarterFocus", substantiations: ["Focus"],
        summary: "Focus project", userCategoryEm: "work" },
      { focusMonths: [], preferredWeekdays: [], priorityEm: null, substantiations: ["Undecided"],
        summary: "Undecided project", userCategoryEm: "work" },
      { focusMonths: [], preferredWeekdays: [], priorityEm: "notNow", substantiations: ["Parked"],
        summary: "Parked project", userCategoryEm: "work" },
    ];
    const publication = quarterlyPlanPublication({ prospects }, scope);
    expect(publication.projects.map(project => project.summary)).toEqual(["Focus project", "Warm project"]);
    expect(publication.notThisQuarter).toEqual(["Parked project"]);
    expect(publication.quarterMonthKeys).toEqual(["2026-10", "2026-11", "2026-12"]);
  });
});

describe("mergedQuarterlyPlanContent", () => {
  const publication = quarterlyPlanPublication({
    dailySufficiency: { capturedAt: "2026-09-11T10:00:00Z", text: "two focused blocks are done" },
    prospects: [{ deadlineOn: null, focusMonths: ["2026-11"], paceEm: "twoFocusedBlocks",
      preferredWeekdays: ["tuesday", "thursday"], priorityEm: "quarterFocus", substantiations: ["Cited by six tasks"],
      summary: "Ship diff-view v2", userCategoryEm: "work" }],
    quarterName: { capturedAt: "2026-09-11T10:00:00Z", text: "The Compounding Quarter" } }, scope);

  it("leads the note with the quarter name without stacking a second title on republication", () => {
    const once = mergedQuarterlyPlanContent(provisionalPlanNoteContent(), publication);
    const twice = mergedQuarterlyPlanContent(once, publication);
    expect(once.startsWith(`# The Compounding Quarter ${ BUILDER_MARKER }\n`)).toBe(true);
    expect(twice).toBe(once);
    expect(twice.match(/^# The Compounding Quarter/gm)).toHaveLength(1);
  });

  it("leaves the Quarter Theme sentence to the user rather than restating the name it just wrote above", () => {
    const authored = provisionalPlanNoteContent()
      .replace("[One sentence describing the main focus of this quarter.]", "Stabilize before we scale.");
    const merged = mergedQuarterlyPlanContent(authored, publication);
    expect(merged).toContain("# Quarter Theme\nStabilize before we scale.");
    expect(merged.match(/The Compounding Quarter/g)).toHaveLength(1);
    const untouched = mergedQuarterlyPlanContent(provisionalPlanNoteContent(), publication);
    expect(untouched).toContain("# Quarter Theme\n[One sentence describing the main focus of this quarter.]");
  });

  it("appends builder projects after the user's own day-of-week categories without disturbing them", () => {
    const merged = mergedQuarterlyPlanContent(provisionalPlanNoteContent(), publication);
    expect(merged).toContain(`- Tuesdays: deep work; Ship diff-view v2 ${ BUILDER_MARKER }`);
    expect(merged).toContain("- Mondays: deep work; code review");
    expect(merged).toContain(`- Thursdays: Ship diff-view v2 ${ BUILDER_MARKER }`);
  });

  it("carries the user's Outcome wording across a republication of the same project", () => {
    const merged = mergedQuarterlyPlanContent(provisionalPlanNoteContent(), publication);
    const edited = merged.replace(`## Ship diff-view v2 ${ BUILDER_MARKER }\n- Outcome:`,
      `## Ship diff-view v2 ${ BUILDER_MARKER }\n- Outcome: p95 render under 400ms`);
    const republished = mergedQuarterlyPlanContent(edited, publication);
    expect(republished).toContain("- Outcome: p95 render under 400ms");
    expect(republished.match(/^## Ship diff-view v2/gm)).toHaveLength(1);
  });

  it("clears untouched template project placeholders but keeps the project block the user wrote", () => {
    const merged = mergedQuarterlyPlanContent(provisionalPlanNoteContent(), publication);
    expect(merged).not.toContain("## [Project 2]");
    expect(merged).not.toContain("## [Project 3]");
    expect(merged).toContain("## Hire a second support engineer");
    expect(merged).toContain("- Outcome: Offer signed by December 1");
  });
});

describe("publishQuarterlyPlan", () => {
  it("merges each wizard page's decisions into a provisionally completed plan note as they are submitted", async () => {
    const { app, planNoteContent } = appWithPlanNote(provisionalPlanNoteContent());
    const publishOptions = context => ({ ...scope, planningContext: context });

    await savePlanGoals(app, { ...scope, goals: [{ capturedAt: "2026-09-11T09:00:00Z", goalRank: 1,
      goalText: "Cut support load in half", userCategoryEm: "work" }] });

    // Projects page: one project taken as the quarter's focus, one kept warm, one parked.
    const projectsContext = await savePlanProspects(app, { ...scope, prospects: [
      prospectRecord({ priorityEm: "quarterFocus", substantiations: ["Cited by six recent tasks"],
        summary: "Ship diff-view v2", uuid: "prospect-diff-view" }),
      prospectRecord({ priorityEm: "stayWarm", summary: "Rewrite onboarding email", uuid: "prospect-onboarding" }),
      prospectRecord({ priorityEm: "notNow", summary: "Conference talk submission", uuid: "prospect-talk" }),
    ] });
    await publishQuarterlyPlan(app, publishOptions(projectsContext));
    expect(planNoteContent()).toContain(`## Ship diff-view v2 ${ BUILDER_MARKER }`);
    expect(planNoteContent()).toContain(`## Rewrite onboarding email ${ KEEP_WARM_MARKER }`);
    expect(planNoteContent()).toContain(`- Conference talk submission ${ BUILDER_MARKER }`);

    // Pace page: a rhythm and the weekdays it occupies, saved without rewriting placement buckets.
    const paceContext = await savePlanProspects(app, { ...scope, updatePlacement: false, prospects: [
      prospectRecord({ capturedAt: "2026-09-11T11:00:00Z", paceEm: "twoFocusedBlocks",
        preferredWeekdays: ["tuesday", "thursday"], priorityEm: "quarterFocus",
        substantiations: ["Cited by six recent tasks"], summary: "Ship diff-view v2", uuid: "prospect-diff-view" }),
    ] });
    await publishQuarterlyPlan(app, publishOptions(paceContext));
    expect(planNoteContent()).toContain("- Weekly rhythm: Two focused blocks per week (Tuesday, Thursday)");
    expect(planNoteContent()).toContain(`- Tuesdays: deep work; Ship diff-view v2 ${ BUILDER_MARKER }`);

    // Quarter-name page: the timeline places the project in a month, and the quarter earns a name.
    const monthContext = await savePlanProspects(app, { ...scope, prospects: [
      prospectRecord({ capturedAt: "2026-09-11T12:00:00Z", focusMonths: ["2026-11"], paceEm: "twoFocusedBlocks",
        preferredWeekdays: ["tuesday", "thursday"], priorityEm: "quarterFocus",
        substantiations: ["Cited by six recent tasks"], summary: "Ship diff-view v2", uuid: "prospect-diff-view" }),
    ] });
    await publishQuarterlyPlan(app, publishOptions(monthContext));
    expect(planNoteContent()).toContain(`- Focus: Ship diff-view v2 ${ BUILDER_MARKER }`);

    const namedContext = await savePlanQuarterAnswer(app, { ...scope, answerKey: "quarterName",
      capturedAt: "2026-09-11T13:00:00Z", text: "The Compounding Quarter" });
    await publishQuarterlyPlan(app, publishOptions(namedContext));
    expect(planNoteContent().startsWith(`# The Compounding Quarter ${ BUILDER_MARKER }\n`)).toBe(true);

    // Enough-for-today page: the day's bar joins the quarter's outcomes as a plain bullet, never a task.
    const finalContext = await savePlanQuarterAnswer(app, { ...scope, answerKey: "dailySufficiency",
      capturedAt: "2026-09-11T14:00:00Z", text: "two focused blocks and the inbox is clear" });
    await publishQuarterlyPlan(app, publishOptions(finalContext));

    const published = planNoteContent();
    expect(published).toContain(`- [ ] [Top outcome]\n- Done for today when: two focused blocks and the inbox is clear ${ BUILDER_MARKER }`);
    // The whole point of the merge: everything the user wrote before the wizard ran is still there.
    for (const authoredLine of USER_AUTHORED_LINES) expect(published).toContain(authoredLine);
    expect(published).toContain("# Quarterly Review");
  });

  it("republishes an unchanged plan without writing to the note", async () => {
    const { app } = appWithPlanNote(provisionalPlanNoteContent());
    const planningContext = await savePlanProspects(app, { ...scope, prospects: [
      prospectRecord({ priorityEm: "quarterFocus", summary: "Ship diff-view v2", uuid: "prospect-diff-view" }),
    ] });
    await publishQuarterlyPlan(app, { ...scope, planningContext });
    const writeCountAfterFirstPublish = app.replaceNoteContent.mock.calls.length;

    const second = await publishQuarterlyPlan(app, { ...scope, planningContext });
    expect(second.updated).toBe(false);
    expect(app.replaceNoteContent.mock.calls.length).toBe(writeCountAfterFirstPublish);
  });

  it("creates the quarter's plan note from the template when none exists yet", async () => {
    const app = createPlanWizardApp();
    const planningContext = await savePlanProspects(app, { ...scope, prospects: [
      prospectRecord({ priorityEm: "quarterFocus", summary: "Ship diff-view v2", uuid: "prospect-diff-view" }),
    ] });
    const result = await publishQuarterlyPlan(app, { ...scope, planningContext });
    expect(result.created).toBe(true);
    const planNote = app.notes.find(note => note.name === planNoteName);
    expect(planNote.content).toContain(`## Ship diff-view v2 ${ BUILDER_MARKER }`);
    expect(planNote.content).toContain("# Quarterly Review");
  });
});
