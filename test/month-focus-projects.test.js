// A month's projects are read from its Focus bullet, the month's intensity follows how many there are, and the
// star choosing the month's focus is written into that bullet and survives Plan Builder publishing again.
import { contentWithStarredMonthProject, monthFocusProjects, monthPlanIntensity } from "plan-wizard/month-focus-projects";
import { lineWithBuilderSegments } from "plan-wizard/quarterly-plan-markdown";

const PLAN_NOTE = [
  "# Month-by-Month Breakdown",
  "",
  "## October",
  "- Focus: hiring; Ship v2 \\[builder\\]; Launch Diff Digest \\[builder\\]",
  "- Key move: close the loop",
  "",
  "## November",
  "- Focus: Ship v2 [builder]",
  "- Key move:",
].join("\n");

describe("monthFocusProjects", () => {
  it("lists each Focus segment and leaves the rest of the section to render", () => {
    const section = "- Focus: hiring; ⭐ Ship v2 \\[builder\\]; Launch Diff Digest [builder]\n- Key move: close the loop";
    const { projects, remainingContent } = monthFocusProjects(section);
    expect(projects).toEqual([{ isBuilder: false, isStarred: false, label: "hiring" },
      { isBuilder: true, isStarred: true, label: "Ship v2" }, { isBuilder: true, isStarred: false, label: "Launch Diff Digest" }]);
    expect(remainingContent).toBe("- Key move: close the loop");
  });

  it("reads an empty Focus bullet as no projects", () => {
    expect(monthFocusProjects("- Focus:\n- Key move:").projects).toEqual([]);
    expect(monthFocusProjects(null).projects).toEqual([]);
  });
});

describe("contentWithStarredMonthProject", () => {
  it("stars only the chosen project in that month", () => {
    const starred = contentWithStarredMonthProject(PLAN_NOTE, "October", "Ship v2");
    expect(starred).toContain("- Focus: hiring; ⭐ Ship v2 \\[builder\\]; Launch Diff Digest \\[builder\\]");
    expect(starred).toContain("## November\n- Focus: Ship v2 [builder]");
  });

  it("moves the star to a newly chosen project, and clears it on null", () => {
    const starred = contentWithStarredMonthProject(PLAN_NOTE, "October", "Ship v2");
    const moved = contentWithStarredMonthProject(starred, "october", "hiring");
    expect(moved).toContain("- Focus: ⭐ hiring; Ship v2 \\[builder\\]; Launch Diff Digest \\[builder\\]");
    const cleared = contentWithStarredMonthProject(moved, "October", null);
    expect(cleared).toBe(PLAN_NOTE);
  });

  it("leaves a note without the month unchanged", () => {
    expect(contentWithStarredMonthProject(PLAN_NOTE, "December", "Ship v2")).toBe(PLAN_NOTE);
  });
});

describe("lineWithBuilderSegments", () => {
  it("keeps a starred builder project starred when it is published again", () => {
    const line = "- Focus: hiring; ⭐ Ship v2 \\[builder\\]; Old project [builder]";
    expect(lineWithBuilderSegments(line, ["Launch Diff Digest", "Ship v2"]))
      .toBe("- Focus: hiring; Launch Diff Digest [builder]; ⭐ Ship v2 [builder]");
  });
});

describe("monthPlanIntensity", () => {
  it("grades the month by its project count", () => {
    expect(monthPlanIntensity(2, "October")).toMatchObject({ hint: "Room for another project in October.", levelEm: "focused" });
    expect(monthPlanIntensity(3, "October")).toMatchObject({ hint: "2 more projects tip October into Aggressive.",
      levelEm: "ambitious", levelLabel: "Mildly Ambitious" });
    expect(monthPlanIntensity(4, "October")).toMatchObject({ hint: "One more project tips October into Aggressive.",
      levelEm: "ambitious", levelLabel: "Ambitious" });
    expect(monthPlanIntensity(5, "October")).toMatchObject({ levelEm: "aggressive", levelLabel: "Mildly Aggressive" });
    expect(monthPlanIntensity(8, "October")).toMatchObject({
      hint: "Move 4 projects to another month to ease back to Ambitious.", levelEm: "aggressive", levelLabel: "Aggressive" });
    expect(monthPlanIntensity(0, "October")).toMatchObject({ hint: "No projects are scheduled for October yet.",
      levelEm: "focused" });
  });
});
