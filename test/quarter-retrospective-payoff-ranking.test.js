// Verify the project payoff ranking: the yearly rankings note it saves to and re-ranks in place, recalling the most
// recent ranked quarters across a year boundary, ordering projects as last ranked, the ranking slide's place in a
// story before its end card, the ranking list's buttons and drag and drop, a story waiting on its interactive slide, and the rankings
// reaching the project suggestion prompt.
import { jest } from "@jest/globals";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { maintenanceApp } from "./project-maintenance-test-app";

const { payoffRankingFromProjects, projectPayoffRankingsNoteName, projectsInPayoffOrder, readProjectPayoffRanking,
  recentProjectPayoffRankings, saveProjectPayoffRanking } = await import("dashboard/quarter-retrospective/project-payoff-rankings");
const { default: RetrospectivePayoffRanking, reorderedProjects } = await import("dashboard/quarter-retrospective/retrospective-payoff-ranking");
const { END_CARD_SLIDE_ID, PAYOFF_RANKING_SLIDE_ID, SLIDE_KINDS, slidesWithEndCard,
  slidesWithPayoffRanking } = await import("dashboard/quarter-retrospective/retrospective-slides");
const { default: RetrospectiveStory, STORY_TICK_MILLISECONDS } = await import("dashboard/quarter-retrospective/retrospective-story");
const { prospectPromptFromEvidence } = await import("plan-wizard/prospect-discovery");
const { recalledPayoffRankings } = await import("plan-wizard/prospect-evidence");

const PROJECTS = [{ derivedFrom: "plan", name: "Etsy shop", uuid: "project-etsy" }, { derivedFrom: "plan", name: "Get outdoors", uuid: "project-outdoors" },
  { derivedFrom: "themes", name: "Garden", uuid: "project-garden" }];
const STORY_SLIDES = [{ caption: "One.", figure: null, headline: "First slide", id: "intro", items: [], kicker: "Hello", tone: "intro" },
  { caption: "Bye.", figure: null, headline: "That was Q3 2026", id: "summary", items: [], kicker: "The whole quarter", tone: "intro" }];

let mounted = null;

// ----------------------------------------------------------------------------------------------
// @desc Mount an element into the document.
// @param {JSX.Element} element - What to render.
// @returns {Promise<HTMLElement>} The mount point.
async function render(element) {
  const mountPoint = document.createElement("div");
  document.body.appendChild(mountPoint);
  const root = createRoot(mountPoint);
  await act(async () => { root.render(element); });
  mounted = { mountPoint, root };
  return mountPoint;
}

const click = async element => { await act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); };
const chipNames = container => [...container.querySelectorAll(".retrospective-payoff-chip-name")].map(name => name.textContent);

// ----------------------------------------------------------------------------------------------
// @desc A drag event carrying a minimal dataTransfer, which jsdom doesn't provide.
// @param {string} type - Such as "dragstart".
// @returns {Event} The event.
function dragEvent(type) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  event.dataTransfer = { dropEffect: "none", effectAllowed: "all", setData: () => {} };
  return event;
}

afterEach(async () => {
  if (mounted) {
    await act(async () => { mounted.root.unmount(); });
    mounted.mountPoint.remove();
    mounted = null;
  }
  jest.useRealTimers();
});

