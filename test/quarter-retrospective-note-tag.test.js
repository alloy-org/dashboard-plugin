// Verify the tag the Quarter Retrospective gives its notes: typed tags normalized, "planning/retrospective" until the
// user picks another, the choice saved once, suggestions from the planning notes' tags, the data, payoff ranking, and
// takeaways notes carrying it, the "Document how you did it" note written once with it, the slide's link to that
// note, and the options screen's tag picker.
import { jest } from "@jest/globals";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { maintenanceApp } from "./project-maintenance-test-app";

const { DASHBOARD_NOTE_TAG, SETTING_KEYS } = await import("constants/settings");
const { pluginSettings, setPluginData } = await import("plugin-data");
const { saveProjectPayoffRanking } = await import("dashboard/quarter-retrospective/project-payoff-rankings");
const { default: QuarterRetrospective } = await import("dashboard/quarter-retrospective/quarter-retrospective");
const { generateRetrospective } = await import("dashboard/quarter-retrospective/retrospective-generation");
const { normalizedRetrospectiveTag, retrospectiveNoteTag, retrospectiveNoteTags, retrospectiveTagSuggestions,
  saveRetrospectiveNoteTag } = await import("dashboard/quarter-retrospective/retrospective-note-tag");
const { projectDocumentationNoteName, saveProjectDocumentationNote } = await import("dashboard/quarter-retrospective/retrospective-project-documentation");
const { SlideHardestTasks } = await import("dashboard/quarter-retrospective/retrospective-slide");
const { saveRetrospectiveTakeaways } = await import("dashboard/quarter-retrospective/retrospective-takeaways");

const SCOPE = { domainName: "Work", quarter: 3, year: 2026 };
const PROJECT = { name: "Launch", taskCount: 6, tasks: [{ difficulty: 9, text: "Ship the beta" }, { difficulty: 7, text: "Pitch the keynote" }] };
let mounted = null;

// ----------------------------------------------------------------------------------------------
// @desc An app holding notes by name and tag, with one completed task in Q3 2026 and settings that can be written.
// @returns {object} App mock.
function taggedApp() {
  const app = maintenanceApp({ tasks: [] });
  const completedAt = Math.floor(new Date(2026, 7, 12, 15).getTime() / 1000);
  app.getCompletedTasks = jest.fn(async () => [{ completedAt, content: "Ship the dashboard", uuid: "task-1", victoryValue: 5 }]);
  app.navigate = jest.fn(async () => true);
  app.setSetting = jest.fn(async () => true);
  return app;
}

// ----------------------------------------------------------------------------------------------
// @desc The names of the app's notes carrying a tag.
// @param {object} app - App mock.
// @param {string} tag - The tag.
// @returns {Promise<Array<string>>} Note names.
async function namesTagged(app, tag) {
  const notes = await app.filterNotes({ tag });
  return notes.map(note => note.name);
}

// ----------------------------------------------------------------------------------------------
// @desc Mount an element and let what it starts settle.
// @param {JSX.Element} element - The element.
// @returns {Promise<HTMLElement>} The mount point.
async function render(element) {
  const mountPoint = document.createElement("div");
  document.body.appendChild(mountPoint);
  const root = createRoot(mountPoint);
  await act(async () => { root.render(element); });
  await settle();
  mounted = { mountPoint, root };
  return mountPoint;
}

