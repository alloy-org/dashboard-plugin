// Verify the Quarter Retrospective's end card and takeaways note: the note written from a data note's statistics and
// month digests, with tables whose numbers come from the statistics and prose from the AI; a second save opening the
// same note; prose built without an AI; the AI's prose cleaned and bounded; project rows from older statistics; and
// the end card's controls in a story.
import { jest } from "@jest/globals";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { maintenanceApp } from "./project-maintenance-test-app";

const { readRetrospectiveDataNote, RETROSPECTIVE_SECTIONS, retrospectiveMonthSection, startRetrospectiveDataNote,
  writeRetrospectiveDataSection } = await import("dashboard/quarter-retrospective/retrospective-data-note");
const { default: RetrospectiveEndCard } = await import("dashboard/quarter-retrospective/retrospective-end-card");
const { SLIDE_KINDS, slidesWithEndCard } = await import("dashboard/quarter-retrospective/retrospective-slides");
const { default: RetrospectiveStory } = await import("dashboard/quarter-retrospective/retrospective-story");
const { retrospectiveTakeawaysNoteName, saveRetrospectiveTakeaways, takeawaysMarkdown, takeawaysProjectRows,
  writtenTakeaways } = await import("dashboard/quarter-retrospective/retrospective-takeaways");

const SCOPE = { domainName: "Work", quarter: 3, year: 2026 };
const STATISTICS = { doneAndOpenByProject: [{ doneCount: 30, name: "Etsy shop", openCount: 4, projectUuid: "project-etsy" },
  { doneCount: 12, name: "Garden | Yard", openCount: null, projectUuid: "project-garden" }],
importantTasks: { count: 6 }, intentAlignmentPercent: 71, intentTexts: ["Grow the shop"], leaders: { byMinutes: [], byTaskCount: [], byVictoryValue: [] },
longestStreak: { days: 9 }, meetingMinutesByCategory: null, monthlyTaskCounts: [20, 15, 18], outsideProjectTaskCount: 11,
projectTotals: [{ minutes: 1500, name: "Etsy shop", projectUuid: "project-etsy", taskCount: 30, victoryValue: 1240 },
  { minutes: 600, name: "Garden | Yard", projectUuid: "project-garden", taskCount: 12, victoryValue: 300 }],
projectsInferred: false, quarter: 3, quarterName: null, quarterOverQuarter: null, totalMinutes: 2400, totalTaskCount: 53,
totalVictoryValue: 1610, year: 2026 };
const MONTH_DIGESTS = [{ monthName: "July", monthNumber: 1 }, { monthName: "August", monthNumber: 2 },
  { monthName: "September", monthNumber: 3 }].map(month => ({ ...month, calendar: null, highlights: [{ summary: `Shipped the ${ month.monthName } listings`,
  taskUuids: [] }], mood: "heads-down", notableMoments: [], taskCount: 0, themes: [{ name: "Listings", taskUuids: [] }] }));
const PAYOFF_RANKING = { rankings: [{ projectName: "Etsy shop", rank: 1 }, { projectName: "Garden | Yard", rank: 2 }] };
const REPLY = { calendar: "", months: [{ monthNumber: 1, text: "July set the pace." }, { monthNumber: 2, text: "## Heading\nAugust kept it going." }],
  paidOff: "The shop paid off.", summary: "You built something real this quarter." };

let mounted = null;

// ----------------------------------------------------------------------------------------------
// @desc A data note holding the statistics and month digests, as a generation records them.
// @param {object} app - The test app.
// @returns {Promise<string>} The data note's UUID.
async function recordedDataNote(app) {
  const started = await startRetrospectiveDataNote(app, { ...SCOPE, domainUuid: null, options: {}, style: "data" });
  let content = started.content;
  const sections = [[RETROSPECTIVE_SECTIONS.statistics, STATISTICS], ...MONTH_DIGESTS.map(digest => [retrospectiveMonthSection(digest.monthNumber), digest])];
  for (const [heading, payload] of sections) {
    content = await writeRetrospectiveDataSection(app, { content, heading, noteHandle: started.noteHandle, payload });
  }
  return started.noteHandle.uuid;
}

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

