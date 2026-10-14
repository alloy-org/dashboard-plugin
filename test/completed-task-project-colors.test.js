// Verify how the Victory Value chart is colored by project: each project's color slot taken in the order the completed
// task ledger first records it and shared past the sixth, a day's value split into segments with "No project" at the
// base, the legend naming the displayed projects, the ledgers read for a week crossing a quarter boundary, and the
// tooltip naming each task's project beside its swatch.
import { dailyProjectSegments, NO_PROJECT_COLOR_TOKEN, NO_PROJECT_KEY, OTHER_PROJECTS_LABEL, projectColorAssignments,
  projectLegendItems, projectUuidsByCompletion } from "dashboard/projects/completed-task-project-colors";
import { ledgerDateSectionMarkdown } from "dashboard/projects/completed-task-project-ledger";
import { displayedQuarters, readCompletedTaskProjects } from "hooks/use-completed-task-projects";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { buildDailyValuesForWeek, tooltipContentFromDay } from "victory-value";

// ----------------------------------------------------------------------------------------------
// @desc Render tooltip content into a detached element and return its markup.
// @param {JSX.Element} content - Tooltip content.
// @returns {Promise<string>} The rendered HTML.
async function markupFromContent(content) {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => { root.render(content); });
  const markup = container.innerHTML;
  root.unmount();
  return markup;
}

// ----------------------------------------------------------------------------------------------
// @desc A ledger entry.
// @param {string} taskUuid - The task's UUID.
// @param {string|null} projectUuid - The project it advanced, or null.
// @param {string} dateKey - The day it was completed.
// @returns {object} Entry.
function entry(taskUuid, projectUuid, dateKey) {
  return { classifiedBy: "decisions", dateKey, projectName: projectUuid ? `Project ${ projectUuid }` : null, projectUuid, taskUuid };
}

// ----------------------------------------------------------------------------------------------
// @desc A completed task.
// @param {string} uuid - Task UUID.
// @param {number} victoryValue - Its victory value.
// @returns {object} Task.
function task(uuid, victoryValue) {
  return { content: `Task ${ uuid }`, uuid, victoryValue };
}

// ----------------------------------------------------------------------------------------------
// @desc Ledger lookups for the given entries.
// @param {Map<string, Array<object>>} entriesByDate - Entries by date key.
// @returns {object} { colorAssignments, projectUuidsByCompletion }.
function completedTaskProjects(entriesByDate) {
  return { colorAssignments: projectColorAssignments(entriesByDate), projectUuidsByCompletion: projectUuidsByCompletion(entriesByDate) };
}

