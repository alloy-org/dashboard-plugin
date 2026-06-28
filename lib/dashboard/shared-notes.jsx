// [Claude claude-opus-4-8-authored file]
// Prompt summary: "new dashboard widget showing which notes have been recently updated by
// collaborators, with a checkbox to limit results to notes that have tasks"
import { widgetTitleFromId } from "constants/settings";
import { useEffect, useState } from "react";
import { avatarTextFromName, findCollaboratorUpdatedNotes, lastUpdatedLabelFromMs } from "shared-notes-service";
import "styles/shared-notes.scss";
import { logIfEnabled } from "util/log";
import WidgetWrapper from "widget-wrapper";

const ALL_SHARERS = "";
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
  const [sharerNames, setSharerNames] = useState([]);
  const [selectedSharer, setSelectedSharer] = useState(ALL_SHARERS);
  const [page, setPage] = useState(0);
  const pageSize = gridHeightSize >= 2 ? MAX_NOTES_TALL : MAX_NOTES_SHORT;

  useEffect(() => {
    let isActive = true;
    setNotes(null);
    // Fetch the full collaborator-updated list (capped at MAX_SCAN); paging happens client-side.
    findCollaboratorUpdatedNotes({ app, onlyWithTasks, taskDomainUUID })
      .then(({ notes: results, sharerNames: names }) => {
        if (!isActive) return;
        setNotes(results);
        setSharerNames(names);
        logIfEnabled("[SharedNotes] notes:", results, "onlyWithTasks:", onlyWithTasks);
      });
    return () => {
      isActive = false;
    };
  }, [app, onlyWithTasks, taskDomainUUID]);

  // Notes after applying the person filter; selecting "Filter on user..." shows everyone's notes.
  const filteredNotes = notes === null ? null : selectedSharer === ALL_SHARERS
    ? notes
    : notes.filter(({ collaborators }) => collaborators.some(collaborator => collaborator.name === selectedSharer));

  const totalPages = filteredNotes === null ? 1 : Math.max(1, Math.ceil(filteredNotes.length / pageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const visibleNotes = filteredNotes === null ? null
    : filteredNotes.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  // Reset to the first page whenever the filter or note set changes so we never land past the end.
  useEffect(() => {
    setPage(0);
  }, [selectedSharer, onlyWithTasks, taskDomainUUID]);

  // The person filter only appears once two or more people have shared notes — with a single sharer
  // there is nothing to filter on. When it is shown, the "Has tasks" toggle moves onto its row
  // (right-aligned) instead of living in the widget header.
  const showSharerFilter = sharerNames.length >= 2;

  // ----------------------------------------------------------------------------------------------
  // @desc The "Has tasks" checkbox toggling the "taskLists" filterNotes group.
  // @param {boolean} inHeader - When true, applies the header-action spacing class for the widget
  //   header; when false, it is laid out inline within the sharer-filter row.
  // @returns {JSX.Element} The checkbox label.
  // [Claude claude-opus-4-8] Task: render the has-tasks toggle in either the header or the filter row
  // Prompt: "When we show the user filter, show the 'Has tasks' checkbox on the right side of the same line"
  const tasksToggle = (inHeader) => (
    <label
      className={`shared-notes-toggle${ inHeader ? " widget-header-action" : "" }`}
      title="Only show shared notes that have tasks"
    >
      <input
        type="checkbox"
        checked={onlyWithTasks}
        onChange={event => setOnlyWithTasks(event.target.checked)}
      />
      Has tasks
    </label>
  );

  // ----------------------------------------------------------------------------------------------
  // @desc First-line person filter, shown only when 2+ people have shared notes. An alphabetical
  //   select of every sharer (choosing one narrows the list to that person's notes; the default
  //   "Filter on user..." shows everyone), with the "Has tasks" toggle right-aligned on the same row.
  // @returns {JSX.Element|null} The filter row, or null when fewer than two sharers exist.
  // [Claude claude-opus-4-8] Task: gate the per-person filter on 2+ sharers and host the tasks toggle
  // Prompt: "Only show the user filter when there are 2 or more users... show the 'Has tasks' checkbox
  //   on the right side of the same line as the select"
  const sharerFilter = !showSharerFilter ? null : (
    <div className="shared-notes-filter">
      <select
        className="shared-notes-sharer-select"
        value={selectedSharer}
        onChange={event => setSelectedSharer(event.target.value)}
      >
        <option value={ALL_SHARERS}>Filter on user...</option>
        { sharerNames.map(name => (<option key={name} value={name}>{name}</option>)) }
      </select>
      {tasksToggle(false)}
    </div>
  );

  // ----------------------------------------------------------------------------------------------
  // @desc Pagination controls shown only when the filtered list spans more than one page.
  // @returns {JSX.Element|null} Prev/indicator/next controls, or null for a single page.
  // [Claude claude-opus-4-8] Task: add pagination controls to the Shared Notes module
  // Prompt: "Add pagination controls to the Shared Notes module"
  const renderPagination = () => {
    if (totalPages <= 1) return null;
    return (
      <div className="shared-notes-pagination">
        <button
          className="shared-notes-page-arrow"
          type="button"
          onClick={() => setPage(p => Math.max(0, p - 1))}
          disabled={currentPage === 0}
        >{'◀'}</button>
        <span className="shared-notes-page-indicator">{`${ currentPage + 1 } / ${ totalPages }`}</span>
        <button
          className="shared-notes-page-arrow"
          type="button"
          onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
          disabled={currentPage >= totalPages - 1}
        >{'▶'}</button>
      </div>
    );
  };

  // ----------------------------------------------------------------------------------------------
  // @desc Render the widget body: loading/error/empty states, or the collaborator-updated list.
  // @returns {JSX.Element} Body content for the WidgetWrapper.
  const renderBody = () => {
    if (visibleNotes === null) {
      return <>{sharerFilter}<p className="note-loading">Loading…</p></>;
    }
    if (visibleNotes.length === 0) {
      return <>{sharerFilter}<p className="note-empty">No notes recently updated by collaborators.</p></>;
    }
    const nowMs = Date.now();
    return (
      <>
      {sharerFilter}
      <ul className="shared-note-list">
        {visibleNotes.map(({ collaborators, noteHandle, updatedMs }) => (
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
                <span
                  className="shared-note-updated"
                  title="Last time a collaborator updated this note"
                >{lastUpdatedLabelFromMs(updatedMs, nowMs)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {renderPagination()}
      </>
    );
  };

  return (
    <WidgetWrapper
      headerActions={showSharerFilter ? null : tasksToggle(true)}
      icon="🤝"
      title={widgetTitleFromId("shared-notes")}
      widgetId="shared-notes"
    >
      {renderBody()}
    </WidgetWrapper>
  );
}
