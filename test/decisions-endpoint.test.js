// DecisionsEndpoint asks Jev, OpenAI's Decisions API, Ample Agent Pro, or the fast model through ordered routes, falls
// back when a route fails, keeps a failed Jev out of the routes for an hour, and returns every reply as one
// DecisionsResponse; decisionsEndpointForApp chooses those routes from the user's keys and Agent Pro.
import { jest } from "@jest/globals";
import { SETTING_KEYS } from "constants/settings";
import { setPluginData } from "plugin-data";
import { choiceQuestion, DECISIONS_PROVIDER_JEV, DECISIONS_PROVIDER_OPENAI, DecisionsEndpoint, decisionsRoute, forgetJevFailure,
  JEV_FAILURE_COOLDOWN_MILLISECONDS, jevFailedRecently, jevKeyRoute, OPENAI_DECISIONS_ENDPOINT, OPENAI_DECISIONS_MODEL,
  openAiDecisionsBody, openAiKeyRoute, recordJevFailure, scoreQuestion } from "providers/decisions-endpoint";
import { decisionsEndpointForApp } from "providers/decisions-endpoint-for-app";
import DecisionsResponse from "providers/decisions-response";

const SCORE_QUESTIONS = { task_1: scoreQuestion("How applicable is task_1?", ["unrelated", "directly advances the project"]) };
const NOW = Date.UTC(2026, 9, 11, 12);

// ----------------------------------------------------------------------------------------------
// @desc A fetch response whose body is the given JSON value, or the string as text when it is not an object.
// @param {object|string} body - Response body.
// @param {number} [status=200] - HTTP status.
// @returns {object} The slice of a fetch Response the endpoint reads.
function jsonResponse(body, status = 200) {
  const bodyText = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => bodyText };
}

// ----------------------------------------------------------------------------------------------
// @desc An app whose Ample Agent Pro note exists, answering every callPlugin with the given reply.
// @param {function} callPlugin - The callPlugin mock.
// @returns {object} The app.
function agentProApp(callPlugin) {
  return { callPlugin, findNote: async () => ({ name: "Ample Agent Pro", uuid: "agent-pro" }) };
}

beforeEach(() => {
  forgetJevFailure();
  setPluginData({ settings: {} });
});

describe("DecisionsResponse", () => {
  it("reads a zero-based score on the rubric's 1-based scale and normalizes usage names", () => {
    const response = new DecisionsResponse({ answers: { held: { score: 12, type: "score" }, task_1: { confidence: 0.4,
      score: 7.64, type: "score" }, task_2: { type: "refusal" }, task_3: { type: "mystery" } }, providerEm: "openai",
    usage: { prompt_tokens: 12 } });
    expect(response.ratingFor("task_1")).toBe(8.6);
    expect(response.confidenceFor("task_1")).toBe(0.4);
    expect(response.ratingFor("held")).toBe(10);
    expect(response.ratingFor("task_2")).toBeNull();
    expect(response.answerFor("task_3")).toEqual({ type: "refusal" });
    expect(response.ratingFor("missing")).toBeNull();
    expect(response.usage).toEqual({ inputTokens: 12, outputTokens: 0 });
  });
});

