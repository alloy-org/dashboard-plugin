// The explanation Amplenote shows for a calendar suggestion: which project the task serves, when one is known,
// then a one- or two-sentence answer to why the user is better off after completing the task, and a note when the
// suggestion falls on a weekday the user chose for its project. The ranker's own rationale stays on the activity for
// the agenda; this module asks for the sentence the calendar tooltip shows.
import { wizardLlmOptions } from "plan-wizard/wizard-prompt-diagnostics";
import { raceWizardPrompt } from "plan-wizard/wizard-prompt-runner";
import { pluginSettings } from "plugin-data";
import { logIfEnabled } from "util/log";

const BENEFIT_QUESTION = "Why am I better off after completing this task?";
const EXPLANATION_LOG_LABEL = "[calendar-suggestion-explanation]";

// Shown in place of the benefit sentence while the provider is still writing it.
export const PENDING_RATIONALE_TEXT = "Generating detailed rationale…";

// ----------------------------------------------------------------------------------------------
// @desc Ask for a benefit sentence for every activity or reserve that should show one, and leave the agenda's
//   own reason untouched. A ranked day asks for every item. Any other day asks only for items flagged
//   needsBenefitRationale, which is how a project the model left out still gets a calendar explanation.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} result - A fresh schedule payload, including activities and reserveTasks.
// @param {object} [options] - { promptRunner }: replaces the provider call in tests.
// @returns {Promise<object>} The same payload, with benefit set on the items that received one.
export async function agendaWithBenefitRationales(app, result, { promptRunner } = {}) {
  if (!result || result.error || !Array.isArray(result.activities)) return result;
  const reserveTasks = result.reserveTasks || [];
  const include = item => result.fromRanking || item?.needsBenefitRationale;
  const combined = [...result.activities, ...reserveTasks];
  const explained = await activitiesWithBenefitRationales(app, combined, { include, promptRunner });
  return { ...result, activities: explained.slice(0, result.activities.length),
    reserveTasks: explained.slice(result.activities.length) };
}

// ----------------------------------------------------------------------------------------------
// @desc Attach a benefit sentence to the listed items that still need one. Items the include predicate
//   rejects, and items that already carry a benefit, are returned unchanged. A failed or empty answer leaves
//   the list as it was given, so a missing provider never drops the suggestion.
// @param {object} app - Host-compatible Amplenote API.
// @param {Array<object>} activities - Suggestions or ranked reserves, each with a title or taskText.
// @param {object} [options] - { include, promptRunner }: include selects which items to ask about; promptRunner
//   replaces the provider call in tests.
// @returns {Promise<Array<object>>} The same items, with benefit set where the provider answered.
export async function activitiesWithBenefitRationales(app, activities, { include = null, promptRunner } = {}) {
  const listed = activities || [];
  const pendingIndexes = [];
  listed.forEach((activity, index) => {
    if (include && !include(activity)) return;
    if (activity?.benefit || !_taskTitle(activity)) return;
    pendingIndexes.push(index);
  });
  if (!pendingIndexes.length) return listed;
  const pending = pendingIndexes.map(index => listed[index]);
  try {
    const runner = promptRunner || _benefitPromptRunner;
    const response = await runner(app, benefitRationalePrompt(pending));
    const benefits = _benefitsFromResponse(response);
    const benefitByIndex = new Map();
    pendingIndexes.forEach((activityIndex, pendingIndex) => {
      const benefit = _atMostTwoSentences(_collapsed(benefits[pendingIndex]));
      if (benefit) benefitByIndex.set(activityIndex, benefit);
    });
    return listed.map((activity, index) => {
      const benefit = benefitByIndex.get(index);
      return benefit ? { ...activity, benefit } : activity;
    });
  } catch (error) {
    logIfEnabled(`${ EXPLANATION_LOG_LABEL } benefit request failed`, error?.message);
    return listed;
  }
}

// ----------------------------------------------------------------------------------------------
// @desc The prompt that asks for one benefit sentence, or two at most, per task, in list order.
// @param {Array<object>} activities - The tasks being explained, each with a title or taskText and an optional
//   projectSummary.
// @returns {string} Prompt text requesting { benefits }.
export function benefitRationalePrompt(activities) {
  const lines = (activities || []).map((activity, index) => {
    const projectSummary = _collapsed(activity?.projectSummary);
    const project = projectSummary ? ` Project: ${ projectSummary }.` : "";
    return `${ index + 1 }.${ project } Task: ${ _taskTitle(activity) }`;
  });
  return `For each task, answer the question "${ BENEFIT_QUESTION }" in one sentence, or two at most. `
    + "Write a direct statement of the benefit of finishing the task, as in "
    + "\"This task serves the dual purpose of social engagement and physical fitness.\" "
    + "Do not mention ratings, cadence, emphasis, how the task was chosen, or that it is a suggestion.\n\n"
    + `${ lines.join("\n") }\n\n`
    + "Reply with JSON only: { \"benefits\": [\"...\"] } with one string per task, in the same order.";
}

