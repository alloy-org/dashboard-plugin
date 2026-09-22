// A quarterly plan note the user filled in by hand is distinct from one that only holds the default template
// or the template plus Plan Builder's own marked output. The header link depends on that distinction.

import { defaultQuarterlyTemplate } from "constants/quarters";
import { resolvePlanScope } from "plan-wizard/plan-models";
import { BUILDER_MARKER } from "plan-wizard/quarterly-plan-markdown";
import { mergedQuarterlyPlanContent } from "plan-wizard/quarterly-plan-merge";
import { quarterlyPlanPublication } from "plan-wizard/quarterly-plan-publication";
import { planNoteHasUserEdits, userEditedPlanNoteUuid } from "plan-wizard/user-edited-plan-note";
import { createPlanWizardApp } from "./fixtures/plan-wizard-app.js";

const scope = resolvePlanScope({ domainName: "Work", domainUuid: "domain-work", quarter: 4, year: 2026 });
const template = defaultQuarterlyTemplate("Q4 2026", 4);

// ----------------------------------------------------------------------------------------------
// @desc A publication that rewrites the template the way finishing the wizard does, with no prior user writing.
// @returns {object} Publication carrying a name, one project, and a day's bar.
function builderPublication() {
  return quarterlyPlanPublication({
    dailySufficiency: { text: "two focused blocks are done" },
    goals: [{ goalRank: 1, goalText: "Cut support load in half", userCategoryEm: "work" }],
    prospects: [{ deadlineOn: null, focusMonths: ["2026-10"], paceEm: "twoFocusedBlocks",
      preferredWeekdays: ["tuesday"], priorityEm: "quarterFocus", substantiations: ["Cited by six tasks"],
      summary: "Ship diff-view v2", userCategoryEm: "work" }],
    quarterName: { text: "The Compounding Quarter" } }, scope);
}

describe("planNoteHasUserEdits", () => {
  it("treats the default template, including a round-trip through Amplenote, as unedited", () => {
    expect(planNoteHasUserEdits(template, template)).toBe(false);
    const roundTripped = `${ template.replace(/\[/g, "\\[").replace(/\]/g, "\\]") }\n\\\n`;
    expect(planNoteHasUserEdits(roundTripped, template)).toBe(false);
  });

  it("treats a focus line the user filled in as their own writing", () => {
    const edited = template.replace("## October\n- Focus:", "## October\n- Focus: settle the hiring loop");
    expect(planNoteHasUserEdits(edited, template)).toBe(true);
  });

  it("ignores a note whose only departures from the template are the builder's", () => {
    const published = mergedQuarterlyPlanContent(template, builderPublication());
    expect(published).toContain(BUILDER_MARKER);
    expect(published).not.toContain("## [Project 1]");
    expect(planNoteHasUserEdits(published, template)).toBe(false);
  });

  it("keeps a user's own project even after the builder has published beside it", () => {
    const authored = template.replace("## [Project 1]\n- Outcome:",
      "## Hire a second support engineer\n- Outcome: Offer signed by December 1");
    const published = mergedQuarterlyPlanContent(authored, builderPublication());
    expect(published).toContain(BUILDER_MARKER);
    expect(planNoteHasUserEdits(published, template)).toBe(true);
  });
});

describe("userEditedPlanNoteUuid", () => {
  it("returns the note when the user has written in it, and null for the template or a missing note", async () => {
    const app = createPlanWizardApp();
    const options = { domainName: "Work", domainUuid: "domain-work", quarter: 4, year: 2026 };
    expect(await userEditedPlanNoteUuid(app, options)).toBeNull();

    app.notes.push({ archived: false, content: template, localUuid: "local-plan", name: "Q4 2026 Work Plan",
      tags: ["planning/quarterly"], uuid: "plan-note" });
    expect(await userEditedPlanNoteUuid(app, options)).toBeNull();

    app.notes[0].content = template.replace("- Mondays: ", "- Mondays: deep work");
    expect(await userEditedPlanNoteUuid(app, options)).toBe("plan-note");
  });
});
