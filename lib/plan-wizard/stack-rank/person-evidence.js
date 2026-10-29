// Widen a person's dictionary evidence beyond a notebook search for their name. Who someone is to the account owner
// shows less in prose that names them than in where they are linked and what work they come up in, so a person's
// evidence leads with:
//
//   - the opening of each note an "@Name" link points at, which is the user's own page about that person;
//   - the open tasks naming them by any of their names, grouped by the note each sits in, so the note's name says which
//     project or area the work belongs to ("video scripts", "customer onboarding");
//   - for an Amplenote user linked with "@@Name", the names of the notes the owner shares with them.
//
// The search passages follow within the same limits as any term. The source digest covers every passage, so a new task
// naming the person brings their definition back to refinement.
import { TERM_ALIAS_SEPARATOR } from "plan-wizard/stack-rank/dictionary-people";
import { termPattern } from "plan-wizard/stack-rank/dictionary-term-discovery";
import { EVIDENCE_OUTCOMES, isPluginMaintainedNote, MAXIMUM_EVIDENCE_CHARACTERS, MAXIMUM_EVIDENCE_PASSAGES,
  MAXIMUM_PASSAGE_CHARACTERS } from "plan-wizard/stack-rank/dictionary-term-evidence";
import { readableTaskText } from "plan-wizard/stack-rank/person-mentions";
import { parsedRichFootnotes, passageWithResolvedFootnotes } from "util/amplenote-rich-footnotes";
import { logIfEnabled } from "util/log";
import { textDigest } from "util/text-digest";

// The most linked notes read, task notes grouped, tasks listed per note, and shared note names listed.
const MAXIMUM_LINKED_NOTES = 2;
const MAXIMUM_SHARED_NOTE_NAMES = 6;
const MAXIMUM_TASK_NOTES = 3;
const MAXIMUM_TASKS_PER_NOTE = 6;
const LOG_LABEL = "[person-evidence]";

