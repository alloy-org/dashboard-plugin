// Ask the configured provider for the tasks a project already has scattered across the user's notes and for
// concrete next actions on it, so the calendar's "Suggested tasks" can be answered from stored text rather than
// by generating ideas on the critical path. One call answers both questions, because the context each needs is the
// same: the intents the project serves, the project's plan, its open tasks, the work already completed on it, and the
// ideas the user has yet to decide on, taken on, or turned down.
import { IDEA_STATUSES, ideaComparisonKey, openIdeas } from "project-idea-records";
import { wizardLlmOptions } from "plan-wizard/wizard-prompt-diagnostics";
import { raceWizardPrompt } from "plan-wizard/wizard-prompt-runner";
import { pluginSettings } from "plugin-data";
import { logIfEnabled } from "util/log";

const IDEA_LOG_LABEL = "[project-task-ideas]";
// Enough to give the agenda a choice on a day this project comes due, while keeping a stale idea's shelf life
// short; the background pass regenerates them whenever the project's ideas age past the staleness window.
const MAXIMUM_IDEAS_PER_PROJECT = 3;
// The most completions the prompt lists verbatim, the most recent first. Any beyond are counted in the prompt, never
// dropped silently, so the model knows the history it sees is partial.
export const MAXIMUM_PROMPT_COMPLETIONS = 40;

// ----------------------------------------------------------------------------------------------
// @desc Refresh one project from the provider: the tasks it can find that belong to the project but were not
//   matched by the local association pass, and new next-action ideas. An idea may supersede one the user has
//   not yet decided on, which the model states by naming that idea's text in `beforeTask`; the caller replaces
//   the superseded idea in place rather than accumulating two phrasings of the same suggestion.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - An object with the following properties:
//   - {Array<string>} [intentTexts=[]] - The Plan Builder intents the project advances, highest ranked first
//   - {object} project - Project record carrying `summary`, `nextAction`, `completedTasks`, `relatedTaskRecords`, and
//     `suggestedTasks` as idea records
//   - {string|null} quarterlyContext - The project's section of the quarterly plan, when available
//   - {function} [promptRunner=raceWizardPrompt] - Injected for tests
// @returns {Promise<object>} An object with the following properties:
//   - {string|null} failureReason - Why the refresh produced nothing, or null on success
//   - {Array<object>} foundTasks - Tasks the model attributes to this project as { taskText, taskUuid }
//   - {boolean} requestFailed - True when the provider call itself failed, rather than answering with nothing usable
//   - {Array<object>} suggestedTasks - Ideas as { beforeTask, generatedAt, taskText }
export async function generateProjectTaskIdeas(app, { intentTexts = [], project, promptRunner = raceWizardPrompt, quarterlyContext }) {
  const prompt = _refreshPrompt(project, { intentTexts, quarterlyContext });
  const llmOptions = wizardLlmOptions(pluginSettings());
  let response = null;
  try {
    response = await promptRunner(app, prompt, llmOptions);
  } catch (error) {
    const failureReason = error?.message || "Project task refresh request failed";
    logIfEnabled(`${ IDEA_LOG_LABEL } provider call failed`, failureReason);
    return { failureReason, foundTasks: [], requestFailed: true, suggestedTasks: [] };
  }
  const foundTasks = _foundTasksFromResponse(response, project);
  const suggestedTasks = _ideasFromResponse(response, project);
  if (!foundTasks.length && !suggestedTasks.length) {
    return { failureReason: "The provider returned no usable tasks or ideas", foundTasks, requestFailed: false, suggestedTasks };
  }
  logIfEnabled(`${ IDEA_LOG_LABEL } refreshed project`, { foundCount: foundTasks.length,
    ideaCount: suggestedTasks.length, project: project.summary });
  return { failureReason: null, foundTasks, requestFailed: false, suggestedTasks };
}

