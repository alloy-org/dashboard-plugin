// The conditions the final wizard page offers for "I have done enough for today", the activities a finished day
// can release the user toward, and the rules that turn a selection into the one line of text the Vision Guide
// stores. Kept apart from the components so the compose/parse round trip can be exercised without rendering.
//
// The answer is stored as prose rather than as a structured record because savePlanQuarterAnswer persists
// { capturedAt, text } and nothing else. A chosen preset is therefore recognized on reopening by matching the
// stored text back against this catalog, the way the quarter-name page recognizes a stored name among its
// drafted ideas; text that matches no preset is a custom condition, which is what a user who wrote their own
// meant. The release clause is appended behind a separator distinctive enough that a condition someone typed by
// hand will not contain it.

import { answerTextFromRecord } from "dashboard/plan-wizard/quarter-answer-fields";

export const DONE_ENOUGH_CONDITION_LEGEND = "Want Amplenote to recognize when you've had an excellent day?";
export const DONE_ENOUGH_CUSTOM_KEY = "custom-condition";
export const DONE_ENOUGH_NONE_KEY = "not-now";
export const RELEASE_CUSTOM_KEY = "custom-activity";
export const RELEASE_HEADING = "What would you enjoy being released toward?";
export const RELEASE_CLAUSE_SEPARATOR = " — released toward: ";

// Each preset carries the sentence the preview reads back and the signals that say what the condition credits.
// A signal with isCredited false is a deliberate exclusion: it names what the condition refuses to count, which
// is the part of a daily bar people most often get wrong.
export const DONE_ENOUGH_OPTIONS = [
  { description: "Best balance of urgency and quarterly progress.", isPreset: true, key: "deadline-and-goal",
    label: "Time-sensitive work + one meaningful move on my top goal",
    previewDetail: "You moved the quarter's top project forward and finished everything due today.",
    previewSignals: [{ isCredited: true, text: "deadline work" }, { isCredited: true, text: "meaningful quarterly move" },
      { isCredited: false, text: "not based on raw task count" }] },
  { description: "Useful when calendar-protected effort matters more than task count.", isPreset: true,
    key: "two-focus-blocks", label: "Two focused work blocks on quarterly goals",
    previewDetail: "You protected two blocks of focused time and spent both of them on quarterly work.",
    previewSignals: [{ isCredited: true, text: "protected focus time" }, { isCredited: true, text: "quarterly goals" },
      { isCredited: false, text: "not based on how full the day looked" }] },
  { description: "Simple, concrete, and easy to understand.", isPreset: true, key: "top-three-tasks",
    label: "My top three planned tasks",
    previewDetail: "You finished the three tasks you had planned as today's most important.",
    previewSignals: [{ isCredited: true, text: "planned priorities" }, { isCredited: true, text: "finished, not started" },
      { isCredited: false, text: "not based on what arrived later" }] },
  { description: "Rewards doing the thing most likely to be avoided.", isPreset: true, key: "hard-task-and-upkeep",
    label: "One difficult task + essential maintenance",
    previewDetail: "You did the task you were most likely to avoid and still kept the essentials running.",
    previewSignals: [{ isCredited: true, text: "hardest task" }, { isCredited: true, text: "essential maintenance" },
      { isCredited: false, text: "not based on comfortable busywork" }] },
  { description: "Describe your own weighted \"done enough\" rule.", isPreset: false, key: DONE_ENOUGH_CUSTOM_KEY,
    label: "Custom condition" },
  { description: "", isPreset: false, key: DONE_ENOUGH_NONE_KEY, label: "Not now" },
];

// The releasePhrase completes "Your next best task is to …", so every one of them starts with a verb.
export const RELEASE_ACTIVITIES = [
  { key: "walk", label: "Walk", releasePhrase: "go for a walk" },
  { key: "workout", label: "Workout", releasePhrase: "get a workout in" },
  { key: "read", label: "Read", releasePhrase: "read" },
  { key: "cook", label: "Cook", releasePhrase: "cook something" },
  { key: "family-time", label: "Family time", releasePhrase: "spend time with family" },
  { key: "games", label: "Games", releasePhrase: "play a game" },
  { key: "creative-hobby", label: "Creative hobby", releasePhrase: "work on a creative hobby" },
  { key: "outdoors", label: "Outdoors", releasePhrase: "get outdoors" },
];

