// Find the notes a user might pick to define a project on the projects page. Only notes that hold tasks are offered,
// and only notes no project on the page already uses. Before anything is typed the menu lists the notes whose names
// best match the project's name, then the notes changed most recently; once the user types, it lists the notes whose
// names contain every typed word. Kept free of React so the ranking rules can be tested on their own, and
// host-compatible since it only reads through the app interface.

import { isAmplenoteMergeReport, isPluginMaintainedNote } from "plan-wizard/stack-rank/dictionary-term-evidence";
import { lastUpdatedLabelFromMs, timestampMsFromValue } from "shared-notes-service";

export const MAXIMUM_BEST_MATCHES = 3;
export const MAXIMUM_RECENT_NOTES = 10;
export const MAXIMUM_TYPED_MATCHES = 8;
// The Amplenote note group holding every note that has tasks in it.
const TASK_LIST_GROUP = "taskLists";
// Recently changed notes with tasks scanned for name matches; enough to cover active work.
const MAXIMUM_SCANNED_RECENT_NOTES = 200;
// Words too common in project names to say anything about which note a project lives in.
const IGNORED_NAME_WORDS = new Set(["and", "for", "from", "into", "one", "our", "plan", "project", "the", "this",
  "with", "your"]);

// ----------------------------------------------------------------------------------------------
// @desc Describe one note handle the way the search menu lists it.
// @param {object} handle - Note handle from filterNotes.
// @param {number} nowMs - Reference time for the edited label.
// @returns {object} { editedLabel, name, tagLabel, taskCount, updatedMs, uuid }; taskCount stays null until
//   withTaskCounts fills it.
function candidateFromHandle(handle, nowMs) {
  const updatedMs = timestampMsFromValue(handle.updated ?? handle.changed) || 0;
  const tags = Array.isArray(handle.tags) ? handle.tags.map(String) : [];
  return { editedLabel: updatedMs ? `edited ${ lastUpdatedLabelFromMs(updatedMs, nowMs) }` : "",
    name: handle.name || "Untitled note", tagLabel: tags[0] ?? "", taskCount: null, updatedMs, uuid: handle.uuid };
}

// ----------------------------------------------------------------------------------------------
// @desc Read at most a number of handles from a filterNotes or searchNotes result, stopping early when the host
//   returns an async iterable so a large account is not drained to list a handful of notes.
// @param {Promise|Array|AsyncIterable|null} result - The value the host call returned.
// @param {number} maximumCount - The most handles to keep.
// @returns {Promise<Array<object>>} Handles in the order the host gave them.
async function leadingHandles(result, maximumCount) {
  const resolved = await result;
  if (Array.isArray(resolved)) return resolved.slice(0, maximumCount);
  if (!resolved || typeof resolved[Symbol.asyncIterator] !== "function") return [];
  const handles = [];
  for await (const handle of resolved) {
    handles.push(handle);
    if (handles.length >= maximumCount) break;
  }
  return handles;
}

// ----------------------------------------------------------------------------------------------
// @desc Score how much of a project's name a note's name repeats, as the share of the project's meaningful words
//   that the note's name also contains. Words match on a shared stem of five letters, so "Automate" meets
//   "automation" and "release" meets "releases".
// @param {string} projectName - The project's name, or the text typed into the search.
// @param {string} noteName - The candidate note's name.
// @returns {number} 0 when nothing is shared, up to 1 when every meaningful word is.
export function noteNameSimilarity(projectName, noteName) {
  const projectWords = meaningfulWords(projectName);
  if (!projectWords.length) return 0;
  const noteStems = new Set(meaningfulWords(noteName).map(word => word.slice(0, 5)));
  const sharedWords = projectWords.filter(word => noteStems.has(word.slice(0, 5)));
  return sharedWords.length / projectWords.length;
}