// ----------------------------------------------------------------------------------------------
// @desc Keep only the found tasks that name a task the project does not already hold. The model is told the
//   UUIDs it may cite, so an entry citing an unknown UUID is dropped: a fabricated identifier would become a
//   dead task link in the store, which is harder to notice than a task the pass simply failed to find.
// @param {object|null} response - Parsed provider response.
// @param {object} project - Project the refresh was requested for.
// @returns {Array<object>} Accepted associations as { taskText, taskUuid }.
function _foundTasksFromResponse(response, project) {
  const rawTasks = Array.isArray(response?.foundTasks) ? response.foundTasks : [];
  const knownUuids = new Set((project.relatedTaskRecords || []).map(task => task.taskUuid));
  const citableUuids = new Set((project.candidateTaskRecords || []).map(task => task.taskUuid));
  const accepted = [];
  for (const found of rawTasks) {
    const taskUuid = (found?.taskUuid || "").trim();
    if (!taskUuid || knownUuids.has(taskUuid) || !citableUuids.has(taskUuid)) continue;
    const candidate = project.candidateTaskRecords.find(task => task.taskUuid === taskUuid);
    knownUuids.add(taskUuid);
    accepted.push({ taskText: candidate.taskText, taskUuid });
  }
  return accepted;
}

// ----------------------------------------------------------------------------------------------
// @desc Keep only well-formed, novel, single-action idea strings, carrying through the idea each one claims to
//   supersede. A `beforeTask` that does not name an open idea the project holds is cleared rather than honored, so a
//   mis-stated supersession adds an idea instead of silently discarding an existing one. An idea restating an
//   associated task, a completed task, or an idea the user already took on or turned down is dropped, compared by
//   ideaComparisonKey so a change of case or punctuation does not make it new.
// @param {object|null} response - Parsed provider response.
// @param {object} project - Project the ideas were requested for.
// @returns {Array<object>} Accepted ideas as { beforeTask, generatedAt, taskText }.
function _ideasFromResponse(response, project) {
  const rawIdeas = Array.isArray(response?.ideas) ? response.ideas : [];
  const decidedIdeas = (project.suggestedTasks || []).filter(idea => idea.status !== IDEA_STATUSES.open);
  const knownSources = [...(project.relatedTaskRecords || []), ...(project.completedTasks || []), ...decidedIdeas];
  const knownTexts = new Set(knownSources.map(source => ideaComparisonKey(source.taskText)).filter(Boolean));
  const priorIdeaTexts = new Map(openIdeas(project.suggestedTasks).map(idea => [ideaComparisonKey(idea.taskText), idea.taskText]));
  const generatedAt = new Date().toISOString();
  const accepted = [];
  for (const idea of rawIdeas) {
    const taskText = (typeof idea === "string" ? idea : idea?.taskText || "").trim();
    if (taskText.length < 4 || taskText.length > 200) continue;
    const comparisonKey = ideaComparisonKey(taskText);
    const supersededKey = ideaComparisonKey(idea?.beforeTask || "");
    const beforeTask = priorIdeaTexts.get(supersededKey) || null;
    if (knownTexts.has(comparisonKey)) continue;
    if (priorIdeaTexts.has(comparisonKey) && !beforeTask) continue;
    knownTexts.add(comparisonKey);
    accepted.push({ beforeTask, generatedAt, taskText });
    if (accepted.length >= MAXIMUM_IDEAS_PER_PROJECT) break;
  }
  return accepted;
}

// ----------------------------------------------------------------------------------------------
// @desc List the project's completions for the prompt, the most recent first, by the text they were recorded with. The
//   lines say how many completions were left out for length and how many were recorded without text, so a partial
//   history is never presented as the whole of it.
// @param {Array<object>} completedTasks - Completion records.
// @returns {string} Bullet lines, "- (none recorded)" when the project has no completions.
function _completionLines(completedTasks) {
  const completions = completedTasks || [];
  if (!completions.length) return "- (none recorded)";
  const withText = completions.filter(completion => completion.taskText);
  const newestFirst = [...withText].sort((first, second) => (second.completedAt || "").localeCompare(first.completedAt || ""));
  const listed = newestFirst.slice(0, MAXIMUM_PROMPT_COMPLETIONS);
  const lines = listed.map(completion => `- ${ completion.taskText } (completed ${ (completion.completedAt || "").slice(0, 10) })`);
  const omittedCount = newestFirst.length - listed.length;
  const textlessCount = completions.length - withText.length;
  if (omittedCount) lines.push(`- (${ omittedCount } earlier completed task(s) not listed here)`);
  if (textlessCount) lines.push(`- (${ textlessCount } completed task(s) recorded without their text)`);
  return lines.join("\n");
}