// The chips the page offers: the catalog above, plus the escape hatch for an activity it does not name.
export const RELEASE_CHOICES = [...RELEASE_ACTIVITIES, { key: RELEASE_CUSTOM_KEY, label: "Custom" }];

// ----------------------------------------------------------------------------------------------
// @desc Read the condition half of a draft as the text it will be stored as, which is a preset's own label or
//   whatever the user wrote for a custom condition.
// @param {object} draft - A draft with the following properties:
//   - {string} conditionKey - Selected DONE_ENOUGH_OPTIONS key.
//   - {string} customConditionText - Text typed under Custom condition.
// @returns {string} Condition text, or an empty string when no condition is chosen yet.
export function conditionTextFromDraft(draft) {
  if (draft.conditionKey === DONE_ENOUGH_CUSTOM_KEY) return draft.customConditionText.trim();
  const option = doneEnoughOptionFromKey(draft.conditionKey);
  return option?.isPreset ? option.label : "";
}

// ----------------------------------------------------------------------------------------------
// @desc Rebuild the page's selection from a stored answer, so reopening the wizard shows the condition and
//   activities the user chose rather than a line of text they have to read back to themselves.
// @param {object|null} answer - Stored { capturedAt, text }, or null when the question is unanswered.
// @returns {object} A draft as described on conditionTextFromDraft, plus customReleaseText and releaseKeys.
// An activity label the catalog does not know becomes custom text rather than being dropped, since a stored
// answer may predate a change to the catalog.
export function doneEnoughDraftFromAnswer(answer) {
  const storedText = answerTextFromRecord(answer).trim();
  if (!storedText) return emptyDoneEnoughDraft();
  const separatorIndex = storedText.indexOf(RELEASE_CLAUSE_SEPARATOR);
  const hasReleaseClause = separatorIndex !== -1;
  const conditionText = hasReleaseClause ? storedText.slice(0, separatorIndex).trim() : storedText;
  const releaseText = hasReleaseClause ? storedText.slice(separatorIndex + RELEASE_CLAUSE_SEPARATOR.length) : "";
  const matchedPreset = DONE_ENOUGH_OPTIONS.find(option => option.isPreset && option.label === conditionText);
  const storedLabels = releaseText.split(",").map(label => label.trim()).filter(Boolean);
  const releaseKeys = [];
  const unmatchedLabels = [];
  for (const storedLabel of storedLabels) {
    const activity = RELEASE_ACTIVITIES.find(item => item.label.toLowerCase() === storedLabel.toLowerCase());
    if (activity) releaseKeys.push(activity.key); else unmatchedLabels.push(storedLabel);
  }
  if (unmatchedLabels.length) releaseKeys.push(RELEASE_CUSTOM_KEY);
  return { conditionKey: matchedPreset ? matchedPreset.key : DONE_ENOUGH_CUSTOM_KEY,
    customConditionText: matchedPreset ? "" : conditionText, customReleaseText: unmatchedLabels.join(", "),
    releaseKeys };
}

// ----------------------------------------------------------------------------------------------
// @desc Read one option's definition by key, so a stored or selected key resolves to its copy in one place.
// @param {string} optionKey - Key from DONE_ENOUGH_OPTIONS.
// @returns {object|null} The option, or null when the key is unknown.
export function doneEnoughOptionFromKey(optionKey) {
  return DONE_ENOUGH_OPTIONS.find(option => option.key === optionKey) ?? null;
}

// ----------------------------------------------------------------------------------------------
// @desc Build the wording a qualifying day would be described in, so the user reads the consequence of their
//   choice instead of inferring it from an option label.
// @param {object} draft - Draft as described on doneEnoughDraftFromAnswer.
// @returns {object} An object with the following properties:
//   - {string} detail - What the chosen condition credits, phrased as the finished day.
//   - {string} release - The sentence naming what the day releases the user toward; empty when none is chosen.
//   - {Array<object>} signals - { isCredited, text } chips substantiating the condition.
//   - {string} title - Heading for the preview panel.
export function doneEnoughPreviewFromDraft(draft) {
  const release = releaseSentenceFromDraft(draft);
  if (draft.conditionKey === DONE_ENOUGH_NONE_KEY) {
    return { detail: "Nothing changes about how your day is judged until you choose a condition.", release,
      signals: [], title: "No daily bar set." };
  }
  if (draft.conditionKey === DONE_ENOUGH_CUSTOM_KEY) {
    const customText = draft.customConditionText.trim();
    const detail = customText ? `You met the condition you wrote: ${ customText }.`
      : "Describe your condition and this preview will read it back to you.";
    return { detail, release, signals: customText ? [{ isCredited: true, text: "your own rule" }] : [],
      title: "You've done enough for today." };
  }
  const option = doneEnoughOptionFromKey(draft.conditionKey);
  return { detail: option.previewDetail, release, signals: option.previewSignals,
    title: "You've done enough for today." };
}

