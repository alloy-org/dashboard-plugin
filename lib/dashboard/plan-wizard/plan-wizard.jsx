// Shell for the quarterly plan wizard: names the quarter being planned, loads its stored state through
// usePlanWizard, and routes to the current step. Closing and reopening resumes from what was persisted, so a
// user who leaves mid-answer loses nothing.

import IntentStep from "dashboard/plan-wizard/intent-step";
import usePlanWizard, { planScopeKey } from "hooks/use-plan-wizard";

export const WIZARD_STEPS = ["intent"];

// ----------------------------------------------------------------------------------------------
// @desc Render the wizard for one domain and quarter.
// @param {object} params - An object with the following properties:
//   - {object} app - Amplenote embed app proxy.
//   - {string|null} domainName - Selected task domain's display name; null plans All Notes.
//   - {string|null} domainUuid - Selected task domain's UUID; null plans All Notes.
//   - {Function} onClose - Dismisses the wizard and returns to the planning widget.
//   - {number} quarter - Quarter being planned, 1 through 4.
//   - {number} year - Planning year.
// @returns {JSX.Element} The wizard.
export default function PlanWizard({ app, domainName = null, domainUuid = null, onClose, quarter, year }) {
  const { error, isLoading, isRefreshing, isSaving, planningContext, reload, saveError,
    saveGoals } = usePlanWizard({ app, domainName, domainUuid, quarter, year });
  const scopeKey = planScopeKey({ domainName, domainUuid, quarter, year });
  const quarterLabel = planningContext.scope ? planningContext.scope.quarterKey : `${ year }-Q${ quarter }`;
  const domainLabel = domainName ?? "All Notes";

  return (
    <div className="plan-wizard-page">
      <header className="plan-wizard-header">
        <div className="plan-wizard-title-group">
          <h1 className="plan-wizard-title">Plan your quarter</h1>
          <p className="plan-wizard-scope">{ `${ quarterLabel } · ${ domainLabel }` }</p>
        </div>
        <button className="plan-wizard-close" onClick={ onClose } type="button">Close</button>
      </header>
      { isLoading ? <p className="plan-wizard-status">Loading your plan…</p> : null }
      { error && !isLoading ? (
        <div className="plan-wizard-error" role="alert">
          <p className="plan-wizard-error-message">Your plan could not be loaded. { error.message }</p>
          <button className="plan-wizard-retry" onClick={ reload } type="button">Try again</button>
        </div>
      ) : null }
      { !isLoading && !error ? (
        <IntentStep isRefreshing={ isRefreshing } isSaving={ isSaving } onSave={ saveGoals }
          planningContext={ planningContext } saveError={ saveError } scopeKey={ scopeKey } />
      ) : null }
    </div>
  );
}