// ----------------------------------------------------------------------------------------------
// @desc Flush the promise chains loading and generating queue.
async function settle() {
  for (let iteration = 0; iteration < 30; iteration += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

afterEach(async () => {
  setPluginData({ settings: {} });
  if (!mounted) return;
  await act(async () => { mounted.root.unmount(); });
  mounted.mountPoint.remove();
  mounted = null;
});

describe("retrospective note tag", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A typed tag is stored as Amplenote stores tags, and the default holds until another is saved, once.
  it("normalizes, defaults, and saves the tag once", () => {
    expect(normalizedRetrospectiveTag("  #Planning//Q3 Review! ")).toBe("planning/q3-review");
    expect(normalizedRetrospectiveTag(" #/ ")).toBeNull();
    expect(retrospectiveNoteTag()).toBe("planning/retrospective");
    expect(retrospectiveNoteTags()).toEqual([DASHBOARD_NOTE_TAG, "planning/retrospective"]);

    const app = { setSetting: jest.fn(async () => true) };
    expect(saveRetrospectiveNoteTag(app, "planning/retrospective")).toBe("planning/retrospective");
    expect(saveRetrospectiveNoteTag(app, "")).toBe("planning/retrospective");
    expect(app.setSetting).not.toHaveBeenCalled();
    expect(saveRetrospectiveNoteTag(app, "Reviews/Quarterly")).toBe("reviews/quarterly");
    expect(pluginSettings()[SETTING_KEYS.RETROSPECTIVE_NOTE_TAG]).toBe("reviews/quarterly");
    expect(retrospectiveNoteTag()).toBe("reviews/quarterly");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Suggestions lead with the current tag, then the known tags and those on the planning notes, without the
  //   Dashboard's own tag; a failed lookup still offers the known tags.
  it("suggests the known tags and those on the planning notes", async () => {
    const app = { filterNotes: jest.fn(async () => [{ tags: ["planning/weekly", DASHBOARD_NOTE_TAG] }, { tags: ["planning/annual"] }]) };
    expect(await retrospectiveTagSuggestions(app)).toEqual(["planning/retrospective", "planning/quarterly", "planning/annual", "planning/weekly"]);
    const failingApp = { filterNotes: jest.fn(async () => { throw new Error("offline"); }) };
    expect(await retrospectiveTagSuggestions(failingApp)).toEqual(["planning/retrospective", "planning/quarterly"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The archived data and payoff ranking notes and the takeaways note all carry the retrospective tag.
  it("tags the data, payoff ranking, and takeaways notes", async () => {
    const app = taggedApp();
    const generated = await generateRetrospective(app, { ...SCOPE, domainUuid: "work-domain", options: {}, style: "data" },
      { decisionsEndpointFactory: null });
    await saveProjectPayoffRanking(app, { ...SCOPE, rankedProjects: [{ name: "Launch", uuid: "project-launch" }] });
    await saveRetrospectiveTakeaways(app, { ...SCOPE, dataNoteUuid: generated.noteUuid }, { requestPrompt: null });
    expect((await namesTagged(app, "planning/retrospective")).sort()).toEqual(["Work Project Payoff Rankings 2026",
      "Work Q3 2026 Data Retrospective Data", "Work Q3 2026 Retrospective"]);
    expect(await namesTagged(app, "planning/quarterly")).toEqual([]);
  });
});

describe("project documentation note", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc The note lists the project's hardest tasks above headings to fill in, carries only the retrospective tag, and
  //   is reopened rather than written again.
  it("writes the note once with the retrospective tag", async () => {
    const app = taggedApp();
    const first = await saveProjectDocumentationNote(app, { project: PROJECT, ...SCOPE });
    const noteName = projectDocumentationNoteName({ projectName: "Launch", ...SCOPE });
    expect(noteName).toBe("How I pulled off Launch (Q3 2026)");
    expect(first.created).toBe(true);
    expect(await namesTagged(app, "planning/retrospective")).toEqual([noteName]);
    expect(await namesTagged(app, DASHBOARD_NOTE_TAG)).toEqual([]);
    const content = app.noteContent(noteName);
    expect(content).toContain("- Ship the beta (difficulty 9/10)\n- Pitch the keynote (difficulty 7/10)");
    expect(content).toContain("## How I did it");

    const second = await saveProjectDocumentationNote(app, { project: PROJECT, ...SCOPE });
    expect(second).toEqual({ created: false, noteUuid: first.noteUuid });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Each project's link opens its note, and a failure is reported beside the project; without a handler the
  //   list shows no links.
  it("offers each project a link that opens its note", async () => {
    const onDocumentProject = jest.fn(async () => { throw new Error("offline"); });
    const mountPoint = await render(createElement(SlideHardestTasks, { hardestProjects: [PROJECT], onDocumentProject }));
    const link = mountPoint.querySelector(".retrospective-slide-document-link");
    expect(link.textContent).toBe("Document how you did it");
    await act(async () => { link.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(onDocumentProject).toHaveBeenCalledWith(PROJECT);
    expect(mountPoint.querySelector(".retrospective-slide-document-error").textContent).toBe("Couldn't open the note. Try again.");

    await act(async () => { mounted.root.render(createElement(SlideHardestTasks, { hardestProjects: [PROJECT] })); });
    expect(mountPoint.querySelector(".retrospective-slide-document-link")).toBeNull();
  });
});

describe("options tag picker", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc The picker stays hidden until "Advanced options" is clicked, which removes the link; it starts on
  //   "planning/retrospective", and a tag typed there is saved when the story is generated, and
  //   the data note is given it.
  it("starts on the default tag and gives the typed tag to the generated notes", async () => {
    const app = taggedApp();
    await render(createElement(QuarterRetrospective, { app, domainName: "Work", domainUuid: "work-domain", onClose: jest.fn(),
      plan: { label: "Q3 2026", noteUUID: null, quarter: 3, year: 2026 } }));
    expect(document.body.querySelector(".retrospective-options-tag-input")).toBeNull();
    const advancedLink = document.body.querySelector(".retrospective-options-advanced-link");
    await act(async () => { advancedLink.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(document.body.querySelector(".retrospective-options-advanced-link")).toBeNull();
    const input = document.body.querySelector(".retrospective-options-tag-input");
    expect(input.value).toBe("planning/retrospective");
    const suggestions = [...document.body.querySelectorAll("#retrospective-tag-suggestions option")].map(option => option.value);
    expect(suggestions).toEqual(["planning/retrospective", "planning/quarterly"]);

    const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    await act(async () => {
      setInputValue.call(input, "Reviews/Q3 Wins");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { document.body.querySelector(".retrospective-options-primary").dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await settle();
    expect(app.setSetting).toHaveBeenCalledWith(SETTING_KEYS.RETROSPECTIVE_NOTE_TAG, "reviews/q3-wins");
    expect(await namesTagged(app, "reviews/q3-wins")).toEqual(["Work Q3 2026 Data Retrospective Data"]);
    expect(app.noteContent("Work Q3 2026 Data Retrospective Data")).not.toContain("noteTag");
  });
});