// ----------------------------------------------------------------------------------------------
// @desc Render the prompt describing one project: the intents it serves, its plan, the tasks it holds, the work already
//   completed on it, the ideas awaiting the user's decision and those already decided, and the pool of open tasks the
//   model may attribute to it. The pool is cited by UUID so a found task resolves to a real task rather than to a
//   restatement of its text.
// @param {object} project - Project record.
// @param {object} options - { intentTexts, quarterlyContext }: quarterlyContext is the project's plan section, or null.
// @returns {string} Prompt text requesting a JSON object of found tasks and ideas.
function _refreshPrompt(project, { intentTexts, quarterlyContext }) {
  const ideas = project.suggestedTasks || [];
  const ideaLines = status => ideas.filter(idea => idea.status === status).map(idea => `- ${ idea.taskText }`).join("\n") || "- (none)";
  const openTasks = (project.relatedTaskRecords || []).map(task => `- ${ task.taskText }`).join("\n") || "- (none)";
  const candidates = (project.candidateTaskRecords || []).map(task => `- [${ task.taskUuid }] ${ task.taskText }`)
    .join("\n") || "- (none)";
  const intentContext = intentTexts?.length ? `\nThis project serves these intents the user chose for the quarter, most `
    + `important first:\n${ intentTexts.map(text => `- ${ text }`).join("\n") }\n` : "";
  const planContext = quarterlyContext ? `\nThe user's plan for this project says:\n${ quarterlyContext }\n` : "";
  const statedNextAction = project.nextAction ? `\nThe plan's stated next action is: ${ project.nextAction }\n` : "";
  return `You are helping the user make progress on a quarterly project called "${ project.summary }".`
    + `${ intentContext }${ planContext }${ statedNextAction }\nTasks already associated with this project:\n${ openTasks }\n`
    + `\nTasks already completed for this project:\n${ _completionLines(project.completedTasks) }\n`
    + `\nTask ideas awaiting the user's decision (they have neither accepted nor rejected these yet):\n`
    + `${ ideaLines(IDEA_STATUSES.open) }\n`
    + `\nEarlier ideas the user took on as tasks:\n${ ideaLines(IDEA_STATUSES.accepted) }\n`
    + `\nEarlier ideas the user turned down. Do not suggest these again, reworded or not:\n`
    + `${ ideaLines(IDEA_STATUSES.dismissed) }\n`
    + `\nOther open tasks from the user's notes, each shown as [uuid] text. Some may belong to this project:\n`
    + `${ candidates }\n`
    + `\nDo two things:\n`
    + `1. List any task from the pool above that belongs to this project, citing its uuid exactly as given. `
    + `Cite only uuids from the pool, and omit tasks already associated with the project.\n`
    + `2. Suggest up to ${ MAXIMUM_IDEAS_PER_PROJECT } concrete next actions that build on the completed work toward `
    + `the project's intents. Each must be a single specific action `
    + `the user could start within one working block, not a goal or a theme. If an idea is a better phrasing or a `
    + `refinement of an idea awaiting decision, set "beforeTask" to that earlier idea's exact text; otherwise set `
    + `"beforeTask" to null. Do not restate an associated task, a completed task, or an earlier idea.\n`
    + `\nRespond with JSON only, shaped: { "foundTasks": [{ "taskUuid": "..." }], `
    + `"ideas": [{ "taskText": "...", "beforeTask": null }] }`;
}
