// Quarter Retrospective statistics and slides: completions joined to the completed task ledger, project rankings,
// important tasks, intent alignment, done and open tasks per project, the quarter's rhythm and meetings, the change
// from the quarter before, and the slides built from them.
import { jest } from "@jest/globals";
import { gatherRetrospectiveQuarter } from "dashboard/quarter-retrospective/retrospective-data";
import { quarterBefore } from "constants/quarters";
import { formattedMinutes, SHORT_SLIDE_DURATION_FACTOR, slideDurationFactor, slidesFromStatistics, slideWordCount } from "dashboard/quarter-retrospective/retrospective-slides";
import { quarterTotals, retrospectiveStatistics, retrospectiveTaskText, scheduledMinutes } from "dashboard/quarter-retrospective/retrospective-statistics";

const HOUR_SECONDS = 60 * 60;

// ----------------------------------------------------------------------------------------------
// @desc A completed task, completed at local noon on the given Q3 2026 day.
// @param {string} uuid - Task UUID.
// @param {object} options - { createdDay, day, duration, endHour, important, month, startHour, victoryValue }.
// @returns {object} Task with timestamps in seconds, as the Amplenote API reports them.
function completedTask(uuid, { createdDay = null, day = 10, duration = null, endHour = null, important = false, month = 7,
    startHour = null, victoryValue = 1 } = {}) {
  const seconds = (hour, dayOfMonth = day) => Math.floor(new Date(2026, month - 1, dayOfMonth, hour).getTime() / 1000);
  return { completedAt: seconds(12), content: `Task ${ uuid }`, createdAt: createdDay === null ? null : seconds(9, createdDay),
    duration, endAt: endHour === null ? null : seconds(endHour), important, startAt: startHour === null ? null : seconds(startHour),
    uuid, victoryValue };
}

// ----------------------------------------------------------------------------------------------
// @desc A ledger entry for a task completed on a date key.
function ledgerEntry(taskUuid, dateKey, project = null, extra = {}) {
  return { dateKey, projectName: project?.name || null, projectUuid: project?.uuid || null, taskText: `Task ${ taskUuid }`, taskUuid,
    ...extra };
}

const launch = { name: "Launch the app", uuid: "project-launch" };
const fitness = { name: "Get fit", uuid: "project-fitness" };