// ----------------------------------------------------------------------------------------------
// @desc Add a person's linked notes, the tasks naming them, and their shared notes to the evidence a search collected.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - An object with the following properties:
//   - {object} evidence - A record from collectTermEvidence
//   - {object} links - { noteUuids, personUuids } from personLinksForNames
//   - {Array<string>} names - The person's term and aliases
//   - {Array<string>} ownerNames - The account owner's names, kept with the record for refinement
//   - {Array<object>} tasks - The domain's tasks as read
// @returns {Promise<object>} The evidence record with the person's passages first, its sources, outcome, and digest
//   recomputed, and isPerson and ownerNames set.
export async function personEvidence(app, { evidence, links, names, ownerNames, tasks }) {
  const leadingNotes = [
    ...await _linkedNotePassages(app, links.noteUuids),
    ...await _taskPassages(app, { names, tasks }),
    ...await _sharedNotePassages(app, { names, personUuids: links.personUuids }),
  ];
  const searchNoteNames = new Map((evidence.sources || []).map(source => [source.noteUuid, source.noteName]));
  const candidates = [...leadingNotes, ...evidence.passages.map(passage => ({ ...passage, noteName: searchNoteNames.get(passage.noteUuid) }))];
  const passages = _boundedPassages(candidates);
  const sources = _sources(passages, evidence.sources || []);
  const sortedTexts = passages.map(passage => passage.text).sort();
  const sourceDigest = passages.length ? textDigest(sortedTexts.join("\n")) : null;
  const outcome = passages.length ? EVIDENCE_OUTCOMES.found : evidence.outcome;
  logIfEnabled(LOG_LABEL, { leadingPassageCount: leadingNotes.length, passageCount: passages.length, term: evidence.term });
  return { ...evidence, isPerson: true, outcome, ownerNames, passages: passages.map(({ noteUuid, text }) => ({ noteUuid, text })),
    sourceDigest, sources };
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Keep passages in order up to MAXIMUM_EVIDENCE_PASSAGES and MAXIMUM_EVIDENCE_CHARACTERS, dropping copies.
// @param {Array<object>} candidates - { noteName, noteUuid, text }.
// @returns {Array<object>} The passages kept.
function _boundedPassages(candidates) {
  const kept = [];
  const seenTexts = new Set();
  let characterCount = 0;
  for (const candidate of candidates) {
    const comparable = candidate.text.replace(/\s+/g, " ").trim().toLowerCase();
    if (!comparable || seenTexts.has(comparable) || characterCount + candidate.text.length > MAXIMUM_EVIDENCE_CHARACTERS) continue;
    seenTexts.add(comparable);
    characterCount += candidate.text.length;
    kept.push(candidate);
    if (kept.length >= MAXIMUM_EVIDENCE_PASSAGES) break;
  }
  return kept;
}

// ----------------------------------------------------------------------------------------------
// @desc A note's name and tags, or null when it cannot be found.
// @param {object} app - Host-compatible Amplenote API.
// @param {string} uuid - The note's UUID.
// @returns {Promise<object|null>} The handle findNote returned.
async function _foundNote(app, uuid) {
  try {
    return (await app.findNote({ uuid })) || null;
  } catch (error) {
    logIfEnabled(LOG_LABEL, "findNote failed", { message: error?.message, uuid });
    return null;
  }
}

// ----------------------------------------------------------------------------------------------
// @desc The opening of each linked note, footnotes resolved, as the user's own page about the person. A note the plugin
//   maintains, or one that cannot be read, gives nothing.
// @param {object} app - Host-compatible Amplenote API.
// @param {Array<string>} noteUuids - Linked notes, newest last.
// @returns {Promise<Array<object>>} { noteName, noteUuid, text }.
async function _linkedNotePassages(app, noteUuids) {
  const passages = [];
  for (const noteUuid of [...noteUuids].reverse().slice(0, MAXIMUM_LINKED_NOTES)) {
    const handle = await _foundNote(app, noteUuid);
    if (!handle || isPluginMaintainedNote(handle)) continue;
    let content = null;
    try {
      content = await app.getNoteContent({ uuid: noteUuid });
    } catch (error) {
      logIfEnabled(LOG_LABEL, "getNoteContent failed", { message: error?.message, noteUuid });
    }
    if (typeof content !== "string" || !content.trim()) continue;
    const { body, definitions } = parsedRichFootnotes(content);
    const opening = passageWithResolvedFootnotes(body.trim(), definitions).slice(0, MAXIMUM_PASSAGE_CHARACTERS).trim();
    passages.push({ noteName: handle.name || null, noteUuid, text: `The person's own note:\n${ opening }` });
  }
  return passages;
}

// ----------------------------------------------------------------------------------------------
// @desc One passage naming the notes the owner shares with the person, when an "@@" link identifies them as an
//   Amplenote user whom app.getPeople lists.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { names, personUuids }.
// @returns {Promise<Array<object>>} Zero or one { noteName, noteUuid, text }.
async function _sharedNotePassages(app, { names, personUuids }) {
  if (!personUuids.length || typeof app.getPeople !== "function") return [];
  let people = [];
  try {
    people = (await app.getPeople()) || [];
  } catch (error) {
    logIfEnabled(LOG_LABEL, "getPeople failed", error?.message);
  }
  const sharedNoteUuids = (Array.isArray(people) ? people : []).filter(person => personUuids.includes(person?.uuid))
    .flatMap(person => person.sharing?.notes || []);
  const sharedHandles = [];
  for (const noteUuid of sharedNoteUuids.slice(0, MAXIMUM_SHARED_NOTE_NAMES)) {
    const handle = await _foundNote(app, noteUuid);
    if (handle?.name) sharedHandles.push({ name: handle.name, uuid: noteUuid });
  }
  if (!sharedHandles.length) return [];
  const noteNames = sharedHandles.map(handle => `- ${ handle.name }`);
  const text = `Notes the owner shares with ${ names[0] } (${ sharedNoteUuids.length } in all):\n${ noteNames.join("\n") }`;
  return [{ noteName: sharedHandles[0].name, noteUuid: sharedHandles[0].uuid, text }];
}

// ----------------------------------------------------------------------------------------------
// @desc Describe each passage's note, keeping the search's description of a note it already read.
// @param {Array<object>} passages - Kept passages with noteName and noteUuid.
// @param {Array<object>} searchSources - The search's sources.
// @returns {Array<object>} { contentDigest, noteName, noteUuid, passageCount } in passage order.
function _sources(passages, searchSources) {
  const searchSourceByUuid = new Map(searchSources.map(source => [source.noteUuid, source]));
  const sourceByUuid = new Map();
  for (const passage of passages) {
    const existing = sourceByUuid.get(passage.noteUuid);
    if (existing) { existing.passageCount += 1; continue; }
    const searchSource = searchSourceByUuid.get(passage.noteUuid);
    sourceByUuid.set(passage.noteUuid, { contentDigest: searchSource?.contentDigest || textDigest(passage.text),
      noteName: searchSource?.noteName || passage.noteName || null, noteUuid: passage.noteUuid, passageCount: 1 });
  }
  return [...sourceByUuid.values()];
}

// ----------------------------------------------------------------------------------------------
// @desc The open tasks naming the person by any of their names, one passage per note, the notes with the most such
//   tasks first.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { names, tasks }.
// @returns {Promise<Array<object>>} { noteName, noteUuid, text }.
async function _taskPassages(app, { names, tasks }) {
  const pattern = termPattern(names.join(TERM_ALIAS_SEPARATOR));
  const namingTasks = (tasks || []).filter(task => task?.noteUUID && !task.completedAt && !task.dismissedAt
    && pattern.test(readableTaskText(task.content)));
  const tasksByNote = new Map();
  for (const task of namingTasks) tasksByNote.set(task.noteUUID, [...(tasksByNote.get(task.noteUUID) || []), task]);
  const busiestNotes = [...tasksByNote.entries()].sort((first, second) => second[1].length - first[1].length);
  const passages = [];
  for (const [noteUuid, noteTasks] of busiestNotes.slice(0, MAXIMUM_TASK_NOTES)) {
    const handle = await _foundNote(app, noteUuid);
    const noteName = handle?.name || null;
    const taskLines = noteTasks.slice(0, MAXIMUM_TASKS_PER_NOTE).map(task => `- ${ readableTaskText(task.content) }`);
    const heading = `Open tasks naming ${ names[0] } in the note "${ noteName || "Untitled" }" (${ noteTasks.length } in all):`;
    passages.push({ noteName, noteUuid, text: `${ heading }\n${ taskLines.join("\n") }`.slice(0, MAXIMUM_PASSAGE_CHARACTERS) });
  }
  return passages;
}