// ----------------------------------------------------------------------------------------------
// @desc Compose the single line this page saves: the chosen condition, then the activities it releases the user
//   toward. A condition is what makes the answer meaningful, so activities alone save nothing.
// @param {object} draft - Draft as described on doneEnoughDraftFromAnswer.
// @returns {string} Text for savePlanQuarterAnswer, or an empty string when there is nothing to save.
export function doneEnoughTextFromDraft(draft) {
  const conditionText = conditionTextFromDraft(draft);
  if (!conditionText) return "";
  const releaseLabels = releaseLabelsFromDraft(draft);
  if (!releaseLabels.length) return conditionText;
  return `${ conditionText }${ RELEASE_CLAUSE_SEPARATOR }${ releaseLabels.join(", ") }`;
}

// ----------------------------------------------------------------------------------------------
// @desc The selection an unanswered question starts from: no condition, which is the same thing "Not now" says.
// @returns {object} Draft as described on doneEnoughDraftFromAnswer.
export function emptyDoneEnoughDraft() {
  return { conditionKey: DONE_ENOUGH_NONE_KEY, customConditionText: "", customReleaseText: "", releaseKeys: [] };
}

// ----------------------------------------------------------------------------------------------
// @desc List the chosen activities as the labels they are stored under, in catalog order so the same selection
//   always produces the same text and a re-save of an unchanged answer stays a no-op.
// @param {object} draft - Draft as described on doneEnoughDraftFromAnswer.
// @returns {Array<string>} Activity labels, with any custom text last.
export function releaseLabelsFromDraft(draft) {
  const chosenActivities = RELEASE_ACTIVITIES.filter(activity => draft.releaseKeys.includes(activity.key));
  const chosenLabels = chosenActivities.map(activity => activity.label);
  const customLabel = draft.releaseKeys.includes(RELEASE_CUSTOM_KEY) ? draft.customReleaseText.trim() : "";
  return customLabel ? [...chosenLabels, customLabel] : chosenLabels;
}

// ----------------------------------------------------------------------------------------------
// @desc Phrase the chosen activities as the day's next best task.
// @param {object} draft - Draft as described on doneEnoughDraftFromAnswer.
// @returns {string} A full sentence, or an empty string when no activity is chosen.
export function releaseSentenceFromDraft(draft) {
  const chosenActivities = RELEASE_ACTIVITIES.filter(activity => draft.releaseKeys.includes(activity.key));
  const phrases = chosenActivities.map(activity => activity.releasePhrase);
  const customPhrase = draft.releaseKeys.includes(RELEASE_CUSTOM_KEY) ? draft.customReleaseText.trim() : "";
  const allPhrases = customPhrase ? [...phrases, customPhrase] : phrases;
  if (!allPhrases.length) return "";
  const leadingPhrases = allPhrases.slice(0, -1);
  const finalPhrase = allPhrases[allPhrases.length - 1];
  const phraseList = leadingPhrases.length ? `${ leadingPhrases.join(", ") } or ${ finalPhrase }` : finalPhrase;
  return `Your next best task is to ${ phraseList }.`;
}

// ----------------------------------------------------------------------------------------------
// @desc Add or remove one activity from the chosen set, since being released toward a walk and a book is one
//   answer rather than two competing ones.
// @param {Array<string>} releaseKeys - Currently chosen activity keys.
// @param {string} activityKey - Activity being toggled.
// @returns {Array<string>} The next chosen keys.
export function toggledReleaseKeysFromSelection(releaseKeys, activityKey) {
  if (releaseKeys.includes(activityKey)) return releaseKeys.filter(key => key !== activityKey);
  return [...releaseKeys, activityKey];
}