describe("retrospectiveStatistics", () => {
  it("ranks projects by victory value, task count, and scheduled minutes", () => {
    const completedTasks = [completedTask("a", { endHour: 11, startHour: 9, victoryValue: 5 }),
      completedTask("b", { day: 11, victoryValue: 2 }), completedTask("c", { day: 11, victoryValue: 1 }),
      completedTask("d", { day: 12, duration: HOUR_SECONDS, victoryValue: 9 })];
    const entriesByDate = new Map([["2026-07-10", [ledgerEntry("a", "2026-07-10", launch)]],
      ["2026-07-11", [ledgerEntry("b", "2026-07-11", fitness), ledgerEntry("c", "2026-07-11", fitness)]],
      ["2026-07-12", [ledgerEntry("d", "2026-07-12", launch)]]]);
    const statistics = retrospectiveStatistics({ completedTasks, entriesByDate, quarter: 3, year: 2026 });

    expect(statistics.totalVictoryValue).toBe(17);
    expect(statistics.leaders.byVictoryValue.map(project => project.name)).toEqual(["Launch the app", "Get fit"]);
    expect(statistics.leaders.byTaskCount.map(project => [project.name, project.taskCount])).toEqual([["Launch the app", 2], ["Get fit", 2]]);
    expect(statistics.leaders.byMinutes).toEqual([{ minutes: 180, name: "Launch the app", taskCount: 2, victoryValue: 14 },
      { minutes: 120, name: "Get fit", taskCount: 2, victoryValue: 3 }]);
    expect(statistics.projectTotals.map(project => [project.projectUuid, project.taskCount, project.victoryValue])).toEqual([[launch.uuid, 2, 14],
      [fitness.uuid, 2, 3]]);
    expect(statistics.totalMinutes).toBe(300);
    expect(statistics.defaultedDurationCount).toBe(2);
  });

  it("counts done and open tasks per project, the quarter's rhythm, and its meetings", () => {
    const completedTasks = [completedTask("a", { day: 30 }), completedTask("b", { day: 31 }), completedTask("c", { day: 1, month: 8 }),
      completedTask("d", { day: 9, month: 9 })];
    const entriesByDate = new Map([["2026-07-30", [ledgerEntry("a", "2026-07-30", launch)]]]);
    const stalled = { name: "Write the book", uuid: "project-book" };
    const openCountByProject = new Map([[launch.uuid, 3], [stalled.uuid, 4], [fitness.uuid, 0]]);
    const meeting = attendeeCount => ({ allDay: false, attendeeCount, end: "2026-07-30T15:00:00.000Z", start: "2026-07-30T14:30:00.000Z",
      title: "Sync" });
    const calendarDays = new Map([["2026-07-30", { events: [meeting(1), meeting(1), meeting(8), { ...meeting(3), allDay: true }] }]]);
    const statistics = retrospectiveStatistics({ calendarDays, completedTasks, entriesByDate, openCountByProject,
      projects: [launch, stalled, fitness], quarter: 3, year: 2026 });

    expect(statistics.doneAndOpenByProject).toEqual([{ doneCount: 1, name: "Launch the app", openCount: 3, projectUuid: launch.uuid },
      { doneCount: 0, name: "Write the book", openCount: 4, projectUuid: stalled.uuid }]);
    expect(statistics.monthlyTaskCounts).toEqual([2, 1, 1]);
    expect(statistics.longestStreak).toEqual({ days: 3, endDateKey: "2026-08-01", startDateKey: "2026-07-30" });
    expect(statistics.firstAndLastCompletion).toEqual({ first: { dateKey: "2026-07-30", text: "Task a" },
      last: { dateKey: "2026-09-09", text: "Task d" } });
    expect(statistics.meetingMinutesByCategory).toMatchObject([{ category: "1:1s", eventCount: 2, minutes: 60 },
      { category: "Large meetings", eventCount: 1, minutes: 30 }]);
    expect(retrospectiveStatistics({ completedTasks, entriesByDate, quarter: 3, year: 2026 }).meetingMinutesByCategory).toBeNull();
  });

  it("counts work outside projects apart from work the ledger never sorted", () => {
    const completedTasks = [completedTask("a"), completedTask("b"), completedTask("c"), completedTask("d")];
    const entriesByDate = new Map([["2026-07-10", [ledgerEntry("a", "2026-07-10", launch), ledgerEntry("b", "2026-07-10"),
      ledgerEntry("c", "2026-07-10")]]]);
    const statistics = retrospectiveStatistics({ completedTasks, entriesByDate, intentTexts: ["Ship it"], quarter: 3, year: 2026 });

    expect(statistics.outsideProjectTaskCount).toBe(2);
    expect(statistics.unclassifiedTaskCount).toBe(1);
    expect(statistics.classifiedTaskCount).toBe(3);
    expect(statistics.intentAlignmentPercent).toBe(33);
  });

  it("uses the ledger's raised victory value when it beats the task's own", () => {
    const completedTasks = [completedTask("a", { victoryValue: 2 })];
    const entriesByDate = new Map([["2026-07-10", [ledgerEntry("a", "2026-07-10", launch, { appliedVictoryValue: 6 })]]]);
    expect(retrospectiveStatistics({ completedTasks, entriesByDate, quarter: 3, year: 2026 }).totalVictoryValue).toBe(6);
  });

  it("rounds Victory Value sums to hundredths, without floating point error", () => {
    const completedTasks = [completedTask("a", { victoryValue: 0.1 }), completedTask("b", { victoryValue: 0.2 })];
    const entriesByDate = new Map([["2026-07-10", [ledgerEntry("a", "2026-07-10", launch), ledgerEntry("b", "2026-07-10", launch)]]]);
    const statistics = retrospectiveStatistics({ completedTasks, entriesByDate, quarter: 3, year: 2026 });
    expect(statistics.totalVictoryValue).toBe(0.3);
    expect(statistics.busiestDay.victoryValue).toBe(0.3);
    expect(statistics.projectTotals[0].victoryValue).toBe(0.3);
    expect(quarterTotals({ completedTasks, entriesByDate, quarter: 3, year: 2026 }).totalVictoryValue).toBe(0.3);
  });

  it("keeps only genuine completions inside the quarter", () => {
    const dismissed = { ...completedTask("dismissed"), dismissedAt: 1 };
    const completedTasks = [completedTask("inside"), completedTask("before", { month: 6 }), completedTask("after", { month: 10 }), dismissed];
    const statistics = retrospectiveStatistics({ completedTasks, entriesByDate: new Map(), quarter: 3, year: 2026 });
    expect(statistics.totalTaskCount).toBe(1);
    expect(statistics.intentAlignmentPercent).toBeNull();
  });

  it("lists important tasks by victory value with days from creation to completion", () => {
    const completedTasks = [completedTask("slow", { createdDay: 1, day: 21, important: true, victoryValue: 3 }),
      completedTask("big", { createdDay: 9, day: 10, important: true, victoryValue: 8 }),
      completedTask("undated", { important: true, victoryValue: 1 }), completedTask("ordinary", { victoryValue: 20 })];
    const { importantTasks } = retrospectiveStatistics({ completedTasks, entriesByDate: new Map(), quarter: 3, year: 2026 });

    expect(importantTasks.count).toBe(3);
    expect(importantTasks.listed.map(task => [task.text, task.elapsedDays])).toEqual([["Task big", 1], ["Task slow", 20], ["Task undated", null]]);
    expect(importantTasks.averageElapsedDays).toBe(11);
  });

  it("names the day with the most victory value", () => {
    const completedTasks = [completedTask("a", { day: 3, victoryValue: 2 }), completedTask("b", { day: 4, victoryValue: 4 }),
      completedTask("c", { day: 4, victoryValue: 1 })];
    const { busiestDay } = retrospectiveStatistics({ completedTasks, entriesByDate: new Map(), quarter: 3, year: 2026 });
    expect(busiestDay).toEqual({ dateKey: "2026-07-04", taskCount: 2, victoryValue: 5 });
  });
});

