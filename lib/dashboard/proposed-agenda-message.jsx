// Show agenda failures with a retry action and access to the source note when its content cannot be read.
import { noteUrlFromUUID } from "app-util";
import { Button, ErrorState } from "dashboard/controls";
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

  // The retry keeps its own class (tests and callers find it by `.proposed-agenda-retry`), so it is passed as an action
  // rather than through ErrorState's onRetry.
  const sourceAndRetryActions = (
    <>
      { noteUuid ? <Button href={ noteUrlFromUUID(noteUuid) } onClick={ openSourceNote }>View source note</Button> : null }
      <Button className="proposed-agenda-retry" onClick={ onRetry } variant="outlined">Try again</Button>
    </>
  );

  return (
    <WidgetWrapper widgetId="proposed-agenda">
      { dateControl }
      { inspectingNote ? <NoteEditor app={ app } noteUUID={ noteUuid } onBack={ () => setInspectingNote(false) } />
        : <ErrorState action={ sourceAndRetryActions } className="proposed-agenda-message" title={ null }>{ message }</ErrorState> }
    </WidgetWrapper>
  );
}
