// Ask a decisions model to score, choose, or check a shared piece of state, and read every reply as a
// DecisionsResponse. Callers build the questions Jev accepts (a name-keyed object, score questions carrying an ordered
// criteria list) and never learn which model answered. An endpoint holds an ordered list of routes, each one way of
// asking: Jev with a key, Jev or OpenAI through Ample Agent Pro, OpenAI's Decisions API with a key, or the generative
// fast model. A request goes to the first route and moves to the next when that one fails. A failed Jev route is
// remembered for JEV_FAILURE_COOLDOWN_MILLISECONDS, so later requests and later endpoints skip it rather than waiting
// on it again; decisionsEndpointForApp reads the same record when choosing routes. The record is held in memory, so
// the host plugin and the dashboard, which run as separate bundles, each keep their own.
//
// OpenAI takes a question array, an input string, and score levels of { label, description }. The translation stays
// inside this module. Both decision models index a rubric from zero, so DecisionsResponse.ratingFor reads either one
// on the 1-based scale.
import DecisionsResponse from "providers/decisions-response";
import { requestJevAnswers } from "providers/jev-client";
import { logIfEnabled } from "util/log";

export const DECISIONS_PROVIDER_GENERATIVE = "generative";
export const DECISIONS_PROVIDER_JEV = "jev";
export const DECISIONS_PROVIDER_OPENAI = "openai";
// How long a failed Jev request keeps Jev out of the routes. Long enough that an outage or an exhausted key is not
// retried on every batch of a pass, short enough that Jev is back in use within the session.
export const JEV_FAILURE_COOLDOWN_MILLISECONDS = 60 * 60 * 1000;
export const OPENAI_DECISIONS_ENDPOINT = "https://api.openai.com/v1/decisions";
export const OPENAI_DECISIONS_MODEL = "gpt-6-luna";
const DECISIONS_TIMEOUT_MILLISECONDS = 30000;
const ENDPOINT_LOG_LABEL = "[decisions-endpoint]";

let jevFailedAt = null; // {number|null} Epoch milliseconds of the most recent failed Jev request in this bundle.

// ----------------------------------------------------------------------------------------------
// @desc Rate one piece of state through the first route that answers. scorerEm tells a caller how to size its work:
//   "jev" for a decision model, which rates hundreds of tasks cheaply, or "generative" for the fast model, which
//   costs far more per task. It also names the provider permit a dispatched request waits for.
export class DecisionsEndpoint {
  clock; // {function} () => epoch milliseconds, injected for tests.
  providerDispatch; // {object|null} A work runtime's provider dispatcher; each request then waits for a permit.
  routes; // {Array<object>} { providerEm, recordsJevFailure, request }, tried in order.
  scorerEm; // {string} "jev" or "generative".
  signal; // {AbortSignal|null} Gives up a request still waiting for its permit.

