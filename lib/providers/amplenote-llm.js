// Ask Amplenote's own model APIs, app.callLLM and app.callDecisionModel, which run on the account's plugin LLM license
// and need no key the user configured. Both methods are always present; an account without a license, or without
// quota left, is told so by the call throwing. The host plugin calls them directly, and the dashboard embed reaches
// them through the onEmbedCall bridge, which resolves a thrown call to an { embedCallFailed } envelope instead of
// rejecting. Every helper here reads a throw and that envelope alike, so a caller sees the same answer from either
// side of the bridge.
//
// Whether the license can answer at all is asked once per app interface with checkQuota, which costs nothing and
// throws when the account has no license or no quota. Only a positive answer is remembered: a later miss on a license
// that answered is a transient failure, not a lapsed subscription, and must not show the upsell to a subscriber.
import { AMPLENOTE_LLM_DEFAULT_MODEL, AMPLENOTE_LLM_MODEL_PREFIXES, AMPLENOTE_LLM_REASONING_EFFORTS } from "constants/llm-providers"
import { extractJsonFromString } from "providers/fetch-json"
import { JEV_DIRECT_MODEL } from "providers/jev-client"
import { logIfEnabled } from "util/log"

const AMPLENOTE_LLM_DEFAULT_TIMEOUT_SECONDS = 60;
const AMPLENOTE_DECISION_TIMEOUT_MILLISECONDS = 30000;
const DEFAULT_SOURCE = "dashboard";
const LOG_LABEL = "[amplenote-llm]";
const RESULT_SNIPPET_LENGTH = 300;

// App interfaces whose plugin LLM license has answered, by quota check or by a completed call.
const appsWithAvailableLlm = new WeakSet();
// The quota check in flight for each app interface, shared so widgets and services that ask at once make one check.
const llmAvailabilityChecksByApp = new WeakMap();

// ----------------------------------------------------------------------------------------------
// @desc Run one prompt through app.callLLM and return its reply, parsed as JSON when asked. A null return is the only
//   failure signal: a missing license, exhausted quota, a timeout, and a provider error all resolve null, so a
//   caller can fall back to the user's own provider, or race this against it, without a rejection settling the race.
// @param {object} app - Host-compatible Amplenote API, or the embed's bridge proxy.
// @param {string} prompt - Sent as the single user message.
// @param {object} [options] - An object with the following properties:
//   - {string|null} [aiModel] - Model to ask; a model callLLM cannot serve, or none, asks AMPLENOTE_LLM_DEFAULT_MODEL
//   - {string|null} [instructions] - System instructions for the model
//   - {boolean} [jsonResponse] - Parse the reply's text as JSON before returning it
//   - {string|null} [reasoningEffort] - Thinking budget; anything below "low" asks for "low"
//   - {string} [source="dashboard"] - Call site name the license attributes usage to
//   - {number|null} [timeoutSeconds=60] - How long callLLM waits for the model
// @returns {Promise<*|null>} The reply's text or parsed JSON, or null when nothing usable came back.
export async function amplenoteLlmPrompt(app, prompt, { aiModel, instructions, jsonResponse, reasoningEffort,
    source = DEFAULT_SOURCE, timeoutSeconds } = {}) {
  const model = amplenoteLlmModel(aiModel);
  const requestOptions = { input: [{ content: prompt, role: "user" }], model, source,
    timeoutMs: (timeoutSeconds || AMPLENOTE_LLM_DEFAULT_TIMEOUT_SECONDS) * 1000 };
  const requestedEffort = _amplenoteReasoningEffort(reasoningEffort);
  if (requestedEffort) requestOptions.reasoningEffort = requestedEffort;
  if (instructions) requestOptions.instructions = instructions;
  const requestStart = performance.now();
  try {
    const response = await app.callLLM(requestOptions);
    const durationMs = Number((performance.now() - requestStart).toFixed(1));
    const failureReason = _bridgeFailureReason(response);
    if (failureReason || typeof response?.textOutput !== "string" || !response.textOutput.trim()) {
      logIfEnabled(`${ LOG_LABEL } callLLM produced no text`, { durationMs, failureReason, model, source });
      return null;
    }
    appsWithAvailableLlm.add(app);
    logIfEnabled(`${ LOG_LABEL } callLLM answered`, { callCost: response.callCost ?? null, durationMs, model, source,
      resultSnippet: response.textOutput.substring(0, RESULT_SNIPPET_LENGTH) });
    return jsonResponse ? extractJsonFromString(response.textOutput) : response.textOutput;
  } catch (error) {
    logIfEnabled(`${ LOG_LABEL } callLLM threw`, { durationMs: Number((performance.now() - requestStart).toFixed(1)),
      errorMessage: error?.message, model, source, status: error?.status ?? null });
    return null;
  }
}

// ----------------------------------------------------------------------------------------------
// @desc A DecisionsEndpoint request function that asks app.callDecisionModel. Its answers are returned keyed by
//   question name in the shape requestJevAnswers returns, so the endpoint reads every route alike. A failed call or a
//   reply without answers throws, so the endpoint records the batch as failed and asks its next route.
// @param {object} app - Host-compatible Amplenote API, or the embed's bridge proxy.
// @param {object} [options] - An object with the following properties:
//   - {string} [source="task-rating"] - Call site name the license attributes usage to
// @returns {function} async ({ questions, state }) => { answers, model, usage }.
export function amplenoteDecisionRequester(app, { source = "task-rating" } = {}) {
  return async ({ questions, state }) => {
    const decisionQuestions = _decisionModelQuestions(questions);
    const response = await app.callDecisionModel({ model: JEV_DIRECT_MODEL, questions: decisionQuestions, source, state,
      timeoutMs: AMPLENOTE_DECISION_TIMEOUT_MILLISECONDS });
    const failureReason = _bridgeFailureReason(response);
    if (failureReason) throw new Error(`Decision model request failed: ${ failureReason }`);
    if (!response?.answers || typeof response.answers !== "object") throw new Error("Decision model response carried no answers");
    appsWithAvailableLlm.add(app);
    const answers = _jevAnswersFromDecisionModelAnswers(response.answers);
    return { answers, model: response.resolvedModel ?? JEV_DIRECT_MODEL, usage: response.usage ?? null };
  };
}

