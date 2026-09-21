// The rail beside the wizard's questions, listing every step with what the user has stored against it and
// letting them jump back to any step they have already answered.
//
// It appears only once the plan's four required steps are behind the user. Where the dialog is too narrow to
// hold it beside the question, the same list is rendered inside wizard-progress-bar.jsx's drop-down panel
// instead, so the rail never competes with the question for room. Both conditions are decided outside this
// component: the shell supplies the rows and whether the core is complete, and plan-wizard.scss picks between
// the rail and the bar at the dialog's width threshold through a container query.
//
// Rows for steps the user has not yet reached are rendered as plain text rather than as buttons. Jumping
// forward past an unanswered step would land them on a page whose inputs depend on answers that do not exist
// yet, so the rail only offers the moves that lead somewhere usable.

import { memo } from "react";

// ----------------------------------------------------------------------------------------------
// @desc Draw the filled check that marks a step the user has stored an answer for.
// @returns {JSX.Element} An inline check icon.
function StepCheckIcon() {
  return (
    <svg aria-hidden="true" className="progress-step-icon" viewBox="0 0 24 24">
      <circle className="progress-step-icon-disc" cx="12" cy="12" r="11" />
      <path className="progress-step-icon-check" d="M7 12.5l3.2 3.2L17 9" />
    </svg>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Draw the hollow ring that marks a step with nothing stored against it yet.
// @returns {JSX.Element} An inline ring icon.
function StepPendingIcon() {
  return (
    <svg aria-hidden="true" className="progress-step-icon progress-step-icon--pending" viewBox="0 0 24 24">
      <circle className="progress-step-icon-ring" cx="12" cy="12" r="11" />
    </svg>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Draw the page glyph beside the link out to the quarter's plan note.
// @returns {JSX.Element} An inline document icon.
function PlanNoteIcon() {
  return (
    <svg aria-hidden="true" className="plan-note-icon" viewBox="0 0 24 24">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Render the wizard's progress rail: a heading, one row per step, and a link to the quarter's plan note.
// @param {object} params - An object with the following properties:
//   - {string} headingText - The rail's heading. It names the list's purpose where the list is the whole point of
//     what the user just opened, so the narrow bar's panel overrides the rail's standing title.
//   - {boolean} isOpeningPlanNote - True while the plan note is being published and opened, which labels the
//     link as busy and prevents a second request.
//   - {Function} onOpenPlanNote - Publishes the plan and hands the user off to the note in Amplenote.
//   - {Function} onSelectStep - Receives the key of a completed step the user asked to return to.
//   - {Array<object>} progressRows - Rows from progressRowsFromContext.
//   - {string} quarterLabel - The quarter being planned, as "Q4 2026", naming the note the link opens.
// @returns {JSX.Element} The progress sidebar.
function WizardProgressSidebar({ headingText = "Quarterly plan", isOpeningPlanNote, onOpenPlanNote, onSelectStep,
    progressRows, quarterLabel }) {
  return (
    <aside aria-label="Quarterly plan progress" className="plan-wizard-progress-sidebar">
      <h2 className="progress-sidebar-heading">{ headingText }</h2>
      <ol className="progress-step-list">
        { progressRows.map(row => {
          const rowClassNames = ["progress-step-row"];
          if (row.isCurrent) rowClassNames.push("progress-step-row--current");
          if (row.isComplete) rowClassNames.push("progress-step-row--complete");
          const rowContent = (
            <>
              { row.isComplete ? <StepCheckIcon /> : <StepPendingIcon /> }
              <span className="progress-step-text">
                <span className="progress-step-label">{ row.label }</span>
                { row.summary ? <span className="progress-step-summary">{ row.summary }</span> : null }
              </span>
            </>
          );
          return (
            <li className={ rowClassNames.join(" ") } key={ row.key }>
              { row.isComplete && !row.isCurrent ? (
                <button className="progress-step-button" onClick={ () => onSelectStep(row.key) } type="button">
                  { rowContent }
                </button>
              ) : (
                <span aria-current={ row.isCurrent ? "step" : undefined } className="progress-step-static">
                  { rowContent }
                </span>
              ) }
            </li>
          );
        }) }
      </ol>
      <button className="progress-plan-note-link" disabled={ isOpeningPlanNote } onClick={ onOpenPlanNote }
        type="button">
        <PlanNoteIcon />
        <span className="plan-note-text">
          <span className="plan-note-label">{ `${ quarterLabel } Plan note` }</span>
          <span className="plan-note-hint">{ isOpeningPlanNote ? "Opening…" : "Opens in Amplenote" }</span>
        </span>
      </button>
    </aside>
  );
}

export default memo(WizardProgressSidebar);
