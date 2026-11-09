// The name field at the top of a project card, which can hold either a name the user types or a link to the note that
// defines the project. A toggle at its left switches between the two. Choosing a note opens a search seeded with
// whatever name was already typed; leaving that search without picking a note keeps the typed name but outlines the
// field in red, since the project was meant to be defined by a note and is not yet. Once a note is linked, clicking
// its name reopens the search to choose a different note, and the arrow beside it opens the note in Amplenote. A note
// picked while planning a Task Domain that does not hold it is first added to that domain, so its tasks reach the
// project; if the host will not add it, the field turns red with an exclamation and offers Retry or Cancel, and the
// project keeps whatever it was defined by before.

import ExpandingTextarea from "dashboard/plan-wizard/expanding-textarea";
import ProjectNoteSearchMenu, { NoteGlyph, selectableMenuItems } from "dashboard/plan-wizard/project-note-search-menu";
import useProjectNoteCandidates from "hooks/use-project-note-candidates";
import { includeNoteInTaskDomain } from "plan-wizard/task-domain-fallback";
import { logIfEnabled } from "util/log";
import { useEffect, useRef, useState } from "react";

const SOURCE_OPTIONS = [
  { description: "Type a name. Plan Builder explains why it fits your intent.", label: "Name it yourself", value: "name" },
  { description: "Pick a note. Plan Builder reads it to show how the project gets done.", label: "Define with a note",
    value: "note" },
];

