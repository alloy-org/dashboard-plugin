// Show agenda failures with a retry action and access to the source note when its content cannot be read.
import { noteUrlFromUUID } from "app-util";
import NoteEditor from "note-editor";
import { useState } from "react";
import { navigateToNote } from "util/goal-notes";
import WidgetWrapper from "widget-wrapper";

// ----------------------------------------------------------------------------------------------
// @desc Show the agenda error and open its source in Amplenote or the existing development note editor.
// @param {object} props - App, date control, error message, optional source note UUID, and retry callback.
// @returns {JSX.Element} Agenda error state or source note editor.
export default function ProposedAgendaMessage({ app, dateControl, message, noteUuid = null, onRetry }) {
  const [inspectingNote, setInspectingNote] = useState(false);

  // ----------------------------------------------------------------------------------------------
  // @desc Open the source note without leaving the dashboard in development mode.
  // @param {object} event - Source link click.
  const openSourceNote = async event => {
    event.preventDefault();
    const result = await navigateToNote(app, noteUuid);
    if (result?.devEdit) setInspectingNote(true);
  };

  return (
    <WidgetWrapper widgetId="proposed-agenda">
      { dateControl }
      { inspectingNote ? <NoteEditor app={ app } noteUUID={ noteUuid } onBack={ () => setInspectingNote(false) } />
        : <div className="proposed-agenda-message" role="alert">
            <p>{ message }</p>
            { noteUuid ? <a href={ noteUrlFromUUID(noteUuid) } onClick={ openSourceNote }>View source note</a> : null }
            <button className="proposed-agenda-retry" onClick={ onRetry }>Try again</button>
          </div> }
    </WidgetWrapper>
  );
}
