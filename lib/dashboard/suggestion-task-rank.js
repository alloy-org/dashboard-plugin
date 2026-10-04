// Rank today's project-nested candidates: existing tasks and generated ideas rated actionable enough to compete with
// them. Jev scores each candidate against the project rationales when a Jev key or Ample Agent Pro is available.
// Otherwise the generative model returns a stack-ranked list of candidate IDs from that same state. Candidates are
// identified as `task:<uuid>` or `idea:<ideaId>` throughout, so an idea is never mistaken for an existing task; an idea
// gives up IDEA_RATING_HANDICAP of its rating, so an existing task wins when the two are otherwise comparable. Callers
// that already have an ordered list skip this module.
import { jevAnswerRequester, projectTaskScorer } from "plan-wizard/stack-rank/stack-rank-project-tasks";
import { wizardLlmOptions } from "plan-wizard/wizard-prompt-diagnostics";
import { raceWizardPrompt } from "plan-wizard/wizard-prompt-runner";
import { pluginSettings } from "plugin-data";
import { fastModelOptions, findAmpleAgentProNote } from "providers/ai-provider-settings";
import { scoreQuestion } from "providers/jev-client";
import { logIfEnabled } from "util/log";

// How much of its rating an idea gives up against existing tasks, so a task already on the user's list is preferred
// when the two are otherwise comparable.
export const IDEA_RATING_HANDICAP = 0.5;
const RANK_LOG_LABEL = "[suggestion-task-rank]";
const SUGGESTION_CRITERIA = ["1: do not suggest this task today", "2",
  "3: the project is only loosely relevant today, or this task was suggested very recently", "4",
  "5: a reasonable suggestion if nothing stronger is available", "6",
  "7: the project's rationale applies today and this task would move it forward", "8", "9",
  "10: the clearest task to suggest right now"];

// ----------------------------------------------------------------------------------------------
// @desc Ask Jev when it is available, and otherwise ask the generative model for a stack-ranked UUID list.
//   A Jev failure falls through to the generative model. Neither being available returns null so the caller
//   can keep its existing generator.
// @param {object} app - Host-compatible Amplenote API.
// @param {Array<object>} groups - From dayProjectGroups.
// @param {object} [options] - { requestAnswers } injects a Jev response for tests and skips the fallback.
// @returns {Promise<object|null>} { rankerEm, rankedTasks }, highest rating first, or null.
export async function rankDayTasks(app, groups, { requestAnswers } = {}) {
  const prepared = suggestionQuestions(groups);
  if (!prepared.listed.length) return null;
  if (requestAnswers) return _rankedFromRequester(prepared, { accessToken: null, requestAnswers });
  const scorerEm = await projectTaskScorer(app);
  if (!scorerEm) return null;
  if (scorerEm === "jev") {
    const jevRanked = await _tryJev(app, prepared);
    if (jevRanked) return jevRanked;
  }
  return _rankWithGenerativeModel(app, prepared);
}

// ----------------------------------------------------------------------------------------------
// @desc The prompt the generative model answers when Jev is unavailable. It must return candidate IDs best-first.
// @param {object} state - { projects } as suggestionQuestions builds it.
// @returns {string} Prompt asking for { rankedCandidateIds }.
export function generativeRankPrompt(state) {
  return ["Choose which tasks to suggest today.",
    "Each project includes a rationale for why it deserves a task today, and its candidates. A candidate of kind "
      + "\"existing task\" is already on the user's task list; one of kind \"new idea\" is a generated next action the "
      + "user has not yet taken on, with an actionability rating from 1 to 10. The score is higher when the candidate "
      + "was judged closer to the project. minutesSinceRecommended is null when the candidate has never been suggested, "
      + "and otherwise how many minutes ago it was last shown. Prefer a candidate that has not been suggested recently, "
      + "and prefer an existing task to a new idea when the two are otherwise comparable.",
    "Return a stack-ranked list of the applicable candidates, best first. Include only candidateIds from the state.",
    "", "State:", JSON.stringify(state, null, 2),
    "", 'Reply with JSON only: { "rankedCandidateIds": ["task:uuid", "idea:id", "..."] }'].join("\n");
}

