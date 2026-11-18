// [Claude claude-opus-4-8 (1M context)-authored file]
// Created: 2026-06-28 | Model: claude-opus-4-8 (1M context)
// Task: fetch a task domain's tasks, falling back to all notes when no domain can be found
// Prompt summary: "components that look up tasks by taskDomainUUID should fall back to not specifying
//   any task domain UUID (All Notes) when no domain can be found"
import { logIfEnabled } from "util/log";

// Cap on task-list notes scanned in the domain-less ("All Notes") fallback, protecting mobile clients
// from an unbounded getNoteTasks fan-out when an account has no task domains configured.
const MAX_ALL_NOTES_TO_SCAN = 250;
// How long one read of a domain's tasks answers every caller that asks for the same tasks again. A Dashboard load has
// Goal Coach, the agenda's obligations, its task selection, and the queued day ranking each reading the same 1000+
// tasks within seconds of one another; on a busy host each read takes seconds, so they share one.
export const SHARED_TASK_READ_MILLISECONDS = 15 * 1000;
const STARTER_NOTES_TAG = "starter-notes";
// Reads in flight or settled within SHARED_TASK_READ_MILLISECONDS, by app, then by the read's arguments.
const SHARED_TASK_READS = new WeakMap();

// ------------------------------------------------------------------------------------------
// @desc Fetch tasks for the given task domain, or — when no domain is available — across all of the
//   user's task-list notes (the "All Notes" fallback). getTaskDomainTasks requires a domain UUID, so the
//   domain-less path instead discovers task-list notes via filterNotes (no taskDomainUUID) and reads each
//   note's tasks, mirroring the existing graveyard/recent-notes scanning pattern. That scan leaves out notes
//   tagged starter-notes, using the tags already on each note handle.
//   Callers asking for the same tasks while a read is in flight, or within SHARED_TASK_READ_MILLISECONDS of it
//   settling, share that read. Each caller receives its own array of copied task objects, so one caller changing a
//   task cannot change what another sees. A failed read is not shared with later callers.
// @param {Object} app - Amplenote app bridge.
// @param {string|null} domainUuid - Active task domain UUID, or null/falsy to use the All-Notes fallback.
// @param {Object} [options]
//   - {boolean} fresh - Read again rather than share a recent read; the new read is then the one shared. Default false.
//   - {boolean} includeDone - Include completed/dismissed tasks (true so victory-value style metrics work). Default false.
//   - {number} maxNotes - Max task-list notes scanned in the fallback path. Default MAX_ALL_NOTES_TO_SCAN.
// @returns {Promise<Array<Object>>} Task objects (noteUUID/noteName populated from the owning note handle).
export function fetchDomainOrAllNotesTasks(app, domainUuid, { fresh = false, includeDone = false, maxNotes = MAX_ALL_NOTES_TO_SCAN } = {}) {
  if (!app || typeof app !== "object") return _readTasks(app, domainUuid, includeDone, maxNotes);
  if (!SHARED_TASK_READS.has(app)) SHARED_TASK_READS.set(app, new Map());
  const readsByKey = SHARED_TASK_READS.get(app);
  const readKey = JSON.stringify([domainUuid || null, includeDone, maxNotes]);
  const shared = readsByKey.get(readKey);
  const sharedIsRecent = shared && (shared.settledAt === null || Date.now() - shared.settledAt < SHARED_TASK_READ_MILLISECONDS);
  if (!fresh && sharedIsRecent) return _copiedTasks(shared.promise);
  const entry = { promise: null, settledAt: null };
  entry.promise = _readTasks(app, domainUuid, includeDone, maxNotes).then(tasks => {
    entry.settledAt = Date.now();
    return tasks;
  }, error => {
    if (readsByKey.get(readKey) === entry) readsByKey.delete(readKey);
    throw error;
  });
  readsByKey.set(readKey, entry);
  return _copiedTasks(entry.promise);
}

// ------------------------------------------------------------------------------------------
// @desc Drop every shared task read for an app, so the next caller reads the host again. Called when the Dashboard
//   learns that a task changed.
// @param {Object} app - Amplenote app bridge.
export function forgetSharedTaskReads(app) {
  if (app && typeof app === "object") SHARED_TASK_READS.delete(app);
}

// ------------------------------------------------------------------------------------------
// @desc Read a domain's tasks from the host, or scan every task-list note when there is no domain.
// @param {Object} app - Amplenote app bridge.
// @param {string|null} domainUuid - Task domain UUID, or null for the All-Notes fallback.
// @param {boolean} includeDone - Whether the All-Notes scan includes completed/dismissed tasks.
// @param {number} maxNotes - Cap on notes the All-Notes scan reads.
// @returns {Promise<Array<Object>>} Task objects as the host returns them.
async function _readTasks(app, domainUuid, includeDone, maxNotes) {
  if (domainUuid) return await app.getTaskDomainTasks(domainUuid);
  return _allNotesTasks(app, includeDone, maxNotes);
}

