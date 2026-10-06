// The idea records a project keeps for its generated next actions: each idea's stable identity, its project, its text,
// when and from which inputs it was generated, the idea it replaced, the note it should be created in, and whether the
// user took it on or turned it down.
// Records written before ideas had identities hold only { generatedAt, taskText }; they read as open ideas whose
// identity is derived from their project and text, so every reader gives a legacy idea the same ID until a write stores
// it. Ideas are compared by a key that ignores case, punctuation, and spacing, so a trivial rewording of an idea the
// user already took on or turned down is recognized as that idea rather than suggested again.
import { textDigest } from "util/text-digest";

// What the user has done with an idea: nothing yet, taken it on as a task, or turned it down.
export const IDEA_STATUSES = Object.freeze({ accepted: "accepted", dismissed: "dismissed", open: "open" });
// How many decided ideas a project keeps as history for the idea prompt, the most recently decided kept.
export const MAXIMUM_DECIDED_IDEAS = 20;

// ----------------------------------------------------------------------------------------------
// @desc Apply the user's decisions on ideas they were shown. Accepting records the task the idea became; an idea
//   already accepted keeps the task it was first accepted as, so a retried acceptance never points it at a duplicate.
//   An idea done on the spot, which leaves no task UUID behind, is accepted without one and takes the first one a later
//   acceptance names. Turning down an open idea dismisses it, while an accepted idea stays accepted. A decision naming
//   an idea the project no longer holds changes nothing.
// @param {Array<object>} ideas - Normalized idea records.
// @param {Array<object>} decisions - { acceptedTaskUuid, ideaId, status }: status is IDEA_STATUSES.accepted or
//   IDEA_STATUSES.dismissed; acceptedTaskUuid names the task an accepted idea became, or is null when none was made.
// @param {object} options - { decidedAt }: ISO time of the decisions.
// @returns {object} { changedCount, ideas }: how many ideas changed, and the updated records.
export function decidedIdeaRecords(ideas, decisions, { decidedAt }) {
  const decisionById = new Map((decisions || []).map(decision => [decision.ideaId, decision]));
  let changedCount = 0;
  const updatedIdeas = ideas.map(idea => {
    const decision = decisionById.get(idea.ideaId);
    const updated = decision ? _decidedIdea(idea, decision, decidedAt) : idea;
    if (updated !== idea) changedCount += 1;
    return updated;
  });
  return { changedCount, ideas: _withBoundedHistory(updatedIdeas) };
}

// ----------------------------------------------------------------------------------------------
// @desc Reduce idea text to the key two phrasings of the same idea share: lowercase words, without punctuation or
//   extra spacing.
// @param {string} taskText - Idea or task text.
// @returns {string} The comparison key, empty for text with no words.
export function ideaComparisonKey(taskText) {
  const lowered = (taskText || "").toLowerCase();
  const words = lowered.replace(/[^\p{L}\p{N}\s]+/gu, " ").trim();
  return words.replace(/\s+/g, " ");
}

