// Dev-mode inline note editor: load a note's markdown into a contentEditable field with save and back.

import { Button, LoadingState } from "dashboard/controls";
import { useEffect, useRef, useState } from "react";
import { MdArrowBack } from "react-icons/md";
import "styles/note-editor.scss";
import { fetchNoteContent, saveNoteContent } from "util/goal-notes";

// ----------------------------------------------------------------------------------------------
// @desc Show one note's full markdown in a contentEditable field so the dev environment can inspect a data
//   store that Amplenote would otherwise open as a native note.
// @param {object} params - An object with the following properties:
//   - {object} app - Amplenote embed app proxy, or the browser-dev mock.
//   - {string} noteUUID - Note to load.
//   - {Function} onBack - Leaves the editor and returns to the previous view.
// @returns {JSX.Element} Toolbar plus the editable note body, or a loading placeholder.
export default function NoteEditor({ app, noteUUID, onBack }) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const editorRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchNoteContent(app, noteUUID).then(noteContent => {
      if (cancelled) return;
      setContent(noteContent || "");
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [app, noteUUID]);

  useEffect(() => {
    if (loading || !editorRef.current) return;
    editorRef.current.textContent = content;
  }, [loading, noteUUID]);

  // ----------------------------------------------------------------------------------------------
  // @desc Write the current editor text back to the note, replacing its entire body.
  const handleSave = async () => {
    setSaving(true);
    await saveNoteContent(app, noteUUID, content);
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="note-editor">
        <LoadingState>Loading note…</LoadingState>
      </div>
    );
  }

  return (
    <div className="note-editor">
      <div className="note-editor-toolbar">
        <Button className="note-editor-btn--back" dense Icon={ MdArrowBack } onClick={ onBack }
          variant="outlined">Back</Button>
        <Button className="note-editor-btn--save" dense disabled={ saving } onClick={ handleSave }
          variant="raised">
          { saving ? "Saving…" : "Save" }
        </Button>
      </div>
      <div aria-label="Data note content" aria-multiline="true" className="note-editor-content" contentEditable="true"
        onInput={ event => setContent(event.currentTarget.textContent ?? "") } ref={ editorRef } role="textbox"
        spellCheck="false" suppressContentEditableWarning />
    </div>
  );
}
