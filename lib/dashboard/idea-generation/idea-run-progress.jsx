// The "Generate ideas" progress window drawn inside the Dashboard, for a host that cannot open it in a prompt. It reads
// the same view as the prompt's page (idea-run-progress-view), so both say the same thing.
import ConfigPopup from "dashboard/config-popup";
import { lineSegments, lineText, ideaRunProgressView } from "dashboard/idea-generation/idea-run-progress-view";
import "dashboard/styles/idea-run-progress.scss";
import { navigateToNote } from "util/goal-notes";

// ----------------------------------------------------------------------------------------------
// @desc Show a run's heading and status line, step circles joined by lines that fill as each step completes, what it
//   has found so far, time left, and summary in a popup.
// @param {object} props - { app, onClose, snapshot }: snapshot from IdeaGenerationRun#snapshot; app opens linked notes.
// @returns {JSX.Element} The popup.
export default function IdeaRunProgressPopup({ app, onClose, snapshot }) {
  const view = ideaRunProgressView(snapshot);
  return (
    <ConfigPopup onCancel={ onClose } onSubmit={ onClose } submitLabel={ view.finished ? "Accept" : "Keep running in background" }>
      <div className="idea-run-progress">
        <div className="progress-header-row">
          <h2 className="progress-heading-text">{ view.heading }</h2>
          <div className="progress-status-line">
            { view.statusParts.map(part => <span className="progress-status-part" key={ part }>{ part }</span>) }
            { view.quotaPercent !== null ? (
              <span className="progress-quota-meter"><span className="progress-quota-fill" style={ { width: `${ view.quotaPercent }%` } } /></span>
            ) : null }
          </div>
        </div>
        <div className="progress-run-title">{ view.title }</div>
        <ol className="progress-step-list">
          { view.steps.map(step => (
            <li className={ `progress-step-item progress-step-item--${ step.state }` } key={ step.number }>
              <span className="progress-step-circle">{ step.state === "done" || step.state === "timedOut" ? "✓" : step.number }</span>
              <span className="progress-step-label">{ step.label }</span>
            </li>
          )) }
        </ol>
        { view.progressLines.length ? (
          <ul className="progress-detail-list">
            { view.progressLines.map(line => <ProgressLine app={ app } className="progress-detail-line" key={ lineText(line) } line={ line } />) }
          </ul>
        ) : null }
        <div className="progress-eta-row">
          { view.finished ? <span className="progress-done-mark">✅</span> : <span className="progress-spinner-dot" /> }
          <span className="progress-eta-label">{ view.etaLabel }</span>
        </div>
        { view.summaryLines.length ? (
          <ul className="progress-summary-list">
            { view.summaryLines.map(line => <ProgressLine app={ app } key={ lineText(line) } line={ line } />) }
          </ul>
        ) : null }
      </div>
    </ConfigPopup>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc One progress or summary line, its segments drawn plain, bold, or as a link that opens a note.
// @param {object} props - { app, className, line }: line from ideaRunProgressLines or ideaRunSummaryLines.
// @returns {JSX.Element} The list item.
function ProgressLine({ app, className, line }) {
  const segments = lineSegments(line);
  return (
    <li className={ className }>
      { segments.map((segment, index) => {
        if (segment.noteUuid) {
          const openNote = event => {
            event.preventDefault();
            navigateToNote(app, segment.noteUuid);
          };
          return <a className="progress-note-link" href="#" key={ index } onClick={ openNote }>{ segment.text }</a>;
        }
        if (segment.strong) return <strong key={ index }>{ segment.text }</strong>;
        return <span key={ index }>{ segment.text }</span>;
      }) }
    </li>
  );
}
