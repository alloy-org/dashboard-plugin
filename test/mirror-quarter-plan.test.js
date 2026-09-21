// Copying an upcoming plan onto the current quarter keeps the plan and drops the months that belong to the
// quarter being copied from.

import { defaultQuarterlyTemplate } from "constants/quarters";
import { contentWithoutMonthlyTargets, mirrorQuarterPlanNote } from "plan-wizard/mirror-quarter-plan";
import { createPlanWizardApp } from "./fixtures/plan-wizard-app.js";

const sourcePlan = { domainName: "Work", label: "Q4 2026", noteUUID: "next-note", quarter: 4, year: 2026 };
const targetPlan = { domainName: "Work", label: "Q3 2026", noteUUID: null, quarter: 3, year: 2026 };

// ----------------------------------------------------------------------------------------------
// @desc The upcoming quarter's plan: a real template plus one filled month target and one appended month.
// @returns {string} Note markdown.
function upcomingPlanContent() {
  const template = defaultQuarterlyTemplate("Q4 2026", 4);
  const withOctoberTarget = template.replace("## October\n- Focus:", "## October\n- Focus: hire an engineer");
  return `${ withOctoberTarget }\n### January\n- Focus: leftover\n- Key move:\n`;
}

describe("contentWithoutMonthlyTargets", () => {
  it("drops the month breakdown and month-named sections, and keeps the rest of the plan", () => {
    const content = `${ upcomingPlanContent() }\n## March launch\n- Outcome: still this plan\n`;
    const stripped = contentWithoutMonthlyTargets(content);
    expect(stripped).not.toContain("Month-by-Month Breakdown");
    expect(stripped).not.toContain("October");
    expect(stripped).not.toContain("hire an engineer");
    expect(stripped).not.toContain("January");
    expect(stripped).not.toContain("leftover");
    expect(stripped).toContain("# Projects");
    expect(stripped).toContain("## March launch");
    expect(stripped).toContain("# Weekly Planning Prompt");
    expect(stripped).toContain("# Quarterly Review");
  });
});

describe("mirrorQuarterPlanNote", () => {
  it("stores the upcoming plan under the current quarter's name, without its monthly targets", async () => {
    const app = createPlanWizardApp();
    app.notes.push({ archived: false, content: upcomingPlanContent(), localUuid: "local-next",
      name: "Q4 2026 Work Plan", tags: ["plugins/dashboard", "planning/quarterly"], uuid: "next-note" });

    const mirrored = await mirrorQuarterPlanNote(app, { sourcePlan, targetPlan });
    const currentNote = app.notes.find(note => note.uuid === mirrored.noteUuid);

    expect(currentNote.name).toBe("Q3 2026 Work Plan");
    expect(currentNote.content).toContain("# Projects");
    expect(currentNote.content).not.toContain("October");
    expect(currentNote.content).not.toContain("January");
    expect(app.notes.filter(note => note.name === "Q3 2026 Work Plan")).toHaveLength(1);
  });

  it("reads an upcoming plan that was just created and is not on the plan object yet", async () => {
    const app = createPlanWizardApp();
    app.notes.push({ archived: false, content: "# Finish the launch\n\n# Projects\n\n## Ship v2\n- Outcome: done\n",
      localUuid: "local-next", name: "Q4 2026 Work Plan", tags: ["plugins/dashboard"], uuid: "next-note" });
    const sourceWithoutUuid = { ...sourcePlan, noteUUID: null };

    const mirrored = await mirrorQuarterPlanNote(app, { sourcePlan: sourceWithoutUuid, targetPlan });
    const currentNote = app.notes.find(note => note.uuid === mirrored.noteUuid);
    expect(currentNote.name).toBe("Q3 2026 Work Plan");
    expect(currentNote.content).toContain("## Ship v2");
  });
});
