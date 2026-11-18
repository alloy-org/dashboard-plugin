// Development stand-ins for the host's app.callLLM and app.callDecisionModel, which the browser dev app cannot reach.
// They answer with the provider tokens in .env, in the response shapes the host documents, so the dashboard's plugin
// LLM license paths run locally the way they run inside Amplenote. With no usable token, each throws the way the host
// does for an account without a license, which is how the AI upsells can be seen in development: empty the tokens.
//
// callLLM answers through the first provider with a dev token (see devLlmOverride), keeping the requested model when
// it belongs to that provider. callDecisionModel answers through Jev with JEV_ACCESS_TOKEN, or, without one, through
// OpenAI's Decisions API with OPEN_AI_ACCESS_TOKEN.
import { PROVIDER_DEFAULT_MODEL } from "constants/llm-providers"
import { devJevAccessToken, devLlmOverride, devOpenAiAccessToken } from "constants/settings"
import { providerFromModel } from "providers/ai-provider-settings"
import { openAiKeyRoute } from "providers/decisions-endpoint"
import { llmPrompt } from "providers/fetch-ai-provider"
import { JEV_DIRECT_MODEL, requestJevAnswers } from "providers/jev-client"
import { logIfEnabled } from "util/log"

// What a dev quota check reports remaining. Any positive amount reads as a working license.
const DEV_QUOTA_REMAINING_DOLLARS = 10;
const DEV_DEFAULT_TIMEOUT_MILLISECONDS = 30000;
const LOG_LABEL = "[dev-amplenote-llm]";
const NO_LICENSE_MESSAGE = "No plugin LLM license is available (dev: add a provider token to .env)";

// ----------------------------------------------------------------------------------------------
// @desc Answer an app.callLLM request with the dev provider token. Only the user messages and instructions are sent,
//   as one prompt, since no dashboard caller passes tools or earlier output items.
// @param {object} app - The dev app, which the provider request uses to report a failure.
// @param {object} options - app.callLLM options: { checkQuota, input, instructions, model, reasoningEffort, timeoutMs }.
// @returns {Promise<number|object>} The quota remaining for a quota check; otherwise an LLM response object
//   { callCost, functionCalls, output, reasoningSummaries, textOutput, usage, usageSummary, webSearchCount }.
export async function devCallLlm(app, { checkQuota, input = [], instructions, model, reasoningEffort, timeoutMs } = {}) {
  const override = devLlmOverride(PROVIDER_DEFAULT_MODEL);
  if (!override) throw new Error(NO_LICENSE_MESSAGE);
  if (checkQuota) return DEV_QUOTA_REMAINING_DOLLARS;
  const chosenModel = _modelBelongsToProvider(model, override.provider) ? model : override.model;
  const userMessages = input.filter(item => item?.role === "user" && typeof item.content === "string");
  const promptParts = [instructions, ...userMessages.map(item => item.content)];
  const prompt = promptParts.filter(Boolean).join("\n\n");
  const timeoutSeconds = (timeoutMs || DEV_DEFAULT_TIMEOUT_MILLISECONDS) / 1000;
  logIfEnabled(`${ LOG_LABEL } callLLM`, { chosenModel, promptLength: prompt.length, requestedModel: model ?? null });
  const reply = await llmPrompt(app, null, prompt, chosenModel, override.apiKey, false, timeoutSeconds, reasoningEffort);
  const textOutput = typeof reply === "string" ? reply : JSON.stringify(reply ?? "");
  const output = [{ content: [{ text: textOutput, type: "output_text" }], role: "assistant", type: "message" }];
  return { callCost: 0, functionCalls: [], output, reasoningSummaries: "", textOutput, usage: null, usageSummary: null,
    webSearchCount: 0 };
}

// ----------------------------------------------------------------------------------------------
// @desc Answer an app.callDecisionModel request with the dev Jev token, or the dev OpenAI token without one. Answers
//   are returned in callDecisionModel's shape, where Jev's "predicate" answer is a "noul".
// @param {object} options - app.callDecisionModel options: { checkQuota, model, questions, state, timeoutMs }.
// @returns {Promise<number|object>} The quota remaining for a quota check; otherwise a decision model response
//   { answer, answers, callCost, resolvedModel, usage, value }.
export async function devCallDecisionModel({ checkQuota, model, questions, state, timeoutMs } = {}) {
  const jevToken = devJevAccessToken();
  const openAiToken = devOpenAiAccessToken();
  if (!jevToken && !openAiToken) throw new Error(NO_LICENSE_MESSAGE);
  if (checkQuota) return DEV_QUOTA_REMAINING_DOLLARS;
  const jevQuestions = _jevQuestionsFromDecisionModelQuestions(questions);
  logIfEnabled(`${ LOG_LABEL } callDecisionModel`, { questionCount: Object.keys(jevQuestions).length,
    route: jevToken ? "jev" : "openai" });
  const reply = jevToken
    ? await requestJevAnswers({ accessToken: jevToken, model: model || JEV_DIRECT_MODEL, questions: jevQuestions, state,
      timeoutMilliseconds: timeoutMs || DEV_DEFAULT_TIMEOUT_MILLISECONDS })
    : await openAiKeyRoute(openAiToken).request({ questions: jevQuestions, state });
  const answers = _decisionModelAnswersFromJevAnswers(reply.answers);
  const answer = Object.values(answers)[0] ?? null;
  const value = answer ? answer[answer.type] ?? null : null;
  return { answer, answers, callCost: 0, resolvedModel: reply.model ?? model ?? JEV_DIRECT_MODEL, usage: reply.usage ?? null,
    value };
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Whether a model is one of the provider's registered models, so the dev token can authenticate it.
// @param {string|null|undefined} model - Requested model.
// @param {string} providerEm - The provider bucket the dev token belongs to.
// @returns {boolean} True when the model is registered under that provider.
function _modelBelongsToProvider(model, providerEm) {
  if (!model) return false;
  try {
    return providerFromModel(model) === providerEm;
  } catch (_error) {
    return false;
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Ask callDecisionModel's "noul" questions as the "predicate" questions Jev takes.
// @param {object} questions - Questions keyed by name.
// @returns {object} The same questions, with "noul" asked as "predicate".
function _jevQuestionsFromDecisionModelQuestions(questions) {
  const questionEntries = Object.entries(questions || {});
  const mappedEntries = questionEntries.map(([questionName, question]) => {
    return [questionName, question?.type === "noul" ? { ...question, type: "predicate" } : question];
  });
  return Object.fromEntries(mappedEntries);
}

// ----------------------------------------------------------------------------------------------
// @desc Return Jev's answers in callDecisionModel's shape: a "predicate" answer becomes a "noul" holding its probability.
// @param {object} answers - Answers keyed by question name, as Jev returns them.
// @returns {object} Answers keyed by question name, as callDecisionModel returns them.
function _decisionModelAnswersFromJevAnswers(answers) {
  const answerEntries = Object.entries(answers || {});
  const mappedEntries = answerEntries.map(([questionName, answer]) => {
    if (answer?.type !== "predicate") return [questionName, answer];
    return [questionName, { noul: answer.probability, type: "noul" }];
  });
  return Object.fromEntries(mappedEntries);
}
