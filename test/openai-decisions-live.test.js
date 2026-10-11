// Live checks against OpenAI's Decisions API, run only when OPEN_AI_ACCESS_TOKEN is set in .env. They confirm that the
// questions rankers build translate into a request the real API accepts, and that its answers read back through
// DecisionsResponse on the same 1–10 scale Jev's do, including when a failing Jev route falls back to OpenAI.
import dotenv from "dotenv";
import fetch from "isomorphic-fetch";
import { relevantDictionaryTerms } from "plan-wizard/stack-rank/build-project-task-context";
import { APPLICABILITY_CRITERIA, rankProspectiveTasks } from "plan-wizard/stack-rank/rank-prospective-tasks";
import { DECISIONS_PROVIDER_JEV, DECISIONS_PROVIDER_OPENAI, DecisionsEndpoint, forgetJevFailure, jevFailedRecently,
  jevKeyRoute, openAiKeyRoute, scoreQuestion } from "providers/decisions-endpoint";

dotenv.config();

const OPEN_AI_ACCESS_TOKEN = (process.env.OPEN_AI_ACCESS_TOKEN || "").trim();
const itIfOpenAiToken = OPEN_AI_ACCESS_TOKEN ? it : it.skip;
const LIVE_TIMEOUT_MILLISECONDS = 60000;
const DIFF_DIGEST_PROJECT = { nextAction: "Draft the Diff Digest onboarding email", relatedTaskRecords: [
  { taskText: "Pick the Diff Digest send day", taskUuid: "related-1" }], summary: "Diff Digest launch", uuid: "project-1" };
const DIFF_DIGEST_DEFINITION = "GitClear's weekly email that summarizes the code changes a team made";

// ----------------------------------------------------------------------------------------------
// @desc Build a task detail shaped like prospectiveTaskDetails output.
// @param {object} overrides - Fields to replace.
// @returns {object} Task detail.
function taskDetail(overrides = {}) {
  return { childTasks: [], createdOn: "2026-09-20", deadlineOn: null, important: false, isParent: false,
    noteName: "Inbox", noteTags: [], noteUuid: "note-1", parentTask: null, taskText: "A task", taskUuid: "task-1",
    urgent: false, ...overrides };
}

// ----------------------------------------------------------------------------------------------
// @desc An endpoint whose only route is OpenAI's Decisions API with the .env key.
// @returns {DecisionsEndpoint} The endpoint.
function openAiEndpoint() {
  return new DecisionsEndpoint({ routes: [openAiKeyRoute(OPEN_AI_ACCESS_TOKEN, { fetchImplementation: fetch })] });
}

describe("OpenAI Decisions API (live)", () => {
  beforeEach(() => forgetJevFailure());

  itIfOpenAiToken("rates a task serving the project above an unrelated one", async () => {
    const dictionary = relevantDictionaryTerms({ "Diff Digest": DIFF_DIGEST_DEFINITION }, [DIFF_DIGEST_PROJECT.summary]);
    const taskDetails = [taskDetail({ noteName: "Errands", taskText: "Buy dog food", taskUuid: "unrelated" }),
      taskDetail({ noteName: "GitClear marketing", noteTags: ["work/gitclear"],
        taskText: "Write landing page copy for the weekly code-change email", taskUuid: "related" })];
    const result = await rankProspectiveTasks({ decisionsEndpoint: openAiEndpoint(), dictionary, project: DIFF_DIGEST_PROJECT,
      taskDetails });
    expect(result.failures).toEqual([]);
    expect(result.rankedTasks.map(task => task.taskUuid)).toEqual(["related", "unrelated"]);
    expect(result.rankedTasks[0].rating).toBeGreaterThan(6);
    expect(result.rankedTasks[1].rating).toBeLessThan(4);
    expect(result.inputTokens).toBeGreaterThan(0);
  }, LIVE_TIMEOUT_MILLISECONDS);

  itIfOpenAiToken("answers score, choice, and predicate questions in one DecisionsResponse", async () => {
    const state = { project: "Diff Digest launch", task: "Write landing page copy for the weekly code-change email" };
    const questions = { applicability: scoreQuestion("How applicable is the task to the project?", APPLICABILITY_CRITERIA),
      kind: { choices: ["writing", "errand", "engineering"], instructions: "What kind of work is the task?", type: "choice" },
      marketing: { instructions: "Is the task marketing work?", type: "predicate" } };
    const response = await openAiEndpoint().rankedResponses({ questions, state });
    expect(response.providerEm).toBe(DECISIONS_PROVIDER_OPENAI);
    expect(response.usage.inputTokens).toBeGreaterThan(0);
    expect(response.ratingFor("applicability", { levelCount: APPLICABILITY_CRITERIA.length })).toBeGreaterThan(6);
    expect(response.confidenceFor("applicability")).toBeGreaterThanOrEqual(0);
    expect(response.confidenceFor("applicability")).toBeLessThanOrEqual(1);
    expect(response.answerFor("kind")).toMatchObject({ choice: "writing", type: "choice" });
    expect(response.answerFor("marketing").type).toBe("predicate");
    expect(response.answerFor("marketing").probability).toBeGreaterThan(0.5);
  }, LIVE_TIMEOUT_MILLISECONDS);

  itIfOpenAiToken("falls back from a failing Jev route to OpenAI and records the Jev failure", async () => {
    const failingJevFetch = async () => ({ ok: false, status: 503, text: async () => "Service Unavailable" });
    const jevRoute = jevKeyRoute("ts-unavailable", { fetchImplementation: failingJevFetch, useProxy: false });
    const openAiRoute = openAiKeyRoute(OPEN_AI_ACCESS_TOKEN, { fetchImplementation: fetch });
    const decisionsEndpoint = new DecisionsEndpoint({ routes: [jevRoute, openAiRoute] });
    expect(decisionsEndpoint.providerEm).toBe(DECISIONS_PROVIDER_JEV);
    const questions = { task_1: scoreQuestion("How applicable is the task to the project?", APPLICABILITY_CRITERIA) };
    const state = { project: "Diff Digest launch", task: "Buy dog food" };
    const response = await decisionsEndpoint.rankedResponses({ questions, state });
    expect(response.providerEm).toBe(DECISIONS_PROVIDER_OPENAI);
    expect(response.ratingFor("task_1")).toBeLessThan(4);
    expect(jevFailedRecently()).toBe(true);
    expect(decisionsEndpoint.providerEm).toBe(DECISIONS_PROVIDER_OPENAI);
  }, LIVE_TIMEOUT_MILLISECONDS);
});
