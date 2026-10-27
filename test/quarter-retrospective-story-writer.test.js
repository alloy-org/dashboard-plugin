// Verify the Quarter Retrospective's story generation: the progress heap's blocks and the pile they make, the AI's
// words merged into the slides built from statistics with every number checked, photo and genre slides, the Data
// style needing no call, a Roast generation recorded end to end, and each kind of slide drawn.
import { jest } from "@jest/globals";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { generateRetrospective } from "dashboard/quarter-retrospective/retrospective-generation";
import { retrospectiveSectionsFromContent } from "dashboard/quarter-retrospective/retrospective-data-note";
import { heapColumnCount, progressHeapLayout } from "dashboard/quarter-retrospective/retrospective-heap-layout";
import { slidesFromStatistics } from "dashboard/quarter-retrospective/retrospective-slides";
import { retrospectiveStatistics } from "dashboard/quarter-retrospective/retrospective-statistics";
import { storyImageOffers, writeRetrospectiveStory, writtenStorySlides } from "dashboard/quarter-retrospective/retrospective-story-writer";
import { maintenanceApp } from "./project-maintenance-test-app";

const { default: RetrospectiveSlide, imageLayoutFromDimensions } = await import("dashboard/quarter-retrospective/retrospective-slide");

// ----------------------------------------------------------------------------------------------
// @desc A completed task, completed at local noon on a day of July 2026.
// @param {string} uuid - Task UUID.
// @param {number} day - Day of July.
// @param {number} victoryValue - The task's Victory Value.
// @returns {object} Task with timestamps in seconds.
function completedTask(uuid, day, victoryValue = 1) {
  return { completedAt: Math.floor(new Date(2026, 6, day, 12).getTime() / 1000), content: `Task ${ uuid }`, uuid, victoryValue };
}

// ----------------------------------------------------------------------------------------------
// @desc Ledger entries for tasks completed on July 10, each in the project named.
// @param {Array<Array<string>>} pairs - [taskUuid, projectName] per entry; a null project name means no project.
// @returns {Map<string, Array<object>>} Entries by date key.
function ledgerOnJulyTenth(pairs) {
  const entries = pairs.map(([taskUuid, projectName]) => ({ dateKey: "2026-07-10", projectName, projectUuid: projectName ? `project-${ projectName }` : null,
    taskText: `Task ${ taskUuid }`, taskUuid }));
  return new Map([["2026-07-10", entries]]);
}

// ----------------------------------------------------------------------------------------------
// @desc Statistics and slides for a quarter of five tasks, three in Launch and one in Garden.
// @returns {object} { baseSlides, statistics }.
function sortedQuarter() {
  const completedTasks = ["a", "b", "c", "d", "e"].map((uuid, index) => completedTask(uuid, 10, index + 1));
  const entriesByDate = ledgerOnJulyTenth([["a", "Launch"], ["b", "Launch"], ["c", "Launch"], ["d", "Garden"], ["e", null]]);
  const statistics = retrospectiveStatistics({ completedTasks, entriesByDate, quarter: 3, year: 2026 });
  return { baseSlides: slidesFromStatistics(statistics), statistics };
}