// ------------------------------------------------------------------------------------------
// @desc A caller's own copy of a shared read: a new array of shallow-copied tasks.
// @param {Promise<Array<Object>>} sharedRead - The shared read.
// @returns {Promise<Array<Object>>} The copy; a result that is not an array is passed through unchanged.
async function _copiedTasks(sharedRead) {
  const tasks = await sharedRead;
  if (!Array.isArray(tasks)) return tasks;
  const copiedTasks = tasks.map(task => (task && typeof task === "object" ? { ...task } : task));
  return copiedTasks;
}

// ------------------------------------------------------------------------------------------
// @desc Gather open (and optionally done) tasks across every task-list note, regardless of task domain.
//   Notes tagged starter-notes are not scanned: their tasks are sample content, and the note handle from
//   this same filterNotes call already carries the tag list.
// @param {Object} app - Amplenote app bridge.
// @param {boolean} includeDone - Whether getNoteTasks should include completed/dismissed tasks.
// @param {number} maxNotes - Cap on notes scanned. Starter notes do not consume it.
// @returns {Promise<Array<Object>>} Task objects with noteUUID/noteName backfilled from the note handle.
async function _allNotesTasks(app, includeDone, maxNotes) {
  const seen = new Set();
  const noteHandles = [];
  let starterNoteCount = 0;
  for await (const handle of (await app.filterNotes({ group: "taskLists" }, "changed"))) {
    if (!handle?.uuid || seen.has(handle.uuid)) continue;
    seen.add(handle.uuid);
    if (_noteCarriesStarterNotesTag(handle)) {
      starterNoteCount += 1;
      continue;
    }
    noteHandles.push(handle);
    if (noteHandles.length >= maxNotes) break;
  }
  logIfEnabled(`[all-notes-tasks] No task domain — scanning ${ noteHandles.length } task-list notes for tasks`);
  if (starterNoteCount > 0) logIfEnabled(`[all-notes-tasks] skipped ${ starterNoteCount } starter notes`);
  const allTasks = await _tasksFromNoteHandles(app, noteHandles, includeDone);
  logIfEnabled(`[all-notes-tasks] Gathered ${ allTasks.length } tasks across all notes (no task domain)`);
  return allTasks;
}

// ------------------------------------------------------------------------------------------
// @desc Whether a note handle from filterNotes is sample content. A missing tag list is not treated as
//   starter content, so a handle that arrived without tags still contributes its tasks.
// @param {Object} handle - Note handle, including its tags array
// @returns {boolean} True when the note carries starter-notes or a child of that tag
function _noteCarriesStarterNotesTag(handle) {
  const tags = Array.isArray(handle?.tags) ? handle.tags : [];
  return tags.some(tag => tag === STARTER_NOTES_TAG || String(tag).startsWith(`${ STARTER_NOTES_TAG }/`));
}

// ------------------------------------------------------------------------------------------
// @desc Read the tasks of every note a task domain lists, including completed and dismissed tasks when asked. The
//   domain's own task list carries open tasks only, so a note that joined the domain holding only finished work
//   shows up here and nowhere in getTaskDomainTasks. The domain's notes include those it holds by tag as well as
//   those added individually; a legacy domain can list every note, so the most recently updated maxNotes are read.
// @param {Object} app - Amplenote app bridge.
// @param {string} domainUuid - Task domain UUID.
// @param {Object} [options] - An object with the following properties:
//   - {boolean} includeDone - Include completed/dismissed tasks. Default false.
//   - {number} maxNotes - Cap on notes read. Default MAX_ALL_NOTES_TO_SCAN.
// @returns {Promise<Object>} { domainFound, domainNoteCount, readNoteCount, tasks }: tasks carry noteUUID/noteName
//   from the owning note handle; domainFound is false, with no tasks, when the host lists no such domain.
export async function fetchTaskDomainNoteTasks(app, domainUuid, { includeDone = false, maxNotes = MAX_ALL_NOTES_TO_SCAN } = {}) {
  const taskDomains = typeof app?.getTaskDomains === "function" ? await app.getTaskDomains() : null;
  const taskDomain = Array.isArray(taskDomains) ? taskDomains.find(domain => domain?.uuid === domainUuid) : null;
  if (!taskDomain) return { domainFound: false, domainNoteCount: 0, readNoteCount: 0, tasks: [] };
  const domainNotes = Array.isArray(taskDomain.notes) ? taskDomain.notes.filter(note => note?.uuid) : [];
  const updatedMilliseconds = note => Date.parse(note.updated ?? "") || 0;
  const recentNotes = domainNotes.slice().sort((first, second) => updatedMilliseconds(second) - updatedMilliseconds(first));
  const noteHandles = recentNotes.slice(0, maxNotes);
  const tasks = await _tasksFromNoteHandles(app, noteHandles, includeDone);
  return { domainFound: true, domainNoteCount: domainNotes.length, readNoteCount: noteHandles.length, tasks };
}

// ------------------------------------------------------------------------------------------
// @desc Read each note's tasks, naming every task's note from the handle when the host left it out.
// @param {Object} app - Amplenote app bridge.
// @param {Array<Object>} noteHandles - Notes to read, each with a uuid.
// @param {boolean} includeDone - Whether getNoteTasks should include completed/dismissed tasks.
// @returns {Promise<Array<Object>>} Task objects with noteUUID/noteName backfilled; a note whose read fails is skipped.
async function _tasksFromNoteHandles(app, noteHandles, includeDone) {
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
  return allTasks;
}
