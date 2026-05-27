/**
 * [Claude-authored file]
 * Created: 2026-03-04 | Model: claude-4.6-sonnet-medium-thinking
 * Task: Recent Notes widget — notes with tasks where no task was created in the past week
 * Prompt summary: "replace AI & Plugins widget with Recent Notes showing notes whose tasks have gone stale"
 */
import { widgetTitleFromId } from "constants/settings";
import { useEffect, useMemo, useState } from "react";
import { buildRecentNotesSeed, findStaleTaskNotes } from "recent-notes-service";
import "styles/recent-notes.scss"
import { logIfEnabled } from "util/log";
import WidgetWrapper from 'widget-wrapper';

const MIN_NOTES = 3;
const MAX_NOTES = 5;

// [Claude] Task: render Recent Notes widget with reseed header action and seed-based note rotation
// Prompt: "component should have a link in the top bar to reseed; seed changes daily or on reseed click"
// Date: 2026-03-05 | Model: claude-4.6-sonnet-medium-thinking
// [Claude] Task: accept gridHeightSize to fetch more candidates when widget is 2 vertical cells
// Prompt: "ensure more note candidates are returned when component is two units tall"
// Date: 2026-03-07 | Model: claude-4.6-opus-high-thinking
// [GPT-5.5] Task: load Recent Notes from archived daily note state
// Prompt: "revise recent-notes.js plugin to store recent and selected notes in an archived note"
// [OpenAI gpt-5.4] Task: reload Recent Notes when the active task domain changes
// Prompt: "receive the selected task domain ID from the dashboard parent, and use that taskDomain as a parameter to filterNotes"
// [OpenAI gpt-5.4] Task: call Recent Notes service with named options and seed-driven refreshes
// Prompt: "Update RecentNotes component to use explicit named options in findStaleTaskNotes, rather than amorphous unnamed parameters"
// [Claude claude-4.7-opus] Task: migrate RecentNotesWidget from createElement to JSX
// Prompt: "translate this project to render components with JSX instead"
export default function RecentNotesWidget({ app, gridHeightSize = 1, taskDomainUUID = null }) {
  const [reseedCount, setReseedCount] = useState(0);
  const [staleNotes, setStaleNotes] = useState(null);
  const [error, setError] = useState(null);
  const maxNotes = gridHeightSize >= 2 ? 10 : MAX_NOTES;

  const seed = useMemo(() => buildRecentNotesSeed(reseedCount), [reseedCount]);

  useEffect(() => {
    let isActive = true;
    setStaleNotes(null);
    setError(null);
    findStaleTaskNotes({ app, maxNotes, seed, taskDomainUUID })
      .then(results => {
        if (!isActive) return;
        setStaleNotes(results);
        logIfEnabled("[RecentNotes] staleNotes:", results, "seed:", seed, "reseedCount:", reseedCount);
      })
      .catch(err => {
        if (!isActive) return;
        logIfEnabled('[RecentNotes] fetch error:', err);
        setError(err.message || 'Failed to load notes');
      });
    return () => {
      isActive = false;
    };
  }, [app, maxNotes, reseedCount, seed, taskDomainUUID]);

  const handleReseed = () => setReseedCount(c => c + 1);

  const reseedButton = (
    <button
      className="widget-header-action"
      type="button"
      onClick={handleReseed}
      title="Show a different set of notes"
    >
      ↻ Reseed
    </button>
  );

  const renderBody = () => {
    if (error) {
      return <p className="note-error">{`Error: ${error}`}</p>;
    }
    if (staleNotes === null) {
      return <p className="note-loading">Loading…</p>;
    }
    if (staleNotes.length < MIN_NOTES) {
      return <p className="note-empty">No notes with stale tasks found.</p>;
    }
    return (
      <ul className="note-list">
        {staleNotes.map(({ noteHandle, taskCount }) => (
          <li key={noteHandle.uuid} className="note-item">
            <button
              className="note-link"
              type="button"
              onClick={() => app.navigate(`https://www.amplenote.com/notes/${noteHandle.uuid}`)}
              title={`Open "${noteHandle.name || 'Untitled'}"`}
            >
              <span className="note-name">{noteHandle.name || 'Untitled'}</span>
              <span className="note-count">{`${taskCount} open task${taskCount !== 1 ? 's' : ''}`}</span>
            </button>
            <div className="note-metadata">
              {noteHandle.changed ? `Last updated: ${new Date(noteHandle.changed).toLocaleDateString()}` : 'No update date'}
            </div>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <WidgetWrapper
      headerActions={reseedButton}
      icon="📝"
      title={widgetTitleFromId('recent-notes')}
      widgetId="recent-notes"
    >
      {renderBody()}
    </WidgetWrapper>
  );
}
