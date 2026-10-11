// Rate tasks through an installed Ample Agent Pro note when no Jev key is set: Agent Pro is asked, through
// callPlugin, to submit each batch to Jev's model at Jev's URL, or, once Jev has failed, to OpenAI's Decisions model
// at its URL. Its reply is read back as name-keyed answers, the shape requestJevAnswers returns, so a DecisionsEndpoint
// route treats every way of asking alike.
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
    const answers = _answersFromAgentProResult(result);
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
    const answers = _answersFromAgentProResult(result);
    if (!answers) throw new Error("OpenAI Decisions response carried no answers");
    return { answers, model: result.model ?? OPENAI_DECISIONS_MODEL, usage: result.usage ?? null };
  };
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Read one Agent Pro reply as name-keyed answers. A reply that carries an `answers` object is used as Jev
//   returned it, and an `answers` array, as the Decisions API returns it, is keyed by each entry's name. A reply that carries `scores` names each question with a 1–10 rating, which is shifted down by
//   one so the rest of the pass can treat it as Jev's zero-indexed score. A rating outside 1–10 is left out.
// @param {object|null} result - Parsed callPlugin result.
// @returns {object|null} Answers keyed by question name, or null when the reply names none.
function _answersFromAgentProResult(result) {
  if (Array.isArray(result?.answers)) return namedAnswersFromOpenAiAnswers(result.answers);
  if (result?.answers && typeof result.answers === "object") return result.answers;
  if (!result?.scores || typeof result.scores !== "object") return null;
  const answerEntries = Object.entries(result.scores).map(([questionName, rating]) => {
    const numericRating = Number(rating);
    if (!Number.isFinite(numericRating) || numericRating < 1 || numericRating > 10) return null;
    return [questionName, { confidence: 0, score: numericRating - 1, type: "score" }];
  });
  const answers = Object.fromEntries(answerEntries.filter(Boolean));
  return Object.keys(answers).length ? answers : null;
}
