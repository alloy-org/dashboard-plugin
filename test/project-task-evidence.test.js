// Verify how an existing task's link reason and similarity decide whether it can be suggested, that a refresh which
// could not rank keeps the tasks the similarity hash holds, that a completed ranking keeps low scores only for cited
// tasks while an unfinished one keeps every rating, and
// that the suggestion log is read from and appended to its headings.
import { associationResult, projectTaskMatches } from "dashboard/project-collection-steps";
import { suggestionLogAppends, suggestionLogFromSection } from "dashboard/project-suggestion-log";
import { isSuggestableTaskRecord, TASK_LINK_REASONS } from "dashboard/project-task-evidence";
import QuarterProject from "dashboard/quarter-project";
import { rankedTaskAssociations } from "plan-wizard/stack-rank/stack-rank-project-tasks";
import { similarityScoresAfterRanking } from "plan-wizard/stack-rank/task-rating-cache";

const NOW = new Date("2026-09-18T12:00:00.000Z");

// ----------------------------------------------------------------------------------------------
// @desc A project with overridable fields.
// @param {object} [overrides] - Fields to replace.
// @returns {QuarterProject} Project.
function project(overrides = {}) {
  return new QuarterProject({ summary: "Launch dashboard", uuid: "project-uuid", primaryNoteUuid: "project-note",
    ...overrides });
}

