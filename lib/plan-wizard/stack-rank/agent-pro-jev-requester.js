// Rate tasks through an installed Ample Agent Pro note when no Jev key is set: Agent Pro is asked, through
// callPlugin, to submit each batch to Jev's model at Jev's URL, or, once Jev has failed, to OpenAI's Decisions model
// at its URL. Its reply is read back as name-keyed answers, the shape requestJevAnswers returns, so a DecisionsEndpoint
// route treats every way of asking alike. Agent Pro sometimes answers with a bare map of question name to rating or
// choice instead of the API's answer objects; each bare value is read by the type of the question it answers.
import { namedAnswersFromOpenAiAnswers, openAiDecisionsBody, OPENAI_DECISIONS_ENDPOINT, OPENAI_DECISIONS_MODEL } from "providers/decisions-endpoint";
import { agentProPrompt } from "providers/fetch-ai-provider";
import { JEV_DIRECT_ENDPOINT, JEV_DIRECT_MODEL } from "providers/jev-client";

// ----------------------------------------------------------------------------------------------
// @desc Ask Ample Agent Pro to submit one Jev batch. The plugin receives the System One body, then Jev's model and
//   URL, and makes the request itself. A missing or answerless reply throws, so the batch is recorded as failed.
// @param {object} app - Host-compatible Amplenote API.
// @returns {function} async ({ questions, state }) => { answers, model, usage }, as requestJevAnswers returns.
export function agentProJevRequester(app) {
  return async ({ questions, state }) => {
    const prompt = JSON.stringify({ model: JEV_DIRECT_MODEL, questions, state });
    const result = await agentProPrompt(app, prompt, { aiModel: JEV_DIRECT_MODEL, endpoint: JEV_DIRECT_ENDPOINT,
      jsonResponse: true });
    const answers = _answersFromAgentProResult(result, questions);
    if (!answers) throw new Error("Jev response carried no answers");
    return { answers, model: result.model ?? JEV_DIRECT_MODEL, usage: result.usage ?? null };
  };
}

// ----------------------------------------------------------------------------------------------
// @desc Ask Ample Agent Pro to submit one batch to OpenAI's Decisions API. The plugin receives the Decisions body, then
//   the Decisions model and URL, and makes the request with its own OpenAI key. A missing or answerless reply throws.
// @param {object} app - Host-compatible Amplenote API.
// @returns {function} async ({ questions, state }) => { answers, model, usage }, answers keyed by question name.
export function agentProOpenAiRequester(app) {
  return async ({ questions, state }) => {
    const prompt = JSON.stringify(openAiDecisionsBody(questions, state));
    const result = await agentProPrompt(app, prompt, { aiModel: OPENAI_DECISIONS_MODEL, endpoint: OPENAI_DECISIONS_ENDPOINT,
      jsonResponse: true });
    const answers = _answersFromAgentProResult(result, questions);
    if (!answers) throw new Error("OpenAI Decisions response carried no answers");
    return { answers, model: result.model ?? OPENAI_DECISIONS_MODEL, usage: result.usage ?? null };
  };
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Read one Agent Pro reply as name-keyed answers. An `answers` array, as the Decisions API returns it, is keyed
//   by each entry's name. Otherwise the reply's `answers` object, its `scores` object, or the reply itself is read as a
//   map from question name to answer: an answer object Jev's way is kept, and a bare value is read by its question's
//   type (see _answerFromBareValue). A question the map does not answer is left out.
// @param {object|null} result - Parsed callPlugin result.
// @param {object} questions - The batch's questions keyed by name, each { criteria, type }.
// @returns {object|null} Answers keyed by question name, or null when the reply answers none of the questions.
function _answersFromAgentProResult(result, questions) {
  if (Array.isArray(result?.answers)) return namedAnswersFromOpenAiAnswers(result.answers);
  if (!result || typeof result !== "object") return null;
  const answerMap = [result.answers, result.scores, result].find(candidate => candidate && typeof candidate === "object");
  const answerEntries = Object.entries(questions || {}).map(([questionName, question]) => {
    const value = answerMap[questionName];
    if (value && typeof value === "object") return typeof value.type === "string" ? [questionName, value] : null;
    const answer = _answerFromBareValue(value, question);
    return answer ? [questionName, answer] : null;
  });
  const answers = Object.fromEntries(answerEntries.filter(Boolean));
  return Object.keys(answers).length ? answers : null;
}

// ----------------------------------------------------------------------------------------------
// @desc Read one bare answer by its question's type. A score is a 1-based rating within the rubric, shifted down by one
//   to the zero-based score Jev returns; a choice is one of the question's choice keys; a predicate is true, false, or
//   a probability from 0 to 1. Anything else is left unanswered rather than guessed.
// @param {*} value - The bare answer, number or text.
// @param {object} question - { criteria, type }.
// @returns {object|null} An answer as Jev returns it, with no confidence, or null.
function _answerFromBareValue(value, question) {
  if (question?.type === "choice") {
    const choiceKeys = Object.keys(question.criteria || {});
    const choice = value == null ? null : String(value).trim();
    return choiceKeys.includes(choice) ? { choice, confidence: 0, type: "choice" } : null;
  }
  if (question?.type === "predicate") {
    const probability = Number(value);
    return value !== "" && value != null && probability >= 0 && probability <= 1 ? { probability, type: "predicate" } : null;
  }
  const levelCount = Array.isArray(question?.criteria) ? question.criteria.length : 10;
  const rating = value === "" || value == null ? NaN : Number(value);
  if (!Number.isFinite(rating) || rating < 1 || rating > levelCount) return null;
  return { confidence: 0, score: rating - 1, type: "score" };
}
