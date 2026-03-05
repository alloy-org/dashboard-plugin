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
// Prompt: "replace AI & Plugins widget with Recent Notes showing notes whose tasks have gone stale"
// Date: 2026-03-04 | Model: claude-4.6-sonnet-medium-thinking
async function fetchAllDomainNotes() {
  const taskDomains = await callPlugin('getTaskDomains');
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
// Prompt: "replace AI & Plugins widget with Recent Notes showing notes whose tasks have gone stale"
// Date: 2026-03-04 | Model: claude-4.6-sonnet-medium-thinking
async function findStaleTaskNotes() {
  const notes = await fetchAllDomainNotes();
  const oneWeekAgo = Date.now() - ONE_WEEK_MS;
  const staleNotes = [];

  for (const noteHandle of notes) {
    if (staleNotes.length >= MAX_NOTES) break;
    try {
      const tasks = await callPlugin('getNoteTasks', noteHandle.uuid, { includeDone: false });
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
// Prompt: "replace AI & Plugins widget with Recent Notes showing notes whose tasks have gone stale"
// Date: 2026-03-04 | Model: claude-4.6-sonnet-medium-thinking
export default function RecentNotesWidget() {
  const h = createElement;
  const [staleNotes, setStaleNotes] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    findStaleTaskNotes().then(results => setStaleNotes(results)).
    catch(err => {
        console.error('[RecentNotes] fetch error:', err);
        setError(err.message || 'Failed to load notes');
      });
  }, []);

  const renderBody = () => {
    if (error) {
      return h('p', { className: 'rn-error' }, `Error: ${error}`);
    }
    if (staleNotes === null) {
      return h('p', { className: 'rn-loading' }, 'Loading…');
    }
    if (staleNotes.length < MIN_NOTES) {
      return h('p', { className: 'rn-empty' }, 'No notes with stale tasks found.');
    }
    return h('ul', { className: 'rn-list' },
      staleNotes.map(({ noteHandle, taskCount }) =>
        h('li', { key: noteHandle.uuid, className: 'rn-item' },
          h('button', {
            className: 'rn-note-link',
            type: 'button',
            onClick: () => callPlugin('navigateToNote', noteHandle.uuid),
            title: `Open "${noteHandle.name || 'Untitled'}"`,
          },
            h('span', { className: 'rn-note-name' }, noteHandle.name || 'Untitled'),
            h('span', { className: 'rn-task-count' }, `${taskCount} open task${taskCount !== 1 ? 's' : ''}`)
          )
        )
      )
    );
  };

  return h(WidgetWrapper, { title: 'Recent Notes', icon: '📝', widgetId: 'ai-plugins' },
    renderBody()
  );
}
