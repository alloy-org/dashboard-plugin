// The collapsible step bar shown above the wizard's questions where the dialog is too narrow to hold the progress
// rail beside them. Collapsed it reports position — the step dots, "Step 2 of 5", and the current step's name —
// and expanded it drops open the same step list the rail shows, so a narrow dialog can still jump between steps.
//
// It renders the rail's own rows rather than a list of its own: both presentations answer "where am I and what
// have I stored", and building that twice is how the two drift apart. Which of the two is shown is decided in
// plan-wizard.scss by one container query, so exactly one is visible at any width and neither is ever mounted
// without the other being hidden.
//
// The panel closes when a step is chosen. Jumping is the only reason it opens, so leaving it open over the page
// the user just asked for would cover the answer they came to give.

import WizardProgressSidebar from "dashboard/plan-wizard/wizard-progress-sidebar";
import { useEffect, useRef, useState } from "react";

// ----------------------------------------------------------------------------------------------
// @desc Draw the chevron that turns to point up while the step panel is open.
// @returns {JSX.Element} An inline chevron icon.
function DisclosureChevronIcon() {
  return (
    <svg aria-hidden="true" className="progress-bar-chevron" viewBox="0 0 24 24">
      <path d="M6 9.5l6 6 6-6" />
    </svg>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Render the narrow-width step bar: a summary row that toggles a panel holding the full step list.
// @param {object} params - An object with the following properties:
//   - {boolean} isOpeningPlanNote - True while the plan note is being published and opened.
//   - {Function} onOpenPlanNote - Publishes the plan and hands the user off to the note in Amplenote.
//   - {Function} onSelectStep - Receives the key of a completed step the user asked to return to.
//   - {Array<object>} progressRows - Rows from progressRowsFromContext.
//   - {string} quarterLabel - The quarter being planned, as "Q4 2026", naming the note the link opens.
//   - {number} stepCount - How many steps the wizard has, for the "of 5" half of the position.
//   - {number} stepNumber - The current step's 1-based position.
//   - {string} stepTitle - The current step's short name, shown beside its position.
// @returns {JSX.Element} The collapsible step bar.
export default function WizardProgressBar({ isOpeningPlanNote, onOpenPlanNote, onSelectStep, progressRows,
    quarterLabel, stepCount, stepNumber, stepTitle }) {
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const panelIdRef = useRef(`wizard-progress-panel-${ Math.random().toString(36).slice(2, 10) }`);

  // A step change the user made from the panel, from Back or Next, or from a page's own jump all mean the panel
  // has served its purpose, so it closes on any of them rather than only on the one it caused itself.
  useEffect(() => {
    setIsPanelOpen(false);
  }, [stepNumber]);

  // ----------------------------------------------------------------------------------------------
  // @desc Move to a step and close the panel covering the page that step renders.
  // @param {string} targetStepKey - Key of the step the user chose.
  const handleSelectStep = targetStepKey => {
    setIsPanelOpen(false);
    onSelectStep(targetStepKey);
  };

  return (
    <div className={ `plan-wizard-progress-bar${ isPanelOpen ? " plan-wizard-progress-bar--open" : "" }` }>
      <button aria-controls={ panelIdRef.current } aria-expanded={ isPanelOpen } className="progress-bar-summary"
        onClick={ () => setIsPanelOpen(previous => !previous) } type="button">
        <span aria-hidden="true" className="progress-bar-track">
          { progressRows.map(row => (
            <span className={ `progress-bar-dot${ row.isCurrent ? " progress-bar-dot--current" : "" }` }
              key={ row.key } />
          )) }
        </span>
        <span className="progress-bar-position">{ `Step ${ stepNumber } of ${ stepCount }` }</span>
        <span className="progress-bar-step-title">{ stepTitle }</span>
        <span className="progress-bar-disclosure">{ isPanelOpen ? "Done" : "All steps" }</span>
        <DisclosureChevronIcon />
      </button>
      { isPanelOpen ? (
        <div className="progress-bar-panel" id={ panelIdRef.current }>
          <WizardProgressSidebar { ...{ isOpeningPlanNote, progressRows, quarterLabel } }
            headingText="Jump to any step" onOpenPlanNote={ onOpenPlanNote } onSelectStep={ handleSelectStep } />
        </div>
      ) : null }
    </div>
  );
}
