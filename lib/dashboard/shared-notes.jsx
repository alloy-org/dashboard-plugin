// [Claude claude-opus-4-8-authored file]
// Prompt summary: "new dashboard widget showing which notes have been recently updated by
// collaborators, with a checkbox to limit results to notes that have tasks"
import { widgetTitleFromId } from "constants/settings";
import { useCallback, useEffect, useState } from "react";
import { loadPinnedNoteUuids, storePinnedNoteUuids } from "shared-notes-archive";
import { avatarTextFromName, findCollaboratorUpdatedNotes, lastUpdatedLabelFromMs,
  orderNotesPinnedFirst } from "shared-notes-service";
import "styles/shared-notes.scss";
import { logIfEnabled } from "util/log";
import WidgetWrapper from "widget-wrapper";

const ALL_SHARERS = "";
const MAX_NOTES_SHORT = 5;
const MAX_NOTES_TALL = 10;
// Cap avatars rendered per note so a heavily-shared note doesn't crowd out the title/timestamp.
const MAX_AVATARS = 4;
// Pagination is bounded to at most this many pages of recently-updated shared notes.
const MAX_PAGES = 5;

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
// @desc Hook: fetch the collaborator-updated shared notes (and sharer names) for the current filter,
//   re-querying whenever app/onlyWithTasks/taskDomainUUID change and ignoring stale resolutions.
// @param {Object} params - { app, onlyWithTasks, taskDomainUUID }.
// @returns {{notes: Array<Object>|null, sharerNames: Array<string>}} `notes` is null while loading.
// [Claude claude-opus-4-8 (1M context)] Task: extract the note-fetching effect into a hook
// Prompt: "Create local functions that split out modular functionality... focused on initializing state"
function useCollaboratorUpdatedNotes({ app, onlyWithTasks, taskDomainUUID }) {
  const [notes, setNotes] = useState(null);
  const [sharerNames, setSharerNames] = useState([]);
  useEffect(() => {
    let isActive = true;
    setNotes(null);
    // Fetch the full collaborator-updated list (capped at MAX_SCAN); paging happens client-side.
    findCollaboratorUpdatedNotes({ app, onlyWithTasks, taskDomainUUID }).then(({ notes: results, sharerNames: names }) => {
      if (!isActive) return;
      setNotes(results);
      setSharerNames(names);
      logIfEnabled("[SharedNotes] notes:", results, "onlyWithTasks:", onlyWithTasks);
    });
    return () => { isActive = false; };
  }, [app, onlyWithTasks, taskDomainUUID]);
  return { notes, sharerNames };
}

// ----------------------------------------------------------------------------------------------
// @desc Hook: manage the set of pinned note UUIDs, seeding it from the archived pins note and
//   persisting every toggle. Toggling is optimistic — local state flips first, a failed write logs.
// @param {Object} app - Amplenote app bridge.
// @returns {{pinnedUuids: Set<string>, togglePin: Function}} Current pins and a `togglePin(uuid)`.
// [Claude claude-opus-4-8 (1M context)] Task: extract pin load + persist into a hook
// Prompt: "click the pin to persist that note atop the paginated list of shared notes"
function usePinnedNotes(app) {
  const [pinnedUuids, setPinnedUuids] = useState(() => new Set());
  useEffect(() => {
    let isActive = true;
    loadPinnedNoteUuids(app).then(uuids => { if (isActive) setPinnedUuids(new Set(uuids)); });
    return () => { isActive = false; };
  }, [app]);
  const togglePin = useCallback(uuid => {
    setPinnedUuids(prev => {
      const next = new Set(prev);
      if (next.has(uuid)) { next.delete(uuid); } else { next.add(uuid); }
      storePinnedNoteUuids(app, [...next]).catch(err => logIfEnabled("[SharedNotes] persist pins failed:", err));
      return next;
    });
  }, [app]);
  return { pinnedUuids, togglePin };
}