describe("DecisionsEndpoint routes", () => {
  it("sends a Jev question object to TypeSafe and returns a DecisionsResponse", async () => {
    const fetchImplementation = jest.fn().mockResolvedValue(jsonResponse({ answers: { task_1: { confidence: 0.5, score: 3,
      type: "score" } }, model: "jev-latest", usage: { input_tokens: 10, output_tokens: 1 } }));
    const endpoint = new DecisionsEndpoint({ routes: [jevKeyRoute("ts-key", { fetchImplementation, useProxy: false })] });
    const response = await endpoint.rankedResponses({ questions: SCORE_QUESTIONS, state: { project: "Diff Digest" } });
    const [url, request] = fetchImplementation.mock.calls[0];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(request.headers.Authorization).toBe("Bearer ts-key");
    expect(JSON.parse(request.body).questions.task_1.criteria).toEqual(["unrelated", "directly advances the project"]);
    expect(response).toBeInstanceOf(DecisionsResponse);
    expect(response).toMatchObject({ model: "jev-latest", providerEm: DECISIONS_PROVIDER_JEV, usage: { inputTokens: 10,
      outputTokens: 1 } });
    expect(response.ratingFor("task_1")).toBe(4);
  });

  it("translates score, predicate, and choice questions for OpenAI and keys its answers by name", async () => {
    const fetchImplementation = jest.fn().mockResolvedValue(jsonResponse({ answers: [{ confidence: 0.4, name: "task_1",
      score: 0.4, type: "score" }, { name: "damaged", probability: 0.2, type: "predicate" },
    { choice: "billing", confidence: 0.9, name: "department", type: "choice" }], model: OPENAI_DECISIONS_MODEL,
    usage: { input_tokens: 80 } }));
    const endpoint = new DecisionsEndpoint({ routes: [openAiKeyRoute("sk-test", { fetchImplementation })] });
    const response = await endpoint.rankedResponses({ questions: { ...SCORE_QUESTIONS, damaged: { instructions: "Is it damaged?",
      type: "predicate" }, department: { choices: [{ description: "Payments", value: "billing" }], instructions: { ask: "Where?" },
      type: "choice" } }, state: "I was charged twice" });
    const [url, request] = fetchImplementation.mock.calls[0];
    expect(url).toBe(OPENAI_DECISIONS_ENDPOINT);
    expect(request.headers.Authorization).toBe("Bearer sk-test");
    expect(JSON.parse(request.body)).toEqual({ input: "I was charged twice", model: OPENAI_DECISIONS_MODEL, questions: [
      { instructions: "How applicable is task_1?", levels: [{ description: "unrelated", label: "1" },
        { description: "directly advances the project", label: "2" }], name: "task_1", type: "score" },
      { instructions: "Is it damaged?", name: "damaged", type: "predicate" },
      { choices: [{ description: "Payments", value: "billing" }], instructions: JSON.stringify({ ask: "Where?" }),
        name: "department", type: "choice" }] });
    expect(response.providerEm).toBe(DECISIONS_PROVIDER_OPENAI);
    expect(response.ratingFor("task_1")).toBe(1.4);
    expect(response.answerFor("damaged")).toEqual({ probability: 0.2, type: "predicate" });
    expect(response.answerFor("department")).toEqual({ choice: "billing", confidence: 0.9, type: "choice" });
    expect(response.usage.inputTokens).toBe(80);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc choiceQuestion builds the criteria object Jev requires (see jev-decisions-live.test.js), refusing fewer than
  //   two choices or a choice without a description, and OpenAI is sent the same choices as described values.
  it("builds a choice question from described criteria and translates it for OpenAI", () => {
    const criteria = { billing: "Payments and refunds", shipping: "Delivery and tracking" };
    const question = choiceQuestion("Which department?", criteria);
    expect(question).toEqual({ criteria, instructions: "Which department?", type: "choice" });
    expect(() => choiceQuestion("Which?", { billing: "Payments" })).toThrow("at least two choices");
    expect(() => choiceQuestion("Which?", ["billing", "shipping"])).toThrow("at least two choices");
    expect(() => choiceQuestion("Which?", { billing: "Payments", shipping: null })).toThrow("Every choice needs a description");
    expect(openAiDecisionsBody({ department: question }, "Where is my parcel?").questions).toEqual([{ choices: [
      { description: "Payments and refunds", value: "billing" }, { description: "Delivery and tracking", value: "shipping" }],
    instructions: "Which department?", name: "department", type: "choice" }]);
  });

  it("names the status when OpenAI rejects a request, and rejects a body with no answers", async () => {
    const rejected = new DecisionsEndpoint({ routes: [openAiKeyRoute("sk-test",
      { fetchImplementation: jest.fn().mockResolvedValue(jsonResponse("nope", 401)) })] });
    await expect(rejected.rankedResponses({ questions: SCORE_QUESTIONS, state: "note" }))
      .rejects.toThrow("OpenAI Decisions answered 401: nope");
    const empty = new DecisionsEndpoint({ routes: [openAiKeyRoute("sk-test",
      { fetchImplementation: jest.fn().mockResolvedValue(jsonResponse({ answers: [] })) })] });
    await expect(empty.rankedResponses({ questions: SCORE_QUESTIONS, state: "note" }))
      .rejects.toThrow("OpenAI Decisions response carried no answers");
    await expect(empty.rankedResponses({ questions: {}, state: "note" })).rejects.toThrow("At least one decision question is required");
  });
});

describe("DecisionsEndpoint fallback", () => {
  it("falls back to OpenAI when Jev fails, then skips Jev until the cooldown passes", async () => {
    let now = NOW;
    const jevRequest = jest.fn().mockRejectedValue(new Error("Jev answered 503: down"));
    const openAiRequest = jest.fn().mockResolvedValue({ answers: { task_1: { score: 5, type: "score" } } });
    const endpoint = new DecisionsEndpoint({ clock: () => now, routes: [decisionsRoute(DECISIONS_PROVIDER_JEV, jevRequest),
      decisionsRoute(DECISIONS_PROVIDER_OPENAI, openAiRequest)] });
    expect(endpoint.providerEm).toBe(DECISIONS_PROVIDER_JEV);
    const first = await endpoint.rankedResponses({ questions: SCORE_QUESTIONS, state: "note" });
    expect(first.providerEm).toBe(DECISIONS_PROVIDER_OPENAI);
    expect(jevFailedRecently(now)).toBe(true);
    await endpoint.rankedResponses({ questions: SCORE_QUESTIONS, state: "note" });
    expect(jevRequest).toHaveBeenCalledTimes(1);
    expect(endpoint.providerEm).toBe(DECISIONS_PROVIDER_OPENAI);
    now += JEV_FAILURE_COOLDOWN_MILLISECONDS;
    jevRequest.mockResolvedValueOnce({ answers: { task_1: { score: 8, type: "score" } } });
    const recovered = await endpoint.rankedResponses({ questions: SCORE_QUESTIONS, state: "note" });
    expect(recovered.providerEm).toBe(DECISIONS_PROVIDER_JEV);
    expect(jevRequest).toHaveBeenCalledTimes(2);
  });

  it("keeps asking Jev when it is the only route, and throws the last error when every route fails", async () => {
    recordJevFailure(Date.now());
    const jevOnly = new DecisionsEndpoint({ routes: [decisionsRoute(DECISIONS_PROVIDER_JEV,
      jest.fn().mockRejectedValue(new Error("Jev answered 401: bad key")))] });
    await expect(jevOnly.rankedResponses({ questions: SCORE_QUESTIONS, state: "note" })).rejects.toThrow("bad key");
  });

  it("holds one dispatcher permit, named by scorerEm, across the whole request", async () => {
    const providerDispatch = { generative: jest.fn(), jev: jest.fn(async (request, { signal }) => {
      expect(signal).toBe("abort-signal");
      return request();
    }) };
    const endpoint = DecisionsEndpoint.fromRequester(async () => ({ answers: { task_1: { score: 1, type: "score" } } }))
      .withProviderDispatch({ providerDispatch, signal: "abort-signal" });
    const response = await endpoint.rankedResponses({ questions: SCORE_QUESTIONS, state: "note" });
    expect(response.ratingFor("task_1")).toBe(2);
    expect(providerDispatch.jev).toHaveBeenCalledTimes(1);
    expect(providerDispatch.generative).not.toHaveBeenCalled();
  });

  it("does not record a Jev failure from an injected request", async () => {
    const injected = DecisionsEndpoint.fromRequester(jest.fn().mockRejectedValue(new Error("test rejection")));
    await expect(injected.rankedResponses({ questions: SCORE_QUESTIONS, state: "note" })).rejects.toThrow("test rejection");
    expect(jevFailedRecently()).toBe(false);
  });
});

describe("decisionsEndpointForApp", () => {
  it("asks Jev first and OpenAI second when both keys are set, and OpenAI first once Jev has failed", async () => {
    setPluginData({ settings: { [SETTING_KEYS.JEV_ACCESS_TOKEN]: "ts-key", [SETTING_KEYS.LLM_API_KEY_OPENAI]: "sk-key" } });
    const healthy = await decisionsEndpointForApp({});
    expect(healthy.routes.map(route => route.providerEm)).toEqual([DECISIONS_PROVIDER_JEV, DECISIONS_PROVIDER_OPENAI]);
    expect(healthy.scorerEm).toBe("jev");
    recordJevFailure(NOW);
    const afterFailure = await decisionsEndpointForApp({}, { now: NOW + 1000 });
    expect(afterFailure.providerEm).toBe(DECISIONS_PROVIDER_OPENAI);
  });

  it("rates with OpenAI Decisions when only an OpenAI key is set, rather than with the fast model", async () => {
    setPluginData({ settings: { [SETTING_KEYS.LLM_API_KEY_OPENAI]: "sk-key" } });
    const endpoint = await decisionsEndpointForApp({});
    expect(endpoint.routes.map(route => route.providerEm)).toEqual([DECISIONS_PROVIDER_OPENAI]);
    expect(endpoint.scorerEm).toBe("jev");
  });

  it("asks Agent Pro for Jev, and for OpenAI Decisions once Jev through it has failed", async () => {
    const callPlugin = jest.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ answers: [{ name: "task_1", score: 6, type: "score" }], model: OPENAI_DECISIONS_MODEL });
    const app = agentProApp(callPlugin);
    const endpoint = await decisionsEndpointForApp(app);
    expect(endpoint.routes.map(route => route.providerEm)).toEqual([DECISIONS_PROVIDER_JEV, DECISIONS_PROVIDER_OPENAI]);
    const response = await endpoint.rankedResponses({ questions: SCORE_QUESTIONS, state: { project: "Diff Digest" } });
    expect(response).toMatchObject({ model: OPENAI_DECISIONS_MODEL, providerEm: DECISIONS_PROVIDER_OPENAI });
    expect(response.ratingFor("task_1")).toBe(7);
    expect(callPlugin.mock.calls[0][3]).toBe("jev-latest");
    const [, , openAiPrompt, openAiModel, openAiEndpoint] = callPlugin.mock.calls[1];
    expect(openAiModel).toBe(OPENAI_DECISIONS_MODEL);
    expect(openAiEndpoint).toBe(OPENAI_DECISIONS_ENDPOINT);
    expect(JSON.parse(openAiPrompt).questions[0]).toMatchObject({ name: "task_1", type: "score" });
    expect(jevFailedRecently()).toBe(true);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Agent Pro has answered with bare maps of question name to rating or choice, at the top level and under
  //   `answers`; each value is read by its question's type, and a value outside the question is left unanswered.
  it("reads Agent Pro's bare rating and choice maps by question type", async () => {
    const tenLevels = Array.from({ length: 10 }, (_unused, index) => `level ${ index + 1 }`);
    const questions = { duration_1: choiceQuestion("How many minutes?", { 30: "30 minutes", 60: "60 minutes" }),
      duration_2: choiceQuestion("How many minutes?", { 30: "30 minutes", 60: "60 minutes" }),
      idea_1_relevance: scoreQuestion("How relevant?", tenLevels), idea_2_relevance: scoreQuestion("How relevant?", tenLevels) };
    const callPlugin = jest.fn()
      .mockResolvedValueOnce('{"idea_1_relevance":8,"idea_2_relevance":11,"duration_1":"60","duration_2":45}')
      .mockResolvedValueOnce({ answers: { duration_1: 30, idea_1_relevance: "3" } });
    const endpoint = await decisionsEndpointForApp(agentProApp(callPlugin));
    const flatResponse = await endpoint.rankedResponses({ questions, state: {} });
    expect(flatResponse.ratingFor("idea_1_relevance")).toBe(8);
    expect(flatResponse.answerFor("idea_2_relevance")).toBeNull();
    expect(flatResponse.answerFor("duration_1")).toMatchObject({ choice: "60", type: "choice" });
    expect(flatResponse.answerFor("duration_2")).toBeNull();
    const wrappedResponse = await endpoint.rankedResponses({ questions, state: {} });
    expect(wrappedResponse.answerFor("duration_1")).toMatchObject({ choice: "30", type: "choice" });
    expect(wrappedResponse.ratingFor("idea_1_relevance")).toBe(3);
  });

  it("falls to the fast model only when no decision model can be asked, and to null without one", async () => {
    expect(await decisionsEndpointForApp({})).toBeNull();
    setPluginData({ settings: { [SETTING_KEYS.LLM_API_KEY_GEMINI]: "gemini-key" } });
    const promptRunner = jest.fn().mockResolvedValue({ ratings: { task_1: 9 } });
    const endpoint = await decisionsEndpointForApp({}, { promptRunner });
    expect(endpoint.scorerEm).toBe("generative");
    const response = await endpoint.rankedResponses({ questions: SCORE_QUESTIONS, state: { project: "Diff Digest" } });
    expect(response.providerEm).toBe("generative");
    expect(response.ratingFor("task_1")).toBe(9);
    expect(await decisionsEndpointForApp({}, { includeFastScore: false })).toBeNull();
  });
});
