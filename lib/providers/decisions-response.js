// The answers one DecisionsEndpoint request returned, in one shape whichever model gave them: Jev, OpenAI's Decisions
// API, or the generative fast model standing in for either. Answers are keyed by question name. A score answer keeps
// the zero-based rubric index both decision models return, and ratingFor reads it on the 1-based scale the rubric
// describes, so a caller never adds the offset itself.

// ----------------------------------------------------------------------------------------------
// @desc One decision request's answers, model, provider, and token usage.
export default class DecisionsResponse {
  answers; // {object} Answers keyed by question name: { type: "score", score, confidence, probabilities? },
  //   { type: "choice", choice, confidence }, { type: "predicate", probability }, or { type: "refusal" }.
  model; // {string|null} The model that answered, as the provider reported it.
  providerEm; // {string} "jev", "openai", or "generative".
  usage; // {object} { inputTokens, outputTokens }, zero when the provider reported none.

  // ----------------------------------------------------------------------------------------------
  // @desc Read one provider's name-keyed answers. An answer of an unknown type is kept as a refusal, so a caller asking
  //   for its rating gets null rather than a guess.
  // @param {object} options - An object with the following properties:
  //   - {object} answers - Answers keyed by question name, in the shape Jev returns
  //   - {string|null} [model] - The model that answered
  //   - {string} providerEm - "jev", "openai", or "generative"
  //   - {object|null} [usage] - Token usage as the provider reported it: input_tokens and output_tokens, or the
  //     prompt_tokens and completion_tokens some bodies carry instead
  constructor({ answers, model = null, providerEm, usage = null }) {
    const answerEntries = Object.entries(answers || {}).map(([name, answer]) => [name, _normalizedAnswer(answer)]);
    Object.assign(this, { answers: Object.fromEntries(answerEntries), model, providerEm, usage: _normalizedUsage(usage) });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc The answer to one question.
  // @param {string} questionName - The name the question was asked under.
  // @returns {object|null} The normalized answer, or null when the provider gave none.
  answerFor(questionName) {
    return this.answers[questionName] || null;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc How confident the provider was in one answer. The generative fast model reports no confidence, so its
  //   answers read as 0.
  // @param {string} questionName - The name the question was asked under.
  // @returns {number} Confidence from 0 to 1.
  confidenceFor(questionName) {
    const confidence = this.answerFor(questionName)?.confidence;
    return Number.isFinite(confidence) ? confidence : 0;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc One score answer on the 1-based scale its rubric describes, to one decimal place: a ten-level rubric reads
  //   1–10. A score past either end of the rubric is held to it.
  // @param {string} questionName - The name the question was asked under.
  // @param {object} [options] - { levelCount = 10 }: how many levels the question's rubric listed.
  // @returns {number|null} The rating, or null when the answer is missing, refused, or not a score.
  ratingFor(questionName, { levelCount = 10 } = {}) {
    const answer = this.answerFor(questionName);
    if (answer?.type !== "score" || !Number.isFinite(answer.score)) return null;
    const rating = Math.min(levelCount, Math.max(1, answer.score + 1));
    return Math.round(rating * 10) / 10;
  }
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc One answer in the shape every provider's is read in.
// @param {object} answer - One provider answer.
// @returns {object} The answer DecisionsResponse holds.
function _normalizedAnswer(answer) {
  const confidence = Number.isFinite(answer?.confidence) ? answer.confidence : null;
  if (answer?.type === "choice") return { choice: answer.choice ?? null, confidence, type: "choice" };
  if (answer?.type === "predicate") {
    return { probability: Number.isFinite(answer.probability) ? answer.probability : null, type: "predicate" };
  }
  if (answer?.type === "score" && Number.isFinite(answer.score)) {
    const scoreAnswer = { confidence, score: answer.score, type: "score" };
    if (Array.isArray(answer.probabilities)) scoreAnswer.probabilities = answer.probabilities;
    return scoreAnswer;
  }
  return { type: "refusal" };
}

// ----------------------------------------------------------------------------------------------
// @desc Token usage under one pair of names. OpenAI's Decisions API charges input tokens only, so its output count
//   is usually absent.
// @param {object|null|undefined} usage - Usage as the provider reported it.
// @returns {object} { inputTokens, outputTokens }.
function _normalizedUsage(usage) {
  const inputTokens = [usage?.input_tokens, usage?.prompt_tokens].find(Number.isFinite) || 0;
  const outputTokens = [usage?.output_tokens, usage?.completion_tokens].find(Number.isFinite) || 0;
  return { inputTokens, outputTokens };
}