// ----------------------------------------------------------------------------------------------
// @desc Order candidates from Jev score answers. A missing answer leaves that candidate unranked.
// @param {Array<object>} listed - Entries from suggestionQuestions, in question order.
// @param {object} answers - Jev answers keyed by question name.
// @returns {Array<object>} Ranked candidates, highest rating first.
export function rankedTasksFromAnswers(listed, answers) {
  const rated = (listed || []).map((entry, index) => {
    const answer = answers?.[`task_${ index + 1 }`];
    if (answer?.type !== "score" || !Number.isFinite(answer.score)) return null;
    return _rankedFromEntry(entry, Math.round((answer.score + 1) * 10) / 10);
  }).filter(Boolean);
  return _byRating(rated);
}

// ----------------------------------------------------------------------------------------------
// @desc Order candidates from a generative reply listing candidate IDs best-first. A bare task UUID, as an older reply
//   gives, names that task's candidate; unknown IDs are dropped. Ratings follow list order, an idea's lowered by
//   IDEA_RATING_HANDICAP.
// @param {Array<object>} listed - Entries from suggestionQuestions, in question order.
// @param {Array<string>} candidateIds - Best-first candidate IDs.
// @returns {Array<object>} Ranked candidates, highest rating first.
export function rankedTasksFromCandidateIds(listed, candidateIds) {
  const byCandidateId = new Map((listed || []).map(entry => [entry.candidate.candidateId, entry]));
  const chosen = [];
  const seen = new Set();
  for (const listedId of candidateIds || []) {
    const candidateId = typeof listedId === "string" && !listedId.includes(":") ? `task:${ listedId }` : listedId;
    if (!candidateId || seen.has(candidateId) || !byCandidateId.has(candidateId)) continue;
    seen.add(candidateId);
    chosen.push(byCandidateId.get(candidateId));
  }
  const span = Math.max(chosen.length - 1, 1);
  const ranked = chosen.map((entry, index) => _rankedFromEntry(entry, Math.round((10 - (index / span) * 9) * 10) / 10));
  return _byRating(ranked);
}

