// Rate a project's generated ideas on two questions of their own, apart from how similar the project's existing tasks
// are to it: how actionable each idea is (specific, feasible, unblocked, and startable in one work block) and how
// directly it advances the project. Jev answers the same score questions it answers for task similarity; without Jev,
// the generative provider's fast model answers them from ideaRatingPrompt. Either way the answers arrive in
// Jev's zero-indexed score shape, and ratingFromScoreAnswer is the one place that turns them back into the 1–10 scale
// stored on each idea. A rating remembers the text it judged, so an idea whose text changed is rated again. Only an
// open idea rated at least IDEA_ACTIONABILITY_MINIMUM for actionability and IDEA_RELEVANCE_MINIMUM for relevance may
// compete with existing tasks in the daily recommendations; a similarity 9 says nothing about either.
import { IDEA_STATUSES, ideaComparisonKey, openIdeas } from "project-idea-records";
import { scoreQuestion } from "providers/jev-client";
import { dateFromDateInput } from "util/date-utility";
import { textDigest } from "util/text-digest";

// The lowest actionability, on 1–10, at which an idea may be recommended.
export const IDEA_ACTIONABILITY_MINIMUM = 7;
// The lowest project relevance, on 1–10, at which an idea may be recommended.
export const IDEA_RELEVANCE_MINIMUM = 6;
// The most ideas one rating request judges; a project rarely holds more open ideas than this.
export const MAXIMUM_IDEAS_PER_RATING = 8;
// How long an idea the rater left unanswered waits before it is asked about again.
const UNANSWERED_RETRY_MILLISECONDS = 72 * 60 * 60 * 1000;
// How much of the project's own work the rating state shows, the most recent first.
const MAXIMUM_STATE_COMPLETIONS = 10;
const MAXIMUM_STATE_OPEN_TASKS = 15;
const ACTIONABILITY_CRITERIA = ["1: a goal, theme, or aspiration rather than an action", "2",
  "3: an action, but vague about what to do, or blocked on something not yet done", "4",
  "5: a clear action that needs more than one work block, or preparation first", "6",
  "7: a specific, feasible action the user could start within one work block", "8", "9",
  "10: a specific, unblocked action the user could start right now and finish within one work block"];
const RELEVANCE_CRITERIA = ["1: unrelated to the project, or a restatement of work already open or completed", "2",
  "3: loosely related; doing it would not move the project forward", "4",
  "5: related, but a side errand rather than progress", "6", "7: directly advances the project", "8", "9",
  "10: the most direct next step toward the project's intents"];

// ----------------------------------------------------------------------------------------------
// @desc The prompt the generative fast model answers in place of Jev: both rubrics, the project's state, and one line
//   per question, asking for the { ratings } reply generativeScoreRequester reads.
// @param {object} questions - Score questions keyed by name, as ideaRatingQuestions builds them.
// @param {object} state - The project state, as ideaRatingQuestions builds it.
// @returns {string} Prompt text.
export function ideaRatingPrompt(questions, state) {
  const questionLines = Object.entries(questions).map(([questionName, question]) => `- ${ questionName }: ${ question.instructions }`);
  const exampleRatings = Object.fromEntries(Object.keys(questions).map(questionName => [questionName, 1]));
  return ["Rate each suggested next action for one project, on a scale from 1 to 10. Questions ending in _actionability "
      + "judge the action alone; questions ending in _relevance judge how it serves the project.",
    "Use a whole number unless one decimal place separates two ideas you would otherwise rate alike.",
    "", "Actionability rubric (an unlabelled number falls between the labelled ones around it):",
    ...ACTIONABILITY_CRITERIA.map(criterion => `- ${ criterion }`),
    "", "Relevance rubric:", ...RELEVANCE_CRITERIA.map(criterion => `- ${ criterion }`),
    "", "State:", JSON.stringify(state, null, 2), "", "Questions:", ...questionLines,
    "", `Reply with JSON only, rating every question: ${ JSON.stringify({ ratings: exampleRatings }) }`].join("\n");
}