// ----------------------------------------------------------------------------------------------
// @desc The explanation delivered to Amplenote: a project line when the suggestion serves one, then the
//   benefit sentence. The agenda's reason is used only when no benefit was written, and PENDING_RATIONALE_TEXT stands
//   in for both while the benefit is still being written. When the suggestion's day is one the user chose for its
//   project, the rationale ends by saying so, since the benefit sentence never mentions it.
// @param {object} activity - A suggestion with optional benefit, emphasizedWeekday, projectSummary, and reason.
// @param {object} [options] - { rationalePending }: true while the provider is writing this activity's benefit.
// @returns {string} The tooltip text, or "" when the activity has neither a benefit nor a reason.
export function calendarSuggestionExplanation(activity, { rationalePending = false } = {}) {
  const fallbackText = rationalePending ? PENDING_RATIONALE_TEXT : activity?.reason;
  const benefitOrReason = _collapsed(activity?.benefit || fallbackText || "");
  const projectSummary = _collapsed(activity?.projectSummary);
  const emphasisSentence = projectSummary ? _emphasisSentence(activity?.emphasizedWeekday, benefitOrReason) : "";
  const rationale = [benefitOrReason, emphasisSentence].filter(Boolean).join(" ");
  if (!projectSummary) return rationale;
  const projectLine = `Project: ${ projectSummary }`;
  return rationale ? `${ projectLine }\n${ rationale }` : projectLine;
}

// ----------------------------------------------------------------------------------------------
// @desc Keep the first two sentences of a benefit, so a longer answer still fits the tooltip.
// @param {string} text - Collapsed benefit text.
// @returns {string} At most two sentences.
function _atMostTwoSentences(text) {
  if (!text) return "";
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  if (!sentences || sentences.length <= 2) return text;
  const kept = sentences.slice(0, 2).map(sentence => sentence.trim());
  return kept.join(" ");
}

// ----------------------------------------------------------------------------------------------
// @desc The benefit strings a provider reply listed, in order. An array reply is that list; an object reply
//   reads its benefits field. Anything else is no answer.
// @param {*} response - Parsed provider response.
// @returns {Array<*>} Benefit values, possibly empty.
function _benefitsFromResponse(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.benefits)) return response.benefits;
  return [];
}

// ----------------------------------------------------------------------------------------------
// @desc Ask whichever prose source can answer: Ample Agent Pro, or the configured provider when a key is set.
// @param {object} app - Host-compatible Amplenote API.
// @param {string} prompt - The benefit prompt.
// @returns {Promise<*>} The provider's parsed reply.
function _benefitPromptRunner(app, prompt) {
  return raceWizardPrompt(app, prompt, wizardLlmOptions(pluginSettings()));
}

// ----------------------------------------------------------------------------------------------
// @desc Collapse a value to a single line, or "" when it has no text.
// @param {*} value - Candidate text.
// @returns {string} Trimmed single-line text.
function _collapsed(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

// ----------------------------------------------------------------------------------------------
// @desc The sentence naming the day the user chose to emphasize a project, e.g. "You chose Tuesday as a day of
//   emphasis for this project." Text that already names the day, as the agenda's own reason does, needs no sentence.
// @param {string|null} emphasizedWeekday - Weekday name, or null.
// @param {string} rationale - The benefit or reason the sentence would follow.
// @returns {string} The sentence, or "" without a weekday or when the rationale already names it.
function _emphasisSentence(emphasizedWeekday, rationale) {
  const weekday = _collapsed(emphasizedWeekday);
  if (!weekday || rationale.includes(weekday)) return "";
  return `You chose ${ weekday } as a day of emphasis for this project.`;
}

// ----------------------------------------------------------------------------------------------
// @desc The task wording a benefit prompt should name. An activity carries a title; a ranked reserve carries
//   taskText.
// @param {object} activity - Suggestion or reserve.
// @returns {string} The task's text, or "".
function _taskTitle(activity) {
  return _collapsed(activity?.title || activity?.taskText);
}
