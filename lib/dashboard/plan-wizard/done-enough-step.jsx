// The wizard's final page: the optional condition that tells the user a day's work is genuinely done, and what
// they would rather be released toward once it is. Both halves are stored in the single dailySufficiency answer
// (see done-enough-fields.js), so this page saves one line of text like every other quarter-wide answer.
//
// The page never blocks Next. A daily bar someone was pushed into naming would be worse than none, so "Not now"
// is offered as a real choice and is where an unanswered question starts.

import DoneEnoughConditions from "dashboard/plan-wizard/done-enough-conditions";
import { DONE_ENOUGH_CUSTOM_KEY, RELEASE_CHOICES, RELEASE_CUSTOM_KEY, RELEASE_HEADING,
  doneEnoughDraftFromAnswer, doneEnoughTextFromDraft,
  toggledReleaseKeysFromSelection } from "dashboard/plan-wizard/done-enough-fields";
import DoneEnoughPreview from "dashboard/plan-wizard/done-enough-preview";
import { hasUnsavedAnswer, quarterAnswerFromDraft } from "dashboard/plan-wizard/quarter-answer-fields";
import { wizardStepFromKey } from "dashboard/plan-wizard/wizard-steps";
import { useEffect, useRef, useState } from "react";

const CUSTOM_RELEASE_PLACEHOLDER = "Something else you would rather be doing";
const DONE_ENOUGH_STEP_COPY = wizardStepFromKey("enough-for-today");

// ----------------------------------------------------------------------------------------------
// @desc Render and save the day's sufficiency condition. The selection is local state seeded from the stored
//   answer and reseeded only when the plan scope changes or a save succeeds, so a background refresh cannot
//   discard a choice the user is in the middle of making.
// @param {object} params - An object with the following properties:
//   - {object|null} answer - Stored { capturedAt, text } for this question, or null when unanswered.
//   - {boolean} isSaving - True while a save is in flight.
//   - {Function} onSave - Receives { answerKey, capturedAt, text } and resolves true when the write succeeded.
//   - {Error|null} saveError - Last save failure; its presence turns the action into a retry.
//   - {string} scopeKey - Identifies the domain and quarter; a change reseeds the draft.
// @returns {JSX.Element} The page.
export default function DoneEnoughStep({ answer, isSaving, onSave, saveError, scopeKey }) {
  const [draft, setDraft] = useState(() => doneEnoughDraftFromAnswer(answer));
  const [hasSaved, setHasSaved] = useState(false);
  const capturedAtRef = useRef(null);
  const seededScopeRef = useRef(scopeKey);

  useEffect(() => {
    if (seededScopeRef.current === scopeKey && !capturedAtRef.current) return;
    seededScopeRef.current = scopeKey;
    capturedAtRef.current = null;
    setDraft(doneEnoughDraftFromAnswer(answer));
    setHasSaved(false);
  }, [scopeKey]);

  useEffect(() => {
    if (capturedAtRef.current) return;
    setDraft(doneEnoughDraftFromAnswer(answer));
  }, [answer]);

  // ----------------------------------------------------------------------------------------------
  // @desc Record one edit and stamp the capture time every edit since the last save will be written under.
  // @param {Function} updateDraft - Receives the current draft and returns the next one.
  // A retry reuses the stamp, since the merge treats an older or tied timestamp as a no-op.
  const changeDraft = updateDraft => {
    capturedAtRef.current = capturedAtRef.current ?? new Date().toISOString();
    setHasSaved(false);
    setDraft(updateDraft);
  };

  // ----------------------------------------------------------------------------------------------
  // @desc Save the composed answer, keeping the selection intact on failure so a retry can reuse its timestamp.
  const handleSave = async () => {
    const capturedAt = capturedAtRef.current ?? new Date().toISOString();
    capturedAtRef.current = capturedAt;
    const didSave = await onSave(quarterAnswerFromDraft("dailySufficiency", capturedAt, doneEnoughTextFromDraft(draft)));
    if (!didSave) return;
    capturedAtRef.current = null;
    setHasSaved(true);
  };

  const canSave = hasUnsavedAnswer(answer, doneEnoughTextFromDraft(draft));
  const saveLabel = saveError ? "Retry saving" : "Save condition";

  return (
    <div className="plan-step-container done-enough-container">
      <div className="done-enough-eyebrow">
        <span className="plan-category-heading">Adaptive module</span>
        <span className="done-enough-optional-badge">Optional</span>
      </div>
      <h2 className="plan-heading done-enough-heading">{ DONE_ENOUGH_STEP_COPY.title }</h2>
      <p className="plan-summary">{ DONE_ENOUGH_STEP_COPY.summary }</p>
      <div className="done-enough-columns">
        <div className="done-enough-choices">
          <DoneEnoughConditions conditionKey={ draft.conditionKey } customConditionText={ draft.customConditionText }
            isDisabled={ isSaving }
            onChangeCustom={ text => changeDraft(previous => ({ ...previous, conditionKey: DONE_ENOUGH_CUSTOM_KEY,
              customConditionText: text })) }
            onSelectCondition={ conditionKey => changeDraft(previous => ({ ...previous, conditionKey })) } />
          <h3 className="done-enough-release-heading">{ RELEASE_HEADING }</h3>
          <div className="done-enough-release-list">
            { RELEASE_CHOICES.map(activity => (
              <button aria-pressed={ draft.releaseKeys.includes(activity.key) } className="done-enough-release-choice"
                disabled={ isSaving } key={ activity.key }
                onClick={ () => changeDraft(previous => ({ ...previous,
                  releaseKeys: toggledReleaseKeysFromSelection(previous.releaseKeys, activity.key) })) }
                type="button">
                { activity.label }
              </button>
            )) }
          </div>
          { draft.releaseKeys.includes(RELEASE_CUSTOM_KEY) ? (
            <input className="done-enough-release-custom-input" disabled={ isSaving }
              onChange={ event => changeDraft(previous => ({ ...previous, customReleaseText: event.target.value })) }
              placeholder={ CUSTOM_RELEASE_PLACEHOLDER } type="text" value={ draft.customReleaseText } />
          ) : null }
        </div>
        <DoneEnoughPreview { ...{ draft } } />
      </div>
      { hasSaved ? <p className="plan-saved">Saved.</p> : null }
      <div className="plan-actions">
        <button className="plan-button plan-button--primary" disabled={ isSaving || !canSave } onClick={ handleSave } type="button">
          { isSaving ? "Saving…" : saveLabel }
        </button>
        <p className="plan-optional">This one is optional — you can move on without choosing a condition.</p>
      </div>
    </div>
  );
}