// ----------------------------------------------------------------------------------------------
// @desc Build the rating request for a project's ideas: two score questions per idea, and a state describing the
//   project, the intents it serves, its open and recently completed tasks, and the ideas by question name.
// @param {QuarterProject} project - The project the ideas belong to.
// @param {Array<object>} ideas - Idea records to rate.
// @param {object} [options] - { intentTexts = [] }: the intents the project advances, highest ranked first.
// @returns {object} { questions, state }.
export function ideaRatingQuestions(project, ideas, { intentTexts = [] } = {}) {
  const completions = (project.completedTasks || []).filter(completion => completion.taskText);
  const recentCompletions = [...completions].sort((first, second) => (second.completedAt || "").localeCompare(first.completedAt || ""));
  const questions = {};
  const ideaTexts = {};
  ideas.forEach((idea, index) => {
    const name = `idea_${ index + 1 }`;
    ideaTexts[name] = idea.taskText;
    questions[`${ name }_actionability`] = scoreQuestion(`How actionable is ${ name } ("${ idea.taskText }")? Judge `
      + "whether it is specific, feasible, unblocked, and could be started within one work block, whatever project "
      + "it belongs to.", ACTIONABILITY_CRITERIA);
    const relevanceInstructions = `How directly would ${ name } ("${ idea.taskText }") advance the project `
      + `"${ project.summary }" toward its intents? A restatement of an open or completed task is not progress.`;
    questions[`${ name }_relevance`] = scoreQuestion(relevanceInstructions, RELEVANCE_CRITERIA);
  });
  const completedTexts = recentCompletions.slice(0, MAXIMUM_STATE_COMPLETIONS).map(completion => completion.taskText);
  const openTaskTexts = (project.relatedTaskRecords || []).slice(0, MAXIMUM_STATE_OPEN_TASKS).map(record => record.taskText);
  const projectState = { completedTasks: completedTexts, intents: intentTexts, nextAction: project.nextAction || null,
    openTasks: openTaskTexts, summary: project.summary };
  return { questions, state: { ideas: ideaTexts, project: projectState } };
}

// ----------------------------------------------------------------------------------------------
// @desc Name the ideas a rating would judge, so a queued rating can tell whether its output is current.
// @param {Array<object>} ideas - Idea records.
// @param {Date} now - Current time.
// @returns {string|null} Eight hex characters, or null when no idea awaits a rating.
export function ideaRatingsRevision(ideas, now) {
  const awaiting = ideasAwaitingRating(ideas, now);
  if (!awaiting.length) return null;
  const identities = awaiting.map(idea => [idea.ideaId, ideaComparisonKey(idea.taskText)]);
  return textDigest(JSON.stringify(identities));
}

// ----------------------------------------------------------------------------------------------
// @desc Whether an idea may compete in the daily recommendations: it is open, its rating judged its current text, and
//   it reached both minimums.
// @param {object} idea - Idea record.
// @returns {boolean} True when the idea is eligible.
export function ideaRecommendable(idea) {
  if ((idea?.status || IDEA_STATUSES.open) !== IDEA_STATUSES.open || !_ratingMatchesText(idea)) return false;
  const { actionability, relevance } = idea.rating;
  return actionability >= IDEA_ACTIONABILITY_MINIMUM && relevance >= IDEA_RELEVANCE_MINIMUM;
}

// ----------------------------------------------------------------------------------------------
// @desc The open ideas a rating should judge: those never rated, those whose text changed since, and those the rater
//   left unanswered more than three days ago. The earliest held come first, at most MAXIMUM_IDEAS_PER_RATING.
// @param {Array<object>} ideas - Idea records.
// @param {Date} now - Current time.
// @returns {Array<object>} Ideas awaiting a rating.
export function ideasAwaitingRating(ideas, now) {
  const awaiting = openIdeas(ideas).filter(idea => !_ratingCurrent(idea, now));
  return awaiting.slice(0, MAXIMUM_IDEAS_PER_RATING);
}