// ----------------------------------------------------------------------------------------------
// @desc Draw the letter glyph that marks a typed project name.
// @returns {JSX.Element} An inline "T" icon.
function TypedNameGlyph() {
  return (
    <svg aria-hidden="true" className="project-source-glyph" viewBox="0 0 24 24">
      <path d="M5 6h14M12 6v13" />
    </svg>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Call a handler when a pointer goes down outside an element, so an open menu closes on an outside click.
// @param {object} elementRef - Ref to the element that counts as inside.
// @param {boolean} isActive - Whether to listen at all.
// @param {Function} onOutsidePointer - Called on a pointer down outside the element.
function useOutsidePointer(elementRef, isActive, onOutsidePointer) {
  useEffect(() => {
    if (!isActive) return undefined;
    const handlePointerDown = event => {
      if (!elementRef.current?.contains(event.target)) onOutsidePointer();
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [elementRef, isActive, onOutsidePointer]);
}

// ----------------------------------------------------------------------------------------------
// @desc While a menu is open, take every Escape on the page for it, wherever focus is. The listener runs in the
//   window's capture phase and stops the event there, so the Plan Builder dialog and the dashboard's focused-widget
//   listener never see it: Escape closes the menu, and only a second Escape closes Plan Builder.
// @param {boolean} isActive - Whether to listen at all.
// @param {Function} onEscape - Called when Escape is pressed.
function useEscapeCapture(isActive, onEscape) {
  useEffect(() => {
    if (!isActive) return undefined;
    const handleKeyDown = event => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onEscape();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isActive, onEscape]);
}

// ----------------------------------------------------------------------------------------------
// @desc Render the menu that switches a project between a typed name and a note.
// @param {object} params - An object with the following properties:
//   - {Function} onChooseSource - Receives "name" or "note".
//   - {string} projectSourceEm - The source currently chosen.
// @returns {JSX.Element} The menu.
function ProjectSourceMenu({ onChooseSource, projectSourceEm }) {
  return (
    <div className="project-source-menu" role="menu">
      { SOURCE_OPTIONS.map(option => (
        <button aria-checked={ option.value === projectSourceEm } className="project-source-menu-option" key={ option.value }
          onClick={ () => onChooseSource(option.value) } role="menuitemradio" type="button">
          { option.value === "note" ? <NoteGlyph /> : <TypedNameGlyph /> }
          <span className="project-source-menu-text">
            <span className="project-source-menu-label">{ option.label }</span>
            <span className="project-source-menu-description">{ option.description }</span>
          </span>
          { option.value === projectSourceEm ? <span aria-hidden="true" className="project-source-menu-check">✓</span> : null }
        </button>
      )) }
    </div>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Render the red notice shown when a picked note could not be added to the Task Domain being planned.
// @param {object} params - An object with the following properties:
//   - {string|null} domainName - Name of the Task Domain being planned.
//   - {Function} onCancel - Abandons the picked note, leaving the project as it was.
//   - {Function} onRetry - Tries again to add the note to the domain.
// @returns {JSX.Element} The notice.
function NoteInclusionAlert({ domainName, onCancel, onRetry }) {
  const domainLabel = domainName ? `the ${ domainName } Task Domain` : "this Task Domain";
  return (
    <div className="project-source-inclusion-alert" role="alert">
      <p className="project-source-inclusion-message">
        This note could not be added to { domainLabel }, so its tasks would not reach this project.
      </p>
      <div className="project-source-inclusion-actions">
        <button className="plan-button plan-button--primary" onClick={ onRetry } type="button">Retry</button>
        <button className="plan-button" onClick={ onCancel } type="button">Cancel</button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Render a project's name field with its source toggle, note search, and linked note.
// @param {object} params - An object with the following properties:
//   - {object} app - Amplenote app interface, used to search, create, and open notes, and to add a picked note to
//     the Task Domain being planned.
//   - {string|null} domainName - Name of the Task Domain being planned, shown if a note cannot be added to it.
//   - {string|null} domainUuid - The Task Domain being planned, or null for All Notes.
//   - {boolean} isDisabled - Whether editing is prevented.
//   - {boolean} isNoteTrashed - True when the linked note was moved to trash, which strikes its name through.
//   - {boolean} isSearchOpen - Whether the note search is showing.
//   - {object} linkedRowUuidByNoteUuid - { [noteUuid]: rowUuid } for notes defining projects on the page.
//   - {Function} onChangeRow - Receives the row UUID and the fields to change on it.
//   - {Function} onSetSearchOpen - Opens or closes the note search.
//   - {object} row - Draft project row; projectSourceEm and primaryNoteUuid say how it is defined.
// @returns {JSX.Element} The field.
export default function ProjectSourceField({ app, domainName = null, domainUuid = null, isDisabled, isNoteTrashed, isSearchOpen,
    linkedRowUuidByNoteUuid, onChangeRow, onSetSearchOpen, row }) {
  const fieldRef = useRef(null);
  const pickCountRef = useRef(0);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [isCreatingNote, setIsCreatingNote] = useState(false);
  const [isSourceMenuOpen, setIsSourceMenuOpen] = useState(false);
  // { candidate, statusEm }: a picked note waiting to join the domain ("including") or refused by it ("failed").
  const [pendingNote, setPendingNote] = useState(null);
  const [searchText, setSearchText] = useState("");
  const isNoteSource = row.projectSourceEm === "note";
  const isLinked = isNoteSource && Boolean(row.primaryNoteUuid);
  const candidates = useProjectNoteCandidates(app, { isOpen: isSearchOpen, linkedRowUuidByNoteUuid,
    projectName: row.summary, searchText });
  const menuItems = selectableMenuItems(candidates);

  // ----------------------------------------------------------------------------------------------
  // @desc Close whichever menu is open, keeping the name already in the field.
  const closeMenus = () => {
    setIsSourceMenuOpen(false);
    onSetSearchOpen(false);
  };

  useOutsidePointer(fieldRef, isSourceMenuOpen || isSearchOpen, closeMenus);
  useEscapeCapture(isSourceMenuOpen || isSearchOpen, closeMenus);

  useEffect(() => () => { pickCountRef.current += 1; }, []);

  useEffect(() => {
    if (!isSearchOpen) return;
    setSearchText("");
    setHighlightedIndex(0);
  }, [isSearchOpen]);

  // ----------------------------------------------------------------------------------------------
  // @desc Switch the project to a typed name, keeping the current name as its text, or to a note, opening the search.
  // @param {string} projectSourceEm - "name" or "note".
  const handleChooseSource = projectSourceEm => {
    setIsSourceMenuOpen(false);
    if (projectSourceEm === "name") {
      onSetSearchOpen(false);
      setPendingNote(null);
      onChangeRow(row.uuid, { primaryNoteLinkedAt: null, primaryNoteName: null, primaryNoteUuid: null, projectSourceEm: "name" });
      return;
    }
    if (!isNoteSource) onChangeRow(row.uuid, { projectSourceEm: "note" });
    onSetSearchOpen(true);
  };

  // ----------------------------------------------------------------------------------------------
  // @desc Create a note named after the project, or after the search text when the project has no name, and link it.
  const handleCreateNote = async () => {
    const noteName = searchText.trim() || row.summary.trim() || "New project";
    setIsCreatingNote(true);
    try {
      const noteUuid = await app.createNote(noteName, []);
      if (noteUuid) await handleLinkNote({ name: noteName, uuid: noteUuid });
    } catch (error) {
      logIfEnabled("[project-source-field] could not create project note", error?.message);
    } finally {
      setIsCreatingNote(false);
    }
  };

  // ----------------------------------------------------------------------------------------------
  // @desc Link a note to the project, taking the note's name as the project's and recording when it was picked. The
  //   note is first added to the Task Domain being planned; until that settles the field shows the note as pending,
  //   and if the domain will not take it the project is left as it was while the field offers Retry or Cancel. A
  //   result arriving after a newer pick, a cancel, or the field closing is dropped.
  // @param {object} candidate - { name, uuid } of the chosen note.
  const handleLinkNote = async candidate => {
    onSetSearchOpen(false);
    pickCountRef.current += 1;
    const pickCount = pickCountRef.current;
    setPendingNote({ candidate, statusEm: "including" });
    const { isIncluded } = await includeNoteInTaskDomain(app, { domainUuid, noteUuid: candidate.uuid });
    if (pickCount !== pickCountRef.current) return;
    if (!isIncluded) {
      setPendingNote({ candidate, statusEm: "failed" });
      return;
    }
    setPendingNote(null);
    onChangeRow(row.uuid, { primaryNoteLinkedAt: new Date().toISOString(), primaryNoteName: candidate.name,
      primaryNoteUuid: candidate.uuid, projectSourceEm: "note", summary: candidate.name });
  };

  // ----------------------------------------------------------------------------------------------
  // @desc Abandon the picked note the domain would not take, leaving the project defined as it was before the pick.
  const handleCancelPendingNote = () => {
    pickCountRef.current += 1;
    setPendingNote(null);
  };

  // ----------------------------------------------------------------------------------------------
  // @desc Move through the menu with the arrow keys and link with Enter. Escape is taken by useEscapeCapture.
  // @param {KeyboardEvent} event - Key pressed in the search input.
  const handleSearchKeyDown = event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlightedIndex(previous => (previous + step + menuItems.length) % menuItems.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const chosenItem = menuItems[highlightedIndex];
      if (chosenItem?.kind === "note") handleLinkNote(chosenItem.candidate);
      else if (chosenItem?.kind === "create") handleCreateNote();
    }
  };

  const fieldClassNames = ["project-source-field"];
  if (isNoteSource) fieldClassNames.push("project-source-field--note");
  if (isLinked) fieldClassNames.push("project-source-field--linked");
  if (isNoteSource && !isLinked && !isSearchOpen) fieldClassNames.push("project-source-field--unlinked");
  if (isSearchOpen) fieldClassNames.push("project-source-field--searching");
  if (isNoteTrashed) fieldClassNames.push("project-source-field--trashed");
  if (pendingNote?.statusEm === "failed") fieldClassNames.push("project-source-field--inclusion-failed");
  const isPicking = pendingNote?.statusEm === "including";

  return (
    <div className={ fieldClassNames.join(" ") } ref={ fieldRef }>
      <div className="project-source-box">
        <button aria-expanded={ isSourceMenuOpen } aria-haspopup="menu" aria-label="Choose how this project is defined"
          className="project-source-toggle" disabled={ isDisabled || Boolean(pendingNote) }
          onClick={ () => setIsSourceMenuOpen(previous => !previous) } type="button">
          { isNoteSource ? <NoteGlyph /> : <TypedNameGlyph /> }
          <span aria-hidden="true" className="project-source-chevron">⌄</span>
        </button>
        { pendingNote ? (
          <span aria-busy={ isPicking } className="project-source-pending">
            { isPicking ? null : <span aria-hidden="true" className="project-source-inclusion-mark">!</span> }
            <span className="project-source-note-name">{ pendingNote.candidate.name }</span>
            { isPicking ? <span className="project-source-pending-status">Adding to Task Domain…</span> : null }
          </span>
        ) : !isNoteSource ? (
          <ExpandingTextarea className="project-row-name" disabled={ isDisabled }
            onChange={ event => onChangeRow(row.uuid, { summary: event.target.value }) }
            placeholder="Name a project that moves an intent forward" shouldAutoFocus={ row.shouldAutoFocus }
            value={ row.summary } />
        ) : isSearchOpen ? (
          <input aria-label="Search notes to define this project" autoFocus className="project-source-search"
            onChange={ event => { setSearchText(event.target.value); setHighlightedIndex(0); } }
            onKeyDown={ handleSearchKeyDown } placeholder="Search notes to define this project" type="text"
            value={ searchText } />
        ) : isLinked ? (
          <>
            <button className="project-source-note-change" disabled={ isDisabled } onClick={ () => onSetSearchOpen(true) }
              title="Choose a different note to define this project" type="button">
              <span className="project-source-note-name">{ row.summary }</span>
            </button>
            { isNoteTrashed ? null : (
              <button aria-label="Open this note in Amplenote" className="project-source-note-open"
                onClick={ () => app.navigate(`https://www.amplenote.com/notes/${ row.primaryNoteUuid }`) }
                title="Open this note in Amplenote" type="button">↗</button>
            ) }
          </>
        ) : (
          <button className="project-source-unlinked" disabled={ isDisabled } onClick={ () => onSetSearchOpen(true) }
            title="No note is linked yet. Choose one, or switch back to naming the project yourself." type="button">
            { row.summary.trim() || "Choose a note to define this project" }
          </button>
        ) }
      </div>
      { pendingNote?.statusEm === "failed" ? (
        <NoteInclusionAlert domainName={ domainName } onCancel={ handleCancelPendingNote }
          onRetry={ () => handleLinkNote(pendingNote.candidate) } />
      ) : null }
      { isSourceMenuOpen ? <ProjectSourceMenu onChooseSource={ handleChooseSource } projectSourceEm={ row.projectSourceEm } /> : null }
      { isSearchOpen ? (
        <ProjectNoteSearchMenu { ...{ candidates, highlightedIndex, isCreatingNote, searchText } }
          escapeHint={ isLinked ? "keep current note" : "keep typed name" } onCreateNote={ handleCreateNote }
          onHighlight={ setHighlightedIndex } onLinkNote={ handleLinkNote } />
      ) : null }
    </div>
  );
}
