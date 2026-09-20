// Ask the configured provider for concrete next actions on one quarterly project, so the calendar's
// "Suggested tasks" can be answered from stored text rather than by generating ideas on the critical path.
import { wizardLlmOptions } from "plan-wizard/wizard-prompt-diagnostics";
import { raceWizardPrompt } from "plan-wizard/wizard-prompt-runner";
import { pluginSettings } from "plugin-data";
import { logIfEnabled } from "util/log";

const IDEA_LOG_LABEL = "[project-task-ideas]";
// Enough to give the agenda a choice on a day this project comes due, while keeping a stale idea's shelf life
// short; the background pass regenerates them whenever the project's ideas age past the staleness window.
const MAXIMUM_IDEAS_PER_PROJECT = 3;

// ----------------------------------------------------------------------------------------------
// @desc Generate next-action ideas for one project, skipping work the project's own plan already names and
//   any task the user already has open, so the store accumulates new suggestions rather than restating the
//   project's existing backlog back to them.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - An object with the following properties:
//   - {object} project - Project record carrying `summary`, `nextAction`, and `relatedTaskRecords`
//   - {string|null} quarterlyContext - The project's section of the quarterly plan, when available
//   - {function} [promptRunner=raceWizardPrompt] - Injected for tests
// @returns {Promise<object>} An object with the following properties:
//   - {string|null} failureReason - Why no ideas were produced, or null on success
//   - {Array<object>} suggestedTasks - Ideas as { generatedAt, taskText }
export async function generateProjectTaskIdeas(app, { project, promptRunner = raceWizardPrompt, quarterlyContext }) {
  const prompt = _ideaPrompt(project, quarterlyContext);
  const llmOptions = wizardLlmOptions(pluginSettings());
  let response = null;
  try {
    response = await promptRunner(app, prompt, llmOptions);
  } catch (error) {
    const failureReason = error?.message || "Project task idea request failed";
    logIfEnabled(`${ IDEA_LOG_LABEL } provider call failed`, failureReason);
    return { failureReason, suggestedTasks: [] };
  }
  const suggestedTasks = _ideasFromResponse(response, project);
  if (!suggestedTasks.length) {
    return { failureReason: "The provider returned no usable task ideas", suggestedTasks: [] };
  }
  logIfEnabled(`${ IDEA_LOG_LABEL } generated ideas`, { count: suggestedTasks.length, project: project.summary });
  return { failureReason: null, suggestedTasks };
}

// ----------------------------------------------------------------------------------------------
// @desc Keep only well-formed, novel, single-action idea strings. The model is asked for JSON, but a
//   malformed or duplicate entry is dropped rather than allowed to reach the user's calendar as a suggestion.
// @param {object|null} response - Parsed provider response.
// @param {object} project - Project the ideas were requested for.
// @returns {Array<object>} Accepted ideas as { generatedAt, taskText }.
function _ideasFromResponse(response, project) {
  const rawIdeas = Array.isArray(response?.tasks) ? response.tasks : [];
  const knownTexts = new Set((project.relatedTaskRecords || []).map(task => (task.taskText || "").trim().toLowerCase()));
  for (const existing of project.suggestedTasks || []) knownTexts.add((existing.taskText || "").trim().toLowerCase());
  const generatedAt = new Date().toISOString();
  const accepted = [];
  for (const idea of rawIdeas) {
    const taskText = (typeof idea === "string" ? idea : idea?.taskText || "").trim();
    if (taskText.length < 4 || taskText.length > 200) continue;
    const comparisonKey = taskText.toLowerCase();
    if (knownTexts.has(comparisonKey)) continue;
    knownTexts.add(comparisonKey);
    accepted.push({ generatedAt, taskText });
    if (accepted.length >= MAXIMUM_IDEAS_PER_PROJECT) break;
  }
  return accepted;
}

// ----------------------------------------------------------------------------------------------
// @desc Render the prompt describing one project and what already exists for it.
// @param {object} project - Project record.
// @param {string|null} quarterlyContext - The project's quarterly plan section, when available.
// @returns {string} Prompt text requesting a JSON object of task ideas.
function _ideaPrompt(project, quarterlyContext) {
  const openTasks = (project.relatedTaskRecords || []).map(task => `- ${ task.taskText }`).join("\n") || "- (none)";
  const priorIdeas = (project.suggestedTasks || []).map(task => `- ${ task.taskText }`).join("\n") || "- (none)";
  const planContext = quarterlyContext ? `\nThe user's plan for this project says:\n${ quarterlyContext }\n` : "";
  const statedNextAction = project.nextAction ? `\nThe plan's stated next action is: ${ project.nextAction }\n` : "";
  return `You are helping the user make progress on a quarterly project called "${ project.summary }".`
    + `${ planContext }${ statedNextAction }\nTasks the user already has open for this project:\n${ openTasks }\n`
    + `\nTask ideas already suggested previously (do not repeat these):\n${ priorIdeas }\n`
    + `\nSuggest up to ${ MAXIMUM_IDEAS_PER_PROJECT } NEW concrete next actions that would move this project forward. `
    + `Each must be a single specific action the user could start within one working block, not a goal or a theme. `
    + `Do not restate an open task or a previous suggestion.\n`
    + `\nRespond with JSON only, shaped: { "tasks": ["first action", "second action"] }`;
}
