// Verify that every task the similarity hash rates similar but the existing tasks leave out is named with its reason,
// and that the store section lists those tasks and reads the reasons back.
import { DISQUALIFICATION_REASONS, disqualifiedSimilarTasks, listedDisqualifiedTasks } from "dashboard/project-tasks/disqualified-similar-tasks";
import { DISQUALIFIED_TASKS_LINE } from "dashboard/quarter-project-serialization";
import { taskRatingKey } from "plan-wizard/stack-rank/task-rating-cache";
import QuarterProject from "quarter-project";

const SUMMARY = "Launch dashboard";

// ----------------------------------------------------------------------------------------------
// @desc Build a project whose hash rates each given task, keyed by the text it was rated with.
// @param {Array<object>} ratedTasks - { rating, taskText, taskUuid }.
// @param {object} [fields] - Further QuarterProject fields.
// @returns {QuarterProject} The project.
function projectWithRatings(ratedTasks, fields = {}) {
  const ratingEntries = ratedTasks.map(task => [taskRatingKey(SUMMARY, task), task.rating]);
  return new QuarterProject({ summary: SUMMARY, taskSimilarityScores: Object.fromEntries(ratingEntries), uuid: "project-uuid",
    ...fields });
}

describe("disqualifiedSimilarTasks", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Each way a similar task can miss the existing tasks gets its own reason; a listed task gets none.
  it("names why each similar task is not listed", () => {
    const ratedTasks = [
      { rating: 9, taskText: "Ship the grid", taskUuid: "listed" },
      { rating: 8, taskText: "Finished work", taskUuid: "completed" },
      { rating: 8, taskText: "Gone", taskUuid: "deleted" },
      { rating: 7, taskText: "Old wording", taskUuid: "edited" },
      { rating: 6.5, taskText: "Borderline", taskUuid: "below-minimum" },
    ];
    const project = projectWithRatings(ratedTasks, { relatedTaskRecords: [{ taskText: "Ship the grid", taskUuid: "listed" }] });
    const tasks = [{ content: "Ship the grid", uuid: "listed" }, { completedAt: 1, content: "Finished work", uuid: "completed" },
      { content: "New wording", uuid: "edited" }, { content: "Borderline", uuid: "below-minimum" }];
    const records = disqualifiedSimilarTasks(project, { minimumMatchScore: 7, tasks });
    const reasonByUuid = Object.fromEntries(records.map(record => [record.taskUuid, record.reason]));
    expect(reasonByUuid).toEqual({ "below-minimum": "below this project's minimum match score of 7",
      completed: DISQUALIFICATION_REASONS.completed, deleted: DISQUALIFICATION_REASONS.notRead,
      edited: DISQUALIFICATION_REASONS.editedSinceRated });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A competitive project that kept only its top tasks at the default minimum says so.
  it("names the competitive cap", () => {
    const project = projectWithRatings([{ rating: 6, taskText: "Twenty-first", taskUuid: "capped" }]);
    const records = disqualifiedSimilarTasks(project, { minimumMatchScore: 6, tasks: [{ content: "Twenty-first", uuid: "capped" }] });
    expect(records).toEqual([{ matchScore: 6, reason: DISQUALIFICATION_REASONS.outsideTopTasks, taskText: "Twenty-first",
      taskUuid: "capped" }]);
  });
});

describe("listedDisqualifiedTasks", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A similar task no ranking explained is still listed, with a reason drawn from the ranking's state.
  it("falls back to a generic reason", () => {
    const project = projectWithRatings([{ rating: 8, taskText: "Paused", taskUuid: "paused" }],
      { unfinishedRankingAt: "2026-10-16T12:00:00.000Z" });
    expect(listedDisqualifiedTasks(project)).toEqual([{ matchScore: 8, reason: DISQUALIFICATION_REASONS.unfinishedRanking,
      taskText: "", taskUuid: "paused" }]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The store section lists each disqualified task with its score and reason, and reads them back.
  it("round-trips through the store section", () => {
    const project = projectWithRatings([{ rating: 8, taskText: "Finished work", taskUuid: "completed" }]);
    project.setDisqualifiedTaskRecords(disqualifiedSimilarTasks(project, { tasks: [] }));
    const section = project.toStoreSection();
    expect(section).toContain(`${ DISQUALIFIED_TASKS_LINE }\n`);
    expect(section).toContain("— similarity 8; not among the open tasks read (deleted, or outside the task domain)");
    const reread = QuarterProject.fromStoreSection(section);
    expect(reread.disqualifiedTaskRecords).toEqual([{ matchScore: 8, reason: DISQUALIFICATION_REASONS.notRead,
      taskText: "Untitled task", taskUuid: "completed" }]);
    expect(reread.relatedTaskRecords).toEqual([]);
  });
});
