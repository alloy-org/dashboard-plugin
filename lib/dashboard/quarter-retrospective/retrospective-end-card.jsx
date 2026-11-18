// The controls on a Quarter Retrospective's end card, its last slide: save the quarter's takeaways in a note, replay
// the story, or go back to the options screen to generate another. Writing the takeaways asks the AI and can take a
// minute, so the save button says so while it runs, and a failure is reported beside it with the story left in place.
import { useState } from "react";
import { logIfEnabled } from "util/log";

export const TAKEAWAYS_SAVE_STATES = Object.freeze({ failed: "failed", idle: "idle", saving: "saving" });

// ----------------------------------------------------------------------------------------------
// @desc The end card's controls.
// @param {object} props - An object with the following properties:
//   - {Function} onGenerateNew - Goes back to the options screen
//   - {Function} onReplay - Starts the story over
//   - {Function} onSaveTakeaways - async () => void; writes the takeaways note, or finds the one already written, and
//     opens it
//   - {boolean} [takeawaysSaved=false] - Whether the quarter's takeaways note is known to exist, which offers to open it
//   - {JSX.Element|null} [children] - More controls, shown below the others
// @returns {JSX.Element} The controls.
export default function RetrospectiveEndCard({ children = null, onGenerateNew, onReplay, onSaveTakeaways, takeawaysSaved = false }) {
  const [saveState, setSaveState] = useState(TAKEAWAYS_SAVE_STATES.idle);
  const saving = saveState === TAKEAWAYS_SAVE_STATES.saving;

  // @desc Save or open the takeaways note, reporting a failure rather than leaving the button spinning.
  const handleSave = async () => {
    setSaveState(TAKEAWAYS_SAVE_STATES.saving);
    try {
      await onSaveTakeaways();
      setSaveState(TAKEAWAYS_SAVE_STATES.idle);
    } catch (error) {
      logIfEnabled("[retrospective-end-card] could not save the takeaways", error?.message);
      setSaveState(TAKEAWAYS_SAVE_STATES.failed);
    }
  };
  let saveLabel = takeawaysSaved ? "Open takeaways note" : "Save takeaways in a note";
  if (saving) saveLabel = takeawaysSaved ? "Opening…" : "Writing your takeaways…";

  return (
    <div className="retrospective-end-card">
      <button aria-busy={ saving } className="retrospective-options-primary" disabled={ saving } onClick={ handleSave } type="button">
        { saveLabel }
      </button>
      { saving && !takeawaysSaved ? <p className="retrospective-end-card-hint">This takes about a minute.</p> : null }
      { saveState === TAKEAWAYS_SAVE_STATES.failed ? (
        <p className="retrospective-end-card-error" role="alert">Couldn't save the takeaways. Try again.</p>
      ) : null }
      <div className="retrospective-end-card-options">
        <button className="retrospective-end-card-option" disabled={ saving } onClick={ onReplay } type="button">↺ Replay retrospective</button>
        <button className="retrospective-end-card-option" disabled={ saving } onClick={ onGenerateNew } type="button">Generate new</button>
      </div>
      { children }
    </div>
  );
}
