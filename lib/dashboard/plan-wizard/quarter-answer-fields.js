// Shared editing rules for the two wizard pages that capture a single quarter-wide answer: the name the user
// gives the quarter, and the bar that tells them a day's work is done. Kept apart from the components so the
// draft/persisted comparison can be exercised without rendering, and so both pages resolve a stale answer the
// same way.

// ----------------------------------------------------------------------------------------------
// @desc Read the text of a stored quarter answer, treating an unanswered question as empty rather than absent so
//   a textarea always has a defined value.
// @param {object|null} answer - Stored { capturedAt, text }, or null when the question is unanswered.
// @returns {string} The stored text, or an empty string.
export function answerTextFromRecord(answer) {
  return answer?.text ?? "";
}

// ----------------------------------------------------------------------------------------------
// @desc Decide whether a draft differs from what is stored, so the page can disable a save that would write the
//   same text again and would only add a note revision.
// @param {object|null} answer - Stored answer record.
// @param {string} draftText - Text currently in the field.
// @returns {boolean} True when the trimmed draft is nonempty and differs from the stored answer.
export function hasUnsavedAnswer(answer, draftText) {
  const trimmedDraft = draftText.trim();
  if (!trimmedDraft) return false;
  return trimmedDraft !== answerTextFromRecord(answer).trim();
}

// ----------------------------------------------------------------------------------------------
// @desc Build the record one of these pages saves.
// @param {string} answerKey - quarterName or dailySufficiency.
// @param {string} capturedAt - ISO timestamp shared across a retry of the same edit.
// @param {string} draftText - Text the user entered.
// @returns {object} Arguments accepted by savePlanQuarterAnswer.
export function quarterAnswerFromDraft(answerKey, capturedAt, draftText) {
  return { answerKey, capturedAt, text: draftText.trim() };
}
