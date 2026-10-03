// The day-project selection, Jev and generative ranking, hour placement, and the project-note suggestion log.
import { dayProjectGroups, deadlineWithinComingWeek } from "day-project-candidates";
import { suggestionSectionsMarkdown } from "project-suggestion-log";
import QuarterProject from "quarter-project";
import { generativeRankPrompt, rankedTasksFromAnswers, rankedTasksFromUuidList, suggestionQuestions } from "suggestion-task-rank";
import { refillRejectedSuggestion, slotRankedTasks, tasksNotRecentlySuggested } from "suggestion-task-slots";

const TUESDAY = new Date(2026, 9, 6, 15, 0, 0);

// ----------------------------------------------------------------------------------------------
// @desc A live project plus the tasks the quarterly project note already stored for it.
// @param {object} project - Fields that differ from a Tuesday Focus project.
// @param {Array<object>} [records] - Stored task records.
// @returns {object} { projects, storedRecords }, each holding one QuarterProject; the live one carries day evidence.
function projectsWithTasks(project = {}, records) {
  const base = new QuarterProject({ summary: "Automate GitClear enterprise pipeline", uuid: "project-1", blocksPerWeek: 1,
    paceEm: "oneSubstantialBlock", preferredWeekdays: ["tuesday"], priorityEm: "quarterFocus", ...project });
  base.setProgressEvidence(TUESDAY);
  const stored = new QuarterProject({ summary: base.summary, uuid: base.uuid,
    relatedTaskRecords: records || [{ matchScore: 8.6, taskText: "Sign up for GrokBot", taskUuid: "task-1" }],
    taskSuggestions: project.taskSuggestions || [] });
  return { projects: [base], storedRecords: [stored] };
}

