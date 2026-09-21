// Describe what project discovery reasons over, in the terms the projects page's sources page shows it: the intents
// a project has to carry, the notes where the most important and most finished work sits, and how many notes and
// tasks the prompt was built from. The summary is available as soon as the evidence is collected, before the
// provider answers, so a user waiting on discovery can see what it is working from. It also carries each considered
// task's text, since a stored project cites its tasks by UUID alone and the page lists a project's tasks on request.
// Host-compatible, since the service that runs discovery imports it.

import { noteNameFromHandle } from "plan-wizard/intent-evidence";

export const MAXIMUM_SOURCE_NOTES = 12;
// Task-domain retrieval often omits note names, so the page's notes are named by handle lookups, bounded here.
const MAXIMUM_NAMED_NOTES = 40;

// ----------------------------------------------------------------------------------------------
// @desc Rank the notes behind discovery's evidence: notes holding important tasks, and notes where tasks were
//   finished in the past month. A note counted by both signals is listed once with both counts.
// @param {object} evidence - Bundle from collectProspectEvidence.
// @returns {Array<object>} Up to MAXIMUM_SOURCE_NOTES { completedTaskCount, importantTaskCount, noteName, noteUuid,
//   openTaskCount }, ranked by important plus completed tasks, then by open tasks.
function sourceNotesFromEvidence(evidence) {
  const noteByUuid = new Map();
  for (const activeNote of evidence.activeNotes ?? []) {
    noteByUuid.set(activeNote.noteUuid, { importantTaskCount: 0, ...activeNote });
  }
  for (const reference of evidence.importantReferences ?? []) {
    if (!reference.noteUuid) continue;
    const sourceNote = noteByUuid.get(reference.noteUuid) ?? { completedTaskCount: 0, importantTaskCount: 0,
      noteName: reference.noteName ?? null, noteUuid: reference.noteUuid, openTaskCount: 0 };
    sourceNote.importantTaskCount += 1;
    noteByUuid.set(reference.noteUuid, sourceNote);
  }
  const sourceNotes = [...noteByUuid.values()];
  const rankedNotes = sourceNotes.sort((first, second) =>
    (second.importantTaskCount + second.completedTaskCount) - (first.importantTaskCount + first.completedTaskCount)
    || second.openTaskCount - first.openTaskCount);
  return rankedNotes.slice(0, MAXIMUM_SOURCE_NOTES);
}

// ----------------------------------------------------------------------------------------------
// @desc Index the considered tasks by UUID so the page can list the tasks a project cites.
// @param {Array<object>} importantReferences - References to tasks marked important.
// @param {Array<object>} allReferences - Every reference across the important, completed, and recent signals.
// @returns {object} Map of taskUuid to { completedAt, isImportant, noteName, noteUuid, text }, as a plain object so
//   the summary stays JSON-serializable.
function taskByUuidFromReferences(importantReferences, allReferences) {
  const importantTaskUuids = new Set(importantReferences.map(reference => reference.taskUuid));
  const taskByUuid = {};
  for (const reference of allReferences) {
    if (!reference.taskUuid || taskByUuid[reference.taskUuid]) continue;
    taskByUuid[reference.taskUuid] = { completedAt: reference.completedAt ?? null,
      isImportant: importantTaskUuids.has(reference.taskUuid), noteName: reference.noteName ?? null,
      noteUuid: reference.noteUuid ?? null, text: reference.text ?? "" };
  }
  return taskByUuid;
}

// ----------------------------------------------------------------------------------------------
// @desc Summarize a discovery evidence bundle for the sources page.
// @param {object} evidence - Bundle from collectProspectEvidence.
// @returns {object} An object with the following properties:
//   - {number} consideredNoteCount - Distinct notes the prompt's tasks came from.
//   - {number} consideredTaskCount - Distinct tasks the prompt listed, across the important, completed, and recent
//     signals.
//   - {Array<object>} intents - { goalText, userCategoryEm, uuid } for each chosen intent.
//   - {Array<object>} notes - Ranked source notes from sourceNotesFromEvidence.
//   - {object} taskByUuid - Considered tasks by UUID, from taskByUuidFromReferences.
// Counts are of what the prompt contained rather than everything in the domain, since that is what the projects
//   were drawn from.
export function projectSourcesFromEvidence(evidence) {
  const importantReferences = evidence.importantReferences ?? [];
  const allReferences = importantReferences.concat(evidence.completedReferences ?? [], evidence.recentReferences ?? []);
  const taskUuids = new Set(allReferences.map(reference => reference.taskUuid).filter(Boolean));
  const noteUuids = new Set(allReferences.map(reference => reference.noteUuid).filter(Boolean));
  const intents = (evidence.chosenGoals ?? []).map(goal => ({ goalText: goal.goalText, userCategoryEm: goal.userCategoryEm,
    uuid: goal.uuid }));
  return { consideredNoteCount: noteUuids.size, consideredTaskCount: taskUuids.size, intents,
    notes: sourceNotesFromEvidence(evidence), taskByUuid: taskByUuidFromReferences(importantReferences, allReferences) };
}

// ----------------------------------------------------------------------------------------------
// @desc Fill in the names of source notes and task notes that arrived untitled, by looking up each note's handle.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} projectSources - Summary from projectSourcesFromEvidence.
// @returns {Promise<object>} A copy of the summary with names filled where a lookup found one. Listed notes are
//   looked up first, then the notes of considered tasks, up to MAXIMUM_NAMED_NOTES lookups in all.
export async function withNamedSourceNotes(app, projectSources) {
  const consideredTasks = Object.values(projectSources.taskByUuid);
  const unnamedItems = projectSources.notes.concat(consideredTasks).filter(item => item.noteUuid && !item.noteName);
  const unnamedNoteUuids = unnamedItems.map(item => item.noteUuid);
  const lookupNoteUuids = [...new Set(unnamedNoteUuids)].slice(0, MAXIMUM_NAMED_NOTES);
  const noteNames = await Promise.all(lookupNoteUuids.map(noteUuid => noteNameFromHandle(app, noteUuid)));
  const nameByNoteUuid = new Map(lookupNoteUuids.map((noteUuid, index) => [noteUuid, noteNames[index]]));
  const namedItem = item => ({ ...item, noteName: item.noteName ?? nameByNoteUuid.get(item.noteUuid) ?? null });
  const notes = projectSources.notes.map(namedItem);
  const taskEntries = Object.entries(projectSources.taskByUuid).map(([taskUuid, task]) => [taskUuid, namedItem(task)]);
  return { ...projectSources, notes, taskByUuid: Object.fromEntries(taskEntries) };
}
