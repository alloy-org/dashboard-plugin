// [Claude claude-opus-4-8-authored file]
// Prompt summary: "new dashboard widget showing which notes have been recently updated by
// collaborators, with a checkbox to limit results to notes that have tasks"
import { widgetTitleFromId } from "constants/settings";
import { useEffect, useState } from "react";
import { avatarTextFromName, findCollaboratorUpdatedNotes, lastUpdatedLabelFromMs } from "shared-notes-service";
import "styles/shared-notes.scss";
import { logIfEnabled } from "util/log";
import WidgetWrapper from "widget-wrapper";

const MAX_NOTES_SHORT = 5;
const MAX_NOTES_TALL = 10;
// Cap avatars rendered per note so a heavily-shared note doesn't crowd out the title/timestamp.
const MAX_AVATARS = 4;

// ----------------------------------------------------------------------------------------------
// @desc Render a single collaborator's avatar: the person's avatar image when getPeople supplied
//   one, otherwise a text badge using the person's `avatar.text` or initials derived from the name.
// @param {Object} props - Component props.
// @param {Object} props.collaborator - A { name, avatar } entry from collaboratorsForNote.
// @returns {JSX.Element} An <img> avatar or a text-badge <span>.
// [Claude claude-opus-4-8] Task: show a collaborator's avatar image when present, else initials
// Prompt: "use the details about the person to show their avatar when it is present"
function CollaboratorAvatar({ collaborator }) {
  const { avatar, name } = collaborator;
  if (avatar?.image) {
    return <img className="collaborator-avatar" src={avatar.image} alt={name} title={name} />;
  }
  return (
    <span className="collaborator-avatar collaborator-avatar-text" title={name}>
      {avatar?.text || avatarTextFromName(name)}
    </span>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Shared Notes widget — lists the most recently collaborator-updated notes for the active
//   task domain. Defaults to a 2-wide-by-1-tall cell, showing up to 5 notes (10 when 2 cells
//   tall). A "Has tasks" checkbox toggles whether the "taskLists" filterNotes group is included.
// @param {Object} props - Component props.
// @param {Object} props.app - Amplenote app bridge passed down from the dashboard cell.
// @param {number} props.gridHeightSize - Cell height in grid units; 2 shows more notes.
// @param {string|null} props.taskDomainUUID - Active task domain UUID from the dashboard.
// @returns {JSX.Element} The rendered widget.
// [Claude claude-opus-4-8] Task: render notes recently updated by collaborators with a hasTasks toggle
// Prompt: "show which notes have been recently updated by collaborators... 2 wide by one tall by default"
export default function SharedNotesWidget({ app, gridHeightSize = 1, taskDomainUUID = null }) {
  const [onlyWithTasks, setOnlyWithTasks] = useState(false);
  const [notes, setNotes] = useState(null);
  const maxNotes = gridHeightSize >= 2 ? MAX_NOTES_TALL : MAX_NOTES_SHORT;

  useEffect(() => {
    let isActive = true;
    setNotes(null);
    findCollaboratorUpdatedNotes({ app, maxNotes, onlyWithTasks, taskDomainUUID }).then(results => {
      if (!isActive) return;
      setNotes(results);
      logIfEnabled("[SharedNotes] notes:", results, "onlyWithTasks:", onlyWithTasks);
    });
    return () => {
      isActive = false;
    };
  }, [app, maxNotes, onlyWithTasks, taskDomainUUID]);

  const tasksToggle = (
    <label className="widget-header-action shared-notes-toggle" title="Only show shared notes that have tasks">
      <input
        type="checkbox"
        checked={onlyWithTasks}
        onChange={event => setOnlyWithTasks(event.target.checked)}
      />
      Has tasks
    </label>
  );

  // ----------------------------------------------------------------------------------------------
  // @desc Render the widget body: loading/error/empty states, or the collaborator-updated list.
  // @returns {JSX.Element} Body content for the WidgetWrapper.
  const renderBody = () => {
    if (notes === null) {
      return <p className="note-loading">Loading…</p>;
    }
    if (notes.length === 0) {
      return <p className="note-empty">No notes recently updated by collaborators.</p>;
    }
    const nowMs = Date.now();
    return (
      <ul className="shared-note-list">
        {notes.map(({ collaborators, noteHandle, updatedMs }) => (
          <li key={noteHandle.uuid} className="shared-note-item">
            <button
              className="shared-note-link"
              type="button"
              onClick={() => app.navigate(`https://www.amplenote.com/notes/${ noteHandle.uuid }`)}
              title={`Open "${ noteHandle.name || "Untitled" }"`}
            >
              <span className="shared-note-title">{noteHandle.name || "Untitled"}</span>
              <span className="shared-note-meta">
                {collaborators.length > 0 && (
                  <span className="shared-note-avatars">
                    {collaborators.slice(0, MAX_AVATARS).map((collaborator, index) => (
                      <CollaboratorAvatar key={index} collaborator={collaborator} />
                    ))}
                  </span>
                )}
                <span className="shared-note-collaborators">
                  {collaborators.length > 0
                    ? collaborators.map(collaborator => collaborator.name).join(", ")
                    : "Shared with collaborators"}
                </span>
                <span className="shared-note-updated">{lastUpdatedLabelFromMs(updatedMs, nowMs)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <WidgetWrapper
      headerActions={tasksToggle}
      icon="🤝"
      title={widgetTitleFromId("shared-notes")}
      widgetId="shared-notes"
    >
      {renderBody()}
    </WidgetWrapper>
  );
}
