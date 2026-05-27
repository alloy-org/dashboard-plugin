/**
 * [Claude-authored file]
 * Created: 2026-03-14 | Model: claude-4.6-opus-high-thinking
 * Task: Dev-mode inline note editor with save/back
 * Prompt summary: "textarea editor for viewing and editing note content in the dev environment"
 */
import { useEffect, useState } from "react";
import { fetchNoteContent, saveNoteContent } from "util/goal-notes";

// ────────────────────────────────────────────────────────────────
/**
 * Inline note editor shown in dev mode when a widget navigates to a note.
 * Loads the note's markdown content into a textarea and provides save/back controls.
 */
// [Claude claude-4.7-opus] Task: migrate NoteEditor from createElement to JSX
// Prompt: "translate this project to render components with JSX instead"
export default function NoteEditor({ app, noteUUID, onBack }) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchNoteContent(app, noteUUID).then(c => {
      if (!cancelled) {
        setContent(c || '');
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [noteUUID, app]);

  const handleSave = async () => {
    setSaving(true);
    await saveNoteContent(app, noteUUID, content);
    setSaving(false);
  };

  if (loading) {
    return <div className="note-editor-loading">Loading note…</div>;
  }

  return (
    <div className="note-editor">
      <div className="note-editor-toolbar">
        <button
          className="note-editor-btn note-editor-btn--back"
          onClick={onBack}
        >← Back</button>
        <button
          className="note-editor-btn note-editor-btn--save"
          onClick={handleSave}
          disabled={saving}
        >{saving ? 'Saving…' : 'Save'}</button>
      </div>
      <textarea
        className="note-editor-textarea"
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
    </div>
  );
}
