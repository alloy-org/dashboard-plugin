// The drop-down beneath a project's note search: recently changed notes that hold tasks, listed as the best matches
// for the project's name and the most recent ones, or, once the user types, the ones whose names contain the typed
// words. An action at the bottom starts a new note named after the project. Notes already defining a project on the
// page are never listed, so two projects never claim one note.

// ----------------------------------------------------------------------------------------------
// @desc List the menu's choosable entries in the order arrow keys move through them.
// @param {object} candidates - { bestMatches, recentlyEdited } from useProjectNoteCandidates.
// @returns {Array<object>} { candidate, kind: "note" } for each listed note, then { kind: "create" }.
export function selectableMenuItems(candidates) {
  const listedNotes = candidates.bestMatches.concat(candidates.recentlyEdited);
  const noteItems = listedNotes.map(candidate => ({ candidate, kind: "note" }));
  return noteItems.concat({ kind: "create" });
}

// ----------------------------------------------------------------------------------------------
// @desc Draw the page glyph that marks a note.
// @returns {JSX.Element} An inline document icon.
export function NoteGlyph() {
  return (
    <svg aria-hidden="true" className="project-note-glyph" viewBox="0 0 24 24">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </svg>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Render one note entry: its name, where it is filed, how many tasks it holds, and when it was last edited.
// @param {object} params - An object with the following properties:
//   - {object} candidate - Candidate from readProjectNoteCandidates.
//   - {boolean} isHighlighted - True when arrow keys rest on this entry.
//   - {Function} onHighlight - Moves the highlight to this entry.
//   - {Function} onLinkNote - Links this note to the project.
// @returns {JSX.Element} The entry.
function NoteMenuEntry({ candidate, isHighlighted, onHighlight, onLinkNote }) {
  const taskLabel = candidate.taskCount === null ? "" : `${ candidate.taskCount } task${ candidate.taskCount === 1 ? "" : "s" }`;
  const detailParts = [candidate.tagLabel, taskLabel, candidate.editedLabel].filter(Boolean);
  const entryClass = `project-note-menu-entry${ isHighlighted ? " project-note-menu-entry--highlighted" : "" }`;
  return (
    <li aria-selected={ isHighlighted } className={ entryClass } role="option">
      <button onClick={ () => onLinkNote(candidate) }
        onMouseDown={ event => event.preventDefault() } onMouseEnter={ onHighlight } type="button">
        <NoteGlyph />
        <span className="project-note-menu-text">
          <span className="project-note-menu-name">{ candidate.name }</span>
          <span className="project-note-menu-detail">{ detailParts.join(" · ") }</span>
        </span>
        { isHighlighted ? <span aria-hidden="true" className="project-note-menu-hint">↵ Link</span> : null }
      </button>
    </li>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Render the note search's drop-down.
// @param {object} params - An object with the following properties:
//   - {object} candidates - { bestMatches, isSearching, recentlyEdited } from useProjectNoteCandidates.
//   - {string} escapeHint - What Escape does, shown among the key hints: keep the typed name or the linked note.
//   - {number} highlightedIndex - Index into selectableMenuItems where arrow keys rest.
//   - {boolean} isCreatingNote - True while a new note is being created.
//   - {Function} onCreateNote - Creates a note named after the project and links it.
//   - {Function} onHighlight - Receives the index of the entry the pointer moved onto.
//   - {Function} onLinkNote - Receives the candidate the user chose.
//   - {string} searchText - What the user typed; when present, the menu lists name matches under one heading.
// @returns {JSX.Element} The menu.
export default function ProjectNoteSearchMenu({ candidates, escapeHint, highlightedIndex, isCreatingNote, onCreateNote,
    onHighlight, onLinkNote, searchText }) {
  const menuItems = selectableMenuItems(candidates);
  const highlightedItem = menuItems[highlightedIndex] ?? null;
  const indexOfCandidate = candidate => menuItems.findIndex(item => item.candidate?.uuid === candidate.uuid);
  const renderEntry = candidate => (
    <NoteMenuEntry candidate={ candidate } isHighlighted={ highlightedItem?.candidate?.uuid === candidate.uuid }
      key={ candidate.uuid } onHighlight={ () => onHighlight(indexOfCandidate(candidate)) } onLinkNote={ onLinkNote } />
  );
  const hasNotes = candidates.bestMatches.length > 0 || candidates.recentlyEdited.length > 0;
  const trimmedSearch = String(searchText ?? "").trim();
  const bestMatchHeading = trimmedSearch ? `Names containing “${ trimmedSearch }”` : "Best matches for this project";
  const emptyMessage = trimmedSearch ? `No recently changed note with tasks has “${ trimmedSearch }” in its name.`
    : "No recently changed notes with tasks yet.";
  return (
    <div className="project-note-menu" role="listbox">
      <p className="project-note-menu-scope">Recently changed notes with tasks shown</p>
      { candidates.bestMatches.length ? (
        <>
          <p className="project-note-menu-heading">{ bestMatchHeading }</p>
          <ul className="project-note-menu-list">{ candidates.bestMatches.map(renderEntry) }</ul>
        </>
      ) : null }
      { candidates.recentlyEdited.length ? (
        <>
          <p className="project-note-menu-heading">Recently changed</p>
          <ul className="project-note-menu-list">{ candidates.recentlyEdited.map(renderEntry) }</ul>
        </>
      ) : null }
      { !hasNotes ? (
        <p className="project-note-menu-empty">{ candidates.isSearching ? "Searching your notes…" : emptyMessage }</p>
      ) : null }
      <button className={ `project-note-menu-create${ highlightedItem?.kind === "create" ? " project-note-menu-create--highlighted" : "" }` }
        disabled={ isCreatingNote } onClick={ onCreateNote } onMouseDown={ event => event.preventDefault() }
        onMouseEnter={ () => onHighlight(menuItems.length - 1) } type="button">
        <span aria-hidden="true">+</span> { isCreatingNote ? "Creating note…" : "New note from this project" }
      </button>
      <p aria-hidden="true" className="project-note-menu-keys">
        <span>↑↓ move</span><span>↵ link note</span><span>esc { escapeHint }</span>
      </p>
    </div>
  );
}