// ----------------------------------------------------------------------------------------------
// @desc Split text into the lowercase words that can tell one project from another.
// @param {string} text - A project or note name.
// @returns {Array<string>} Distinct words of three letters or more, common planning words left out.
function meaningfulWords(text) {
  const words = String(text ?? "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const keptWords = words.filter(word => word.length >= 3 && !IGNORED_NAME_WORDS.has(word));
  return [...new Set(keptWords)];
}

// ----------------------------------------------------------------------------------------------
// @desc Whether a note's name contains every word typed into the search, ignoring case, so "q1 rev" finds
//   "Q1 Goal Review".
// @param {string} searchText - What the user typed.
// @param {string} noteName - The candidate note's name.
// @returns {boolean} True when each whitespace-separated word appears somewhere in the name.
export function noteNameContainsWords(searchText, noteName) {
  const typedWords = String(searchText ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const lowercaseName = String(noteName ?? "").toLowerCase();
  return typedWords.every(word => lowercaseName.includes(word));
}

// ----------------------------------------------------------------------------------------------
// @desc Read the notes the search menu offers, all drawn from the notes that hold tasks, leaving out notes the
//   Dashboard maintains for itself, merge reports, and notes already defining a project on the page (this one's
//   included, since choosing it again changes nothing).
//   With nothing typed: best matches by how much of the project's name a note's name repeats, then the notes changed
//   most recently. With text typed: the most recently changed notes whose names contain every typed word, found among
//   recent notes and a name query to the host, so an older note can still be reached by typing its name.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} params - An object with the following properties:
//   - {object} [linkedRowUuidByNoteUuid={}] - { [noteUuid]: rowUuid } for notes already defining a project.
//   - {Date} [now=new Date()] - Reference time for edited labels.
//   - {string} projectName - The project's name, used to rank best matches before anything is typed.
//   - {string} searchText - What the user typed into the search, or "".
// @returns {Promise<object>} { bestMatches, recentlyEdited }, each an array of candidates from candidateFromHandle;
//   with text typed, bestMatches holds the name matches and recentlyEdited is empty.
export async function readProjectNoteCandidates(app, { linkedRowUuidByNoteUuid = {}, now = new Date(), projectName,
    searchText }) {
  const trimmedSearch = String(searchText ?? "").trim();
  const queriedResult = trimmedSearch ? app.filterNotes({ group: TASK_LIST_GROUP, query: trimmedSearch }) : null;
  const [queriedHandles, recentHandles] = await Promise.all([
    leadingHandles(queriedResult, MAXIMUM_SCANNED_RECENT_NOTES).catch(() => []),
    leadingHandles(app.filterNotes({ group: TASK_LIST_GROUP }, "changed"), MAXIMUM_SCANNED_RECENT_NOTES).catch(() => []) ]);
  const usableHandle = handle => handle?.uuid && !linkedRowUuidByNoteUuid[handle.uuid] && !isPluginMaintainedNote(handle)
    && !isAmplenoteMergeReport(handle);
  const usableHandles = recentHandles.concat(queriedHandles).filter(usableHandle);
  const handleByUuid = new Map(usableHandles.map(handle => [handle.uuid, handle]));
  const candidates = [...handleByUuid.values()].map(handle => candidateFromHandle(handle, now.getTime()));
  const newestCandidates = candidates.sort((first, second) => second.updatedMs - first.updatedMs);
  if (trimmedSearch) {
    const namedCandidates = newestCandidates.filter(candidate => noteNameContainsWords(trimmedSearch, candidate.name));
    return { bestMatches: namedCandidates.slice(0, MAXIMUM_TYPED_MATCHES), recentlyEdited: [] };
  }
  const scoreOf = candidate => noteNameSimilarity(projectName, candidate.name);
  const matchingCandidates = newestCandidates.filter(candidate => scoreOf(candidate) > 0);
  const rankedMatches = matchingCandidates.sort((first, second) => scoreOf(second) - scoreOf(first)
    || second.updatedMs - first.updatedMs);
  const bestMatches = rankedMatches.slice(0, MAXIMUM_BEST_MATCHES);
  const bestMatchUuids = new Set(bestMatches.map(candidate => candidate.uuid));
  const unlistedCandidates = newestCandidates.filter(candidate => !bestMatchUuids.has(candidate.uuid));
  return { bestMatches, recentlyEdited: unlistedCandidates.slice(0, MAXIMUM_RECENT_NOTES) };
}

// ----------------------------------------------------------------------------------------------
// @desc Count each candidate note's tasks, finished ones included, so the menu can say how much work a note holds.
// @param {object} app - Host-compatible Amplenote API exposing getNoteTasks.
// @param {Array<object>} candidates - Candidates from readProjectNoteCandidates.
// @returns {Promise<Array<object>>} The same candidates with taskCount filled; a note whose tasks cannot be read
//   keeps taskCount null.
export async function withTaskCounts(app, candidates) {
  const taskCounts = await Promise.all(candidates.map(async candidate => {
    try {
      const tasks = await app.getNoteTasks({ uuid: candidate.uuid }, { includeDone: true });
      return Array.isArray(tasks) ? tasks.length : null;
    } catch (_error) {
      return null;
    }
  }));
  const countedCandidates = candidates.map((candidate, index) => ({ ...candidate, taskCount: taskCounts[index] }));
  return countedCandidates;
}
