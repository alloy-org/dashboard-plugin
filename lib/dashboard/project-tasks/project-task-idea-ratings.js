// Rate a project's generated ideas on two questions of their own, apart from how similar the project's existing tasks
// are to it: how actionable each idea is (specific, feasible, unblocked, and startable in one work block) and how
// directly it advances the project. A decision model (Jev or OpenAI's Decisions API) answers the same score questions
// it answers for task similarity; without one, the generative provider's fast model answers them from
// ideaRatingPrompt. Either way the answers arrive as a DecisionsResponse, whose ratingFor reads each on the 1–10
// scale stored on each idea. A rating remembers the text it judged, so an idea whose text changed is rated again. Only an
// open idea rated at least IDEA_ACTIONABILITY_MINIMUM for actionability and IDEA_RELEVANCE_MINIMUM for relevance may
// compete with existing tasks in the daily recommendations; a similarity 9 says nothing about either. Once a project
// holds IDEA_SATURATION_COUNT open ideas whose average rating reaches IDEA_KEEPING_AVERAGE_MINIMUM, it has enough to
// choose from: no more ideas are generated for it, and the ideas rated below that average or already done are dropped.
import { IDEA_STATUSES, ideaComparisonKey, openIdeas } from "dashboard/project-tasks/project-idea-records";
import { scoreQuestion } from "providers/decisions-endpoint";
import { dateFromDateInput } from "util/date-utility";
import { textDigest } from "util/text-digest";

// The lowest actionability, on 1–10, at which an idea may be recommended.
export const IDEA_ACTIONABILITY_MINIMUM = 7;
// The lowest project relevance, on 1–10, at which an idea may be recommended.
export const IDEA_RELEVANCE_MINIMUM = 6;
// How many well-rated open ideas a project holds before it stops asking for more.
export const IDEA_SATURATION_COUNT = 12;
// The lowest average rating, on 1–10, at which an idea counts as well rated and is kept once the project is saturated.
export const IDEA_KEEPING_AVERAGE_MINIMUM = 6;
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
// The rating fields an idea's average reads, each counted only when it holds a score.
const AVERAGED_RATING_FIELDS = ["actionability", "relevance", "similarity"];
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
// @desc The mean of whichever of an idea's actionability, relevance, and similarity ratings were scored, provided its
//   rating judged the idea's current text.
// @param {object} idea - Idea record.
// @returns {number|null} The average on 1–10, or null when the idea holds no current score.
export function ideaAverageRating(idea) {
  if (!_ratingMatchesText(idea)) return null;
  const scores = AVERAGED_RATING_FIELDS.map(field => idea.rating[field]).filter(score => Number.isFinite(score));
  if (!scores.length) return null;
  const scoreTotal = scores.reduce((total, score) => total + score, 0);
  return scoreTotal / scores.length;
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
// @desc Whether an idea holds both of the ratings ideaRecommendable judges, for its current text.
// @param {object} idea - Idea record.
// @returns {boolean} True when actionability and relevance are both rated for the idea's text.
export function ideaRated(idea) {
  if (!_ratingMatchesText(idea)) return false;
  return Number.isFinite(idea.rating.actionability) && Number.isFinite(idea.rating.relevance);
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
// @desc Whether a project already holds enough well-rated open ideas that generating more would only add to a list
//   the user cannot work through: at least IDEA_SATURATION_COUNT whose average rating reaches
//   IDEA_KEEPING_AVERAGE_MINIMUM.
// @param {Array<object>} ideas - Idea records.
// @returns {boolean} True when the project should stop generating ideas.
export function ideasSaturated(ideas) {
  const wellRatedIdeas = openIdeas(ideas).filter(idea => (ideaAverageRating(idea) ?? 0) >= IDEA_KEEPING_AVERAGE_MINIMUM);
  return wellRatedIdeas.length >= IDEA_SATURATION_COUNT;
}

// ----------------------------------------------------------------------------------------------
// @desc The ideas a saturated project keeps: every idea except an open one whose text matches a completed task, an
//   accepted one whose task was completed, and an open one rated below IDEA_KEEPING_AVERAGE_MINIMUM. An open idea not
//   yet rated is kept until its rating arrives.
// @param {Array<object>} ideas - Idea records.
// @param {object} options - { completedTasks }: completions as { sourceTaskUuid?, taskText?, taskUuid }.
// @returns {Array<object>} The kept records, in held order.
export function keptIdeaRecords(ideas, { completedTasks = [] }) {
  const completedKeys = new Set(completedTasks.map(task => ideaComparisonKey(task.taskText)).filter(Boolean));
  const completedUuids = new Set(completedTasks.flatMap(task => [task.taskUuid, task.sourceTaskUuid]).filter(Boolean));
  const keptIdeas = (ideas || []).filter(idea => {
    if (idea.status === IDEA_STATUSES.accepted) return !completedUuids.has(idea.acceptedTaskUuid);
    if ((idea.status || IDEA_STATUSES.open) !== IDEA_STATUSES.open) return true;
    if (completedKeys.has(ideaComparisonKey(idea.taskText))) return false;
    const averageRating = ideaAverageRating(idea);
    return averageRating === null || averageRating >= IDEA_KEEPING_AVERAGE_MINIMUM;
  });
  return keptIdeas;
}

// ----------------------------------------------------------------------------------------------
// @desc Ask the rater about a project's ideas and read its answers onto the 1–10 scale.
// @param {object} options - An object with the following properties:
//   - {Array<object>} ideas - Idea records to rate
//   - {Array<string>} [intentTexts=[]] - The intents the project advances
//   - {QuarterProject} project - The project
//   - {DecisionsEndpoint} decisionsEndpoint - Rates the ideas
// @returns {Promise<object>} { failureReason, ratingsById }: ratingsById maps idea IDs to { actionability, relevance },
//   either null when the rater gave no usable answer; null with a failureReason when the request failed.
export async function rateProjectIdeas({ decisionsEndpoint, ideas, intentTexts = [], project }) {
  const { questions, state } = ideaRatingQuestions(project, ideas, { intentTexts });
  let response;
  try {
    response = await decisionsEndpoint.rankedResponses({ questions, state });
  } catch (error) {
    return { failureReason: error?.message || "The idea rating request failed", ratingsById: null };
  }
  const ratingsById = new Map(ideas.map((idea, index) => [idea.ideaId, {
    actionability: response.ratingFor(`idea_${ index + 1 }_actionability`),
    relevance: response.ratingFor(`idea_${ index + 1 }_relevance`) }]));
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