describe("retrospective helpers", () => {
  it("reduces task markdown to a short line", () => {
    expect(retrospectiveTaskText("Read **[the spec](https://example.com)**\n now")).toBe("Read the spec now");
    expect(retrospectiveTaskText("x".repeat(120))).toHaveLength(90);
  });

  it("measures scheduled minutes from the span, then the duration", () => {
    expect(scheduledMinutes({ endAt: 7200, startAt: 3600 })).toBe(60);
    expect(scheduledMinutes({ duration: 1800 })).toBe(30);
    expect(scheduledMinutes({})).toBe(0);
    expect(formattedMinutes(870)).toBe("14h 30m");
    expect(formattedMinutes(45)).toBe("45m");
  });
});

describe("slidesFromStatistics", () => {
  it("leaves out project and intent slides for a quarter the ledger never sorted", () => {
    const statistics = retrospectiveStatistics({ completedTasks: [completedTask("a", { victoryValue: 3 })], entriesByDate: new Map(),
      quarter: 3, year: 2026 });
    expect(slidesFromStatistics(statistics).map(slide => slide.id)).toEqual(["intro", "victory-total", "progress-heap", "month-by-month",
      "busiest-day", "summary"]);
  });

  it("plays every slide for a fully sorted quarter", () => {
    const completedTasks = [completedTask("a", { createdDay: 1, endHour: 11, important: true, startHour: 10, victoryValue: 4 }),
      completedTask("b")];
    const entriesByDate = new Map([["2026-07-10", [ledgerEntry("a", "2026-07-10", launch), ledgerEntry("b", "2026-07-10")]]]);
    const statistics = retrospectiveStatistics({ completedTasks, entriesByDate, intentTexts: ["Ship it"], quarter: 3, quarterName: "Liftoff",
      year: 2026 });
    const slides = slidesFromStatistics(statistics);

    expect(slides.map(slide => slide.id)).toEqual(["intro", "victory-total", "progress-heap", "month-by-month", "project-victory",
      "project-tasks", "project-time",
      "important-tasks", "outside-projects", "intent", "busiest-day", "summary"]);
    expect(slides[0].headline).toBe("“Liftoff”");
    expect(slides.find(slide => slide.id === "intent").figure.value).toBe(50);
  });

  it("shortens the slides with few words, keeps the heap long, and leaves data-rich slides at the usual length", () => {
    const completedTasks = [completedTask("a", { victoryValue: 4 }), completedTask("b")];
    const entriesByDate = new Map([["2026-07-10", [ledgerEntry("a", "2026-07-10", launch), ledgerEntry("b", "2026-07-10")]]]);
    const statistics = retrospectiveStatistics({ completedTasks, entriesByDate, quarter: 3, year: 2026 });
    const factorById = Object.fromEntries(slidesFromStatistics(statistics).map(slide => [slide.id, slideDurationFactor(slide)]));

    expect(factorById.intro).toBe(SHORT_SLIDE_DURATION_FACTOR);
    // The Victory Value total explains what Victory Value is, which takes the usual time to read.
    expect(factorById["victory-total"]).toBe(1);
    expect(factorById["progress-heap"]).toBe(1.5);
    expect(factorById["project-victory"]).toBe(1);
  });

  it("counts a slide's words without its kicker, its figure, or tokens that are only punctuation", () => {
    const slide = { caption: "From 1 Jul – 30 Sep.", figure: { prefix: "", suffix: "", value: 42 }, headline: "Q3, wrapped",
      items: [{ label: "Ship it", value: "4 VV" }], kicker: "Your quarter in review" };
    expect(slideWordCount(slide)).toBe(11);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The Q3 statistics for ten tasks worth 40 Victory Value, compared with Q2's totals.
  function comparedStatistics(previousTaskCount, previousVictoryValue) {
    const completedTasks = Array.from({ length: 10 }, (unused, index) => completedTask(`t${ index }`, { day: index + 1, victoryValue: 4 }));
    const previousQuarterTotals = { quarter: 2, totalTaskCount: previousTaskCount, totalVictoryValue: previousVictoryValue, year: 2026 };
    return retrospectiveStatistics({ completedTasks, entriesByDate: new Map(), previousQuarterTotals, quarter: 3, year: 2026 });
  }
  const comparisonSlide = statistics => slidesFromStatistics(statistics).find(slide => slide.id === "previous-quarter") || null;

  it("leads the comparison with the larger growth, right after the Victory Value total", () => {
    const statistics = comparedStatistics(8, 25);
    expect(statistics.quarterOverQuarter).toEqual({ previousQuarter: { quarter: 2, year: 2026 }, previousTaskCount: 8, previousVictoryValue: 25,
      taskCountChangePercent: 25, victoryValueChangePercent: 60 });
    const slideIds = slidesFromStatistics(statistics).map(slide => slide.id);
    expect(slideIds.slice(0, 3)).toEqual(["intro", "victory-total", "previous-quarter"]);
    const slide = comparisonSlide(statistics);
    expect(slide).toMatchObject({ caption: "Up on Q2 2026 across the board.", figure: { prefix: "+", suffix: "%", value: 60 },
      headline: "more Victory Value earned than Q2 2026", kicker: "Compared with Q2 2026" });
    expect(slide.items).toEqual([{ label: "Tasks completed", value: "10 vs. 8" }, { label: "Victory Value", value: "40 vs. 25" }]);
  });

  it("still celebrates growth when the other total dipped a little", () => {
    const slide = comparisonSlide(comparedStatistics(8, 42));
    expect(slide).toMatchObject({ caption: "More checked off, each a lighter lift.", figure: { value: 25 }, headline: "more tasks completed than Q2 2026" });
  });

  it("frames a dip of ten percent or less as room to breathe", () => {
    const slide = comparisonSlide(comparedStatistics(11, 44));
    expect(slide).toMatchObject({ figure: null, headline: "Less intense, more room to breathe" });
  });

  it("skips the comparison when either total fell by more than ten percent, or the quarter before did nothing", () => {
    expect(comparisonSlide(comparedStatistics(12, 30))).toBeNull();
    expect(comparisonSlide(comparedStatistics(8, 50))).toBeNull();
    expect(comparedStatistics(0, 0).quarterOverQuarter).toBeNull();
  });

  it("gives an empty quarter a single slide", () => {
    const statistics = retrospectiveStatistics({ completedTasks: [], entriesByDate: new Map(), quarter: 3, year: 2026 });
    expect(slidesFromStatistics(statistics).map(slide => slide.id)).toEqual(["empty"]);
  });
});

describe("gatherRetrospectiveQuarter", () => {
  it("reads the domain's quarter of completions and survives a missing ledger and guide", async () => {
    const app = { filterNotes: jest.fn(async () => []), findNote: jest.fn(async () => null),
      getCompletedTasks: jest.fn(async () => [completedTask("a", { victoryValue: 2 })]) };
    const { statistics } = await gatherRetrospectiveQuarter(app, { domainName: "Work", domainUuid: "domain-work", quarter: 3, year: 2026 });

    expect(statistics.totalVictoryValue).toBe(2);
    const [fromSeconds, toSeconds, options] = app.getCompletedTasks.mock.calls[0];
    expect(new Date(fromSeconds * 1000)).toEqual(new Date(2026, 6, 1));
    expect(toSeconds).toBeLessThanOrEqual(Math.floor(new Date(2026, 9, 1).getTime() / 1000));
    expect(options).toEqual({ taskDomainUUID: "domain-work" });
  });

  it("reads the quarter before's totals from its own tasks and ledger, and goes on without them", async () => {
    const julySeconds = Math.floor(new Date(2026, 6, 1).getTime() / 1000);
    const aprilTasks = [completedTask("q2-a", { month: 4, victoryValue: 1 }), completedTask("q2-b", { month: 5, victoryValue: 3 })];
    const app = { filterNotes: jest.fn(async () => []), findNote: jest.fn(async () => null),
      getCompletedTasks: jest.fn(async fromSeconds => (fromSeconds < julySeconds ? aprilTasks : [completedTask("a", { victoryValue: 6 })])) };
    const { statistics } = await gatherRetrospectiveQuarter(app, { domainName: "Work", domainUuid: "domain-work", quarter: 3, year: 2026 });
    expect(statistics.quarterOverQuarter).toMatchObject({ previousTaskCount: 2, previousVictoryValue: 4, taskCountChangePercent: -50,
      victoryValueChangePercent: 50 });
    expect(app.findNote).toHaveBeenCalledWith({ name: expect.stringContaining("Q2 2026") });

    app.getCompletedTasks = jest.fn(async fromSeconds => {
      if (fromSeconds < julySeconds) throw new Error("offline");
      return [completedTask("a", { victoryValue: 6 })];
    });
    const withoutPrevious = await gatherRetrospectiveQuarter(app, { domainName: "Work", domainUuid: "domain-work", quarter: 3, year: 2026 });
    expect(withoutPrevious.statistics.quarterOverQuarter).toBeNull();
    expect(withoutPrevious.statistics.totalVictoryValue).toBe(6);
  });

  it("counts a quarter's totals and names the quarter before, across a year", () => {
    expect(quarterTotals({ completedTasks: [completedTask("a", { victoryValue: 5 })], entriesByDate: new Map(), quarter: 3, year: 2026 }))
      .toEqual({ quarter: 3, totalTaskCount: 1, totalVictoryValue: 5, year: 2026 });
    expect(quarterBefore({ quarter: 1, year: 2027 })).toEqual({ label: "Q4 2026", quarter: 4, year: 2026 });
  });

  it("throws when completed tasks cannot be read", async () => {
    await expect(gatherRetrospectiveQuarter({}, { domainName: null, domainUuid: null, quarter: 3, year: 2026 })).rejects.toThrow();
  });
});
