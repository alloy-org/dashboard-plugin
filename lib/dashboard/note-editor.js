/**
 * [Claude-authored file]
 * Created: 2026-03-14 | Model: claude-4.6-opus-high-thinking
 * Task: Dev-mode inline note editor with save/back
 * Prompt summary: "textarea editor for viewing and editing note content in the dev environment"
 */
import { createElement, useEffect, useState } from "react";
import { fetchNoteContent, saveNoteContent } from "util/goal-notes";

// ────────────────────────────────────────────────────────────────
/**
 * Inline note editor shown in dev mode when a widget navigates to a note.
 * Loads the note's markdown content into a textarea and provides save/back controls.
 * @param {Object} props
 * @param {string} props.noteUUID - UUID of the note to edit.
 * @param {Function} props.onBack - Callback invoked when the user clicks Back.
 * @returns {React.ReactElement}
 */
export default function NoteEditor({ noteUUID, onBack }) {
  const h = createElement;
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchNoteContent(noteUUID).then(c => {
      if (!cancelled) {
        setContent(c || '');
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [noteUUID]);

  const handleSave = async () => {
    setSaving(true);
    await saveNoteContent(noteUUID, content);
    setSaving(false);
  };

  if (loading) {
    return h('div', { className: 'note-editor-loading' }, 'Loading note…');
  }

  return h('div', { className: 'note-editor' },
    h('div', { className: 'note-editor-toolbar' },
      h('button', {
        className: 'note-editor-btn note-editor-btn--back',
        onClick: onBack,
      }, '← Back'),
      h('button', {
        className: 'note-editor-btn note-editor-btn--save',
        onClick: handleSave,
        disabled: saving,
      }, saving ? 'Saving…' : 'Save'),
    ),
    h('textarea', {
      className: 'note-editor-textarea',
      value: content,
      onChange: (e) => setContent(e.target.value),
    })
  );
}
