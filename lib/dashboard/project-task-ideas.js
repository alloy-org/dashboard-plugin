// Ask the configured provider for the tasks a project already has scattered across the user's notes and for
// concrete next actions on it, so the calendar's "Suggested tasks" can be answered from stored text rather than
// by generating ideas on the critical path. One call answers both questions, because the context each needs —
// the project's plan, its open tasks, and the ideas still awaiting the user's decision — is the same context.
import { wizardLlmOptions } from "plan-wizard/wizard-prompt-diagnostics";
import { raceWizardPrompt } from "plan-wizard/wizard-prompt-runner";
import { pluginSettings } from "plugin-data";
import { logIfEnabled } from "util/log";

const IDEA_LOG_LABEL = "[project-task-ideas]";
// Enough to give the agenda a choice on a day this project comes due, while keeping a stale idea's shelf life
// short; the background pass regenerates them whenever the project's ideas age past the staleness window.
const MAXIMUM_IDEAS_PER_PROJECT = 3;

// ----------------------------------------------------------------------------------------------
// @desc Refresh one project from the provider: the tasks it can find that belong to the project but were not
//   matched by the local association pass, and new next-action ideas. An idea may supersede one the user has
//   not yet decided on, which the model states by naming that idea's text in `beforeTask`; the caller replaces
//   the superseded idea in place rather than accumulating two phrasings of the same suggestion.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - An object with the following properties:
//   - {object} project - Project record carrying `summary`, `nextAction`, `relatedTaskRecords`, `suggestedTasks`
//   - {string|null} quarterlyContext - The project's section of the quarterly plan, when available
//   - {function} [promptRunner=raceWizardPrompt] - Injected for tests
// @returns {Promise<object>} An object with the following properties:
//   - {string|null} failureReason - Why the refresh produced nothing, or null on success
//   - {Array<object>} foundTasks - Tasks the model attributes to this project as { taskText, taskUuid }
//   - {Array<object>} suggestedTasks - Ideas as { beforeTask, generatedAt, taskText }
export async function generateProjectTaskIdeas(app, { project, promptRunner = raceWizardPrompt, quarterlyContext }) {
  const prompt = _refreshPrompt(project, quarterlyContext);
  const llmOptions = wizardLlmOptions(pluginSettings());
  let response = null;
  try {
    response = await promptRunner(app, prompt, llmOptions);
  } catch (error) {
    const failureReason = error?.message || "Project task refresh request failed";
    logIfEnabled(`${ IDEA_LOG_LABEL } provider call failed`, failureReason);
    return { failureReason, foundTasks: [], suggestedTasks: [] };
  }
  const foundTasks = _foundTasksFromResponse(response, project);
  const suggestedTasks = _ideasFromResponse(response, project);
  if (!foundTasks.length && !suggestedTasks.length) {
    return { failureReason: "The provider returned no usable tasks or ideas", foundTasks, suggestedTasks };
  }
  logIfEnabled(`${ IDEA_LOG_LABEL } refreshed project`, { foundCount: foundTasks.length,
    ideaCount: suggestedTasks.length, project: project.summary });
  return { failureReason: null, foundTasks, suggestedTasks };
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
//   supersede. A `beforeTask` that does not name an idea the project currently holds is cleared rather than
//   honored, so a mis-stated supersession adds an idea instead of silently discarding an existing one.
// @param {object|null} response - Parsed provider response.
// @param {object} project - Project the ideas were requested for.
// @returns {Array<object>} Accepted ideas as { beforeTask, generatedAt, taskText }.
function _ideasFromResponse(response, project) {
  const rawIdeas = Array.isArray(response?.ideas) ? response.ideas : [];
  const knownTexts = new Set((project.relatedTaskRecords || []).map(task => (task.taskText || "").trim().toLowerCase()));
  const priorIdeaTexts = new Map((project.suggestedTasks || []).map(idea => [(idea.taskText || "").trim().toLowerCase(),
    idea.taskText]));
  const generatedAt = new Date().toISOString();
  const accepted = [];
  for (const idea of rawIdeas) {
    const taskText = (typeof idea === "string" ? idea : idea?.taskText || "").trim();
    if (taskText.length < 4 || taskText.length > 200) continue;
    const comparisonKey = taskText.toLowerCase();
    const supersededKey = (idea?.beforeTask || "").trim().toLowerCase();
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
// @desc Render the prompt describing one project, the tasks it already holds, the ideas the user has not yet
//   decided on, and the pool of open tasks the model may attribute to it. The pool is cited by UUID so a found
//   task resolves to a real task rather than to a restatement of its text.
// @param {object} project - Project record.
// @param {string|null} quarterlyContext - The project's quarterly plan section, when available.
// @returns {string} Prompt text requesting a JSON object of found tasks and ideas.
function _refreshPrompt(project, quarterlyContext) {
  const openTasks = (project.relatedTaskRecords || []).map(task => `- ${ task.taskText }`).join("\n") || "- (none)";
  const priorIdeas = (project.suggestedTasks || []).map(task => `- ${ task.taskText }`).join("\n") || "- (none)";
  const candidates = (project.candidateTaskRecords || []).map(task => `- [${ task.taskUuid }] ${ task.taskText }`)
    .join("\n") || "- (none)";
  const planContext = quarterlyContext ? `\nThe user's plan for this project says:\n${ quarterlyContext }\n` : "";
  const statedNextAction = project.nextAction ? `\nThe plan's stated next action is: ${ project.nextAction }\n` : "";
  return `You are helping the user make progress on a quarterly project called "${ project.summary }".`
    + `${ planContext }${ statedNextAction }\nTasks already associated with this project:\n${ openTasks }\n`
    + `\nTask ideas awaiting the user's decision (they have neither accepted nor rejected these yet):\n${ priorIdeas }\n`
    + `\nOther open tasks from the user's notes, each shown as [uuid] text. Some may belong to this project:\n`
    + `${ candidates }\n`
    + `\nDo two things:\n`
    + `1. List any task from the pool above that belongs to this project, citing its uuid exactly as given. `
    + `Cite only uuids from the pool, and omit tasks already associated with the project.\n`
    + `2. Suggest up to ${ MAXIMUM_IDEAS_PER_PROJECT } concrete next actions. Each must be a single specific action `
    + `the user could start within one working block, not a goal or a theme. If an idea is a better phrasing or a `
    + `refinement of an idea awaiting decision, set "beforeTask" to that earlier idea's exact text; otherwise set `
    + `"beforeTask" to null. Do not restate an already-associated task.\n`
    + `\nRespond with JSON only, shaped: { "foundTasks": [{ "taskUuid": "..." }], `
    + `"ideas": [{ "taskText": "...", "beforeTask": null }] }`;
}
