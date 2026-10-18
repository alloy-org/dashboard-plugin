// The calendar generation report names its pass, notices the Debug Console in the layout, renders each evaluated day
// with the scores behind each suggestion, its rankings, and the reasons a day was left with open hours, and stays under
// its per-day character budget.
import { jest } from "@jest/globals";
import { SETTING_KEYS } from "constants/settings";
import { initialProjectTaskStoreMarkdown } from "dashboard/project-tasks/project-task-store-markdown";
import { calendarGenerationReportMarkdown, calendarGenerationReportName, debugConsoleInLayout,
  rankingSelectionTrace, writeCalendarGenerationReport } from "dashboard/suggestions/calendar-generation-report";
import { projectCadenceCounts } from "dashboard/suggestions/day-project-candidates";
import QuarterProject from "quarter-project";

const MONDAY = new Date(2026, 9, 19);

// ----------------------------------------------------------------------------------------------
// @desc A day served from a cached agenda: its activity and reserve carry no scores, as persisted entries do not.
// @returns {object} { dayOutcome, dayResult }
function cachedDay() {
  const activities = [{ durationMinutes: 30, isExisting: true, projectUuid: "project-1", startTime: "09:00",
    taskUuid: "task-1", title: "Draft launch email" }];
  const reserveTasks = [{ ideaId: "idea-1", isExisting: false, noteUuid: "note-1", projectUuid: "project-1",
    taskText: "Outline pricing page" }];
  const dayOutcome = { activities, droppedTitles: [], refilledCount: 0, reserveTasks, suggestionHours: null };
  const selectionTrace = { cachedActivityCount: 1, replacedCount: 0, source: "cache" };
  return { dayOutcome, dayResult: { day: MONDAY, dismissedKeys: [], obligations: [], scheduledKeys: [], selectionTrace } };
}

// ----------------------------------------------------------------------------------------------
// @desc Mock the app bridge with one quarter's project task store note holding the cached day's project, and capture
//   the report note written.
// @returns {object} App mock carrying `reportContent` for assertions.
function projectStoreApp() {
  const project = new QuarterProject({ relatedTaskRecords: [{ matchScore: 6.9, taskText: "Draft launch email", taskUuid: "task-1" }],
    suggestedTasks: [{ generatedAt: "2026-10-01T12:00:00.000Z", ideaId: "idea-1", rating: { actionability: 8,
      ratedAt: "2026-10-02T12:00:00.000Z", relevance: 9.1 }, taskText: "Outline pricing page" }],
    summary: "Launch", uuid: "project-1" });
  const storeContent = initialProjectTaskStoreMarkdown().replace("# Past projects",
    `## ${ project.summary } (project:${ project.uuid })\n\n${ project.toStoreSection() }\n# Past projects`);
  const state = { reportContent: null };
  const app = {
    createNote: jest.fn(async () => "report-note"),
    findNote: jest.fn(async ({ name, uuid } = {}) => {
      if (uuid === "note-1") return { name: "Launch", uuid };
      return name === "Project Tasks Q4 2026 Work" ? { uuid: "store-note" } : null;
    }),
    getNoteContent: jest.fn(async ({ uuid }) => (uuid === "store-note" ? storeContent : "")),
    insertNoteContent: jest.fn(async (handle, markdown) => { state.reportContent = markdown; return true; }),
  };
  Object.defineProperty(app, "reportContent", { get: () => state.reportContent });
  return app;
}

// ----------------------------------------------------------------------------------------------
// @desc A ranked task as prepareDayRanking returns it.
// @param {number} index - Distinguishes the task's UUID and title.
// @param {number} rating - The ranker's rating.
// @returns {object}
function rankedTask(index, rating) {
  return { durationMinutes: 30, isExisting: true, projectSummary: "Ship the dashboard", rating, score: 6 + index / 10,
    taskText: `Task number ${ index }`, taskUuid: `task-${ index }` };
}