// ----------------------------------------------------------------------------------------------
// @desc Apply the person filter, float pinned notes to the top, then slice out the current page —
//   returning null `visibleNotes` while notes are still loading. Pure (no hooks/state).
// @param {Object} params - { notes, page, pageSize, pinnedUuids, selectedSharer }.
// @returns {{currentPage: number, totalPages: number, visibleNotes: Array<Object>|null}}
// [Claude claude-opus-4-8 (1M context)] Task: extract filter/pin-order/pagination math into a helper
// Prompt: "Create local functions that split out modular functionality... focused on initializing state"
function paginateSharedNotes({ notes, page, pageSize, pinnedUuids, selectedSharer }) {
  const filtered = notes === null ? null : selectedSharer === ALL_SHARERS ? notes
    : notes.filter(({ collaborators }) => collaborators.some(collaborator => collaborator.name === selectedSharer));
  const ordered = filtered === null ? null : orderNotesPinnedFirst(filtered, pinnedUuids);
  const totalPages = ordered === null ? 1 : Math.min(MAX_PAGES, Math.max(1, Math.ceil(ordered.length / pageSize)));
  const currentPage = Math.min(page, totalPages - 1);
  const visibleNotes = ordered === null ? null : ordered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  return { currentPage, totalPages, visibleNotes };
}

