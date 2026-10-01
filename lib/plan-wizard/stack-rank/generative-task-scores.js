// Rate prospective tasks with the generative provider's fast model when no Jev key is set. The model is given the
// same state and score questions a Jev batch carries, and asked to reply with one 1–10 rating per question. Its
// reply is converted to Jev's answer shape, so batching, the rating cache, and the match score thresholds treat both
// raters alike. A generative call costs far more per task than Jev, so callers draw a smaller pool for it.
import { wizardLlmOptions } from "plan-wizard/wizard-prompt-diagnostics";
import { raceWizardPrompt } from "plan-wizard/wizard-prompt-runner";
import { pluginSettings } from "plugin-data";
import { fastModelOptions, findAmpleAgentProNote } from "providers/ai-provider-settings";

const LOWEST_RATING = 1;
const HIGHEST_RATING = 10;

// ----------------------------------------------------------------------------------------------
// @desc Decide whether the fast model can rate tasks: either a provider key is set, or Ample Agent Pro is installed
//   to answer the prompt without one.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} [settings=pluginSettings()] - Settings map.
// @returns {Promise<boolean>} True when some source can answer a rating prompt.
export async function generativeScoringAvailable(app, settings = pluginSettings()) {
  if (fastModelOptions(settings)) return true;
  const agentProNote = await findAmpleAgentProNote(app);
  return !!agentProNote;
}

// ----------------------------------------------------------------------------------------------
// @desc Render one batch's Jev state and questions as a prompt for the fast model. Every question shares one rubric,
//   so the rubric is stated once, ahead of the questions.
// @param {object} questions - Score questions keyed by name, as jevRequestForBatch builds them.
// @param {object} state - The batch's state, as jevRequestForBatch builds it.
// @returns {string} Prompt asking for { "ratings": { [questionName]: number } }.
export function generativeScorePrompt(questions, state) {
  const questionEntries = Object.entries(questions);
  const rubric = questionEntries[0]?.[1]?.criteria || [];
  const rubricLines = rubric.map(criterion => `- ${ criterion }`);
  const questionLines = questionEntries.map(([questionName, question]) => `- ${ questionName }: ${ question.instructions }`);
  const exampleRatings = Object.fromEntries(questionEntries.map(([questionName]) => [questionName, 1]));
  return [
    "Your only job is to rate how applicable each prospective task is to one project, on a scale from 1 to 10.",
    "Rate each task on its own, judging it by its text, its note, its tags, and its parent and child tasks. The tasks "
      + "the project already holds show what the project means in practice. The user terms dictionary defines names "
      + "specific to this person's notebook.",
    "A whole number fits most tasks; use one decimal place only to separate two tasks you would otherwise rate alike. "
      + "Most prospective tasks are unrelated to any one project, so expect most ratings to be low.",
    "", "Rubric (an unlabelled number falls between the labelled ones around it):", ...rubricLines,
    "", "State:", JSON.stringify(state, null, 2),
    "", "Questions:", ...questionLines,
    "", `Reply with JSON only, rating every question: ${ JSON.stringify({ ratings: exampleRatings }) }`,
  ].join("\n");
}

// ----------------------------------------------------------------------------------------------
// @desc Build a stand-in for requestJevAnswers that asks the fast model instead. A rating outside 1–10, or one the
//   reply leaves out, yields no answer for that question, so its task stays unrated as it would after a bad Jev
//   answer. A reply with no ratings at all throws, so the batch is recorded as failed.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} [options] - An object with the following properties:
//   - {function} [promptRunner=raceWizardPrompt] - Injected for tests
// @returns {function} async ({ questions, state }) => { answers, model, usage }, answers in Jev's score shape with
//   confidence 0, since the model reports none.
export function generativeScoreRequester(app, { promptRunner = raceWizardPrompt } = {}) {
  return async ({ questions, state }) => {
    const llmOptions = wizardLlmOptions(pluginSettings());
    const response = await promptRunner(app, generativeScorePrompt(questions, state), llmOptions);
    const ratings = response?.ratings;
    if (!ratings || typeof ratings !== "object") throw new Error("The fast model returned no ratings");
    const answerEntries = Object.keys(questions).map(questionName => [questionName, _scoreAnswer(ratings[questionName])]);
    const answeredEntries = answerEntries.filter(([, answer]) => answer);
    return { answers: Object.fromEntries(answeredEntries), model: llmOptions.aiModel || null, usage: null };
  };
}

// ----------------------------------------------------------------------------------------------
// @desc Convert one 1–10 rating to a Jev score answer, whose score is indexed from zero.
// @param {*} rating - The model's rating for one question.
// @returns {object|null} { confidence, score, type }, or null when the rating is not a number from 1 to 10.
function _scoreAnswer(rating) {
  const numericRating = Number(rating);
  if (!Number.isFinite(numericRating) || numericRating < LOWEST_RATING || numericRating > HIGHEST_RATING) return null;
  return { confidence: 0, score: numericRating - 1, type: "score" };
}
