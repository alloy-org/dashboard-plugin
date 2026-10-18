// Rate a project's generated ideas on two questions of their own, apart from how similar the project's existing tasks
// are to it: how actionable each idea is (specific, feasible, unblocked, obvious where to start, and startable in one
// work block) and how directly it advances the project. The same request asks once how clear the project itself is
// about the work it calls for; a project rated below PROJECT_CLARITY_MINIMUM is too abstract to suggest anything for,
// so projectTooAbstract keeps its ideas out of the recommendations and stops more being generated until its summary
// changes. A decision model (Jev or OpenAI's Decisions API) answers the same score questions
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
// The lowest project clarity, on 1–10, at which a project's ideas may be recommended or more generated for it.
export const PROJECT_CLARITY_MINIMUM = 5;
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
  "3: an action, but abstract enough that it is not obvious where to start, or blocked on something not yet done", "4",
  "5: a clear action, but its first step needs working out, or it needs more than one work block", "6",
  "7: a specific, feasible action with an obvious first step, startable within one work block", "8", "9",
  "10: a specific, unblocked action with an obvious first step, startable right now and finished within one work block"];
const PROJECT_CLARITY_CRITERIA = ["1: a theme, value, or aspiration; no one could say what work it calls for", "2",
  "3: an area of interest whose work would have to be invented before any of it could start", "4",
  "5: a direction whose next steps a person could name after some thought", "6",
  "7: a defined outcome with an evident first step", "8", "9", "10: a concrete outcome whose next steps are obvious"];
const PROJECT_CLARITY_QUESTION = "project_clarity";
// The rating fields an idea's average reads, each counted only when it holds a score.
const AVERAGED_RATING_FIELDS = ["actionability", "relevance", "similarity"];
const RELEVANCE_CRITERIA = ["1: unrelated to the project, or a restatement of work already open or completed", "2",
  "3: loosely related; doing it would not move the project forward", "4",
  "5: related, but a side errand rather than progress", "6", "7: directly advances the project", "8", "9",
  "10: the most direct next step toward the project's intents"];

// ----------------------------------------------------------------------------------------------
// @desc The prompt the generative fast model answers in place of Jev: the three rubrics, the project's state, and one line
//   per question, asking for the { ratings } reply generativeScoreRequester reads.
// @param {object} questions - Score questions keyed by name, as ideaRatingQuestions builds them.
// @param {object} state - The project state, as ideaRatingQuestions builds it.
// @returns {string} Prompt text.
export function ideaRatingPrompt(questions, state) {
  const questionLines = Object.entries(questions).map(([questionName, question]) => `- ${ questionName }: ${ question.instructions }`);
  const exampleRatings = Object.fromEntries(Object.keys(questions).map(questionName => [questionName, 1]));
  return ["Rate each suggested next action for one project, on a scale from 1 to 10. Questions ending in _actionability "
      + "judge the action alone; questions ending in _relevance judge how it serves the project; "
      + `${ PROJECT_CLARITY_QUESTION } judges the project itself.`,
    "Use a whole number unless one decimal place separates two ideas you would otherwise rate alike.",
    "", "Actionability rubric (an unlabelled number falls between the labelled ones around it):",
    ...ACTIONABILITY_CRITERIA.map(criterion => `- ${ criterion }`),
    "", "Relevance rubric:", ...RELEVANCE_CRITERIA.map(criterion => `- ${ criterion }`),
    "", "Project clarity rubric:", ...PROJECT_CLARITY_CRITERIA.map(criterion => `- ${ criterion }`),
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
// @desc Build the rating request for a project's ideas: two score questions per idea, one on the clarity of the
//   project itself, and a state describing the project, the intents it serves, its open and recently completed tasks, and the ideas by question name.
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
      + "whether it is specific, feasible, unblocked, and obvious where to start, its first step apparent without "
      + "further planning, and whether it could be started within one work block, whatever project it belongs to. An "
      + "abstract action that would first need breaking down is not actionable.", ACTIONABILITY_CRITERIA);
    const relevanceInstructions = `How directly would ${ name } ("${ idea.taskText }") advance the project `
      + `"${ project.summary }" toward its intents? A restatement of an open or completed task is not progress.`;
    questions[`${ name }_relevance`] = scoreQuestion(relevanceInstructions, RELEVANCE_CRITERIA);
  });
  questions[PROJECT_CLARITY_QUESTION] = scoreQuestion(`How clear is it what concrete work the project "${ project.summary }" `
    + "calls for? Judge the project itself, from its summary, intents, next action, and tasks, not the ideas.",
    PROJECT_CLARITY_CRITERIA);
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
// @desc Whether the project's most recent clarity rating, made while it held its current summary, fell below
//   PROJECT_CLARITY_MINIMUM. Such a project is too abstract to suggest anything for: none of its ideas are recommended
//   and no more are generated, until a reworded summary lets it be judged afresh.
// @param {QuarterProject|null|undefined} project - The project as the store holds it.
// @returns {boolean} True when the project is too abstract; false when it was never judged under this summary.
export function projectTooAbstract(project) {
  const summaryKey = ideaComparisonKey(project?.summary);
  const ratings = (project?.suggestedTasks || []).map(idea => idea.rating);
  const clarityRatings = ratings.filter(rating => Number.isFinite(rating?.projectClarity) && rating.projectSummaryKey === summaryKey);
  if (!clarityRatings.length) return false;
  const latestRating = clarityRatings.reduce((latest, rating) => ((rating.ratedAt || "") > (latest.ratedAt || "") ? rating : latest));
  return latestRating.projectClarity < PROJECT_CLARITY_MINIMUM;
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
// @returns {Promise<object>} { failureReason, ratingsById }: ratingsById maps idea IDs to { actionability,
//   projectClarity, projectSummaryKey, relevance }, any score null when the rater gave no usable answer, and
//   projectClarity the same for every idea; null with a failureReason when the request failed.
export async function rateProjectIdeas({ decisionsEndpoint, ideas, intentTexts = [], project }) {
  const { questions, state } = ideaRatingQuestions(project, ideas, { intentTexts });
  let response;
  try {
    response = await decisionsEndpoint.rankedResponses({ questions, state });
  } catch (error) {
    return { failureReason: error?.message || "The idea rating request failed", ratingsById: null };
  }
  const projectClarity = response.ratingFor(PROJECT_CLARITY_QUESTION);
  const projectSummaryKey = ideaComparisonKey(project.summary);
  const ratingsById = new Map(ideas.map((idea, index) => [idea.ideaId, {
    actionability: response.ratingFor(`idea_${ index + 1 }_actionability`), projectClarity, projectSummaryKey,
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
    const { actionability, projectClarity = null, projectSummaryKey = null, relevance } = rating;
    return { ...idea, rating: { actionability, projectClarity, projectSummaryKey, ratedAt, ratedTextKey, raterEm, relevance } };
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