afterEach(async () => {
  if (mounted) {
    await act(async () => { mounted.root.unmount(); });
    mounted.mountPoint.remove();
    mounted = null;
  }
});

describe("saveRetrospectiveTakeaways", () => {
  it("writes the note with tables from the statistics and the AI's prose, then reopens it on a second save", async () => {
    const app = maintenanceApp({ tasks: [] });
    const dataNoteUuid = await recordedDataNote(app);
    const requestPrompt = jest.fn(async () => REPLY);
    const first = await saveRetrospectiveTakeaways(app, { ...SCOPE, dataNoteUuid, payoffRanking: PAYOFF_RANKING }, { requestPrompt });
    expect(first.created).toBe(true);

    const note = app.noteContent(retrospectiveTakeawaysNoteName(SCOPE));
    expect(retrospectiveTakeawaysNoteName(SCOPE)).toBe("Work Q3 2026 Retrospective");
    expect(note).toContain("## Summary\n\nYou built something real this quarter.");
    expect(note).toContain("| 53 | 1,610 | 40h | 6 | 71% | 9 days |");
    expect(note).toContain("| Etsy shop | 30 | 25h | 1,240 | 30 / 4 |");
    expect(note).toContain("| Garden \\| Yard | 12 | 10h | 300 | 12 / — |");
    expect(note).toContain("11 completed tasks advanced no project.");
    expect(note).toContain('|**July**<!-- {"cell":{"backgroundColor":"#22374F","color":"#FFFFFF","colwidth":700}} -->|\n|[^1]<!-- {"cell":');
    expect(note).toContain("[^1]: \n    *20 tasks completed · mood: heads-down*\n\n    \\\n\n    July set the pace.\n\n    \\\n\n    - Shipped the July listings");
    expect(note).toContain("-->|\n\n\\\n\n| |\n|-|\n|**August**");
    expect(note).toContain("August kept it going.");
    expect(note).not.toContain("## Heading");
    expect(note).toContain("## What paid off");
    expect(note).toContain("1. Etsy shop\n2. Garden | Yard\n\nThe shop paid off.");
    expect(note).not.toContain("## Calendar");
    expect(requestPrompt.mock.calls[0][0]).toContain("1. Etsy shop");

    const { payloads } = await readRetrospectiveDataNote(app, dataNoteUuid);
    expect(payloads.get(RETROSPECTIVE_SECTIONS.takeaways).noteUuid).toBe(first.noteUuid);
    const second = await saveRetrospectiveTakeaways(app, { ...SCOPE, dataNoteUuid, payoffRanking: PAYOFF_RANKING }, { requestPrompt });
    expect(second).toEqual({ created: false, noteUuid: first.noteUuid });
    expect(requestPrompt).toHaveBeenCalledTimes(1);
  });

  it("builds its prose from the statistics without an AI, and leaves out an unranked quarter's payoff section", async () => {
    const app = maintenanceApp({ tasks: [] });
    const dataNoteUuid = await recordedDataNote(app);
    await saveRetrospectiveTakeaways(app, { ...SCOPE, dataNoteUuid }, { requestPrompt: null });
    const note = app.noteContent(retrospectiveTakeawaysNoteName(SCOPE));
    expect(note).toContain("You completed 53 tasks in Q3 2026, earning 1,610 Victory Value over 40h of scheduled time.");
    expect(note).toContain("Etsy shop led the quarter's projects in Victory Value.");
    expect(note).not.toContain("## What paid off");
  });

  it("refuses a retrospective that was never recorded", async () => {
    const app = maintenanceApp({ tasks: [] });
    await expect(saveRetrospectiveTakeaways(app, { ...SCOPE, dataNoteUuid: null }, { requestPrompt: null })).rejects.toThrow("wasn't saved");
  });
});