describe("day project candidates", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A weekday affinity and a Focus priority both belong in the rationale, with the stored task nested under it.
  it("includes a project scheduled for today and describes why", () => {
    const { projects, storedRecords } = projectsWithTasks();
    const [group] = dayProjectGroups({ now: TUESDAY, projects, storedRecords });
    expect(group.summary).toBe("Automate GitClear enterprise pipeline");
    expect(group.rationale).toContain("This project is scheduled for Tuesdays and today is Tuesday.");
    expect(group.rationale).toContain("The user picked this as a 'Focus' emphasis for the current quarter.");
    expect(group.taskCandidates).toEqual([expect.objectContaining({ minutesSinceRecommended: null, score: 8.6,
      text: "Sign up for GrokBot", uuid: "task-1" })]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Keep warm with no weekday still qualifies, and says how many of its tasks were finished this week.
  it("includes a cadence with no weekday and reports this week's completions", () => {
    const { projects, storedRecords } = projectsWithTasks({ paceEm: "oneSubstantialBlock", preferredWeekdays: [],
      priorityEm: "stayWarm", summary: "Bolster iPad Differentiation" });
    const [group] = dayProjectGroups({ now: TUESDAY, projects, storedRecords });
    expect(group.rationale).toContain("User chose to work on this once per week without a day of week specified.");
    expect(group.rationale).toContain("They have finished zero tasks from this project so far this week.");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A deadline inside the coming week qualifies even when today is not one of the project's weekdays.
  it("includes a project whose deadline is in the coming week and skips one pinned to another day", () => {
    const due = projectsWithTasks({ deadlineOn: "2026-10-08", preferredWeekdays: ["wednesday"], uuid: "due" });
    const later = projectsWithTasks({ deadlineOn: "2026-11-01", preferredWeekdays: ["wednesday"], summary: "Later",
      uuid: "later" });
    const groups = dayProjectGroups({ now: TUESDAY, projects: [...due.projects, ...later.projects],
      storedRecords: [...due.storedRecords, ...later.storedRecords] });
    expect(groups.map(group => group.projectUuid)).toEqual(["due"]);
    expect(groups[0].rationale).toContain("within the coming week");
    expect(deadlineWithinComingWeek("2026-10-13", TUESDAY)).toBe(true);
    expect(deadlineWithinComingWeek("2026-10-14", TUESDAY)).toBe(false);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc minutesSinceRecommended is how long ago the project note says the task was shown.
  it("reports how long ago a stored task was suggested", () => {
    const suggestedAt = new Date(TUESDAY.getTime() - 90 * 60 * 1000).toISOString();
    const { projects, storedRecords } = projectsWithTasks({ taskSuggestions: [{ suggestedAt, taskUuid: "task-1" }] });
    const [group] = dayProjectGroups({ now: TUESDAY, projects, storedRecords });
    expect(group.taskCandidates[0].minutesSinceRecommended).toBe(90);
  });
});

describe("suggestion ranking", () => {
  const groups = dayProjectGroups({ now: TUESDAY, ...projectsWithTasks() });

  // ----------------------------------------------------------------------------------------------
  // @desc The state Jev sees nests each task under its project rationale.
  it("nests task candidates under the project rationale", () => {
    const { state } = suggestionQuestions(groups);
    expect(state.projects["Automate GitClear enterprise pipeline"].taskCandidates[0]).toEqual({
      minutesSinceRecommended: null, score: 8.6, text: "Sign up for GrokBot", uuid: "task-1" });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Jev's zero-indexed score becomes a 1–10 rating.
  it("orders Jev score answers from highest to lowest", () => {
    const { listed } = suggestionQuestions(groups);
    const ranked = rankedTasksFromAnswers(listed, { task_1: { score: 7.6, type: "score" } });
    expect(ranked[0]).toEqual(expect.objectContaining({ rating: 8.6, taskUuid: "task-1" }));
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The generative model is asked for a stack-ranked UUID list, and that order is kept.
  it("keeps the generative model's stack rank and drops unknown uuids", () => {
    const { listed, state } = suggestionQuestions(groups);
    expect(generativeRankPrompt(state)).toContain('"rankedTaskUuids"');
    const second = { ...listed[0], candidate: { ...listed[0].candidate, text: "Second", uuid: "task-2" } };
    const ranked = rankedTasksFromUuidList([listed[0], second], ["task-2", "missing", "task-1"]);
    expect(ranked.map(task => task.taskUuid)).toEqual(["task-2", "task-1"]);
    expect(ranked[0].rating).toBeGreaterThan(ranked[1].rating);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Dream task will not repeat a suggestion from the past three days.
  it("drops tasks suggested within the past three days", () => {
    const fresh = { minutesSinceRecommended: null, taskUuid: "new" };
    const recent = { minutesSinceRecommended: 60, taskUuid: "recent" };
    const old = { minutesSinceRecommended: 3 * 24 * 60, taskUuid: "old" };
    expect(tasksNotRecentlySuggested([fresh, recent, old]).map(task => task.taskUuid)).toEqual(["new", "old"]);
  });
});

describe("suggestion slots", () => {
  const longTask = { durationMinutes: 90, rationale: "First", taskText: "Long", taskUuid: "long" };
  const nextTask = { durationMinutes: 30, rationale: "Second", taskText: "Next", taskUuid: "next" };
  const spare = { durationMinutes: 30, rationale: "Third", taskText: "Spare", taskUuid: "spare" };

  // ----------------------------------------------------------------------------------------------
  // @desc An hour within 30 minutes of an obligation is skipped, and a task's duration pushes the next hour out.
  it("skips occupied hours and honors the placed task's duration", () => {
    const { activities } = slotRankedTasks([longTask, nextTask], { obligations: [{ durationMinutes: 30, startMinutes: 9 * 60 }] });
    expect(activities.map(activity => activity.startTime)).toEqual(["10:00", "12:00"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Rejecting a placed task offers the next ranked task in the freed hour.
  it("fills a rejected slot with the next highest task", () => {
    const refill = refillRejectedSuggestion({ activities: [], obligations: [{ durationMinutes: 30, startMinutes: 9 * 60 }],
      preferredStartMinutes: 10 * 60, reserveTasks: [spare] });
    expect(refill.placed.taskUuid).toBe("spare");
    expect(refill.placed.startTime).toBe("10:00");
    expect(refill.reserveTasks).toEqual([]);
  });
});

describe("project suggestion log", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A shown task is an h3 under the project, and a later suggestion appends to that task's bullet list.
  it("renders an h3 per task uuid and round-trips the log through the project section", () => {
    const taskSuggestions = [{ suggestedAt: "2026-10-06T15:00:00.000Z", taskUuid: "task-1" },
      { suggestedAt: "2026-10-06T18:00:00.000Z", taskUuid: "task-1" }];
    expect(suggestionSectionsMarkdown(taskSuggestions)).toContain("### task-1 suggested");
    expect(suggestionSectionsMarkdown(taskSuggestions)).toContain("- task-1 — 2026-10-06T18:00:00.000Z");
    const markdown = new QuarterProject({ summary: "Launch", uuid: "project-1", taskSuggestions }).toStoreSection();
    expect(QuarterProject.fromStoreSection(markdown).taskSuggestions).toEqual(taskSuggestions);
  });
});
