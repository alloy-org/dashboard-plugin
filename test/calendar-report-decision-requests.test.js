// The calendar report's DecisionsEndpoint requests: each is abbreviated to its first question, rubric, and state with its
// task lists counted, and a pass files them under the day being planned, or the whole pass outside any day.
import PassDecisionRequests, { abbreviatedDecisionRequest, decisionRequestLines } from "dashboard/suggestions/calendar-report-decision-requests";
import { durationQuestions } from "dashboard/project-tasks/task-duration-estimates";
import { salienceQuestions, salienceState } from "dashboard/suggestions/suggestion-salience";
import { suggestionQuestions } from "dashboard/suggestions/suggestion-task-rank";
import { DecisionsEndpoint } from "providers/decisions-endpoint";

const MONDAY = new Date(2026, 9, 19);
const GROUPS = [{ projectUuid: "project-1", rationale: "Launch is due Friday.", summary: "Launch", taskCandidates: [
  { candidateId: "task:task-1", isExisting: true, score: 6.9, text: "Draft launch email", uuid: "task-1" },
  { actionability: 8, candidateId: "idea:idea-1", ideaId: "idea-1", isExisting: false, score: 9.1, text: "Outline pricing page" }] }];

// ----------------------------------------------------------------------------------------------
// @desc An endpoint whose one route answers nothing, so a test can make requests without a provider.
// @returns {DecisionsEndpoint}
function silentEndpoint() {
  return DecisionsEndpoint.fromRequester(async () => ({ answers: {} }));
}

describe("abbreviatedDecisionRequest", () => {
  it("keeps a ranking's first question and rubric, and counts each project's candidates", () => {
    const { questions, state } = suggestionQuestions(GROUPS);
    const request = abbreviatedDecisionRequest({ questions, state });
    expect(request).toMatchObject({ kind: "Ranking", questionCount: 2, sampleName: "task_1" });
    expect(request.sampleInstructions).toContain('task_1 ("Draft launch email")');
    expect(request.rubricText.startsWith("1: do not suggest this task today; 2; 3:")).toBe(true);
    expect(JSON.parse(request.stateText)).toEqual({ projects: { Launch: { rationale: "Launch is due Friday.",
      taskCandidates: "[Array of 2 tasks]" } } });
  });

  it("names salience and duration requests, counting their task lists", () => {
    const listed = GROUPS[0].taskCandidates.map(candidate => ({ candidate, group: GROUPS[0] }));
    const salience = abbreviatedDecisionRequest({ questions: salienceQuestions(listed, MONDAY),
      state: salienceState(GROUPS, { targetDate: MONDAY }) });
    expect(salience.kind).toBe("Salience");
    expect(JSON.parse(salience.stateText).groups[0].candidates).toBe("[Array of 2 tasks]");
    const durations = abbreviatedDecisionRequest(durationQuestions([{ taskText: "Draft" }, { taskText: "Ship" }], { MRR: "revenue" }));
    expect(durations.kind).toBe("Duration estimates");
    expect(durations.rubricText).toContain("30: 30 minutes; 60: 60 minutes");
    expect(JSON.parse(durations.stateText)).toEqual({ tasks: "[Array of 2 tasks]", userTermsDictionary: { MRR: "revenue" } });
  });
});

describe("decisionRequestLines", () => {
  it("heads each request with its size and keeps its pieces inline", () => {
    const request = { kind: "Ranking", questionCount: 2, rubricText: "1; 2", sampleInstructions: "Rate `task_1`",
      sampleName: "task_1", stateText: "{}" };
    expect(decisionRequestLines([request], "  ")).toEqual(["  - Ranking, 2 questions, 19 characters without its tasks:",
      "    - Each task asked, as task_1: `Rate 'task_1'`", "    - Rubric: `1; 2`", "    - State: `{}`"]);
  });
});

describe("PassDecisionRequests", () => {
  it("files requests under the day they were made for, and the rest under the pass", async () => {
    const requests = new PassDecisionRequests();
    const { questions, state } = suggestionQuestions(GROUPS);
    await silentEndpoint().rankedResponses({ questions, state });
    requests.fileUnderPass();
    await silentEndpoint().rankedResponses({ questions, state });
    requests.fileUnderDay(MONDAY.toDateString());
    requests.finish();
    await silentEndpoint().rankedResponses({ questions, state });
    expect(requests.passRequests).toHaveLength(1);
    expect(requests.requestsForDay(MONDAY.toDateString())).toHaveLength(1);
    expect(requests.requestsForDay("Tue Oct 20 2026")).toEqual([]);
  });
});
