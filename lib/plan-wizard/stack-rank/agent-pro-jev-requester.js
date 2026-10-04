// Rate tasks through an installed Ample Agent Pro note when no Jev key is set: Agent Pro is asked, through
// callPlugin, to submit each batch to Jev's model at Jev's URL, and its reply is read back in the answer shape
// requestJevAnswers returns, so the ranker treats both routes alike.
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
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Read one Agent Pro reply as Jev score answers. A reply that already carries `answers` is used as Jev
//   returned it. A reply that carries `scores` names each question with a 1–10 rating, which is shifted down by
//   one so the rest of the pass can treat it as Jev's zero-indexed score. A rating outside 1–10 is left out.
// @param {object|null} result - Parsed callPlugin result.
// @returns {object|null} Answers keyed by question name, or null when the reply names none.
function _answersFromAgentProResult(result) {
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
