// Offer recent task notes to a sparse planning domain, then refresh the shared task read before discovery starts.

import { checkedAppResult } from "plan-wizard/vision-guide-notes";
import { fetchDomainOrAllNotesTasks, forgetSharedTaskReads } from "util/all-notes-tasks";
import { logIfEnabled } from "util/log";
import { arrayFromFilterNotesResult } from "util/note-handles";

export const MINIMUM_PLAN_DOMAIN_TASKS = 20;
const RECENT_NOTE_WINDOW_MILLISECONDS = 30 * 86400000;
const INCLUDE_NOTES_ACTION = "include-task-notes";

// ----------------------------------------------------------------------------------------------
// @desc Tag the approved notes and include them directly in the selected domain, whose filters may not use todo.
//   Failed notes are counted individually so the remaining approved notes can still be included.
// @param {object} app - Amplenote app interface.
// @param {object} options - { domainUuid, isActive, notes }; isActive guards writes after closing or switching scope.
// @returns {Promise<number>} Number of notes that could not be tagged or included.
async function includeRecentTaskNotes(app, { domainUuid, isActive, notes }) {
  let failedNoteCount = 0;
  for (const note of notes) {
    if (!isActive()) break;
    try {
      const handle = { uuid: note.uuid };
      const tagged = checkedAppResult(await app.addNoteTag(handle, "todo"));
      if (!tagged) throw new Error("Could not add the todo tag");
      if (!isActive()) break;
      const included = checkedAppResult(await app.addTaskDomainNote(domainUuid, handle));
      if (!included) throw new Error("Could not include the note in the Task Domain");
    } catch (error) {
      failedNoteCount += 1;
      logIfEnabled("[plan-task-domain-fallback] could not include note", { message: error?.message, noteUuid: note.uuid });
    }
  }
  return failedNoteCount;
}

// ----------------------------------------------------------------------------------------------
// @desc When a domain has fewer than twenty open tasks, ask before adding todo to recent task notes. A fresh
//   domain read replaces the shared cache after approval, so intent and project discovery see the added tasks.
// @param {object} app - Amplenote app interface with task-domain, note-filter, tagging, and alert methods.
// @param {object} options - { domainName, domainUuid, isActive, referenceDate }; isActive cancels pending work when
//   the builder closes or changes scope. All Notes has no domain to expand and skips this fallback.
// @returns {Promise<void>} Resolves after the optional prompt, writes, and task refresh.
export async function preparePlanTaskDomain(app, { domainName = null, domainUuid = null, isActive = () => true,
    referenceDate = new Date() } = {}) {
  if (!domainUuid || !isActive() || typeof app.getTaskDomainTasks !== "function") return;
  const tasks = await fetchDomainOrAllNotesTasks(app, domainUuid, { includeDone: true });
  const openTasks = tasks.filter(task => task && !task.completedAt && !task.dismissedAt);
  if (!isActive() || openTasks.length >= MINIMUM_PLAN_DOMAIN_TASKS) return;
  if (typeof app.addNoteTag !== "function" || typeof app.addTaskDomainNote !== "function" || typeof app.alert !== "function") return;
  const taskNotes = await arrayFromFilterNotesResult(app.filterNotes({ group: "taskLists", tag: "^todo" }, "changed"));
  const notes = recentTaskNotesWithoutTodo(taskNotes, referenceDate);
  if (!isActive() || !notes.length) return;
  const domainLabel = domainName || "current";
  const noteLabel = notes.length === 1 ? "note" : "notes";
  const message = `Your ${ domainLabel } Task Domain has ${ openTasks.length } tasks. We found ${ notes.length } ${ noteLabel } `
    + "with open tasks changed in the past month that aren't tagged todo. Include these notes in this Task Domain "
    + "so Plan Builder can suggest projects from them? This adds the todo tag to each note.";
  const action = await app.alert(message, { actions: [{ label: "Include notes", value: INCLUDE_NOTES_ACTION }],
    preface: "Build your plan from more tasks", primaryAction: { label: "Not now" } });
  if (!isActive() || action !== INCLUDE_NOTES_ACTION) return;
  const failedNoteCount = await includeRecentTaskNotes(app, { domainUuid, isActive, notes });
  forgetSharedTaskReads(app);
  await fetchDomainOrAllNotesTasks(app, domainUuid, { fresh: true, includeDone: true });
  if (isActive() && failedNoteCount) {
    await app.alert(`${ failedNoteCount } of ${ notes.length } notes could not be included. Plan Builder will use the tasks available in this Task Domain.`);
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Keep distinct notes changed within the rolling month that do not already inherit the todo tag.
// @param {Array<object>} taskNotes - Note handles from the taskLists filter, which guarantees open tasks.
// @param {Date} referenceDate - End of the thirty-day window.
// @returns {Array<object>} Unique eligible note handles, preserving the filter's order.
function recentTaskNotesWithoutTodo(taskNotes, referenceDate) {
  const windowEnd = referenceDate.getTime();
  const windowStart = windowEnd - RECENT_NOTE_WINDOW_MILLISECONDS;
  const notesByUuid = new Map();
  for (const note of taskNotes) {
    if (!note?.uuid || note.archived) continue;
    const tags = Array.isArray(note.tags) ? note.tags : [];
    if (tags.some(tag => tag === "todo" || tag.startsWith("todo/"))) continue;
    const changedAt = Date.parse(note.changed ?? note.updated);
    if (changedAt >= windowStart && changedAt <= windowEnd) notesByUuid.set(note.uuid, note);
  }
  return [...notesByUuid.values()];
}