describe("takeaways prose and rows", () => {
  it("keeps only usable prose, cut at a full sentence when too long", () => {
    expect(writtenTakeaways({ months: [] })).toBeNull();
    expect(writtenTakeaways("text")).toBeNull();
    const written = writtenTakeaways({ months: [{ monthNumber: 4, text: "Nope." }, { monthNumber: 1, text: "Yes." }],
      summary: `${ "A sentence here. ".repeat(200) }` });
    expect(written.summary.length).toBeLessThanOrEqual(2200);
    expect(written.summary.endsWith(".")).toBe(true);
    expect([...written.months.keys()]).toEqual([1]);
    expect(written.calendar).toBeNull();
  });

  it("puts an empty paragraph between prose paragraphs while keeping a list together", () => {
    const written = { calendar: null, months: new Map(), paidOff: null, summary: "First line.\nSecond line.\n\n- One\n- Two" };
    const note = takeawaysMarkdown({ domainName: "Work", monthDigests: [], payoffRanking: null, projectRows: [],
      statistics: { quarter: 3, totalTaskCount: 1, year: 2026 }, written });
    expect(note).toContain("## Summary\n\nFirst line.\n\n\\\n\nSecond line.\n\n\\\n\n- One\n- Two\n\n|");
  });

  it("falls back to the ranked leaders for statistics saved before project totals", () => {
    const leader = { minutes: 90, name: "Etsy shop", taskCount: 3, victoryValue: 40 };
    const rows = takeawaysProjectRows({ doneAndOpenByProject: [{ doneCount: 3, name: "Etsy shop", openCount: 2, projectUuid: "project-etsy" },
      { doneCount: 0, name: "Garden", openCount: 5, projectUuid: "project-garden" }], leaders: { byMinutes: [leader], byTaskCount: [leader],
      byVictoryValue: [leader] } });
    expect(rows).toEqual([{ doneCount: 3, minutes: 90, name: "Etsy shop", openCount: 2, taskCount: 3, victoryValue: 40 },
      { doneCount: 0, minutes: null, name: "Garden", openCount: 5, taskCount: 0, victoryValue: null }]);
  });
});

describe("end card", () => {
  it("ends the story on the end card, whose Replay starts it over and replaces the footer's controls", async () => {
    const slides = slidesWithEndCard([{ caption: "", figure: null, headline: "Hi", id: "intro", items: [], kicker: "", tone: "intro" }], "Q3 2026");
    const renderInteractiveSlide = (slide, { onReplay }) => (slide.kind === SLIDE_KINDS.endCard ? createElement(RetrospectiveEndCard,
      { onGenerateNew: () => {}, onReplay, onSaveTakeaways: async () => {} }) : null);
    const container = await render(createElement(RetrospectiveStory, { label: "Q3 2026 retrospective", renderInteractiveSlide, slides }));
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" })); });
    expect(container.querySelector(".retrospective-slide-kicker").textContent).toBe("That was Q3 2026");
    expect(container.querySelector(".retrospective-story-control")).toBeNull();

    const replay = [...container.querySelectorAll(".retrospective-end-card-option")].find(button => button.textContent.includes("Replay"));
    await click(replay);
    expect(container.querySelector(".retrospective-story-counter").textContent).toBe("1 / 2");
  });

  it("says so when saving the takeaways fails, and offers to open a note already saved", async () => {
    const onSaveTakeaways = jest.fn(async () => { throw new Error("offline"); });
    const container = await render(createElement(RetrospectiveEndCard, { onGenerateNew: () => {}, onReplay: () => {}, onSaveTakeaways }));
    const saveButton = container.querySelector(".retrospective-options-primary");
    expect(saveButton.textContent).toBe("Save takeaways in a note");
    await click(saveButton);
    expect(container.querySelector("[role='alert']").textContent).toContain("Couldn't save");
    expect(saveButton.disabled).toBe(false);

    await act(async () => { mounted.root.render(createElement(RetrospectiveEndCard, { onGenerateNew: () => {}, onReplay: () => {}, onSaveTakeaways,
      takeawaysSaved: true })); });
    expect(saveButton.textContent).toBe("Open takeaways note");
  });
});