// ----------------------------------------------------------------------------------------------
// @desc The "Has tasks" checkbox toggling the "taskLists" filterNotes group.
// @param {Object} props - { inHeader, onChange, onlyWithTasks }. `inHeader` applies header-action
//   spacing (for the widget header) instead of the inline filter-row layout.
// @returns {JSX.Element} The checkbox label.
// [Claude claude-opus-4-8] Task: render the has-tasks toggle in either the header or the filter row
// Prompt: "When we show the user filter, show the 'Has tasks' checkbox on the right side of the same line"
function TasksToggle({ inHeader, onChange, onlyWithTasks }) {
  return (
    <label
      className={`shared-notes-toggle${ inHeader ? " widget-header-action" : "" }`}
      title="Only show shared notes that have tasks"
    >
      <input type="checkbox" checked={onlyWithTasks} onChange={event => onChange(event.target.checked)} />
      Has tasks
    </label>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc First-line person filter: an alphabetical select of every sharer (choosing one narrows the
//   list to that person's notes; the default "Filter on user..." shows everyone), with the "Has
//   tasks" toggle right-aligned on the same row. Only rendered by the parent when 2+ sharers exist.
// @param {Object} props - { onSelectSharer, selectedSharer, sharerNames, tasksToggle }. `tasksToggle`
//   is a render fn taking `inHeader` so the toggle lives inline (false) on this row.
// @returns {JSX.Element} The filter row.
// [Claude claude-opus-4-8] Task: person-filter select hosting the tasks toggle
// Prompt: "show the 'Has tasks' checkbox on the right side of the same line as the select"
function SharerFilter({ onSelectSharer, selectedSharer, sharerNames, tasksToggle }) {
  return (
    <div className="shared-notes-filter">
      <select
        className="shared-notes-sharer-select"
        value={selectedSharer}
        onChange={event => onSelectSharer(event.target.value)}
      >
        <option value={ALL_SHARERS}>All collaborators</option>
        { sharerNames.map(name => (<option key={name} value={name}>{name}</option>)) }
      </select>
      {tasksToggle(false)}
    </div>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Pagination controls shown only when the list spans more than one page.
// @param {Object} props - { currentPage, onPageChange, totalPages }. `onPageChange` receives an
//   updater fn (setPage-compatible).
// @returns {JSX.Element|null} Prev/indicator/next controls, or null for a single page.
// [Claude claude-opus-4-8] Task: pagination controls for the Shared Notes module
// Prompt: "Add pagination controls to the Shared Notes module"
function SharedNotesPagination({ currentPage, onPageChange, totalPages }) {
  if (totalPages <= 1) return null;
  return (
    <div className="shared-notes-pagination">
      <button
        className="shared-notes-page-arrow"
        type="button"
        onClick={() => onPageChange(p => Math.max(0, p - 1))}
        disabled={currentPage === 0}
      >{'◀'}</button>
      <span className="shared-notes-page-indicator">{`${ currentPage + 1 } / ${ totalPages }`}</span>
      <button
        className="shared-notes-page-arrow"
        type="button"
        onClick={() => onPageChange(p => Math.min(totalPages - 1, p + 1))}
        disabled={currentPage >= totalPages - 1}
      >{'▶'}</button>
    </div>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc A single shared-note row: a left-edge pin toggle plus a link opening the note, whose meta
//   line carries collaborator avatars/names and the two datestamps (opened by you, updated by them).
// @param {Object} props - { isPinned, note, nowMs, onNavigate, onTogglePin }. `note` is an
//   { activeMs, collaborators, noteHandle, updatedMs } entry; `onNavigate` receives a note UUID.
// @returns {JSX.Element} The <li> row.
// [Claude claude-opus-4-8 (1M context)] Task: extract one shared-note row into its own component
// Prompt: "Create local functions that split out modular functionality"
function SharedNoteRow({ isPinned, note, nowMs, onNavigate, onTogglePin }) {
  const { activeMs, collaborators, noteHandle, updatedMs } = note;
  return (
    <li className="shared-note-item">
      <button
        className={`shared-note-pin${ isPinned ? " shared-note-pin-active" : "" }`}
        type="button"
        onClick={() => onTogglePin(noteHandle.uuid)}
        title={isPinned ? "Unpin this note" : "Pin this note to the top"}
        aria-pressed={isPinned}
      >📌</button>
      <button
        className="shared-note-link"
        type="button"
        onClick={() => onNavigate(noteHandle.uuid)}
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
          <span className="shared-note-dates">
            <span
              className="shared-note-opened"
              title="When you last opened this note"
            >Opened {lastUpdatedLabelFromMs(activeMs, nowMs) || "—"}</span>
            <span
              className="shared-note-updated"
              title="When a collaborator last updated this note"
            >Updated {lastUpdatedLabelFromMs(updatedMs, nowMs)}</span>
          </span>
        </span>
      </button>
    </li>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc The widget body: loading/empty states, or the paginated collaborator-updated note list. The
//   sharer filter (when present) renders above whichever state is shown.
// @param {Object} props - { currentPage, onNavigate, onPageChange, onTogglePin, pinnedUuids,
//   sharerFilter, totalPages, visibleNotes }. `visibleNotes` is null while loading.
// @returns {JSX.Element} Body content for the WidgetWrapper.
// [Claude claude-opus-4-8 (1M context)] Task: extract the body render (states + list) into a component
// Prompt: "Create local functions that split out modular functionality"
function SharedNotesBody({ currentPage, onNavigate, onPageChange, onTogglePin, pinnedUuids, sharerFilter,
    totalPages, visibleNotes }) {
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
      {visibleNotes.map(note => (
        <SharedNoteRow key={note.noteHandle.uuid} note={note} nowMs={nowMs}
          isPinned={pinnedUuids.has(note.noteHandle.uuid)} onTogglePin={onTogglePin} onNavigate={onNavigate} />
      ))}
    </ul>
    <SharedNotesPagination currentPage={currentPage} totalPages={totalPages} onPageChange={onPageChange} />
    </>
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
  const [selectedSharer, setSelectedSharer] = useState(ALL_SHARERS);
  const [page, setPage] = useState(0);
  const pageSize = gridHeightSize >= 2 ? MAX_NOTES_TALL : MAX_NOTES_SHORT;

  const { notes, sharerNames } = useCollaboratorUpdatedNotes({ app, onlyWithTasks, taskDomainUUID });
  const { pinnedUuids, togglePin } = usePinnedNotes(app);
  const { currentPage, totalPages, visibleNotes } = paginateSharedNotes({ notes, page, pageSize, pinnedUuids,
    selectedSharer });

  // Reset to the first page whenever the filter or note set changes so we never land past the end.
  useEffect(() => { setPage(0); }, [selectedSharer, onlyWithTasks, taskDomainUUID]);

  // The person filter only appears once two or more people have shared notes — with a single sharer
  // there is nothing to filter on. When shown, the "Has tasks" toggle moves onto its row (right-
  // aligned via SharerFilter) instead of living in the widget header.
  const showSharerFilter = sharerNames.length >= 2;
  const tasksToggle = inHeader => (<TasksToggle inHeader={inHeader} onChange={setOnlyWithTasks} onlyWithTasks={onlyWithTasks} />);
  const sharerFilter = !showSharerFilter ? null : (<SharerFilter onSelectSharer={setSelectedSharer}
    selectedSharer={selectedSharer} sharerNames={sharerNames} tasksToggle={tasksToggle} />);

  return (
    <WidgetWrapper
      headerActions={showSharerFilter ? null : tasksToggle(true)}
      icon="🤝"
      title={widgetTitleFromId("shared-notes")}
      widgetId="shared-notes"
    >
      <SharedNotesBody currentPage={currentPage} onNavigate={uuid => app.navigate(`https://www.amplenote.com/notes/${ uuid }`)}
        onPageChange={setPage} onTogglePin={togglePin} pinnedUuids={pinnedUuids} sharerFilter={sharerFilter}
        totalPages={totalPages} visibleNotes={visibleNotes} />
    </WidgetWrapper>
  );
}
