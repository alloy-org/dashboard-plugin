// The "Generate ideas" progress window drawn inside the Dashboard, for a host that cannot open it in a prompt. It reads
// the same view as the prompt's page (idea-run-progress-view), so both say the same thing.
import ConfigPopup from "config-popup";
import { ideaRunProgressView } from "dashboard/idea-run-progress-view";
import "styles/idea-run-progress.scss";

// ----------------------------------------------------------------------------------------------
// @desc Show a run's status line, step circles, time left, and summary in a popup.
// @param {object} props - { onClose, snapshot }: snapshot from IdeaGenerationRun#snapshot.
// @returns {JSX.Element} The popup.
export default function IdeaRunProgressPopup({ onClose, snapshot }) {
  const view = ideaRunProgressView(snapshot);
  return (
    <ConfigPopup onCancel={ onClose } onSubmit={ onClose } submitLabel={ view.finished ? "Done" : "Keep running in background" } title={ view.title }>
      <div className="idea-run-progress">
        <div className="progress-status-line">
          { view.statusParts.map(part => <span className="progress-status-part" key={ part }>{ part }</span>) }
          { view.quotaPercent !== null ? (
            <span className="progress-quota-meter"><span className="progress-quota-fill" style={ { width: `${ view.quotaPercent }%` } } /></span>
          ) : null }
        </div>
        <ol className="progress-step-list">
          { view.steps.map(step => (
            <li className={ `progress-step-item progress-step-item--${ step.state }` } key={ step.number }>
              <span className="progress-step-circle">{ step.state === "done" || step.state === "timedOut" ? "✓" : step.number }</span>
              <span className="progress-step-label">{ step.label }</span>
            </li>
          )) }
        </ol>
        <div className="progress-eta-row">
          { view.finished ? null : <span className="progress-spinner-dot" /> }
          <span className="progress-eta-label">{ view.etaLabel }</span>
        </div>
        { view.summaryLines.length ? (
          <ul className="progress-summary-list">{ view.summaryLines.map(line => <li key={ line }>{ line }</li>) }</ul>
        ) : null }
      </div>
    </ConfigPopup>
  );
}