describe("existing task eligibility", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A direct link always qualifies; otherwise a score below the similar-task minimum rules a task out, assigned or
  //   not, and an unrated task qualifies.
  it("rules out only tasks rated below the minimum without a direct link", () => {
    expect(isSuggestableTaskRecord({ linkedBy: TASK_LINK_REASONS.projectName, matchScore: 3 })).toBe(true);
    expect(isSuggestableTaskRecord({ linkedBy: TASK_LINK_REASONS.assigned, matchScore: 3 })).toBe(false);
    expect(isSuggestableTaskRecord({ matchScore: 4.5 })).toBe(false);
    expect(isSuggestableTaskRecord({ matchScore: 6 })).toBe(true);
    expect(isSuggestableTaskRecord({ linkedBy: TASK_LINK_REASONS.assigned })).toBe(true);
    expect(isSuggestableTaskRecord({})).toBe(true);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A direct link read from the task wins over an assignment of the same task.
  it("names the link that ties a task to its project", () => {
    const linkedProject = project({ relatedTasks: ["assigned-task", "named-task"] });
    expect(linkedProject.taskLinkReason({ noteUUID: "project-note", uuid: "x" })).toBe(TASK_LINK_REASONS.primaryNote);
    expect(linkedProject.taskLinkReason({ content: "See project:project-uuid", uuid: "x" })).toBe(TASK_LINK_REASONS.projectLink);
    expect(linkedProject.taskLinkReason({ content: "Polish Launch dashboard copy", uuid: "named-task" }))
      .toBe(TASK_LINK_REASONS.projectName);
    expect(linkedProject.taskLinkReason({ content: "Unrelated", uuid: "assigned-task" })).toBe(TASK_LINK_REASONS.assigned);
    expect(linkedProject.taskLinkReason({ content: "Unrelated", uuid: "other-task" })).toBeNull();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A day's candidates leave out the stored associations the store lists as not suggested.
  it("leaves tasks rated below the minimum out of a day's candidates", () => {
    const rankedProject = project({ relatedTaskRecords: [
      { matchScore: 8, taskText: "Ship the export", taskUuid: "similar-task" },
      { matchScore: 4, taskText: "Tidy the inbox", taskUuid: "weak-task" },
      { linkedBy: TASK_LINK_REASONS.projectName, matchScore: 4, taskText: "Launch dashboard review", taskUuid: "named-task" }] });
    const candidateUuids = rankedProject.taskCandidates({ now: NOW }).map(candidate => candidate.uuid);
    expect(candidateUuids).toEqual(["similar-task", "named-task"]);
  });
});

describe("existing task associations", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A task both matched locally and scored appears once, with its score and its link reason.
  it("joins a matched task's link reason onto its score", () => {
    const { associatedRecords } = rankedTaskAssociations(
      [{ linkedBy: TASK_LINK_REASONS.projectName, taskText: "Launch dashboard copy", taskUuid: "both-task" },
        { linkedBy: TASK_LINK_REASONS.assigned, taskText: "Cited", taskUuid: "cited-task" }],
      [{ matchScore: 7, taskText: "Launch dashboard copy", taskUuid: "both-task" }]);
    expect(associatedRecords).toEqual([
      { linkedBy: TASK_LINK_REASONS.assigned, taskText: "Cited", taskUuid: "cited-task" },
      { linkedBy: TASK_LINK_REASONS.projectName, matchScore: 7, taskText: "Launch dashboard copy", taskUuid: "both-task" }]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A refresh that could not rank still lists the open tasks the similarity hash holds, with their scores, so
  //   the existing tasks do not empty out until a ranking succeeds.
  it("keeps the hash's open tasks when nothing could rank", () => {
    const hashedProject = project({ taskSimilarityScores: { "abc:similar-task": 7.5, "def:done-task": 8 } });
    const tasks = [{ content: "Ship the export", uuid: "similar-task" },
      { completedAt: "2026-09-10T00:00:00.000Z", content: "Old work", uuid: "done-task" },
      { content: "Launch dashboard review", uuid: "named-task" }];
    const matches = projectTaskMatches(hashedProject, tasks);
    expect(matches.similarTaskRecords).toEqual([{ matchScore: 7.5, taskText: "Ship the export", taskUuid: "similar-task" }]);
    const result = associationResult({ matches, now: NOW, project: hashedProject, ranking: null, scorerEm: null });
    expect(result.relatedTaskRecords).toEqual([
      { linkedBy: TASK_LINK_REASONS.projectName, taskText: "Launch dashboard review", taskUuid: "named-task" },
      { matchScore: 7.5, taskText: "Ship the export", taskUuid: "similar-task" }]);
  });
});

describe("similarity hash retention", () => {
  const ratingKeyByUuid = { "cited-task": "c1:cited-task", "low-task": "l1:low-task", "similar-task": "s1:similar-task" };
  const ratedTasks = [{ rating: 3, taskUuid: "cited-task" }, { rating: 2, taskUuid: "low-task" },
    { rating: 8, taskUuid: "similar-task" }];
  const storedScores = { "l1:low-task": 2, "o1:old-low-task": 1.5, "o2:old-cited-task": 2.5 };

  // ----------------------------------------------------------------------------------------------
  // @desc With the cited tasks known, only similar and cited scores survive, rated now or stored before.
  it("drops low scores for uncited tasks when the cited tasks are known", () => {
    const scores = similarityScoresAfterRanking({ citedTaskUuids: ["cited-task", "old-cited-task"], ratedTasks,
      ratingKeyByUuid, requiredTaskUuids: [], storedScores });
    expect(scores).toEqual({ "c1:cited-task": 3, "o2:old-cited-task": 2.5, "s1:similar-task": 8 });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Without the cited tasks, scores the ranking did not touch are kept, since any may be cited, while a rated task
  //   is kept only when similar or required.
  it("keeps untouched scores when the cited tasks are unknown", () => {
    const scores = similarityScoresAfterRanking({ citedTaskUuids: null, ratedTasks, ratingKeyByUuid,
      requiredTaskUuids: ["cited-task"], storedScores });
    expect(scores).toEqual({ "c1:cited-task": 3, "o1:old-low-task": 1.5, "o2:old-cited-task": 2.5, "s1:similar-task": 8 });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A ranking that has not completed keeps every rating and every stored score, so a restart reads them all.
  it("keeps every rating while a ranking is unfinished", () => {
    const scores = similarityScoresAfterRanking({ citedTaskUuids: ["cited-task"], isComplete: false, ratedTasks,
      ratingKeyByUuid, requiredTaskUuids: [], storedScores: { ...storedScores, "l0:low-task": 1 } });
    expect(scores).toEqual({ "c1:cited-task": 3, "l1:low-task": 2, "o1:old-low-task": 1.5, "o2:old-cited-task": 2.5,
      "s1:similar-task": 8 });
  });
});

describe("suggestion log headings", () => {
  const sectionBody = "- Last attempted: never\n\n```json\n{}\n```\n\n### task-1 suggested\n- task-1 — 2026-09-01T12:00:00.000Z\n\n"
    + "### idea-0a1b2c3d suggested\n- idea-0a1b2c3d — 2026-09-02T12:00:00.000Z\n";

  // ----------------------------------------------------------------------------------------------
  // @desc Each bullet becomes an entry, an idea told from a task by its identity.
  it("reads the log from its headings", () => {
    expect(suggestionLogFromSection(sectionBody)).toEqual([
      { suggestedAt: "2026-09-01T12:00:00.000Z", taskUuid: "task-1" },
      { ideaId: "idea-0a1b2c3d", suggestedAt: "2026-09-02T12:00:00.000Z" }]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A known identity gains a bullet under its heading; a new one gets its own heading inside the last one's
  //   body; a section with no log heading asks for a whole-section write.
  it("plans heading-scoped appends", () => {
    const writes = suggestionLogAppends(sectionBody, [{ suggestedAt: "2026-09-03T12:00:00.000Z", taskUuid: "task-1" },
      { suggestedAt: "2026-09-03T12:00:00.000Z", taskUuid: "task-2" }]);
    expect(writes).toEqual([
      { body: "- task-1 — 2026-09-01T12:00:00.000Z\n- task-1 — 2026-09-03T12:00:00.000Z\n\n", headingText: "task-1 suggested" },
      { body: "- idea-0a1b2c3d — 2026-09-02T12:00:00.000Z\n\n### task-2 suggested\n- task-2 — 2026-09-03T12:00:00.000Z\n",
        headingText: "idea-0a1b2c3d suggested" }]);
    expect(suggestionLogAppends("- Last attempted: never\n", [{ suggestedAt: "2026-09-03T12:00:00.000Z", taskUuid: "a" }]))
      .toBeNull();
  });
});