// ----------------------------------------------------------------------------------------------
// @desc Build the nested project state and one score question per candidate.
// @param {Array<object>} groups - From dayProjectGroups.
// @returns {object} { listed, questions, state }. state.projects is what the ranker is shown.
export function suggestionQuestions(groups) {
  const keyByProjectUuid = new Map();
  const projects = {};
  const usedKeys = new Set();
  for (const group of groups || []) {
    let key = group.summary || "Untitled project";
    if (usedKeys.has(key)) key = `${ key } (${ group.projectUuid })`;
    usedKeys.add(key);
    keyByProjectUuid.set(group.projectUuid, key);
    projects[key] = { rationale: group.rationale, taskCandidates: group.taskCandidates.map(_candidateState) };
  }
  const listed = [];
  for (const group of groups || []) {
    for (const candidate of group.taskCandidates) {
      listed.push({ candidate, projectUuid: group.projectUuid, rationale: group.rationale, summary: group.summary });
    }
  }
  const questions = {};
  listed.forEach((entry, index) => {
    const name = `task_${ index + 1 }`;
    questions[name] = scoreQuestion(_questionInstructions(name, entry), SUGGESTION_CRITERIA);
  });
  return { listed, questions, state: { projects } };
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Order ranked candidates by rating, highest first, keeping the given order between equal ratings.
// @param {Array<object>} ranked - Ranked candidates.
// @returns {Array<object>} The same candidates, sorted.
function _byRating(ranked) {
  return [...ranked].sort((first, second) => second.rating - first.rating);
}

// ----------------------------------------------------------------------------------------------
// @desc What the ranker is shown about one candidate: its identity and kind, and an idea's actionability.
// @param {object} candidate - From QuarterProject#taskCandidates.
// @returns {object} { actionability?, candidateId, kind, minutesSinceRecommended, score, text }.
function _candidateState(candidate) {
  const state = { candidateId: candidate.candidateId, kind: candidate.isExisting === false ? "new idea" : "existing task",
    minutesSinceRecommended: candidate.minutesSinceRecommended, score: candidate.score, text: candidate.text };
  if (candidate.isExisting === false) state.actionability = candidate.actionability;
  return state;
}

// ----------------------------------------------------------------------------------------------
// @desc The sentence explaining why an idea is offered, added to its project's rationale.
// @param {object} candidate - An idea candidate.
// @returns {string} One sentence.
function _ideaExplanation(candidate) {
  return `This is a new next action generated for the project, rated ${ candidate.actionability }/10 for being something `
    + "to start within one work block; accepting it adds it to your tasks.";
}

// ----------------------------------------------------------------------------------------------
// @desc The Jev question for one candidate. An idea is named as a new next action, so its rating weighs its
//   actionability and gives way to an existing task that is otherwise comparable.
// @param {string} name - The question name.
// @param {object} entry - A listed candidate.
// @returns {string} The question's instructions.
function _questionInstructions(name, entry) {
  const { candidate } = entry;
  const subject = candidate.isExisting === false
    ? `${ name }, a new next action that is not yet a task ("${ candidate.text }"),` : `${ name } ("${ candidate.text }")`;
  const weighed = candidate.isExisting === false ? "the idea's relevance score and actionability" : "the task's applicability score";
  return `How strongly should we suggest ${ subject } from the project "${ entry.summary }" today? Weigh that project's `
    + `rationale, ${ weighed }, and minutesSinceRecommended. Prefer a candidate that has not been suggested recently, `
    + "and an existing task over a new idea when the two are otherwise comparable.";
}

// ----------------------------------------------------------------------------------------------
// @desc One ranked candidate in the shape both the dream-task and agenda slotters consume. An idea's rating is lowered
//   by IDEA_RATING_HANDICAP, and its rationale says why a new action is offered.
// @param {object} entry - A listed candidate.
// @param {number} rating - 1–10 suggestion strength.
// @returns {object} Ranked candidate: taskUuid is null and ideaId set for an idea.
function _rankedFromEntry(entry, rating) {
  const { candidate } = entry;
  const isIdea = candidate.isExisting === false;
  const rationale = isIdea ? `${ entry.rationale } ${ _ideaExplanation(candidate) }`.trim() : entry.rationale;
  const adjustedRating = isIdea ? Math.max(1, Math.round((rating - IDEA_RATING_HANDICAP) * 10) / 10) : rating;
  return { candidateId: candidate.candidateId, durationMinutes: candidate.durationMinutes, ideaId: candidate.ideaId || null,
    isExisting: !isIdea, minutesSinceRecommended: candidate.minutesSinceRecommended, noteUuid: candidate.noteUuid,
    projectUuid: entry.projectUuid, rationale, rating: adjustedRating, taskText: candidate.text, taskUuid: candidate.uuid || null };
}

// ----------------------------------------------------------------------------------------------
// @desc Run one injected or resolved requester and keep the result only when it ranked something.
// @param {object} prepared - From suggestionQuestions.
// @param {object} requester - { accessToken, requestAnswers }.
// @returns {Promise<object|null>} { rankerEm: "jev", rankedTasks } or null.
async function _rankedFromRequester(prepared, requester) {
  try {
    const { answers } = await requester.requestAnswers({ accessToken: requester.accessToken, questions: prepared.questions,
      state: prepared.state });
    const rankedTasks = rankedTasksFromAnswers(prepared.listed, answers);
    return rankedTasks.length ? { rankerEm: "jev", rankedTasks } : null;
  } catch (error) {
    logIfEnabled(`${ RANK_LOG_LABEL } Jev ranking failed`, error?.message);
    return null;
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Ask Jev through the key or Ample Agent Pro. A failure is null so the generative model can answer.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} prepared - From suggestionQuestions.
// @returns {Promise<object|null>} A Jev ranking, or null.
async function _tryJev(app, prepared) {
  const requester = await jevAnswerRequester(app);
  if (!requester) return null;
  return _rankedFromRequester(prepared, requester);
}

// ----------------------------------------------------------------------------------------------
// @desc Ask the generative model for a stack-ranked UUID list. Agent Pro can answer when no provider key is set.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} prepared - From suggestionQuestions.
// @returns {Promise<object|null>} { rankerEm: "generative", rankedTasks } or null.
async function _rankWithGenerativeModel(app, prepared) {
  const settings = pluginSettings();
  const canAsk = fastModelOptions(settings) || await findAmpleAgentProNote(app);
  if (!canAsk) return null;
  try {
    const response = await raceWizardPrompt(app, generativeRankPrompt(prepared.state), wizardLlmOptions(settings));
    const candidateIds = Array.isArray(response) ? response : response?.rankedCandidateIds || response?.rankedTaskUuids;
    if (!Array.isArray(candidateIds)) return null;
    const rankedTasks = rankedTasksFromCandidateIds(prepared.listed, candidateIds);
    return rankedTasks.length ? { rankerEm: "generative", rankedTasks } : null;
  } catch (error) {
    logIfEnabled(`${ RANK_LOG_LABEL } generative ranking failed`, error?.message);
    return null;
  }
}
