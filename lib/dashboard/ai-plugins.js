/**
 * [Claude-authored file]
 * Created: 2026-03-04 | Model: claude-4.6-sonnet-medium-thinking
 * Task: Recent Notes widget — notes with tasks where no task was created in the past week
 * Prompt summary: "replace AI & Plugins widget with Recent Notes showing notes whose tasks have gone stale"
 */
import { createElement, useEffect, useState } from "react";
import WidgetWrapper from './widget-wrapper';

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_NOTES = 3;
const MAX_NOTES = 5;

// [Claude] Task: collect note handles from all task domains, deduplicated by uuid
// Prompt: "widgets receive the app object instead of using callPlugin"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
async function fetchAllDomainNotes(app) {
  const taskDomains = await app.getTaskDomains();
  if (!Array.isArray(taskDomains) || taskDomains.length === 0) return [];
  const seen = new Set();
  const notes = [];
  for (const domain of taskDomains) {
    for (const noteHandle of (domain.notes || [])) {
      if (noteHandle.uuid && !seen.has(noteHandle.uuid)) {
        seen.add(noteHandle.uuid);
        notes.push(noteHandle);
      }
    }
  }
  return notes;
}

// [Claude] Task: find notes that have tasks but whose most-recently-created task is older than one week
// Prompt: "widgets receive the app object instead of using callPlugin"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
async function findStaleTaskNotes(app) {
  const notes = await fetchAllDomainNotes(app);
  const oneWeekAgo = Date.now() - ONE_WEEK_MS;
  const staleNotes = [];

  for (const noteHandle of notes) {
    if (staleNotes.length >= MAX_NOTES) break;
    try {
      const tasks = await app.getNoteTasks(noteHandle.uuid, { includeDone: false });
      if (!Array.isArray(tasks) || tasks.length === 0) continue;

      // hideUntil and startAt are creation-adjacent proxies; fall back to uuid-based order
      // The most recently created open task can be identified by the highest startAt value,
      // or if none have startAt, treat the note as potentially stale.
      const latestTaskTimestamp = tasks.reduce((maxMs, task) => {
        // Prefer startAt as the best available proxy for when the task was created/scheduled
        const ts = task.startAt ? task.startAt * 1000 : 0;
        return Math.max(maxMs, ts);
      }, 0);

      // Include notes where either:
      //  (a) tasks exist but none have a startAt (latestTaskTimestamp === 0) — treat as stale
      //  (b) the most recently scheduled task is older than one week
      if (latestTaskTimestamp === 0 || latestTaskTimestamp < oneWeekAgo) {
        staleNotes.push({ noteHandle, taskCount: tasks.length, latestTaskTimestamp });
      }
    } catch (err) {
      console.warn(`[RecentNotes] Failed to fetch tasks for note ${noteHandle.uuid}:`, err);
    }
  }

  return staleNotes;
}

// [Claude] Task: render Recent Notes widget — notes with stale open tasks
// Prompt: "widgets receive the app object instead of using callPlugin"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
export default function RecentNotesWidget({ app }) {
  const h = createElement;
  const [staleNotes, setStaleNotes] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    findStaleTaskNotes(app)
      .then(results => setStaleNotes(results))
      .catch(err => {
        console.error('[RecentNotes] fetch error:', err);
        setError(err.message || 'Failed to load notes');
      });
  }, [app]);

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
            onClick: () => app.navigateToNote(noteHandle.uuid),
            title: `Open "${noteHandle.name || 'Untitled'}"`,
          },
            h('span', { className: 'note-name' }, noteHandle.name || 'Untitled'),
            h('span', { className: 'note-count' }, `${taskCount} open task${taskCount !== 1 ? 's' : ''}`)
          )
        )
      )
    );
  };

  return h(WidgetWrapper, { title: 'Recent Notes', icon: '📝', widgetId: 'recent-notes' },
    renderBody()
  );
}