describe("payoff rankings note", () => {
  it("saves a quarter's ranking, reads it back, and replaces it when re-ranked", async () => {
    const app = maintenanceApp({ tasks: [] });
    await saveProjectPayoffRanking(app, { domainName: "Work", quarter: 3, rankedProjects: PROJECTS, year: 2026 });
    await saveProjectPayoffRanking(app, { domainName: "Work", quarter: 2, rankedProjects: PROJECTS.slice(0, 1), year: 2026 });
    const reranked = [PROJECTS[2], PROJECTS[0], PROJECTS[1]];
    await saveProjectPayoffRanking(app, { domainName: "Work", quarter: 3, rankedProjects: reranked, year: 2026 });

    const content = app.noteContent(projectPayoffRankingsNoteName({ domainName: "Work", year: 2026 }));
    expect(content).toContain("Written by the Dashboard");
    expect(content.match(/^## Q3$/gm)).toHaveLength(1);
    const ranking = await readProjectPayoffRanking(app, { domainName: "Work", quarter: 3, year: 2026 });
    expect(ranking.rankings.map(entry => [entry.rank, entry.projectName])).toEqual([[1, "Garden"], [2, "Etsy shop"], [3, "Get outdoors"]]);
    expect(ranking.rankings[0]).toMatchObject({ derivedFrom: "themes", projectUuid: "project-garden" });
    expect(await readProjectPayoffRanking(app, { domainName: "Work", quarter: 1, year: 2026 })).toBeNull();
  });

  it("recalls the two most recent ranked quarters before the one planned, across a year boundary", async () => {
    const app = maintenanceApp({ tasks: [] });
    await saveProjectPayoffRanking(app, { domainName: "Work", quarter: 2, rankedProjects: PROJECTS, year: 2026 });
    await saveProjectPayoffRanking(app, { domainName: "Work", quarter: 4, rankedProjects: PROJECTS.slice(1), year: 2026 });
    await saveProjectPayoffRanking(app, { domainName: "Work", quarter: 1, rankedProjects: PROJECTS, year: 2027 });

    const recalled = await recentProjectPayoffRankings(app, { domainName: "Work", quarter: 1, year: 2027 });
    expect(recalled.map(rankedQuarter => rankedQuarter.label)).toEqual(["Q4 2026", "Q2 2026"]);
    expect(recalled[0].rankings.map(entry => entry.projectName)).toEqual(["Get outdoors", "Garden"]);
    expect(await recalledPayoffRankings(app, { domainName: "Personal", quarter: 1, year: 2027 })).toEqual([]);
  });

  it("orders projects as last ranked, keeping unranked ones after in their own order", () => {
    const ranking = payoffRankingFromProjects([PROJECTS[2], PROJECTS[0]], "2026-10-26T00:00:00.000Z");
    const ordered = projectsInPayoffOrder(PROJECTS, ranking);
    expect(ordered.map(project => project.name)).toEqual(["Garden", "Etsy shop", "Get outdoors"]);
    expect(projectsInPayoffOrder(PROJECTS, null)).toEqual(PROJECTS);
    expect(reorderedProjects(PROJECTS, 0, 2).map(project => project.name)).toEqual(["Get outdoors", "Garden", "Etsy shop"]);
    expect(reorderedProjects(PROJECTS, 0, 5)).toBe(PROJECTS);
  });

  it("places the ranking slide before the end card, and only once", () => {
    const endedSlides = slidesWithEndCard(STORY_SLIDES, "Q3 2026");
    expect(slidesWithEndCard(endedSlides, "Q3 2026")).toBe(endedSlides);
    const slides = slidesWithPayoffRanking(endedSlides, PROJECTS);
    expect(slides.map(slide => slide.id)).toEqual(["intro", "summary", PAYOFF_RANKING_SLIDE_ID, END_CARD_SLIDE_ID]);
    expect(slides[2]).toMatchObject({ kind: SLIDE_KINDS.payoffRanking, projects: PROJECTS });
    expect(slidesWithPayoffRanking(STORY_SLIDES, PROJECTS).map(slide => slide.id)).toEqual(["intro", "summary", PAYOFF_RANKING_SLIDE_ID]);
    expect(slidesWithPayoffRanking(slides, PROJECTS)).toBe(slides);
    expect(slidesWithPayoffRanking(STORY_SLIDES, [])).toBe(STORY_SLIDES);
  });
});

describe("RetrospectivePayoffRanking", () => {
  it("reorders with the move buttons and by dragging, then saves the order", async () => {
    const onSave = jest.fn(async () => {});
    const onSaved = jest.fn();
    const container = await render(createElement(RetrospectivePayoffRanking, { onSave, onSaved, projects: PROJECTS }));
    expect(container.querySelector("[aria-label='Move Etsy shop up']").disabled).toBe(true);

    await click(container.querySelector("[aria-label='Move Etsy shop down']"));
    expect(chipNames(container)).toEqual(["Get outdoors", "Etsy shop", "Garden"]);

    const chips = container.querySelectorAll(".retrospective-payoff-chip");
    await act(async () => { chips[2].dispatchEvent(dragEvent("dragstart")); });
    await act(async () => { chips[0].dispatchEvent(dragEvent("dragover")); });
    await act(async () => { chips[0].dispatchEvent(dragEvent("drop")); });
    expect(chipNames(container)).toEqual(["Garden", "Get outdoors", "Etsy shop"]);

    const saveButton = container.querySelector(".retrospective-options-primary");
    expect(saveButton.textContent).toBe("Save ranking");
    await click(saveButton);
    expect(onSave.mock.calls[0][0].map(project => project.name)).toEqual(["Garden", "Get outdoors", "Etsy shop"]);
    expect(onSaved).toHaveBeenCalled();
    expect(saveButton.textContent).toBe("Saved ✓");

    await click(container.querySelector("[aria-label='Move Garden down']"));
    expect(saveButton.textContent).toBe("Update ranking");
  });

  it("keeps the order and says so when saving fails", async () => {
    const onSave = jest.fn(async () => { throw new Error("offline"); });
    const container = await render(createElement(RetrospectivePayoffRanking, { onSave, projects: PROJECTS }));
    await click(container.querySelector(".retrospective-options-primary"));
    expect(container.querySelector("[role='alert']").textContent).toContain("Couldn't save");
    expect(chipNames(container)).toEqual(["Etsy shop", "Get outdoors", "Garden"]);
  });
});

describe("RetrospectiveStory with an interactive slide", () => {
  it("waits on the ranking slide without tap zones, and moves on when the ranking is done", async () => {
    jest.useFakeTimers();
    const slides = slidesWithPayoffRanking(STORY_SLIDES.slice(0, 1), PROJECTS).concat(STORY_SLIDES.slice(1));
    const renderInteractiveSlide = (slide, { onDone }) => (slide.kind === SLIDE_KINDS.payoffRanking
      ? createElement("button", { className: "ranking-done-button", onClick: onDone, type: "button" }, "Done") : null);
    const container = await render(createElement(RetrospectiveStory, { label: "Q3 2026 retrospective", renderInteractiveSlide,
      slideMilliseconds: 1000, slides }));
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" })); });
    const counterText = () => container.querySelector(".retrospective-story-counter").textContent;
    expect(counterText()).toBe("2 / 3");
    expect(container.querySelector(".retrospective-story-tap")).toBeNull();

    for (let passed = 0; passed < 3000; passed += STORY_TICK_MILLISECONDS) {
      await act(async () => { jest.advanceTimersByTime(STORY_TICK_MILLISECONDS); });
    }
    expect(counterText()).toBe("2 / 3");
    await click(container.querySelector(".ranking-done-button"));
    expect(counterText()).toBe("3 / 3");
    expect(container.querySelector(".retrospective-story-tap")).not.toBeNull();
  });
});

describe("project suggestion prompt", () => {
  it("lists past payoff rankings inside the evidence and asks to weigh them", () => {
    const evidence = { activeNotes: [], chosenGoals: [], completedReferences: [], coverage: { collectedAt: "2026-10-26T00:00:00.000Z",
      completedTaskCount: 0, completedWindowDays: 31, importantTaskCount: 0, importantWindowMonths: 3, recentTaskCount: 0 },
    importantReferences: [], payoffRankings: [{ label: "Q3 2026", rankings: [{ projectName: "Etsy shop", rank: 1 },
      { projectName: "Garden", rank: 2 }] }], quarterMonths: ["2026-10", "2026-11", "2026-12"], recentReferences: [], rejectedSummaries: [] };
    const prompt = prospectPromptFromEvidence(evidence, { domainName: "Work", quarterKey: "2026-Q4" });
    const evidenceText = prompt.slice(prompt.indexOf("<<<EVIDENCE"), prompt.indexOf("EVIDENCE>>>"));
    expect(evidenceText).toContain("- Q3 2026 #1 of 2: Etsy shop");
    expect(evidenceText).toContain("- Q3 2026 #2 of 2: Garden");
    expect(prompt).toContain("favor candidates that continue or extend a project ranked near the top");
  });
});
