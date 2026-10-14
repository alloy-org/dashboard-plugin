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

import { PlainButton } from "dashboard/controls";
import PaceBreakdownPie from "dashboard/plan-wizard/pace-breakdown-pie";
import { memo } from "react";
import { MdCheckCircle, MdDescription, MdRadioButtonUnchecked } from "react-icons/md";

// ----------------------------------------------------------------------------------------------
// @desc Draw the filled check that marks a step the user has stored an answer for.
// @returns {JSX.Element} The check_circle Material icon.
function StepCheckIcon() {
  return <MdCheckCircle className="progress-step-icon" />;
}

// ----------------------------------------------------------------------------------------------
// @desc Draw the hollow ring that marks a step with nothing stored against it yet.
// @returns {JSX.Element} The radio_button_unchecked Material icon.
function StepPendingIcon() {
  return <MdRadioButtonUnchecked className="progress-step-icon progress-step-icon--pending" />;
}

// ----------------------------------------------------------------------------------------------
// @desc Draw the page glyph beside the link out to the quarter's plan note.
// @returns {JSX.Element} The description Material icon.
function PlanNoteIcon() {
  return <MdDescription className="plan-note-icon" />;
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
//   - {string} quarterLabel - The quarter key, such as "2026-Q4", displayed with a space in the note link.
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
                { row.paceSlices ? <PaceBreakdownPie paceSlices={ row.paceSlices } summary={ row.summary } />
                  : row.summary ? <span className="progress-step-summary">{ row.summary }</span> : null }
              </span>
            </>
          );
          return (
            <li className={ rowClassNames.join(" ") } key={ row.key }>
              { row.isComplete && !row.isCurrent ? (
                <PlainButton className="progress-step-button" onClick={ () => onSelectStep(row.key) }>
                  { rowContent }
                </PlainButton>
              ) : (
                <span aria-current={ row.isCurrent ? "step" : undefined } className="progress-step-static">
                  { rowContent }
                </span>
              ) }
            </li>
          );
        }) }
      </ol>
      <PlainButton className="progress-plan-note-link" disabled={ isOpeningPlanNote }
        onClick={ onOpenPlanNote }>
        <PlanNoteIcon />
        <span className="plan-note-text">
          <span className="plan-note-label">{ `Open ${ quarterLabel.replace("-", " ") } Planning Note` }</span>
          { isOpeningPlanNote ? <span className="plan-note-hint">Opening…</span> : null }
        </span>
      </PlainButton>
    </aside>
  );
}

export default memo(WizardProgressSidebar);