  // ----------------------------------------------------------------------------------------------
  // @desc Hold the routes a request may take.
  // @param {object} options - An object with the following properties:
  //   - {function} [clock=Date.now] - Injected for tests
  //   - {object|null} [providerDispatch=null] - The dispatcher whose scorerEm permit each request waits for
  //   - {Array<object>} routes - At least one route, as decisionsRoute, jevKeyRoute, or openAiKeyRoute builds
  //   - {string} [scorerEm="jev"] - "jev" for a decision model, "generative" for the fast model
  //   - {AbortSignal|null} [signal=null] - Gives up a request still waiting for its permit
  constructor({ clock = () => Date.now(), providerDispatch = null, routes, scorerEm = "jev", signal = null }) {
    if (!Array.isArray(routes) || !routes.length) throw new Error("A decisions endpoint needs at least one route");
    Object.assign(this, { clock, providerDispatch, routes, scorerEm, signal });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc An endpoint that asks one injected request. It never records a Jev failure, so a test that rejects does
  //   not change which routes a later endpoint is given.
  // @param {function} requestAnswers - async ({ questions, state }) => { answers, model, usage }, answers name-keyed.
  // @param {object} [options] - { providerEm = "jev", scorerEm = "jev" }.
  // @returns {DecisionsEndpoint} The endpoint.
  static fromRequester(requestAnswers, { providerEm = DECISIONS_PROVIDER_JEV, scorerEm = "jev" } = {}) {
    return new DecisionsEndpoint({ routes: [{ providerEm, recordsJevFailure: false, request: requestAnswers }], scorerEm });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc The provider the next request would ask first.
  // @returns {string} "jev", "openai", or "generative".
  get providerEm() {
    return this._orderedRoutes()[0].providerEm;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Ask the routes in order until one answers. A route that throws is logged and the next is asked; a failed
  //   Jev route is recorded so it is skipped for JEV_FAILURE_COOLDOWN_MILLISECONDS. With a dispatcher, the whole
  //   request, fallbacks included, holds one permit.
  // @param {object} options - { questions, state }: questions keyed by name as scoreQuestion builds them, and the
  //   text or JSON object every question is asked about.
  // @returns {Promise<DecisionsResponse>} The first route's answers.
  async rankedResponses({ questions, state }) {
    const askRoutes = () => this._askRoutes({ questions, state });
    if (!this.providerDispatch) return askRoutes();
    return this.providerDispatch[this.scorerEm](askRoutes, { signal: this.signal });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc The same endpoint, with each request waiting for its own permit from a work runtime's dispatcher.
  // @param {object} options - { providerDispatch, signal = null }.
  // @returns {DecisionsEndpoint} A new endpoint over the same routes.
  withProviderDispatch({ providerDispatch, signal = null }) {
    return new DecisionsEndpoint({ clock: this.clock, providerDispatch, routes: this.routes, scorerEm: this.scorerEm, signal });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Try each route until one answers, recording a Jev failure as it happens.
  // @param {object} request - { questions, state }.
  // @returns {Promise<DecisionsResponse>} The first answer.
  async _askRoutes({ questions, state }) {
    let lastError = null;
    for (const route of this._orderedRoutes()) {
      try {
        const reply = await route.request({ questions, state });
        if (lastError) logIfEnabled(`${ ENDPOINT_LOG_LABEL } answered by fallback ${ route.providerEm }`);
        return new DecisionsResponse({ ...reply, providerEm: route.providerEm });
      } catch (error) {
        lastError = error;
        if (route.recordsJevFailure) recordJevFailure(this.clock());
        logIfEnabled(`${ ENDPOINT_LOG_LABEL } ${ route.providerEm } request failed`, error?.message);
      }
    }
    throw lastError;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc The routes a request tries, leaving out a Jev route while a recent Jev failure stands, unless every route
  //   would be left out.
  // @returns {Array<object>} Routes in the order they are asked.
  _orderedRoutes() {
    if (!jevFailedRecently(this.clock())) return this.routes;
    const healthyRoutes = this.routes.filter(route => !route.recordsJevFailure);
    return healthyRoutes.length ? healthyRoutes : this.routes;
  }
}

// ----------------------------------------------------------------------------------------------
// @desc A route that asks some provider through a request function, such as Ample Agent Pro or the fast model.
// @param {string} providerEm - "jev", "openai", or "generative"; a "jev" route records its failures.
// @param {function} request - async ({ questions, state }) => { answers, model, usage }, answers name-keyed.
// @returns {object} { providerEm, recordsJevFailure, request }.
export function decisionsRoute(providerEm, request) {
  return { providerEm, recordsJevFailure: providerEm === DECISIONS_PROVIDER_JEV, request };
}

// ----------------------------------------------------------------------------------------------
// @desc Forget the recorded Jev failure, so Jev is asked again. Used by tests and after the user changes keys.
export function forgetJevFailure() {
  jevFailedAt = null;
}

// ----------------------------------------------------------------------------------------------
// @desc A route that calls Jev with a TypeSafe or OpenRouter key.
// @param {string} accessToken - The Jev key.
// @param {object} [options] - { fetchImplementation, useProxy }, as requestJevAnswers takes them.
// @returns {object} The route.
export function jevKeyRoute(accessToken, { fetchImplementation, useProxy } = {}) {
  return decisionsRoute(DECISIONS_PROVIDER_JEV, ({ questions, state }) => requestJevAnswers({ accessToken,
    fetchImplementation, questions, state, useProxy }));
}

// ----------------------------------------------------------------------------------------------
// @desc Whether a Jev request failed within the last JEV_FAILURE_COOLDOWN_MILLISECONDS.
// @param {number} [now=Date.now()] - Epoch milliseconds.
// @returns {boolean} True while Jev should not be asked first.
export function jevFailedRecently(now = Date.now()) {
  return jevFailedAt !== null && now - jevFailedAt < JEV_FAILURE_COOLDOWN_MILLISECONDS;
}

// ----------------------------------------------------------------------------------------------
// @desc Key an OpenAI answers array by question name. Entries without a name are dropped.
// @param {Array<object>|undefined} decisionAnswers - The response's answers array.
// @returns {object|null} Answers keyed by name, or null when the array names nothing.
export function namedAnswersFromOpenAiAnswers(decisionAnswers) {
  if (!Array.isArray(decisionAnswers)) return null;
  const namedEntries = decisionAnswers.filter(answer => typeof answer?.name === "string" && answer.name);
  const answers = Object.fromEntries(namedEntries.map(answer => [answer.name, answer]));
  return Object.keys(answers).length ? answers : null;
}

// ----------------------------------------------------------------------------------------------
// @desc A route that calls OpenAI's Decisions API with the user's OpenAI key.
// @param {string} accessToken - The OpenAI key.
// @param {object} [options] - { fetchImplementation, model, timeoutMilliseconds }.
// @returns {object} The route.
export function openAiKeyRoute(accessToken, { fetchImplementation = globalThis.fetch, model = OPENAI_DECISIONS_MODEL,
    timeoutMilliseconds = DECISIONS_TIMEOUT_MILLISECONDS } = {}) {
  return decisionsRoute(DECISIONS_PROVIDER_OPENAI, ({ questions, state }) => _requestOpenAiDecisions({ accessToken,
    fetchImplementation, model, questions, state, timeoutMilliseconds }));
}

// ----------------------------------------------------------------------------------------------
// @desc The Decisions API request body for name-keyed questions about one state.
// @param {object} questions - Questions keyed by name, each { type, instructions, criteria?, choices? }.
// @param {object|string} state - The text or JSON object every question is asked about.
// @param {string} [model=OPENAI_DECISIONS_MODEL] - The Decisions model.
// @returns {object} { input, model, questions }.
export function openAiDecisionsBody(questions, state, model = OPENAI_DECISIONS_MODEL) {
  return { input: _decisionInputFromState(state), model, questions: _openAiQuestionsFromNamedQuestions(questions) };
}

// ----------------------------------------------------------------------------------------------
// @desc Remember that a Jev request failed, so Jev is skipped until the cooldown passes.
// @param {number} [now=Date.now()] - Epoch milliseconds of the failure.
export function recordJevFailure(now = Date.now()) {
  jevFailedAt = now;
}

// ----------------------------------------------------------------------------------------------
// @desc Build a score question any route can ask. Every provider reads the rubric from zero, so a 1–10 scale is a
//   ten-entry list whose first entry describes a 1, and DecisionsResponse.ratingFor reads the answer on that scale.
// @param {string|object} instructions - The question, as text or a JSON object.
// @param {Array<string>} criteria - At least two rubric descriptions, lowest score first. Jev rejects null entries.
// @returns {object} A score question: { criteria, instructions, type: "score" }.
export function scoreQuestion(instructions, criteria) {
  if (!Array.isArray(criteria) || criteria.length < 2) throw new Error("A score question needs at least two criteria");
  if (criteria.some(criterion => typeof criterion !== "string")) throw new Error("Every score criterion must be text");
  return { criteria, instructions, type: "score" };
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc The input string OpenAI scores. A string state is sent as itself; a structured state is sent as JSON.
// @param {object|string|null|undefined} state - The text or object every question is asked about.
// @returns {string} The Decisions API input.
function _decisionInputFromState(state) {
  if (typeof state === "string") return state;
  return JSON.stringify(state ?? null);
}

// ----------------------------------------------------------------------------------------------
// @desc The instructions string OpenAI scores. An object is sent as JSON, the same words Jev would have read.
// @param {object|string|null|undefined} instructions - The question, as text or a JSON object.
// @returns {string} Instructions text.
function _instructionsText(instructions) {
  if (typeof instructions === "string") return instructions;
  if (instructions == null) return "";
  return JSON.stringify(instructions);
}

// ----------------------------------------------------------------------------------------------
// @desc OpenAI score levels from a Jev criteria list, lowest first. The label is the 1-based rubric step; the
//   description is the criterion text. Level indices stay zero-based, which is the score both APIs return.
// @param {Array<string>} criteria - Rubric descriptions, lowest score first.
// @returns {Array<object>} { description, label } pairs.
function _levelsFromCriteria(criteria) {
  if (!Array.isArray(criteria) || criteria.length < 2) throw new Error("A score question needs at least two criteria");
  return criteria.map((criterion, index) => ({ description: String(criterion), label: String(index + 1) }));
}

// ----------------------------------------------------------------------------------------------
// @desc OpenAI choices from a list of choice names. The API takes each choice as { value, description? } and rejects a
//   bare string, so a name becomes its value; a choice already given as an object passes through.
// @param {Array<string|object>} choices - Choice names, or { value, description } objects.
// @returns {Array<object>} Decisions API choices.
function _openAiChoices(choices) {
  const openAiChoices = (choices || []).map(choice => (typeof choice === "string" ? { value: choice } : choice));
  return openAiChoices;
}

// ----------------------------------------------------------------------------------------------
// @desc One named Jev question as an OpenAI Decisions question.
// @param {string} name - Question name, echoed back on the answer.
// @param {object} question - { choices?, criteria?, instructions, type }.
// @returns {object} A Decisions API question.
function _openAiQuestion(name, question) {
  const instructions = _instructionsText(question?.instructions);
  if (question?.type === "predicate") return { instructions, name, type: "predicate" };
  if (question?.type === "choice") return { choices: _openAiChoices(question.choices), instructions, name, type: "choice" };
  return { instructions, levels: _levelsFromCriteria(question?.criteria), name, type: "score" };
}

// ----------------------------------------------------------------------------------------------
// @desc The questions array OpenAI scores, in the order of the name-keyed object callers already build.
// @param {object} questions - Questions keyed by name.
// @returns {Array<object>} Decisions API questions.
function _openAiQuestionsFromNamedQuestions(questions) {
  if (!questions || typeof questions !== "object" || Array.isArray(questions)) {
    throw new Error("At least one decision question is required");
  }
  const namedQuestions = Object.entries(questions).map(([name, question]) => _openAiQuestion(name, question));
  if (!namedQuestions.length) throw new Error("At least one decision question is required");
  return namedQuestions;
}

// ----------------------------------------------------------------------------------------------
// @desc Submit one OpenAI Decisions request. A non-2xx response, a timeout, or a body without named answers throws,
//   naming the HTTP status and the start of the body.
// @param {object} request - { accessToken, fetchImplementation, model, questions, state, timeoutMilliseconds }.
// @returns {Promise<object>} { answers, model, usage }, answers keyed by question name.
async function _requestOpenAiDecisions({ accessToken, fetchImplementation, model, questions, state, timeoutMilliseconds }) {
  if (!accessToken) throw new Error("An OpenAI access token is required");
  const body = JSON.stringify(openAiDecisionsBody(questions, state, model));
  const headers = { Authorization: `Bearer ${ accessToken }`, "Content-Type": "application/json" };
  const abortController = typeof AbortController === "function" ? new AbortController() : null;
  const timer = abortController ? setTimeout(() => abortController.abort(), timeoutMilliseconds) : null;
  let response;
  try {
    response = await fetchImplementation(OPENAI_DECISIONS_ENDPOINT, { body, headers, method: "POST",
      signal: abortController?.signal });
  } catch (error) {
    const reason = error?.name === "AbortError" ? `timed out after ${ timeoutMilliseconds }ms` : error?.message;
    throw new Error(`OpenAI Decisions request failed: ${ reason }`);
  } finally {
    if (timer) clearTimeout(timer);
  }
  const bodyText = await response.text();
  if (!response.ok) throw new Error(`OpenAI Decisions answered ${ response.status }: ${ bodyText.slice(0, 200) }`);
  let parsedBody = null;
  try { parsedBody = JSON.parse(bodyText); } catch (_error) { parsedBody = null; }
  const answers = namedAnswersFromOpenAiAnswers(parsedBody?.answers);
  if (!answers) throw new Error(`OpenAI Decisions response carried no answers: ${ bodyText.slice(0, 200) }`);
  return { answers, model: parsedBody.model ?? null, usage: parsedBody.usage ?? null };
}
