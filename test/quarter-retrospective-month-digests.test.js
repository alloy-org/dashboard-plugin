// Verify the Quarter Retrospective's month digests: prompts packed by week under their size limit, replies kept only
// where they cite the tasks and images they were given, a split month's parts merged with each task in one theme,
// projects inferred from themes with each task in one project, a plain digest when no AI answers, digests reused from
// another style's generation, and generation turning inferred projects and digests into slides.
import { jest } from "@jest/globals";
import { digestRetrospectiveMonths, inferredProjectsFromReply, mergedMonthDigest, monthDigestPrompt, validatedMonthDigest,
  weekPackedBatches } from "dashboard/quarter-retrospective/retrospective-month-digests";
import { generateRetrospective } from "dashboard/quarter-retrospective/retrospective-generation";
import { retrospectiveSectionsFromContent } from "dashboard/quarter-retrospective/retrospective-data-note";
import { maintenanceApp } from "./project-maintenance-test-app";

// ----------------------------------------------------------------------------------------------
// @desc An enriched completion on a day of Q3 2026.
// @param {string} name - Distinguishes the task.
// @param {number} month - 7 through 9.
// @param {number} day - Day of the month.
// @param {object} [extra] - Fields to override.
// @returns {object} Completion.
function completion(name, month, day, extra = {}) {
  const dateKey = `2026-${ String(month).padStart(2, "0") }-${ String(day).padStart(2, "0") }`;
  return { completedMillis: new Date(2026, month - 1, day, 12).getTime(), dateKey, durationDefaulted: true, footnoteText: "", images: [],
    important: false, minutes: 60, noteName: null, noteTags: [], projectName: null, taskUuid: `task-${ name }`, text: `Task ${ name }`,
    victoryValue: 1, ...extra };
}

const QUARTER = { calendar: null, inferProjects: false, media: [], quarter: 3, year: 2026 };