// ----------------------------------------------------------------------------------------------
// @desc Derive the stable identity of an idea from its project and its comparison key.
// @param {string} projectUuid - The project the idea belongs to.
// @param {string} taskText - The idea's text.
// @returns {string} "idea-" followed by eight hex characters.
export function ideaIdFor(projectUuid, taskText) {
  return `idea-${ textDigest(`${ projectUuid }\n${ ideaComparisonKey(taskText) }`) }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Mark the open ideas the user has since taken on as tasks: an open task whose text has an open idea's comparison
//   key accepts that idea, recording the task's UUID.
// @param {Array<object>} ideas - Normalized idea records.
// @param {object} options - { decidedAt, openTaskRecords }: openTaskRecords as { taskText, taskUuid }.
// @returns {Array<object>} The ideas, with accepted ones replaced by accepted copies.
export function ideasAcceptedByTasks(ideas, { decidedAt, openTaskRecords }) {
  const taskUuidByKey = new Map((openTaskRecords || []).map(record => [ideaComparisonKey(record.taskText), record.taskUuid]));
  const updatedIdeas = ideas.map(idea => {
    const taskUuid = taskUuidByKey.get(ideaComparisonKey(idea.taskText));
    if (idea.status !== IDEA_STATUSES.open || !taskUuid) return idea;
    return { ...idea, acceptedTaskUuid: taskUuid, decidedAt, status: IDEA_STATUSES.accepted };
  });
  return updatedIdeas;
}

// ----------------------------------------------------------------------------------------------
// @desc Fold newly generated ideas into the ones a project holds. An idea naming an open one in `beforeTask` replaces it
//   at its position and records the replaced idea's ID, so a refinement reads as the same suggestion improved rather
//   than as a second nearly identical one. An idea matching any held idea, open or decided, is not added again. Decided
//   ideas past MAXIMUM_DECIDED_IDEAS are dropped, the earliest decided first.
// @param {Array<object>} keptIdeas - Normalized idea records the project holds.
// @param {Array<object>} returnedIdeas - Generated ideas as { beforeTask, generatedAt, noteUuid, taskText }.
// @param {object} options - { projectUuid, sourceRevision }: sourceRevision digests the inputs the ideas were made from.
// @returns {object} { addedCount, ideas }: how many returned ideas were taken, and the merged records.
export function mergedIdeaRecords(keptIdeas, returnedIdeas, { projectUuid, sourceRevision }) {
  const mergedIdeas = [...keptIdeas];
  const heldIds = new Set(keptIdeas.map(idea => idea.ideaId));
  let addedCount = 0;
  for (const returned of returnedIdeas) {
    const ideaId = ideaIdFor(projectUuid, returned.taskText);
    if (heldIds.has(ideaId)) continue;
    const supersededKey = returned.beforeTask ? ideaComparisonKey(returned.beforeTask) : null;
    const supersededIndex = supersededKey ? mergedIdeas.findIndex(idea => idea.status === IDEA_STATUSES.open
      && ideaComparisonKey(idea.taskText) === supersededKey) : -1;
    const supersedesIdeaId = supersededIndex >= 0 ? mergedIdeas[supersededIndex].ideaId : null;
    const newIdea = _ideaRecord({ generatedAt: returned.generatedAt, ideaId, noteUuid: returned.noteUuid, sourceRevision,
      supersedesIdeaId, taskText: returned.taskText }, projectUuid);
    if (supersededIndex >= 0) mergedIdeas[supersededIndex] = newIdea;
    else mergedIdeas.push(newIdea);
    heldIds.add(ideaId);
    addedCount += 1;
  }
  return { addedCount, ideas: _withBoundedHistory(mergedIdeas) };
}

// ----------------------------------------------------------------------------------------------
// @desc Read a project's stored ideas, whatever version wrote them, as complete idea records. Fields this version does
//   not know are kept, since a newer version may have written them. Text-only records become open ideas with derived
//   identities; records without text are dropped, and a repeated identity keeps its first record.
// @param {*} rawIdeas - Ideas as read from a note or passed by a caller.
// @param {object} options - { projectUuid }.
// @returns {Array<object>} Records as { acceptedTaskUuid, decidedAt, generatedAt, ideaId, noteUuid, projectUuid,
//   sourceRevision, status, supersedesIdeaId, taskText }, nulls for what is unknown. noteUuid names the note the idea
//   should be created in; ideas generated before it was recorded hold null.
export function normalizedIdeaRecords(rawIdeas, { projectUuid }) {
  if (!Array.isArray(rawIdeas)) return [];
  const records = [];
  const seenIds = new Set();
  for (const rawIdea of rawIdeas) {
    const taskText = typeof rawIdea?.taskText === "string" ? rawIdea.taskText.trim() : "";
    if (!taskText) continue;
    const record = _ideaRecord({ ...rawIdea, taskText }, projectUuid);
    if (seenIds.has(record.ideaId)) continue;
    seenIds.add(record.ideaId);
    records.push(record);
  }
  return records;
}

// ----------------------------------------------------------------------------------------------
// @desc The ideas still awaiting the user's decision. An idea without a status was written before ideas had one, and
//   is open.
// @param {Array<object>} ideas - Idea records.
// @returns {Array<object>} The open ones, in held order.
export function openIdeas(ideas) {
  return (ideas || []).filter(idea => (idea.status || IDEA_STATUSES.open) === IDEA_STATUSES.open);
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Apply one decision to one idea.
// @param {object} idea - Idea record.
// @param {object} decision - { acceptedTaskUuid, status }.
// @param {string} decidedAt - ISO time of the decision.
// @returns {object} The same record when nothing changes, else an updated copy.
function _decidedIdea(idea, decision, decidedAt) {
  if (decision.status === IDEA_STATUSES.accepted) {
    const wasAccepted = idea.status === IDEA_STATUSES.accepted;
    if (wasAccepted && (idea.acceptedTaskUuid || !decision.acceptedTaskUuid)) return idea;
    return { ...idea, acceptedTaskUuid: decision.acceptedTaskUuid || null, decidedAt: wasAccepted ? idea.decidedAt : decidedAt,
      status: IDEA_STATUSES.accepted };
  }
  if (decision.status !== IDEA_STATUSES.dismissed || idea.status !== IDEA_STATUSES.open) return idea;
  return { ...idea, decidedAt, status: IDEA_STATUSES.dismissed };
}

// ----------------------------------------------------------------------------------------------
// @desc Complete one idea record, deriving its identity when it has none and opening it when its status is unknown.
// @param {object} fields - The idea's fields, with trimmed taskText.
// @param {string} projectUuid - The project the idea belongs to.
// @returns {object} The idea record.
function _ideaRecord(fields, projectUuid) {
  const status = Object.values(IDEA_STATUSES).includes(fields.status) ? fields.status : IDEA_STATUSES.open;
  const ideaId = typeof fields.ideaId === "string" && fields.ideaId ? fields.ideaId : ideaIdFor(projectUuid, fields.taskText);
  return { ...fields, acceptedTaskUuid: fields.acceptedTaskUuid || null, decidedAt: fields.decidedAt || null,
    generatedAt: fields.generatedAt || null, ideaId, noteUuid: fields.noteUuid || null, projectUuid,
    sourceRevision: fields.sourceRevision || null, status,
    supersedesIdeaId: fields.supersedesIdeaId || null, taskText: fields.taskText };
}

// ----------------------------------------------------------------------------------------------
// @desc Keep every open idea and the most recently decided MAXIMUM_DECIDED_IDEAS, in held order.
// @param {Array<object>} ideas - Idea records.
// @returns {Array<object>} The kept records.
function _withBoundedHistory(ideas) {
  const decided = ideas.filter(idea => idea.status !== IDEA_STATUSES.open);
  if (decided.length <= MAXIMUM_DECIDED_IDEAS) return ideas;
  const newestFirst = [...decided].sort((first, second) => (second.decidedAt || "").localeCompare(first.decidedAt || ""));
  const keptDecided = new Set(newestFirst.slice(0, MAXIMUM_DECIDED_IDEAS));
  const keptIdeas = ideas.filter(idea => idea.status === IDEA_STATUSES.open || keptDecided.has(idea));
  return keptIdeas;
}
