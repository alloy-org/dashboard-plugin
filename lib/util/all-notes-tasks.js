// [Claude claude-opus-4-8 (1M context)-authored file]
// Created: 2026-06-28 | Model: claude-opus-4-8 (1M context)
// Task: fetch a task domain's tasks, falling back to all notes when no domain can be found
// Prompt summary: "components that look up tasks by taskDomainUUID should fall back to not specifying
//   any task domain UUID (All Notes) when no domain can be found"
import { logIfEnabled } from "util/log";

// Cap on task-list notes scanned in the domain-less ("All Notes") fallback, protecting mobile clients
// from an unbounded getNoteTasks fan-out when an account has no task domains configured.
const MAX_ALL_NOTES_TO_SCAN = 250;

// ------------------------------------------------------------------------------------------
// @desc Fetch tasks for the given task domain, or — when no domain is available — across all of the
//   user's task-list notes (the "All Notes" fallback). getTaskDomainTasks requires a domain UUID, so the
//   domain-less path instead discovers task-list notes via filterNotes (no taskDomainUUID) and reads each
//   note's tasks, mirroring the existing graveyard/recent-notes scanning pattern.
// @param {Object} app - Amplenote app bridge.
// @param {string|null} domainUuid - Active task domain UUID, or null/falsy to use the All-Notes fallback.
// @param {Object} [options]
//   - {boolean} includeDone - Include completed/dismissed tasks (true so victory-value style metrics work). Default true.
//   - {number} maxNotes - Max task-list notes scanned in the fallback path. Default MAX_ALL_NOTES_TO_SCAN.
// @returns {Promise<Array<Object>>} Task objects (noteUUID/noteName populated from the owning note handle).
export function fetchDomainOrAllNotesTasks(app, domainUuid, { includeDone = false, maxNotes = MAX_ALL_NOTES_TO_SCAN } = {}) {
  if (domainUuid) {
    return app.getTaskDomainTasks(domainUuid);
  } else {
    return _allNotesTasks(app, includeDone, maxNotes);
  }
}

// ------------------------------------------------------------------------------------------
// @desc Gather open (and optionally done) tasks across every task-list note, regardless of task domain.
// @param {Object} app - Amplenote app bridge.
// @param {boolean} includeDone - Whether getNoteTasks should include completed/dismissed tasks.
// @param {number} maxNotes - Cap on notes scanned.
// @returns {Promise<Array<Object>>} Task objects with noteUUID/noteName backfilled from the note handle.
async function _allNotesTasks(app, includeDone, maxNotes) {
  const seen = new Set();
  const noteHandles = [];
  for await (const handle of (await app.filterNotes({ group: "taskLists" }, "changed"))) {
    if (!handle?.uuid || seen.has(handle.uuid)) continue;
    seen.add(handle.uuid);
    noteHandles.push(handle);
    if (noteHandles.length >= maxNotes) break;
  }
  logIfEnabled(`[all-notes-tasks] No task domain — scanning ${ noteHandles.length } task-list notes for tasks`);
  // Pair each settled result with its handle by index. We intentionally do NOT .then()-chain the
  // getNoteTasks call: the Amplenote app bridge returns a non-spec-compliant thenable whose .then()
  // resolves to undefined, which would make every Promise.allSettled outcome.value undefined.
  const settled = await Promise.allSettled(noteHandles.map(handle => app.getNoteTasks({ uuid: handle.uuid }, { includeDone })));
  const allTasks = [];
  for (let index = 0; index < settled.length; index += 1) {
    const outcome = settled[index];
    const handle = noteHandles[index];
    if (!outcome || outcome.status === "rejected") {
      logIfEnabled("[all-notes-tasks] getNoteTasks failed:", outcome?.reason);
      continue;
    }
    const tasks = Array.isArray(outcome.value) ? outcome.value : [];
    for (const task of tasks) {
      if (!task?.uuid) continue;
      allTasks.push({ ...task, noteName: task.noteName || task.noteTitle || task.note?.name || handle.name || null,
        noteUUID: task.noteUUID || handle.uuid });
    }
  }
  logIfEnabled(`[all-notes-tasks] Gathered ${ allTasks.length } tasks across all notes (no task domain)`);
  return allTasks;
}
