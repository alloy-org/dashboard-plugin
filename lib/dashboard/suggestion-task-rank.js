// Rank today's project-nested task candidates. Jev scores each candidate against the project rationales when a
// Jev key or Ample Agent Pro is available. Otherwise the generative model returns a stack-ranked list of task
// UUIDs from that same state. Callers that already have an ordered list skip this module.
import { jevAnswerRequester, projectTaskScorer } from "plan-wizard/stack-rank/stack-rank-project-tasks";
import { wizardLlmOptions } from "plan-wizard/wizard-prompt-diagnostics";
import { raceWizardPrompt } from "plan-wizard/wizard-prompt-runner";
import { pluginSettings } from "plugin-data";
import { fastModelOptions, findAmpleAgentProNote } from "providers/ai-provider-settings";
import { scoreQuestion } from "providers/jev-client";
import { logIfEnabled } from "util/log";

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
// @desc The prompt the generative model answers when Jev is unavailable. It must return task UUIDs best-first.
// @param {object} state - { projects } as suggestionQuestions builds it.
// @returns {string} Prompt asking for { rankedTaskUuids }.
export function generativeRankPrompt(state) {
  return ["Choose which existing tasks to suggest today.",
    "Each project includes a rationale for why it deserves a task today, and the tasks already associated with "
      + "it in the project task note. The applicability score is higher when the task was judged closer to the "
      + "project. minutesSinceRecommended is null when the task has never been suggested, and otherwise how many "
      + "minutes ago it was last shown. Prefer a task that has not been suggested recently.",
    "Return a stack-ranked list of the applicable tasks, best first. Include only uuids from the state.",
    "", "State:", JSON.stringify(state, null, 2),
    "", 'Reply with JSON only: { "rankedTaskUuids": ["task-uuid", "..."] }'].join("\n");
}

// ----------------------------------------------------------------------------------------------
// @desc Order candidates from a generative { rankedTaskUuids } reply. Unknown UUIDs are dropped.
// @param {Array<object>} listed - Entries from suggestionQuestions, in question order.
// @param {Array<string>} uuids - Best-first task UUIDs.
// @returns {Array<object>} Ranked tasks, first in the list rated highest.
export function rankedTasksFromUuidList(listed, uuids) {
  const byUuid = new Map((listed || []).map(entry => [entry.candidate.uuid, entry]));
  const chosen = [];
  const seen = new Set();
  for (const uuid of uuids || []) {
    if (!uuid || seen.has(uuid) || !byUuid.has(uuid)) continue;
    seen.add(uuid);
    chosen.push(byUuid.get(uuid));
  }
  const span = Math.max(chosen.length - 1, 1);
  return chosen.map((entry, index) => _rankedFromEntry(entry, Math.round((10 - (index / span) * 9) * 10) / 10));
}

// ----------------------------------------------------------------------------------------------
// @desc Order candidates from Jev score answers. A missing answer leaves that task unranked.
// @param {Array<object>} listed - Entries from suggestionQuestions, in question order.
// @param {object} answers - Jev answers keyed by question name.
// @returns {Array<object>} Ranked tasks, highest rating first.
export function rankedTasksFromAnswers(listed, answers) {
  const rated = (listed || []).map((entry, index) => {
    const answer = answers?.[`task_${ index + 1 }`];
    if (answer?.type !== "score" || !Number.isFinite(answer.score)) return null;
    return _rankedFromEntry(entry, Math.round((answer.score + 1) * 10) / 10);
  }).filter(Boolean);
  return rated.sort((first, second) => second.rating - first.rating);
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
    projects[key] = { rationale: group.rationale, taskCandidates: group.taskCandidates.map(candidate => ({
      minutesSinceRecommended: candidate.minutesSinceRecommended, score: candidate.score, text: candidate.text,
      uuid: candidate.uuid })) };
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
    questions[name] = scoreQuestion(`How strongly should we suggest ${ name } ("${ entry.candidate.text }") from `
      + `the project "${ entry.summary }" today? Weigh that project's rationale, the task's applicability score, `
      + "and minutesSinceRecommended. Prefer a task that has not been suggested recently.", SUGGESTION_CRITERIA);
  });
  return { listed, questions, state: { projects } };
}

// ----------------------------------------------------------------------------------------------
// @desc One ranked task in the shape both the dream-task and agenda slotters consume.
// @param {object} entry - A listed candidate.
// @param {number} rating - 1–10 suggestion strength.
// @returns {object} Ranked task.
function _rankedFromEntry(entry, rating) {
  return { durationMinutes: entry.candidate.durationMinutes, minutesSinceRecommended: entry.candidate.minutesSinceRecommended,
    noteUuid: entry.candidate.noteUuid, projectUuid: entry.projectUuid, rationale: entry.rationale, rating,
    taskText: entry.candidate.text, taskUuid: entry.candidate.uuid };
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
    const uuids = Array.isArray(response) ? response : response?.rankedTaskUuids;
    if (!Array.isArray(uuids)) return null;
    const rankedTasks = rankedTasksFromUuidList(prepared.listed, uuids);
    return rankedTasks.length ? { rankerEm: "generative", rankedTasks } : null;
  } catch (error) {
    logIfEnabled(`${ RANK_LOG_LABEL } generative ranking failed`, error?.message);
    return null;
  }
}