describe("completed task project colors", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Projects take slots in the order the ledger first names them, reading days oldest first; past the sixth
  //   project, the sixth slot is shared under one "Other projects" key.
  it("assigns color slots by first appearance and shares the last slot past six projects", () => {
    const entriesByDate = new Map([["2026-10-09", [entry("late", "beta", "2026-10-09")]],
      ["2026-10-08", [entry("early", "alpha", "2026-10-08"), entry("none", null, "2026-10-08"), entry("again", "beta", "2026-10-08")]]]);
    const assignments = projectColorAssignments(entriesByDate);
    expect([...assignments.keys()]).toEqual(["alpha", "beta"]);
    expect(assignments.get("alpha")).toEqual({ colorToken: "--dashboard-color-category-1", key: "alpha", label: "Project alpha", slot: 1 });
    const crowdedEntries = ["a", "b", "c", "d", "e", "f", "g"].map(projectUuid => entry(`task-${ projectUuid }`, projectUuid, "2026-10-08"));
    const crowded = projectColorAssignments(new Map([["2026-10-08", crowdedEntries]]));
    expect(crowded.get("e")).toMatchObject({ key: "e", label: "Project e", slot: 5 });
    expect(crowded.get("f")).toEqual({ colorToken: "--dashboard-color-category-6", key: "slot-6", label: OTHER_PROJECTS_LABEL, slot: 6 });
    expect(crowded.get("g")).toEqual(crowded.get("f"));
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A day's value splits by project, unclaimed and unrecorded tasks together at the base, valueless segments
  //   dropped; without ledger data the day is one "No project" segment.
  it("splits a day's value into project segments with no project at the base", () => {
    const entriesByDate = new Map([["2026-10-08", [entry("one", "alpha", "2026-10-08"), entry("two", "beta", "2026-10-08"),
      entry("three", null, "2026-10-08"), entry("four", "alpha", "2026-10-08")]]]);
    const projects = completedTaskProjects(entriesByDate);
    const tasks = [task("two", 3), task("one", 2), task("three", 1), task("unrecorded", 4), task("four", 5), task("zero", 0)];
    const segments = dailyProjectSegments(tasks, "2026-10-08", projects);
    expect(segments.map(({ key, value }) => [key, value])).toEqual([[NO_PROJECT_KEY, 5], ["alpha", 7], ["beta", 3]]);
    expect(segments[0].colorToken).toBe(NO_PROJECT_COLOR_TOKEN);
    expect(dailyProjectSegments(tasks, "2026-10-09", projects).map(segment => segment.key)).toEqual([NO_PROJECT_KEY]);
    expect(dailyProjectSegments(tasks, "2026-10-08", null)).toEqual([{ colorToken: NO_PROJECT_COLOR_TOKEN, key: NO_PROJECT_KEY,
      label: "No project", slot: 0, value: 15 }]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The chart's days carry segments; the legend lists the week's projects by slot with "No project" last, and
  //   is empty when no bar is colored by project.
  it("builds the week's segments and legend", () => {
    const entriesByDate = new Map([["2026-10-01", [entry("old", "alpha", "2026-10-01")]],
      ["2026-10-10", [entry("recent", "beta", "2026-10-10")]]]);
    const completedTasksByDate = { "2026-10-09": [task("plain", 2)], "2026-10-10": [task("recent", 4)] };
    const dailyValues = buildDailyValuesForWeek(completedTasksByDate, [], "2026-10-11", completedTaskProjects(entriesByDate));
    expect(dailyValues).toHaveLength(7);
    const october10 = dailyValues.find(day => day.segments.some(segment => segment.key === "beta"));
    expect(october10.value).toBe(4);
    const legend = projectLegendItems(dailyValues);
    expect(legend.map(item => [item.key, item.label])).toEqual([["beta", "Project beta"], [NO_PROJECT_KEY, "No project"]]);
    expect(legend[0].colorToken).toBe("--dashboard-color-category-2");
    expect(projectLegendItems(buildDailyValuesForWeek(completedTasksByDate, [], "2026-10-11", null))).toEqual([]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A week crossing a quarter boundary reads both quarters' ledgers, and a week inside one reads one.
  it("reads the ledger of every quarter the displayed days fall in", async () => {
    expect(displayedQuarters("2026-10-03")).toEqual([{ quarter: 3, year: 2026 }, { quarter: 4, year: 2026 }]);
    expect(displayedQuarters("2026-10-11")).toEqual([{ quarter: 4, year: 2026 }]);
    const notes = {
      "Completed Tasks by Project Q3 2026 Work": `## 2026-09-30\n\n${ ledgerDateSectionMarkdown([entry("september", "alpha", "2026-09-30")]) }`,
      "Completed Tasks by Project Q4 2026 Work": `## 2026-10-02\n\n${ ledgerDateSectionMarkdown([entry("october", "beta", "2026-10-02")]) }`,
    };
    const app = { findNote: async ({ name }) => (notes[name] ? { uuid: name } : null), getNoteContent: async ({ uuid }) => notes[uuid] };
    const projects = await readCompletedTaskProjects(app, { domainName: "Work", quarters: displayedQuarters("2026-10-03") });
    expect([...projects.colorAssignments.keys()]).toEqual(["alpha", "beta"]);
    expect(projects.projectUuidsByCompletion.get("2026-10-02:october")).toBe("beta");
    expect(await readCompletedTaskProjects(app, { domainName: "Home", quarters: [{ quarter: 4, year: 2026 }] })).toBeNull();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Each tooltip row names its task's project beside the project's swatch, the name escaped; a task no project
  //   claims shows no project.
  it("names each task's project in the tooltip", async () => {
    const entriesByDate = new Map([["2026-10-10", [{ ...entry("claimed", "alpha", "2026-10-10"), projectName: "Ship <v2>" }]]]);
    const completedTasksByDate = { "2026-10-10": [task("claimed", 4), task("unclaimed", 1)] };
    const projects = completedTaskProjects(entriesByDate);
    const dailyValues = buildDailyValuesForWeek(completedTasksByDate, [], "2026-10-10", projects);
    const html = await markupFromContent(tooltipContentFromDay(6, dailyValues, completedTasksByDate, [], projects));
    // jsdom drops var() colors from inline styles, so the swatch's color token is covered by the color assignment
    // tests above; here the swatch must sit beside the project's escaped name.
    expect(html).toContain("<span class=\"dashboard-tooltip-row-swatch\"></span>Ship &lt;v2&gt;</span>");
    expect(html.match(/dashboard-tooltip-row-project/g)).toHaveLength(1);
    expect(await markupFromContent(tooltipContentFromDay(6, dailyValues, completedTasksByDate, [], null)))
      .not.toContain("dashboard-tooltip-row-project");
  });
});
