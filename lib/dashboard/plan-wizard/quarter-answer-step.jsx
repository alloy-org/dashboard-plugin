// The wizard page shape shared by "Name the quarter" and "When have you done enough for today?": one question,
// one text answer that belongs to the whole quarter, and the same save/retry behavior as the intent page. Both
// questions are optional — a user who skips them still has a usable plan — so the page never blocks Next.
//
// The answer is a one-line input: a quarter's name and a daily bar are each a short phrase, and a box sized for
// paragraphs would ask for more than either question wants.

import { answerTextFromRecord, hasUnsavedAnswer, quarterAnswerFromDraft } from "dashboard/plan-wizard/quarter-answer-fields";
import { useEffect, useRef, useState } from "react";

// ----------------------------------------------------------------------------------------------
// @desc Render and save one quarter-wide answer. Draft text is local state seeded from the stored answer and
//   reseeded only when the plan scope changes or a save succeeds, so a background refresh of suggestions cannot
//   discard text the user is in the middle of writing.
// @param {object} params - An object with the following properties:
//   - {object|null} answer - Stored { capturedAt, text } for this question, or null when unanswered.
//   - {string} answerKey - quarterName or dailySufficiency; identifies which answer is being written.
//   - {string} heading - The question, shown as the page heading.
//   - {Array<string>} hints - Short examples that show the kind of answer expected, without proposing one.
//   - {boolean} isSaving - True while a save is in flight.
//   - {Function} onSave - Receives { answerKey, capturedAt, text } and resolves true when the write succeeded.
//   - {string} placeholder - Prompt shown in the empty input.
//   - {Error|null} saveError - Last save failure; its presence turns the action into a retry.
//   - {string} scopeKey - Identifies the domain and quarter; a change reseeds the draft.
//   - {string} summary - One line explaining what the answer is used for.
// @returns {JSX.Element} The page.
export default function QuarterAnswerStep({ answer, answerKey, heading, hints = [], isSaving, onSave, placeholder,
    saveError, scopeKey, summary }) {
  const [draftText, setDraftText] = useState(() => answerTextFromRecord(answer));
  const [hasSaved, setHasSaved] = useState(false);
  const capturedAtRef = useRef(null);
  const seededScopeRef = useRef(scopeKey);

  useEffect(() => {
    if (seededScopeRef.current === scopeKey && !capturedAtRef.current) return;
    seededScopeRef.current = scopeKey;
    capturedAtRef.current = null;
    setDraftText(answerTextFromRecord(answer));
    setHasSaved(false);
  }, [scopeKey]);

  useEffect(() => {
    if (capturedAtRef.current) return;
    setDraftText(answerTextFromRecord(answer));
  }, [answer]);

  // ----------------------------------------------------------------------------------------------
  // @desc Record an edit and stamp the capture time this edit will be saved under.
  // @param {string} text - New text.
  // A retry reuses the stamp, since the merge treats an older or tied timestamp as a no-op.
  const handleChangeText = text => {
    capturedAtRef.current = capturedAtRef.current ?? new Date().toISOString();
    setHasSaved(false);
    setDraftText(text);
  };

  // ----------------------------------------------------------------------------------------------
  // @desc Save the trimmed answer, keeping the draft intact on failure so a retry can reuse its timestamp.
  const handleSave = async () => {
    const capturedAt = capturedAtRef.current ?? new Date().toISOString();
    capturedAtRef.current = capturedAt;
    const didSave = await onSave(quarterAnswerFromDraft(answerKey, capturedAt, draftText));
    if (!didSave) return;
    capturedAtRef.current = null;
    setHasSaved(true);
  };

  const canSave = hasUnsavedAnswer(answer, draftText);
  const saveLabel = saveError ? "Retry saving" : "Save answer";

  return (
    <div className={ `quarter-answer-page quarter-answer-page--${ answerKey }` }>
      <h2 className="quarter-answer-heading">{ heading }</h2>
      <p className="quarter-answer-summary">{ summary }</p>
      <input className="quarter-answer-input" disabled={ isSaving } onChange={ event => handleChangeText(event.target.value) }
        placeholder={ placeholder } type="text" value={ draftText } />
      { hints.length ? (
        <ul className="quarter-answer-hint-list">
          { hints.map(hint => <li className="quarter-answer-hint" key={ hint }>{ hint }</li>) }
        </ul>
      ) : null }
      { saveError ? (
        <p className="quarter-answer-error" role="alert">Your answer was not saved. { saveError.message }</p>
      ) : null }
      { hasSaved ? <p className="quarter-answer-saved">Saved.</p> : null }
      <div className="quarter-answer-actions">
        <button className="quarter-answer-save" disabled={ isSaving || !canSave } onClick={ handleSave } type="button">
          { isSaving ? "Saving…" : saveLabel }
        </button>
        <p className="quarter-answer-optional">This one is optional — you can move on without answering.</p>
      </div>
    </div>
  );
}