// ----------------------------------------------------------------------------------------------
// @desc Ask the rater about a project's ideas and read its answers onto the 1–10 scale.
// @param {object} options - An object with the following properties:
//   - {Array<object>} ideas - Idea records to rate
//   - {Array<string>} [intentTexts=[]] - The intents the project advances
//   - {QuarterProject} project - The project
//   - {function} requestAnswers - async ({ questions, state }) => { answers }, in requestJevAnswers' shape
// @returns {Promise<object>} { failureReason, ratingsById }: ratingsById maps idea IDs to { actionability, relevance },
//   either null when the rater gave no usable answer; null with a failureReason when the request failed.
export async function rateProjectIdeas({ ideas, intentTexts = [], project, requestAnswers }) {
  const { questions, state } = ideaRatingQuestions(project, ideas, { intentTexts });
  let response;
  try {
    response = await requestAnswers({ questions, state });
  } catch (error) {
    return { failureReason: error?.message || "The idea rating request failed", ratingsById: null };
  }
  const ratingsById = new Map(ideas.map((idea, index) => [idea.ideaId, {
    actionability: ratingFromScoreAnswer(response?.answers?.[`idea_${ index + 1 }_actionability`]),
    relevance: ratingFromScoreAnswer(response?.answers?.[`idea_${ index + 1 }_relevance`]) }]));
  return { failureReason: null, ratingsById };
}

// ----------------------------------------------------------------------------------------------
// @desc Put ratings on the ideas they were made for, each remembering the text it judged. An idea whose text no longer
//   matches what was rated, or that was not rated, is left as it was.
// @param {Array<object>} ideas - Idea records as the store holds them now.
// @param {Map<string, object>} ratingsById - From rateProjectIdeas.
// @param {object} options - { ratedAt, ratedIdeas, raterEm }: ratedIdeas are the records the rater was shown.
// @returns {Array<object>} The ideas with their ratings.
export function ratedIdeaRecords(ideas, ratingsById, { ratedAt, ratedIdeas, raterEm }) {
  const ratedKeyById = new Map(ratedIdeas.map(idea => [idea.ideaId, ideaComparisonKey(idea.taskText)]));
  return ideas.map(idea => {
    const ratedTextKey = ratedKeyById.get(idea.ideaId);
    const rating = ratingsById.get(idea.ideaId);
    if (!rating || ratedTextKey !== ideaComparisonKey(idea.taskText)) return idea;
    return { ...idea, rating: { actionability: rating.actionability, ratedAt, ratedTextKey, raterEm, relevance: rating.relevance } };
  });
}

// ----------------------------------------------------------------------------------------------
// @desc Read one score answer, from Jev or from the generative stand-in, onto the 1–10 scale ideas store.
// @param {object|undefined} answer - A Jev score answer, whose score is indexed from zero.
// @returns {number|null} The rating to one decimal place, or null when the answer is missing or unreadable.
export function ratingFromScoreAnswer(answer) {
  if (answer?.type !== "score" || !Number.isFinite(answer.score)) return null;
  const rating = Math.min(10, Math.max(1, answer.score + 1));
  return Math.round(rating * 10) / 10;
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Whether an idea's rating still stands: it judged the idea's current text and either answered both questions
//   or was left unanswered recently enough not to ask again yet.
// @param {object} idea - Idea record.
// @param {Date} now - Current time.
// @returns {boolean} True when the idea needs no rating now.
function _ratingCurrent(idea, now) {
  if (!_ratingMatchesText(idea)) return false;
  const { actionability, ratedAt, relevance } = idea.rating;
  if (Number.isFinite(actionability) && Number.isFinite(relevance)) return true;
  const ratedDate = ratedAt ? dateFromDateInput(ratedAt, { throwOnInvalid: false }) : null;
  return Boolean(ratedDate) && now.getTime() - ratedDate.getTime() < UNANSWERED_RETRY_MILLISECONDS;
}

// ----------------------------------------------------------------------------------------------
// @desc Whether an idea carries a rating made for the text it has now.
// @param {object} idea - Idea record.
// @returns {boolean} True when the rating judged the current text.
function _ratingMatchesText(idea) {
  const rating = idea?.rating;
  if (!rating || typeof rating !== "object") return false;
  return rating.ratedTextKey === ideaComparisonKey(idea.taskText);
}
