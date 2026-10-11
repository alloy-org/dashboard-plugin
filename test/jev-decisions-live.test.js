// Live checks against Jev, run only when JEV_ACCESS_TOKEN is set in .env. They record, as the raw requests sent, how
// Jev's choice questions are shaped: a body must name a model, a choice question's options go in a criteria object
// keyed by choice (a choices list, a criteria list, or criteria text is refused with a 422), and the answer carries
// the chosen key, a confidence from 0 to 1, and a probability for every choice. A last check sends a question built by
// choiceQuestion through jevKeyRoute, confirming the confidence survives DecisionsResponse.
import dotenv from "dotenv";
import fetch from "isomorphic-fetch";
import { choiceQuestion, DecisionsEndpoint, forgetJevFailure, jevKeyRoute } from "providers/decisions-endpoint";
import { jevRouteFromAccessToken } from "providers/jev-client";

dotenv.config();

const JEV_ACCESS_TOKEN = (process.env.JEV_ACCESS_TOKEN || "").trim();
const itIfJevToken = JEV_ACCESS_TOKEN ? it : it.skip;
const LIVE_TIMEOUT_MILLISECONDS = 60000;
const PROJECT_CRITERIA = { "1. Launch dashboard": "The task advanced the project \"Launch dashboard\".",
  "2. Hire a designer": "The task advanced the project \"Hire a designer\".",
  "None of these projects": "The task advanced none of these projects, such as an errand or a chore." };
const CHOICE_INSTRUCTIONS = "The user completed the task \"Tune the dashboard widget spacing\". Which project did it advance?";

// ----------------------------------------------------------------------------------------------
// @desc Post one request body to Jev directly, without the proxy, and read its reply.
// @param {object} body - The request body, sent as JSON exactly as given.
// @returns {Promise<object>} { body, status }: the parsed reply and the HTTP status.
async function postToJev(body) {
  const { endpoint } = jevRouteFromAccessToken(JEV_ACCESS_TOKEN, { useProxy: false });
  const response = await fetch(endpoint, { body: JSON.stringify(body), headers: { Authorization: `Bearer ${ JEV_ACCESS_TOKEN }`,
    "Content-Type": "application/json" }, method: "POST" });
  return { body: await response.json(), status: response.status };
}

// ----------------------------------------------------------------------------------------------
// @desc A request body asking one choice question about one completed task.
// @param {object} question - The question, sent as given.
// @param {object} [fields] - Body fields to add or replace, such as model.
// @returns {object} The request body.
function choiceBody(question, fields = {}) {
  const { model } = jevRouteFromAccessToken(JEV_ACCESS_TOKEN || "ts-unset", { useProxy: false });
  return { model, questions: { task_1: question }, state: { completedTasks: ["Tune the dashboard widget spacing"] }, ...fields };
}

// ----------------------------------------------------------------------------------------------
// @desc The validation errors in a 422 reply, as [location, type] pairs.
// @param {object} reply - From postToJev.
// @returns {Array<Array<string>>} One pair per error, the location joined with dots.
function validationErrors(reply) {
  expect(reply.status).toBe(422);
  const errorPairs = reply.body.detail.map(error => [error.loc.join("."), error.type]);
  return errorPairs;
}

describe("Jev choice questions (live)", () => {
  beforeEach(() => forgetJevFailure());

  // ----------------------------------------------------------------------------------------------
  // @desc A body without a model, and a choice question offering its options as a choices list, are both refused.
  itIfJevToken("refuses a missing model and a choice question without criteria", async () => {
    const question = { choices: Object.keys(PROJECT_CRITERIA), instructions: CHOICE_INSTRUCTIONS, type: "choice" };
    const reply = await postToJev(choiceBody(question, { model: undefined }));
    expect(validationErrors(reply)).toEqual([["body.model", "missing"], ["body.questions.task_1.choice.criteria", "missing"]]);
  }, LIVE_TIMEOUT_MILLISECONDS);

  // ----------------------------------------------------------------------------------------------
  // @desc Criteria given as a list of choices, or as text, is refused: Jev reads criteria as an object.
  itIfJevToken("refuses choice criteria that are not an object", async () => {
    for (const criteria of [Object.keys(PROJECT_CRITERIA), Object.values(PROJECT_CRITERIA), "Pick the project the task advanced"]) {
      const question = { choices: Object.keys(PROJECT_CRITERIA), criteria, instructions: CHOICE_INSTRUCTIONS, type: "choice" };
      expect(validationErrors(await postToJev(choiceBody(question)))).toEqual([["body.questions.task_1.choice.criteria", "dict_type"]]);
    }
  }, LIVE_TIMEOUT_MILLISECONDS);

  // ----------------------------------------------------------------------------------------------
  // @desc Criteria keyed by choice are accepted, with or without a choices list beside them; the answer names one of
  //   the keys and reports a confidence and each choice's probability.
  itIfJevToken("answers criteria keyed by choice with a confidence and every choice's probability", async () => {
    const questions = [{ criteria: PROJECT_CRITERIA, instructions: CHOICE_INSTRUCTIONS, type: "choice" },
      { choices: Object.keys(PROJECT_CRITERIA), criteria: PROJECT_CRITERIA, instructions: CHOICE_INSTRUCTIONS, type: "choice" }];
    for (const question of questions) {
      const reply = await postToJev(choiceBody(question));
      expect(reply.status).toBe(200);
      const answer = reply.body.answers.task_1;
      expect(answer.type).toBe("choice");
      expect(Object.keys(PROJECT_CRITERIA)).toContain(answer.choice);
      expect(answer.confidence).toBeGreaterThanOrEqual(0);
      expect(answer.confidence).toBeLessThanOrEqual(1);
      expect(Object.keys(answer.probabilities).sort()).toEqual(Object.keys(PROJECT_CRITERIA).sort());
      expect(reply.body.usage.input_tokens).toBeGreaterThan(0);
    }
  }, LIVE_TIMEOUT_MILLISECONDS);

  // ----------------------------------------------------------------------------------------------
  // @desc A question choiceQuestion builds, asked through jevKeyRoute, reads back through DecisionsResponse with the
  //   choice and confidence Jev reported.
  itIfJevToken("reads a choiceQuestion answer through DecisionsResponse", async () => {
    const decisionsEndpoint = new DecisionsEndpoint({ routes: [jevKeyRoute(JEV_ACCESS_TOKEN, { fetchImplementation: fetch,
      useProxy: false })] });
    const response = await decisionsEndpoint.rankedResponses({ questions: { task_1: choiceQuestion(CHOICE_INSTRUCTIONS,
      PROJECT_CRITERIA) }, state: { completedTasks: ["Tune the dashboard widget spacing"] } });
    expect(response.answerFor("task_1")).toMatchObject({ choice: "1. Launch dashboard", type: "choice" });
    expect(response.confidenceFor("task_1")).toBeGreaterThan(0);
  }, LIVE_TIMEOUT_MILLISECONDS);
});