// ----------------------------------------------------------------------------------------------
// @desc Decide whether the account's plugin LLM license can answer, by asking callLLM for the quota remaining. A
//   license that has answered before is reported available without asking again, and concurrent callers share one
//   check. No license, no quota left, and a check that fails all count as unavailable.
// @param {object} app - Host-compatible Amplenote API, or the embed's bridge proxy.
// @returns {Promise<boolean>} True when callLLM and callDecisionModel can be asked.
export async function isAmplenoteLlmAvailable(app) {
  if (!app) return false;
  if (appsWithAvailableLlm.has(app)) return true;
  if (!llmAvailabilityChecksByApp.has(app)) {
    const availabilityCheck = _checkAmplenoteLlmQuota(app).finally(() => llmAvailabilityChecksByApp.delete(app));
    llmAvailabilityChecksByApp.set(app, availabilityCheck);
  }
  return llmAvailabilityChecksByApp.get(app);
}

// ----------------------------------------------------------------------------------------------
// @desc The model callLLM is asked for. A model whose name callLLM routes to a provider is kept, so a user who chose a
//   provider in Dashboard Settings is still answered by it; anything else, including no model, gets the default.
// @param {string|null|undefined} aiModel - The model a caller would like.
// @returns {string} A model name callLLM accepts.
export function amplenoteLlmModel(aiModel) {
  const requestedModel = typeof aiModel === "string" ? aiModel.trim() : "";
  const isSupported = AMPLENOTE_LLM_MODEL_PREFIXES.some(prefix => requestedModel.startsWith(prefix));
  return isSupported ? requestedModel : AMPLENOTE_LLM_DEFAULT_MODEL;
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Ask callLLM for the quota remaining once, remembering a positive answer for the app interface.
// @param {object} app - Amplenote app interface exposing callLLM.
// @returns {Promise<boolean>} True when the check returned a positive dollar amount.
async function _checkAmplenoteLlmQuota(app) {
  try {
    const remainingQuota = await app.callLLM({ checkQuota: true });
    const failureReason = _bridgeFailureReason(remainingQuota);
    const isAvailable = !failureReason && Number.isFinite(remainingQuota) && remainingQuota > 0;
    logIfEnabled(`${ LOG_LABEL } quota check`, { failureReason, isAvailable, remainingQuota: failureReason ? null : remainingQuota });
    if (isAvailable) appsWithAvailableLlm.add(app);
    return isAvailable;
  } catch (error) {
    logIfEnabled(`${ LOG_LABEL } quota check threw`, error?.message || error);
    return false;
  }
}

// ----------------------------------------------------------------------------------------------
// @desc The reason a bridge call failed, read from the envelope onEmbedCall resolves in place of a rejection.
// @param {*} response - What the call resolved with.
// @returns {string|null} The failure's message, "no response" when the call resolved nothing, or null on success.
function _bridgeFailureReason(response) {
  if (response === null || typeof response === "undefined") return "no response";
  if (response?.embedCallFailed) return response.error || "embed call failed";
  return null;
}

// ----------------------------------------------------------------------------------------------
// @desc Map the endpoint's questions onto the types callDecisionModel accepts. Jev's "predicate" is callDecisionModel's
//   "noul"; score and choice questions pass through unchanged.
// @param {object} questions - Questions keyed by name, each { criteria, instructions, type }.
// @returns {object} The same questions keyed by name, with predicate questions asked as "noul".
function _decisionModelQuestions(questions) {
  const questionEntries = Object.entries(questions || {});
  const mappedEntries = questionEntries.map(([questionName, question]) => {
    return [questionName, question?.type === "predicate" ? { ...question, type: "noul" } : question];
  });
  return Object.fromEntries(mappedEntries);
}

// ----------------------------------------------------------------------------------------------
// @desc Read callDecisionModel's answers in the shape Jev returns them. A "noul" answer becomes a predicate carrying
//   its probability; score and choice answers already match and pass through.
// @param {object} answers - Answers keyed by question name, as callDecisionModel returns them.
// @returns {object} Answers keyed by question name, as DecisionsResponse reads them.
function _jevAnswersFromDecisionModelAnswers(answers) {
  const answerEntries = Object.entries(answers);
  const mappedEntries = answerEntries.map(([questionName, answer]) => {
    if (answer?.type !== "noul") return [questionName, answer];
    return [questionName, { probability: answer.noul, type: "predicate" }];
  });
  return Object.fromEntries(mappedEntries);
}

// ----------------------------------------------------------------------------------------------
// @desc The reasoning budget callLLM is asked for. A budget it does not offer, such as "none" or "minimal", asks for
//   "low", the least it has; no budget leaves callLLM's own default.
// @param {string|null|undefined} reasoningEffort - The caller's budget.
// @returns {string|null} "low", "medium", "high", or null.
function _amplenoteReasoningEffort(reasoningEffort) {
  if (!reasoningEffort) return null;
  return AMPLENOTE_LLM_REASONING_EFFORTS.includes(reasoningEffort) ? reasoningEffort : "low";
}
