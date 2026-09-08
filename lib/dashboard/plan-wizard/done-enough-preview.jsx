// The panel beside the "done enough" conditions, showing how a qualifying day would be described back to the
// user. A condition is an abstraction until its consequence is visible, and the panel is what makes the
// difference between the presets legible without the user having to save one and wait for a day to end.
//
// It says plainly that it is a preview: nothing evaluates a day against the stored condition yet, and the page
// must not imply that something does.

import { doneEnoughPreviewFromDraft } from "dashboard/plan-wizard/done-enough-fields";

// ----------------------------------------------------------------------------------------------
// @desc Render the read-back of the currently selected condition and release activities.
// @param {object} params - An object with the following properties:
//   - {object} draft - Selection as described on doneEnoughDraftFromAnswer.
// @returns {JSX.Element} The preview panel.
export default function DoneEnoughPreview({ draft }) {
  const { detail, release, signals, title } = doneEnoughPreviewFromDraft(draft);

  return (
    <aside aria-label="Preview of a finished day" className="done-enough-preview">
      <svg aria-hidden="true" className="done-enough-scene" viewBox="0 0 400 120">
        <rect className="done-enough-scene-sky" height="120" width="400" x="0" y="0" />
        <circle className="done-enough-scene-sun" cx="338" cy="34" r="13" />
        <path className="done-enough-scene-hill done-enough-scene-hill--far"
          d="M0 90C80 54 160 56 224 76c62 20 126 22 176 10v34H0Z" />
        <path className="done-enough-scene-hill done-enough-scene-hill--near"
          d="M0 120c65-34 152-36 232-22 73 13 126 13 168 6v16H0Z" />
      </svg>
      <h4 className="done-enough-preview-title">{ title }</h4>
      <p className="plan-summary done-enough-preview-detail">{ release ? `${ detail } ${ release }` : detail }</p>
      { signals.length ? (
        <ul className="done-enough-signal-list">
          { signals.map(signal => (
            <li className={ `done-enough-signal done-enough-signal--${ signal.isCredited ? "credited" : "excluded" }` }
              key={ signal.text }>
              { signal.isCredited ? <span aria-hidden="true" className="done-enough-signal-mark">✓</span> : null }
              { signal.text }
            </li>
          )) }
        </ul>
      ) : null }
      <p className="done-enough-preview-note">Wording only — no daily check runs against this condition yet.</p>
    </aside>
  );
}
