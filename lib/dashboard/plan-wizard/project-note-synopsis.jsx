// The "How it gets done" panel on a project card defined by a note: what the note says the plan is, the latest
// finished task and the next open ones, and how many of its tasks are done. While the note is first read the panel
// shows a placeholder of the same shape; when the note has been moved to trash it says so and offers the ways forward.

import { Button } from "dashboard/controls";
import { MdCheck, MdRefresh } from "react-icons/md";
import { lastUpdatedLabelFromMs } from "shared-notes-service";

// ----------------------------------------------------------------------------------------------
// @desc Render the placeholder shown while a note is read for the first time.
// @param {object} params - An object with the following properties:
//   - {string} noteName - The name of the note being read.
// @returns {JSX.Element} The placeholder panel.
function ReadingPlaceholder({ noteName }) {
  return (
    <div aria-busy="true" className="project-note-synopsis project-note-synopsis--reading">
      <p className="project-note-synopsis-heading">
        <span className="project-note-synopsis-title">How it gets done</span>
        <span className="project-note-synopsis-meta">{ `Reading “${ noteName }”…` }</span>
      </p>
      <span aria-hidden="true" className="project-note-skeleton-line project-note-skeleton-line--long" />
      <span aria-hidden="true" className="project-note-skeleton-line project-note-skeleton-line--medium" />
      { [0, 1].map(index => (
        <span aria-hidden="true" className="project-note-skeleton-task" key={ index }>
          <span className="project-note-skeleton-dot" />
          <span className="project-note-skeleton-line" />
        </span>
      )) }
    </div>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Render the notice shown when the linked note was moved to trash, with the three ways forward.
// @param {object} params - An object with the following properties:
//   - {Function} onNameYourself - Turns the project back into a typed name, keeping the note's last name.
//   - {Function} onPickAnother - Opens the note search to link a different note.
//   - {Function} onRestore - Opens the trashed note in Amplenote, where it can be restored.
// @returns {JSX.Element} The notice panel.
function TrashedNotice({ onNameYourself, onPickAnother, onRestore }) {
  return (
    <div className="project-note-synopsis project-note-synopsis--trashed" role="status">
      <p className="project-note-trashed-message">
        The note that defined this project was moved to trash, so Plan Builder can no longer read how it gets done.
      </p>
      <div className="project-note-trashed-actions">
        <Button className="project-note-restore" dense onClick={ onRestore } variant="outlined">Restore note</Button>
        <Button dense onClick={ onPickAnother } variant="outlined">Pick another note</Button>
        <Button dense onClick={ onNameYourself } variant="outlined">Name it yourself</Button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Render a note-defined project's "How it gets done" panel in whichever state its reading is in.
// @param {object} params - An object with the following properties:
//   - {boolean} isReading - True while a read is in flight.
//   - {string} noteName - The project's name, which is the note's name as last read.
//   - {Function} onNameYourself - Turns the project back into a typed name.
//   - {Function} onPickAnother - Opens the note search.
//   - {Function} onReread - Reads the note again.
//   - {Function} onRestore - Opens the trashed note in Amplenote.
//   - {string} statusEm - Reading status from useProjectNoteSynopsis.
//   - {object|null} synopsis - Reading from readProjectNoteSynopsis.
// @returns {JSX.Element|null} The panel, or null when there is no note to describe.
export default function ProjectNoteSynopsis({ isReading, noteName, onNameYourself, onPickAnother, onReread, onRestore,
    statusEm, synopsis }) {
  if (statusEm === "idle") return null;
  if (statusEm === "reading") return <ReadingPlaceholder noteName={ noteName } />;
  if (statusEm === "trashed") return <TrashedNotice { ...{ onNameYourself, onPickAnother, onRestore } } />;
  const readLabel = synopsis ? `read ${ lastUpdatedLabelFromMs(new Date(synopsis.readAt).getTime(), Date.now()) }` : "";
  let openTaskNumber = 0;
  return (
    <div className="project-note-synopsis">
      <p className="project-note-synopsis-heading">
        <span className="project-note-synopsis-title">How it gets done</span>
        <span className="project-note-synopsis-meta">
          { statusEm === "failed" ? "The note could not be read" : `From the note · ${ readLabel }` }
        </span>
        <Button className="project-note-reread" dense disabled={ isReading } Icon={ MdRefresh } iconSize={ 16 }
          onClick={ onReread }>
          { isReading ? "Reading…" : "Re-read" }
        </Button>
      </p>
      { synopsis?.synopsisText ? <p className="project-note-synopsis-text">{ synopsis.synopsisText }</p> : null }
      { synopsis?.listedTasks.length ? (
        <ol className="project-note-task-list">
          { synopsis.listedTasks.map(task => {
            if (!task.isDone) openTaskNumber += 1;
            return (
              <li className={ `project-note-task${ task.isDone ? " project-note-task--done" : "" }` } key={ task.uuid }>
                <span aria-label={ task.isDone ? "Done" : `Next ${ openTaskNumber }` } className="project-note-task-marker">
                  { task.isDone ? <MdCheck size={ 12 } /> : openTaskNumber }
                </span>
                <span className="project-note-task-text">{ task.text }</span>
                { task.dueLabel ? <span className="project-note-task-due">{ task.dueLabel }</span> : null }
              </li>
            );
          }) }
        </ol>
      ) : null }
      { synopsis ? (
        <p className="project-note-task-count">
          { synopsis.taskCount ? `${ synopsis.taskCount } task${ synopsis.taskCount === 1 ? "" : "s" } in the note · ${ synopsis.doneCount } done`
            : "No tasks in the note yet" }
        </p>
      ) : null }
    </div>
  );
}
