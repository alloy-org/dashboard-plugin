/**
 * [Claude-authored file]
 * Created: 2026-03-04 | Model: claude-4.6-sonnet-medium-thinking
 * Task: Recent Notes widget — notes with tasks where no task was created in the past week
 * Prompt summary: "replace AI & Plugins widget with Recent Notes showing notes whose tasks have gone stale"
 */
import { widgetTitleFromId } from "constants/settings";
import { createElement, useEffect, useMemo, useState } from "react";
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
export default function RecentNotesWidget({ app, gridHeightSize = 1 }) {
  const h = createElement;
  const [reseedCount, setReseedCount] = useState(0);
  const [staleNotes, setStaleNotes] = useState(null);
  const [error, setError] = useState(null);
  const maxNotes = gridHeightSize >= 2 ? 10 : MAX_NOTES;

  const seed = useMemo(() => buildRecentNotesSeed(reseedCount), [reseedCount]);

  useEffect(() => {
    let isActive = true;
    setStaleNotes(null);
    setError(null);
    findStaleTaskNotes(app, seed, { forceRefresh: reseedCount > 0, maxNotes })
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
  }, [app, maxNotes, reseedCount, seed]);

  const handleReseed = () => setReseedCount(c => c + 1);

  const reseedButton = h('button', {
    className: 'widget-header-action',
    type: 'button',
    onClick: handleReseed,
    title: 'Show a different set of notes',
  }, '↻ Reseed');

  const renderBody = () => {
    if (error) {
      return h('p', { className: 'note-error' }, `Error: ${error}`);
    }
    if (staleNotes === null) {
      return h('p', { className: 'note-loading' }, 'Loading…');
    }
    if (staleNotes.length < MIN_NOTES) {
      return h('p', { className: 'note-empty' }, 'No notes with stale tasks found.');
    }
    return h('ul', { className: 'note-list' },
      staleNotes.map(({ noteHandle, taskCount }) =>
        h('li', { key: noteHandle.uuid, className: 'note-item' },
          h('button', {
            className: 'note-link',
            type: 'button',
            onClick: () => app.navigate(`https://www.amplenote.com/notes/${noteHandle.uuid}`),
            title: `Open "${noteHandle.name || 'Untitled'}"`,
          },
            h('span', { className: 'note-name' }, noteHandle.name || 'Untitled'),
            h('span', { className: 'note-count' }, `${taskCount} open task${taskCount !== 1 ? 's' : ''}`)
          )
        )
      )
    );
  };

  return h(WidgetWrapper, {
    headerActions: reseedButton,
    icon: '📝',
    title: widgetTitleFromId('recent-notes'),
    widgetId: 'recent-notes',
  },
    renderBody()
  );
}