// ----------------------------------------------------------------------------------------------
// @desc A traced, ranked day: task-1 suggested at 09:00, an idea suggested at 13:30, task-2 claimed by an earlier day,
//   task-3 in reserve.
// @param {object} [overrides] - { obligations } to close hours of the day.
// @returns {object} { dayOutcome, dayResult }
function rankedDay({ obligations = [] } = {}) {
  const rankedTasks = [rankedTask(1, 9.2), rankedTask(2, 8.8), rankedTask(3, 7.4)];
  const slotted = { activities: [{ candidateId: "task:task-1" }], reserveTasks: [rankedTasks[2]] };
  const rankingTrace = rankingSelectionTrace({ excludedSuggestionKeys: new Set(["task:task-2"]), outcome: "ranked",
    ranking: { fromStore: true, rankedTasks, rankerEm: "jev" }, slotted });
  const projectCadence = { cadenceCount: 2, monthCount: 1, monthLabel: "October", weekdayCount: 1, weekdayLabel: "Mondays" };
  const selectionTrace = { eligibleCount: 40, generator: "ranking", projectCadence, projectCandidateCount: 6, projectCount: 2,
    selectedTaskCount: 34, source: "fresh", ...rankingTrace };
  const offered = [{ candidateId: "task:task-1", durationMinutes: 30, isExisting: true, score: 6.9, startTime: "09:00",
    taskUuid: "task-1", title: "Task number 1" },
  { actionability: 8, candidateId: "idea:idea-1", durationMinutes: 30, ideaId: "idea-1", isExisting: false, noteUuid: "note-1",
    score: 9.1, startTime: "13:30", title: "Outline a pricing page that compares every plan side by side for buyers" }];
  const dayOutcome = { activities: offered.map(activity => ({ ...activity, startMinutes: 540 })), droppedTitles: [],
    refilledCount: 0, reserveTasks: [rankedTasks[2]], suggestionHours: { earliestStart: "09:00", nowMinutes: null,
      openHours: ["09:00", "10:00"] } };
  return { dayOutcome, dayResult: { day: MONDAY, dismissedKeys: [], obligations, scheduledKeys: [], selectionTrace } };
}