describe("progress heap", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Projects take colors by task count, a task in no project takes none, and sizes rise with Victory Value.
  it("colors blocks by project and sizes them by Victory Value", () => {
    const { statistics } = sortedQuarter();
    expect(statistics.progressHeap.legend).toEqual([{ label: "Launch", slot: 1, taskCount: 3 }, { label: "Garden", slot: 2, taskCount: 1 }]);
    expect(statistics.progressHeap.blocks).toEqual([[1, 1], [1, 1], [1, 1], [2, 2], [0, 3]]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Past six projects, the five busiest keep their colors and the rest share the sixth as "Other projects".
  it("shares the last color among the smaller projects", () => {
    const pairs = ["p1", "p1", "p2", "p3", "p4", "p5", "p6", "p7"].map((projectName, index) => [`t${ index }`, projectName]);
    const completedTasks = pairs.map(([uuid]) => completedTask(uuid, 10));
    const statistics = retrospectiveStatistics({ completedTasks, entriesByDate: ledgerOnJulyTenth(pairs), quarter: 3, year: 2026 });
    const legend = statistics.progressHeap.legend;
    expect(legend).toHaveLength(6);
    expect(legend[0]).toEqual({ label: "p1", slot: 1, taskCount: 2 });
    expect(legend[5]).toEqual({ label: "Other projects", slot: 6, taskCount: 2 });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Every block lands on the one beneath it, the pile peaks near the middle, and the same blocks make the
  //   same pile.
  it("piles the blocks into a mountain", () => {
    const blocks = Array.from({ length: 300 }, (unused, index) => [index % 3, (index % 5) + 1 > 3 ? 1 : (index % 5) + 1]);
    const layout = progressHeapLayout(blocks);
    expect(layout.columnCount % 2).toBe(1);
    expect(layout.placed).toHaveLength(300);
    const heights = new Array(layout.columnCount).fill(0);
    for (const block of layout.placed) {
      expect(block.bottom).toBe(heights[block.column]);
      heights[block.column] += block.size;
    }
    const middle = (layout.columnCount - 1) / 2;
    expect(heights[middle]).toBeGreaterThan(heights[0] * 2);
    expect(Math.max(...heights)).toBe(layout.height);
    expect(progressHeapLayout(blocks)).toEqual(layout);
    expect(heapColumnCount(0)).toBe(9);
    expect(heapColumnCount(100000)).toBe(41);
  });
});

describe("story replies", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Words are rewritten while figures and lists stay, a line citing a number the slide lacks is put back, an
  //   overlong line is put back, and an unknown slide id is ignored.
  it("rewrites words but never numbers the facts don't hold", () => {
    const { baseSlides, statistics } = sortedQuarter();
    const reply = { slides: [{ caption: "5 tasks. Somebody was busy.", headline: "You actually did things", id: "intro", kicker: "Brace yourself" },
      { caption: "Launch ate 99 hours of your life.", headline: "Launch, again", id: "project-tasks", kicker: "x".repeat(60) },
      { caption: "Made up", headline: "Ghost", id: "nonexistent", kicker: "Boo" }] };
    const written = writtenStorySlides(reply, { baseSlides, imageOffers: [], statistics, style: "roast" });
    const intro = written.slides.find(slide => slide.id === "intro");
    const baseIntro = baseSlides.find(slide => slide.id === "intro");
    expect(intro).toEqual({ ...baseIntro, caption: "5 tasks. Somebody was busy.", headline: "You actually did things", kicker: "Brace yourself" });
    const projectTasks = written.slides.find(slide => slide.id === "project-tasks");
    const baseProjectTasks = baseSlides.find(slide => slide.id === "project-tasks");
    expect(projectTasks).toEqual({ ...baseProjectTasks, headline: "Launch, again" });
    expect(written.slides.map(slide => slide.id)).toEqual(baseSlides.map(slide => slide.id));
    expect(writtenStorySlides({ slides: [] }, { baseSlides, imageOffers: [], statistics, style: "roast" })).toBeNull();
    expect(writtenStorySlides("nope", { baseSlides, imageOffers: [], statistics, style: "roast" })).toBeNull();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Photo slides show only offered images, each once, after the slide they name or before the summary, and a
  //   Spotify story gains its genre before the summary.
  it("adds photo slides from offered images and a Spotify genre", () => {
    const { baseSlides, statistics } = sortedQuarter();
    const monthDigests = [{ imageUrls: ["https://x.com/a.png", "https://x.com/gone.png"], monthName: "July" }, { imageUrls: ["https://x.com/a.png"],
      monthName: "August" }];
    const media = [{ alt: "Launch party", footnoteText: "We shipped", url: "https://x.com/a.png" }];
    const imageOffers = storyImageOffers(monthDigests, media);
    expect(imageOffers).toEqual([{ alt: "Launch party", context: "We shipped", id: "i1", monthName: "July", taskText: "", url: "https://x.com/a.png" }]);
    const reply = { genre: { caption: "Heads down, ship it.", name: "Deep-Focus Builder" }, imageSlides: [{ afterSlideId: "intro", caption: "Worth it",
      headline: "Launch night", imageId: "i1", kicker: "July" }, { afterSlideId: "intro", headline: "Again", imageId: "i1" },
    { headline: "Invented", imageId: "i9" }], slides: [{ caption: "Five whole tasks", headline: "Your quarter", id: "intro", kicker: "Wrapped" }] };
    const written = writtenStorySlides(reply, { baseSlides, imageOffers, statistics, style: "spotify" });
    const slideIds = written.slides.map(slide => slide.id);
    expect(slideIds.slice(0, 2)).toEqual(["intro", "image-i1"]);
    expect(slideIds.slice(-2)).toEqual(["personality", "summary"]);
    expect(written.slides[1]).toMatchObject({ headline: "Launch night", imageUrl: "https://x.com/a.png", kind: "image" });
    expect(written.slides.at(-2)).toMatchObject({ caption: "Heads down, ship it.", headline: "Deep-Focus Builder", kicker: "Your quarter's genre" });
    expect(written.imageUrls).toEqual(["https://x.com/a.png"]);

    const roast = writtenStorySlides(reply, { baseSlides, imageOffers, statistics, style: "roast" });
    expect(roast.slides.some(slide => slide.id === "personality")).toBe(false);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A photo slide's caption is the text of the task holding its image, and a reply that gives the slide no
  //   headline gets the archive headline rather than losing the photo.
  it("captions photo slides with their task's text", () => {
    const { baseSlides, statistics } = sortedQuarter();
    const monthDigests = [{ imageUrls: ["https://x.com/a.png"], monthName: "July" }];
    const media = [{ alt: "Launch party", footnoteText: "We shipped", taskText: "Ship the beta launch", url: "https://x.com/a.png" }];
    const imageOffers = storyImageOffers(monthDigests, media);
    const reply = { imageSlides: [{ afterSlideId: "intro", caption: "Invented caption", imageId: "i1" }],
      slides: [{ caption: "Five whole tasks", headline: "Your quarter", id: "intro", kicker: "Wrapped" }] };
    const written = writtenStorySlides(reply, { baseSlides, imageOffers, statistics, style: "roast" });
    const photoSlide = written.slides.find(slide => slide.kind === "image");
    expect(photoSlide).toMatchObject({ caption: "Ship the beta launch", headline: `A Q${ statistics.quarter } moment from the archives…`,
      kicker: "July" });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The Data style asks nothing; a styled story whose call fails keeps the plain words and says so.
  it("asks nothing for Data and falls back when the call fails", async () => {
    const { baseSlides, statistics } = sortedQuarter();
    const requestPrompt = jest.fn(async () => { throw new Error("timeout"); });
    const storyInput = { baseSlides, media: [], monthDigests: [], statistics };
    const data = await writeRetrospectiveStory({ ...storyInput, style: "data" }, { requestPrompt });
    expect(data).toEqual({ generatedBy: "statistics", imageUrls: [], slides: baseSlides });
    expect(requestPrompt).not.toHaveBeenCalled();
    const roast = await writeRetrospectiveStory({ ...storyInput, style: "roast" }, { requestPrompt });
    expect(roast).toEqual({ generatedBy: "fallback", imageUrls: [], slides: baseSlides });
    const prompt = requestPrompt.mock.calls[0][0];
    expect(prompt).toContain("Never joke about health");
    expect(prompt).toContain('"id":"progress-heap"');
    expect(prompt).not.toContain("blocks");
  });
});

describe("Roast generation", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A Roast retrospective records the AI's words, the images it showed, and that the AI wrote the story.
  it("records the written story and the images it shows", async () => {
    const app = maintenanceApp({ tasks: [] });
    const completedAt = day => Math.floor(new Date(2026, 6, day, 12).getTime() / 1000);
    app.getCompletedTasks = jest.fn(async () => [{ completedAt: completedAt(6), content: "Ship the beta ![Beta launch](https://x.com/beta.png)",
      uuid: "task-1", victoryValue: 4 }]);
    const requestPrompt = jest.fn(async prompt => {
      if (prompt.includes("Write the words for a Roast")) {
        return { imageSlides: [{ afterSlideId: "intro", caption: "Look at you.", headline: "Shipped, somehow", imageId: "i1", kicker: "Exhibit A" }],
          slides: [{ caption: "One task. Pace yourself.", headline: "Wrapped, barely", id: "intro", kicker: "Roast incoming" }] };
      }
      return { highlights: [{ summary: "Shipped the beta", taskIds: ["t1"] }], imageIds: ["i1"], themes: [{ name: "Beta", taskIds: ["t1"] }] };
    });
    const progress = [];
    const request = { domainName: "Work", domainUuid: "work-domain", options: {}, quarter: 3, style: "roast", year: 2026 };
    const generated = await generateRetrospective(app, request, { onProgress: message => progress.push(message), requestPrompt });
    expect(generated.slides.slice(0, 2).map(slide => slide.headline)).toEqual(["Wrapped, barely", "Shipped, somehow"]);
    expect(progress).toContain("Writing your Roast story…");
    const { payloads } = retrospectiveSectionsFromContent(app.noteContent("Work Q3 2026 Roast Retrospective Data"));
    expect(payloads.get("Story").generatedBy).toBe("ai");
    expect(payloads.get("Media").chosen).toEqual(["https://x.com/beta.png"]);
  });
});

describe("slide kinds", () => {
  let mounted = null;

  // ----------------------------------------------------------------------------------------------
  // @desc Mount one slide.
  // @param {object} slide - The slide.
  // @returns {Promise<HTMLElement>} The mount point.
  async function renderSlide(slide) {
    const mountPoint = document.createElement("div");
    document.body.appendChild(mountPoint);
    const root = createRoot(mountPoint);
    await act(async () => { root.render(createElement(RetrospectiveSlide, { slide })); });
    mounted = { mountPoint, root };
    return mountPoint;
  }

  afterEach(async () => {
    if (!mounted) return;
    await act(async () => { mounted.root.unmount(); });
    mounted.mountPoint.remove();
    mounted = null;
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The heap draws one block per task with a legend, and the timeline one column per month with its note.
  it("draws the heap and the timeline", async () => {
    const { baseSlides } = sortedQuarter();
    const heapSlide = baseSlides.find(slide => slide.id === "progress-heap");
    const heapMount = await renderSlide(heapSlide);
    expect(heapMount.querySelectorAll(".retrospective-heap-block")).toHaveLength(5);
    expect([...heapMount.querySelectorAll(".retrospective-heap-legend-entry")].map(entry => entry.textContent)).toEqual(["Launch (3)", "Garden (1)", "No project (1)"]);
    expect(heapMount.querySelector(".retrospective-heap-pile").getAttribute("aria-label")).toBe("A pile of 5 completed tasks");
    await act(async () => { mounted.root.unmount(); });
    mounted.mountPoint.remove();

    const timelineSlide = { ...baseSlides.find(slide => slide.id === "month-by-month") };
    timelineSlide.columns = timelineSlide.columns.map((column, index) => ({ ...column, note: index ? "" : "Launch week" }));
    const timelineMount = await renderSlide(timelineSlide);
    const months = [...timelineMount.querySelectorAll(".retrospective-slide-timeline-month")];
    expect(months.map(month => month.querySelector(".retrospective-slide-timeline-label").textContent)).toEqual(["July", "August", "September"]);
    expect(months[0].querySelector(".retrospective-slide-timeline-note").textContent).toBe("Launch week");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A project name longer than fifty characters is cut short in the legend, keeping its task count.
  it("truncates long project names in the heap legend", async () => {
    const { baseSlides } = sortedQuarter();
    const heapSlide = baseSlides.find(slide => slide.id === "progress-heap");
    const longName = "Amplenote effectively markets dashboard, mood tracking, and assignment";
    const legend = heapSlide.heap.legend.map((entry, index) => (index ? entry : { ...entry, label: longName }));
    const heapMount = await renderSlide({ ...heapSlide, heap: { ...heapSlide.heap, legend } });
    const firstEntryText = heapMount.querySelector(".retrospective-heap-legend-entry").textContent;
    expect(firstEntryText).toBe("Amplenote effectively markets dashboard, mood tra… (3)");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Bars show done and open per project, and a photo that fails to load leaves the words on the slide's tone.
  it("draws bars and drops a photo that fails to load", async () => {
    const barsMount = await renderSlide({ bars: [{ done: 6, label: "Launch", open: 2 }], caption: "", figure: null, headline: "Done vs. still open",
      id: "done-and-open", items: [], kicker: "Where each project stood", kind: "bars", tone: "forest" });
    expect(barsMount.querySelector(".retrospective-slide-bar-value").textContent).toBe("6 done · 2 open");
    expect(barsMount.querySelector(".retrospective-slide-bar-done").style.width).toBe("75%");
    await act(async () => { mounted.root.unmount(); });
    mounted.mountPoint.remove();

    const imageMount = await renderSlide({ caption: "Worth it", figure: null, headline: "Launch night", id: "image-i1", imageUrl: "https://x.com/a.png",
      items: [], kicker: "July", kind: "image", tone: "dusk" });
    const photo = imageMount.querySelector(".retrospective-slide-photo");
    expect(photo.getAttribute("src")).toBe("https://x.com/a.png");
    await act(async () => { photo.dispatchEvent(new Event("error")); });
    expect(imageMount.querySelector(".retrospective-slide-photo")).toBeNull();
    expect(imageMount.querySelector(".retrospective-slide-headline").textContent).toBe("Launch night");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A photo stays hidden until it loads; a wide screenshot is then framed whole, and a photo about the slide's
  //   shape fills it.
  it("picks a photo's layout from its shape once it loads", async () => {
    const photoSlide = { caption: "Ship the beta", figure: null, headline: "A Q3 moment from the archives…", id: "image-i1",
      imageUrl: "https://x.com/a.png", items: [], kicker: "July", kind: "image", tone: "dusk" };
    const imageMount = await renderSlide(photoSlide);
    const photo = imageMount.querySelector(".retrospective-slide-photo");
    expect(photo.classList.contains("retrospective-slide-photo--shown")).toBe(false);
    Object.defineProperty(photo, "naturalWidth", { value: 2400 });
    Object.defineProperty(photo, "naturalHeight", { value: 1350 });
    await act(async () => { photo.dispatchEvent(new Event("load")); });
    expect(imageMount.querySelector(".retrospective-slide--image-framed")).not.toBeNull();
    expect(photo.classList.contains("retrospective-slide-photo--shown")).toBe(true);

    expect(imageLayoutFromDimensions({ height: 1600, slideAspect: 9 / 16, width: 900 })).toBe("fill");
    expect(imageLayoutFromDimensions({ height: 1000, slideAspect: 9 / 16, width: 1000 })).toBe("framed");
    expect(imageLayoutFromDimensions({ height: 0, slideAspect: 9 / 16, width: 0 })).toBe("framed");
  });
});