describe("month digest prompts", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Whole weeks share a prompt while they fit, and a week larger than one prompt is split by task.
  it("packs whole weeks under the limit and splits a week too large for one", () => {
    const record = (id, dateKey) => ({ dateKey, id, text: "x".repeat(80) });
    const records = [record("t1", "2026-07-06"), record("t2", "2026-07-07"), record("t3", "2026-07-13"), record("t4", "2026-07-14")];
    const lineSize = JSON.stringify({ id: "t1", text: "x".repeat(80) }).length + 1;
    expect(weekPackedBatches(records, lineSize * 2).map(batch => batch.map(item => item.id))).toEqual([["t1", "t2"], ["t3", "t4"]]);
    expect(weekPackedBatches(records, lineSize * 3).map(batch => batch.map(item => item.id))).toEqual([["t1", "t2"], ["t3", "t4"]]);
    expect(weekPackedBatches(records, lineSize).map(batch => batch.map(item => item.id))).toEqual([["t1"], ["t2"], ["t3"], ["t4"]]);
    expect(weekPackedBatches(records, lineSize * 4)).toHaveLength(1);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A prompt names its part and dates, carries one line per task without the date key, and the calendar only
  //   when given.
  it("describes the month part, its tasks, and its calendar", () => {
    const batch = { imageIds: new Set(), records: [{ dateKey: "2026-07-06", day: "07-06", id: "t1", text: "Ship it", vv: 5 }] };
    const prompt = monthDigestPrompt({ batch, batchCount: 2, batchIndex: 0, calendarCategories: [{ category: "1:1s", eventCount: 4, minutes: 120,
      recurringEventCount: 4, sampleTitles: ["Weekly sync"] }], monthName: "July", monthNumber: 1, quarter: 3, year: 2026 });
    expect(prompt).toContain("part 1 of 2");
    expect(prompt).toContain('{"day":"07-06","id":"t1","text":"Ship it","vv":5}');
    expect(prompt).toContain('"hours":2');
    expect(prompt).toContain("calendarNarrative: one sentence");
  });
});

describe("month digest replies", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Invented tasks and images are dropped, a task claimed by two themes stays in the first, and a reply with
  //   nothing grounded reads as no reply.
  it("keeps only what cites the tasks and images offered", () => {
    const reply = { calendarNarrative: "Meetings everywhere", highlights: [{ summary: "Shipped the app", taskIds: ["t1", "t9"] },
      { summary: "Invented", taskIds: ["t9"] }], imageIds: ["i1", "i7"], mood: "  heads-down  ", notableMoments: ["A", "A", 4],
      themes: [{ name: "Launch", taskIds: ["t1", "t2"] }, { name: "Chores", taskIds: ["t2", "t3"] }] };
    const digest = validatedMonthDigest(reply, { imageIds: new Set(["i1"]), includeCalendar: false, taskIds: new Set(["t1", "t2", "t3"]) });
    expect(digest).toEqual({ calendarNarrative: null, highlights: [{ summary: "Shipped the app", taskIds: ["t1"] }], imageIds: ["i1"],
      mood: "heads-down", notableMoments: ["A"], themes: [{ name: "Launch", taskIds: ["t1", "t2"] }, { name: "Chores", taskIds: ["t3"] }] });
    expect(validatedMonthDigest({ highlights: [{ summary: "x", taskIds: ["t9"] }] }, { imageIds: new Set(), taskIds: new Set(["t1"]) })).toBeNull();
    expect(validatedMonthDigest("not json", { imageIds: new Set(), taskIds: new Set() })).toBeNull();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Parts merge in order; themes of one name join, and a task keeps the first theme that claimed it.
  it("merges a split month's parts", () => {
    const first = { calendarNarrative: "Busy", highlights: [{ summary: "A", taskIds: ["t1"] }], imageIds: ["i1"], mood: "steady",
      notableMoments: ["M1"], themes: [{ name: "Launch", taskIds: ["t1"] }] };
    const second = { calendarNarrative: null, highlights: [{ summary: "B", taskIds: ["t3"] }], imageIds: ["i1", "i2"], mood: "rushed",
      notableMoments: [], themes: [{ name: "launch", taskIds: ["t3", "t1"] }, { name: "Hiring", taskIds: ["t4"] }] };
    expect(mergedMonthDigest([first, second])).toEqual({ calendarNarrative: "Busy", highlights: [{ summary: "A", taskIds: ["t1"] },
      { summary: "B", taskIds: ["t3"] }], imageIds: ["i1", "i2"], mood: "steady · rushed", notableMoments: ["M1"],
    themes: [{ name: "Launch", taskIds: ["t1", "t3"] }, { name: "Hiring", taskIds: ["t4"] }] });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A task whose themes two projects claim goes to the first; a theme claimed twice stays with the first, and a
  //   project with no known themes is dropped.
  it("infers projects with each task in exactly one", () => {
    const themeEntries = [{ name: "Launch prep", taskUuids: ["a", "b"], themeId: "th1" }, { name: "Launch", taskUuids: ["b", "c"], themeId: "th2" },
      { name: "Hiring", taskUuids: ["d"], themeId: "th3" }];
    const reply = { projects: [{ name: "Hiring", themeIds: ["th3"] }, { name: "Ship v2", summary: "The launch.", themeIds: ["th1", "th2"] },
      { name: "Again", themeIds: ["th3"] }, { name: "Ghost", themeIds: ["th9"] }] };
    const projects = inferredProjectsFromReply(reply, themeEntries);
    expect(projects.map(project => [project.name, project.taskUuids])).toEqual([["Ship v2", ["a", "b", "c"]], ["Hiring", ["d"]]]);
    expect(projects[0]).toMatchObject({ derivedFrom: "themes", summary: "The launch.", uuid: expect.stringMatching(/^theme-/) });
  });
});

describe("digestRetrospectiveMonths", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Each month's prompt is answered, its ids mapped back to task UUIDs and image URLs, and the months' themes
  //   merged into projects.
  it("digests each month and infers projects from the themes", async () => {
    const completions = [completion("a", 7, 6, { images: [{ alt: "Cover", url: "https://x.com/a.png" }] }), completion("b", 7, 8),
      completion("c", 8, 3), completion("d", 9, 1)];
    const requestPrompt = jest.fn(async prompt => {
      if (prompt.includes("Merge them into")) return { projects: [{ name: "Ship the book", themeIds: ["th1", "th2"] }] };
      const taskIds = [...prompt.matchAll(/"id":"(t\d+)"/g)].map(match => match[1]);
      return { highlights: [{ summary: "Did it", taskIds: [taskIds[0]] }], imageIds: ["i1"], mood: "good",
        themes: [{ name: "Writing", taskIds }] };
    });
    const progress = [];
    const result = await digestRetrospectiveMonths({ ...QUARTER, completions, inferProjects: true, media: [{ alt: "Cover", url: "https://x.com/a.png" }] },
      { onProgress: message => progress.push(message), requestPrompt });
    expect(requestPrompt).toHaveBeenCalledTimes(4);
    expect(result.monthDigests.map(digest => [digest.monthName, digest.taskCount, digest.generatedBy])).toEqual([["July", 2, "ai"],
      ["August", 1, "ai"], ["September", 1, "ai"]]);
    expect(result.monthDigests[0]).toMatchObject({ highlights: [{ summary: "Did it", taskUuids: ["task-a"] }], imageUrls: ["https://x.com/a.png"],
      themes: [{ name: "Writing", taskUuids: ["task-a", "task-b"] }] });
    expect(result.inferredProjects).toEqual([expect.objectContaining({ name: "Ship the book", taskUuids: ["task-a", "task-b", "task-c"] })]);
    expect(progress).toEqual(["Summarizing July, August, and September…", "Finding the projects your tasks added up to…"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Without an AI each month gets its most valuable tasks as highlights and its projects as themes, and the
  //   inferred projects are those themes.
  it("builds plain digests when no AI can answer", async () => {
    const completions = [completion("a", 7, 6, { projectName: "Garden", victoryValue: 2 }), completion("b", 7, 8, { important: true }),
      completion("c", 8, 3, { projectName: "Garden" })];
    const result = await digestRetrospectiveMonths({ ...QUARTER, completions, inferProjects: true }, { requestPrompt: null });
    expect(result.monthDigests[0]).toMatchObject({ generatedBy: "fallback", highlights: [{ summary: "Task b", taskUuids: ["task-b"] },
      { summary: "Task a", taskUuids: ["task-a"] }], themes: [{ name: "Garden", taskUuids: ["task-a"] }] });
    expect(result.monthDigests[2]).toMatchObject({ highlights: [], taskCount: 0 });
    expect(result.inferredProjects.map(project => [project.name, project.taskUuids])).toEqual([["Garden", ["task-a", "task-c"]]]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A month the AI digested before from the same tasks is reused; one whose tasks changed is asked again, and a
  //   month with no tasks needs no prompt.
  it("reuses an earlier AI digest when the month's tasks are unchanged", async () => {
    const completions = [completion("a", 7, 6), completion("b", 8, 3), completion("c", 8, 4)];
    const earlier = month => ({ calendar: null, generatedBy: "ai", highlights: [], monthNumber: month, taskCount: 1, themes: [], version: 1 });
    const earlierDigests = [earlier(1), earlier(2), earlier(3)];
    const requestPrompt = jest.fn(async () => ({ highlights: [{ summary: "New", taskIds: ["t2"] }] }));
    const result = await digestRetrospectiveMonths({ ...QUARTER, completions, reusableDigests: earlierDigests }, { requestPrompt });
    expect(result.monthDigests[0]).toBe(earlierDigests[0]);
    expect(result.monthDigests[1]).toMatchObject({ generatedBy: "ai", highlights: [{ summary: "New", taskUuids: ["task-b"] }], taskCount: 2 });
    expect(result.monthDigests[2]).toMatchObject({ generatedBy: "fallback", taskCount: 0 });
    expect(requestPrompt).toHaveBeenCalledTimes(1);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc When every month is reused, the projects inferred alongside them are reused too, with no prompt at all.
  it("reuses inferred projects when every month was reused", async () => {
    const completions = [completion("a", 7, 6)];
    const earlier = (month, taskCount) => ({ calendar: null, generatedBy: "ai", highlights: [], monthNumber: month, taskCount, themes: [], version: 1 });
    const recorded = [{ derivedFrom: "themes", name: "Garden", taskUuids: ["task-a"], uuid: "theme-1" }];
    const requestPrompt = jest.fn();
    const result = await digestRetrospectiveMonths({ ...QUARTER, completions, inferProjects: true, reusableDigests: [earlier(1, 1), earlier(2, 0),
      earlier(3, 0)], reusableInferredProjects: recorded }, { requestPrompt });
    expect(result.inferredProjects).toBe(recorded);
    expect(requestPrompt).not.toHaveBeenCalled();
  });
});

describe("generation with month digests", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A quarter with no projects gets its projects inferred, so the project slides and the month-by-month slide
  //   appear, and the inferred projects are recorded.
  it("ranks inferred projects and shows each month's highlight", async () => {
    const app = maintenanceApp({ tasks: [] });
    const completedAt = day => Math.floor(new Date(2026, 6, day, 12).getTime() / 1000);
    app.getCompletedTasks = jest.fn(async () => [{ completedAt: completedAt(6), content: "Draft chapter one", uuid: "task-1", victoryValue: 4 },
      { completedAt: completedAt(7), content: "Draft chapter two", uuid: "task-2", victoryValue: 3 }]);
    const requestPrompt = async prompt => {
      if (prompt.includes("Merge them into")) return { projects: [{ name: "Write the book", themeIds: ["th1"] }] };
      if (!prompt.includes('"id":"t1"')) return null;
      return { highlights: [{ summary: "Two chapters drafted", taskIds: ["t1", "t2"] }], themes: [{ name: "Drafting", taskIds: ["t1", "t2"] }] };
    };
    const request = { domainName: "Work", domainUuid: "work-domain", options: {}, quarter: 3, style: "data", year: 2026 };
    const generated = await generateRetrospective(app, request, { requestPrompt });
    const victorySlide = generated.slides.find(slide => slide.id === "project-victory");
    expect(victorySlide).toMatchObject({ caption: "7 Victory Value across 2 tasks. Projects inferred from your tasks.", headline: "Write the book" });
    const monthSlide = generated.slides.find(slide => slide.id === "month-by-month");
    expect(monthSlide.items).toEqual([{ label: "July: Two chapters drafted", value: "2 tasks" }, { label: "August: A quieter month", value: "0 tasks" },
      { label: "September: A quieter month", value: "0 tasks" }]);
    const { payloads } = retrospectiveSectionsFromContent(app.noteContent("Work Q3 2026 Data Retrospective Data"));
    expect(payloads.get("Projects").projects).toEqual([expect.objectContaining({ derivedFrom: "themes", name: "Write the book" })]);
    expect(payloads.get("Month 2")).toMatchObject({ generatedBy: "fallback", taskCount: 0 });
  });
});