describe("calendar generation report", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc The note name carries the domain, the day count, and the pass's 24-hour start time.
  it("names the note for its domain, day count, and start time", () => {
    const startedAt = new Date(2026, 9, 16, 13, 32);
    expect(calendarGenerationReportName({ dayCount: 3, domainName: "Work", startedAt })).toBe("Calendar Work Generate: 3 days at 13:32");
    expect(calendarGenerationReportName({ dayCount: 1, domainName: null, startedAt })).toBe("Calendar All Notes Generate: 1 day at 13:32");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The layout is read from a JSON string on the host and an array in the embed; a bad layout means no report.
  it("finds the Debug Console in a layout string or array", () => {
    const layout = [{ widgetId: "agenda" }, { widgetId: "debug-console" }];
    expect(debugConsoleInLayout({ [SETTING_KEYS.DASHBOARD_COMPONENTS]: JSON.stringify(layout) })).toBe(true);
    expect(debugConsoleInLayout({ [SETTING_KEYS.DASHBOARD_COMPONENTS]: layout })).toBe(true);
    expect(debugConsoleInLayout({ [SETTING_KEYS.DASHBOARD_COMPONENTS]: "[{" })).toBe(false);
    expect(debugConsoleInLayout({})).toBe(false);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Each ranking row shows its rating and what became of it, and a day with an hour still free explains why.
  it("renders rankings with their fate and explains the hours left open", () => {
    const markdown = calendarGenerationReportMarkdown([rankedDay()]);
    expect(markdown).toMatch(/^# Monday, October 19 — 2 suggested/);
    expect(markdown).toContain("- Source: fresh ranking by jev (stored ranking reused)");
    expect(markdown).toContain("- Eligible: 40 tasks (34 recent open tasks, 6 project candidates) across 2 projects; "
      + "active projects: 2 with a cadence, 1 for October, 1 targeting Mondays");
    expect(markdown).toContain("- Considered: 3 rated by jev; 1 already suggested on an earlier day; best 2 pooled for slotting");
    expect(markdown).toContain("- Next in line:\n  - 6.3 similarity score for existing task \"Task number 3\" (task-3)");
    expect(markdown).toContain("  - 9.2 Task number 1 [Ship the dashboard] → 09:00");
    expect(markdown).toContain("  - 8.8 Task number 2 [Ship the dashboard] earlier day");
    expect(markdown).toContain("  - 7.4 Task number 3 [Ship the dashboard] reserve");
    expect(markdown).toContain("- Not filled because:");
    expect(markdown).toContain("  - 10:00 is still open");
    expect(markdown).toContain("  - 1 reserves left, none fits the open hours");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Each suggestion gets its own bullet: an existing task with its similarity score and UUID, an idea with its
  //   actionability and relevance and a link to the note it would be created in.
  it("lists each suggestion with the scores that put it forward", () => {
    const noteNameByUuid = new Map([["note-1", "Pricing [draft]"]]);
    const markdown = calendarGenerationReportMarkdown([rankedDay()], { noteNameByUuid });
    expect(markdown).toContain("- Suggested:\n  - 9:00am: 6.9 similarity score for existing task \"Task number 1\" (task-1)\n"
      + "  - 1:30pm: 8.0 actionability, 9.1 relevance for suggested task "
      + "\"Outline a pricing page that compares every plan s…\" in [Pricing draft](https://www.amplenote.com/notes/note-1)");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A suggestion without its own scores, such as one from an older cached agenda, falls back to the ranker's rating.
  it("falls back to the ranker rating for an unscored suggestion", () => {
    const day = rankedDay();
    day.dayOutcome.activities = [{ candidateId: "task:task-9", rating: 7.2, startTime: "10:00", taskUuid: "task-9", title: "Old" }];
    const markdown = calendarGenerationReportMarkdown([day]);
    expect(markdown).toContain("  - 10:00am: 7.2 ranker rating for existing task \"Old\" (task-9)");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Scores from the project task store fill in for a suggestion that has none of its own, while a suggestion's
  //   own scores win over stored ones.
  it("shows stored scores for a suggestion that arrived without its own", () => {
    const storedScoresByCandidateId = new Map([["idea:idea-1", { actionability: 8, relevance: 9.1, similarity: null }],
      ["task:task-1", { actionability: null, relevance: null, similarity: 6.9 }]]);
    const markdown = calendarGenerationReportMarkdown([cachedDay()], { storedScoresByCandidateId });
    expect(markdown).toContain("  - 9:00am: 6.9 similarity score for existing task \"Draft launch email\" (task-1)");
    expect(markdown).toContain("- Next in line:\n  - 8.0 actionability, 9.1 relevance for suggested task \"Outline pricing page\"");
    const ownScored = rankedDay();
    const overridden = new Map([["task:task-1", { actionability: null, relevance: null, similarity: 2 }]]);
    const ownMarkdown = calendarGenerationReportMarkdown([ownScored], { storedScoresByCandidateId: overridden });
    expect(ownMarkdown).toContain("9:00am: 6.9 similarity score for existing task \"Task number 1\"");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Writing the report for a cached day reads the quarter's project task store for the scores the cache dropped.
  it("reads a cached day's scores back from the project task store note", async () => {
    const app = projectStoreApp();
    const uuid = await writeCalendarGenerationReport(app, { days: [cachedDay()], domainName: "Work", domainUuid: "work-domain",
      startedAt: new Date(2026, 9, 18, 9, 5) });
    expect(uuid).toBe("report-note");
    expect(app.reportContent).toContain("- Source: cached agenda (1 cached, 0 replaced as stale)");
    expect(app.reportContent).toContain("  - 9:00am: 6.9 similarity score for existing task \"Draft launch email\" (task-1)");
    expect(app.reportContent).toContain("  - 8.0 actionability, 9.1 relevance for suggested task \"Outline pricing page\" in "
      + "[Launch](https://www.amplenote.com/notes/note-1)");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A freshly ranked pass already carries its scores, so the report reads no project task store.
  it("reads no project task store when every suggestion carries its scores", async () => {
    const app = projectStoreApp();
    const day = rankedDay();
    day.dayOutcome.reserveTasks = [];
    await writeCalendarGenerationReport(app, { days: [day], domainName: "Work", domainUuid: "work-domain",
      startedAt: new Date(2026, 9, 18, 9, 5) });
    const storeLookups = app.findNote.mock.calls.filter(([query]) => String(query?.name || "").startsWith("Project Tasks"));
    expect(storeLookups).toEqual([]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Active projects count when they carry a cadence, then by whether they fit the planned month and weekday.
  it("counts active projects by cadence, month, and weekday", () => {
    const projects = [{ focusMonths: [], preferredWeekdays: ["monday"], priorityEm: "quarterFocus" },
      { focusMonths: ["2026-11"], preferredWeekdays: [], priorityEm: "stayWarm" },
      { focusMonths: ["2026-10"], paceEm: "twoFocusedBlocks", preferredWeekdays: ["tuesday"], priorityEm: null },
      { focusMonths: [], preferredWeekdays: ["monday"], priorityEm: "notNow" }, { focusMonths: [], preferredWeekdays: [] }];
    expect(projectCadenceCounts({ now: MONDAY, projects })).toEqual({ cadenceCount: 3, monthCount: 2, monthLabel: "October",
      weekdayCount: 1, weekdayLabel: "Mondays" });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A day whose remaining hours are all occupied has no "Not filled" section.
  it("leaves out the unfilled section when no hour is open", () => {
    const busyAfternoon = [{ durationMinutes: 480, source: "event", startMinutes: 600, title: "Offsite" }];
    const markdown = calendarGenerationReportMarkdown([rankedDay({ obligations: busyAfternoon })]);
    expect(markdown).not.toContain("Not filled because");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A day that produced no agenda still gets a heading, with its error and the ranker's outcome.
  it("explains a day that suggested nothing", () => {
    const dayResult = { day: MONDAY, error: "No tasks found available to schedule in Task Domain.", obligations: [],
      selectionTrace: { eligibleCount: 0, projectCandidateCount: 0, projectCount: 0, rankingOutcome: "noCandidates",
        selectedTaskCount: 0, source: "fresh" } };
    const markdown = calendarGenerationReportMarkdown([{ dayOutcome: null, dayResult }]);
    expect(markdown).toMatch(/^# Monday, October 19 — nothing suggested/);
    expect(markdown).toContain("  - Generation error: No tasks found available to schedule in Task Domain.");
    expect(markdown).toContain("  - No open task in the task domain and no project candidate");
    expect(markdown).toContain("  - Ranker had no candidates: no live project offered a task or idea");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Many long days shed ranking rows first and are cut off with a notice if that is not enough.
  it("stays under 3k characters per day", () => {
    const longTitle = "A very long task title that keeps going well past the shortening limit for report rows";
    const longRanked = Array.from({ length: 15 }, (_, index) => ({ ...rankedTask(index, 9 - index / 10), taskText: longTitle }));
    const trace = rankingSelectionTrace({ outcome: "ranked", ranking: { rankedTasks: longRanked, rankerEm: "jev" },
      slotted: { activities: [], reserveTasks: longRanked } });
    const days = Array.from({ length: 6 }, () => {
      const day = rankedDay();
      day.dayResult.selectionTrace = { ...day.dayResult.selectionTrace, ...trace };
      day.dayOutcome.reserveTasks = longRanked;
      return day;
    });
    const markdown = calendarGenerationReportMarkdown(days);
    expect(markdown.length).toBeLessThanOrEqual(3000 * days.length);
    expect(markdown.match(/^# /gm).length).toBeGreaterThan(0);
  });
});
