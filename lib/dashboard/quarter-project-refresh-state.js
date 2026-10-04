// Record what each kind of refresh last finished for a QuarterProject, and when the project's output changed. Every
// refresh operation keeps its own success, so a ranking that completed cannot make the project's ideas look current,
// and a refresh that failed part way leaves its operation's last success as it was. The project's output revision
// counts changes to what readers of the project consume, never to the bookkeeping that records a refresh happened.
import { textDigest } from "util/text-digest";

// The refresh operations a project records separately: dictionary discovery from its wording, the similarity ranking
// of tasks against it, idea generation, and the preparation of a day's suggestions from it.
export const REFRESH_OPERATIONS = ["dayPreparation", "dictionary", "ideas", "similarity"];

// The fields whose change advances a project's output revision. Refresh times, the refresh state itself, and the log
// of tasks shown to the user are left out: a prepared suggestion that recorded its own display, or a refresh that
// recorded its own success, would otherwise make the output it just produced look stale.
const OUTPUT_FIELDS = ["blocksPerWeek", "completedTasks", "deadlineOn", "focusMonths", "isActive", "nextAction", "paceEm",
  "preferredWeekdays", "primaryNoteUuid", "priorityEm", "relatedTaskRecords", "relatedTasks", "suggestedTasks", "summary",
  "taskSimilarityScores"];

// ----------------------------------------------------------------------------------------------
// @desc Digest the inputs an idea request reads beyond the provider: the project's wording, its stated next action,
//   and the tasks already associated with it, which the prompt shows so the model does not restate them.
// @param {QuarterProject} project - The project ideas were requested for.
// @returns {string} Eight hex characters.
export function ideasInputRevision(project) {
  const relatedTaskUuids = project.relatedTaskRecords.map(record => record.taskUuid);
  return textDigest(JSON.stringify([project.summary, project.nextAction || null, relatedTaskUuids]));
}

// ----------------------------------------------------------------------------------------------
// @desc Decide the output revision a project should carry once written over its previous version: one past the
//   previous revision when anything readers consume differs, else the previous revision unchanged.
// @param {QuarterProject|null} previous - The project as last written, or null for a project not yet stored.
// @param {QuarterProject} next - The project about to be written.
// @returns {number} The revision to write.
export function nextProjectRevision(previous, next) {
  if (!previous) return Math.max(1, next.projectRevision + 1);
  const previousOutput = JSON.stringify(_outputFields(previous));
  const nextOutput = JSON.stringify(_outputFields(next));
  return previousOutput === nextOutput ? previous.projectRevision : previous.projectRevision + 1;
}

// ----------------------------------------------------------------------------------------------
// @desc Keep only the refresh state entries a project can carry: a plain object per operation name. Entries for an
//   operation this version does not know are kept, since a newer version may have written them.
// @param {*} refreshState - Refresh state as read from a note, or anything a caller passed.
// @returns {object} Refresh state, {} when nothing usable was given.
export function readableRefreshState(refreshState) {
  if (!refreshState || typeof refreshState !== "object" || Array.isArray(refreshState)) return {};
  const usableEntries = Object.entries(refreshState).filter(([, success]) => success && typeof success === "object"
    && !Array.isArray(success));
  return Object.fromEntries(usableEntries);
}

// ----------------------------------------------------------------------------------------------
// @desc Name the revision one operation's last success reflects, so a queued job can tell whether its output is
//   already current: the inputs it read, and for a refresh that catches up on task changes, the position it reached.
// @param {object} refreshState - A project's refresh state.
// @param {string} operation - One of REFRESH_OPERATIONS.
// @returns {string|null} "<inputRevision>@<snapshotId>:<sequence>", "<inputRevision>@none" without a watermark, or null
//   when the operation has never succeeded.
export function refreshRevision(refreshState, operation) {
  const success = refreshState?.[operation];
  if (!success?.inputRevision) return null;
  const position = success.watermark ? `${ success.watermark.snapshotId }:${ success.watermark.sequence }` : "none";
  return `${ success.inputRevision }@${ position }`;
}

// ----------------------------------------------------------------------------------------------
// @desc A new refresh state recording one operation's success, leaving every other operation as it was. A success
//   that does not supply a watermark keeps the operation's previous one, since the refresh did not process changes
//   past it, and likewise for the dictionary position, which is stored only once some refresh has recorded one.
// @param {object} refreshState - The project's current refresh state.
// @param {string} operation - One of REFRESH_OPERATIONS.
// @param {object} success - An object with the following properties:
//   - {object} [dictionaryPosition] - { revisionsId, sequence } of the term revisions the refresh read; omit when it
//     did not compare definitions
//   - {string|null} inputRevision - Digest of the inputs this refresh read
//   - {string} succeededAt - ISO time the refresh finished
//   - {object} [watermark] - Position in the task change history this refresh covered; omit when it covered none
// @returns {object} The new refresh state.
// @throws When the operation is not one this version records.
export function refreshStateWithSuccess(refreshState, operation, { dictionaryPosition, inputRevision, succeededAt, watermark }) {
  if (!REFRESH_OPERATIONS.includes(operation)) throw new Error(`Unknown refresh operation: ${ operation }`);
  const previous = refreshState[operation];
  const operationState = { inputRevision: inputRevision ?? null, succeededAt,
    watermark: watermark === undefined ? previous?.watermark ?? null : watermark };
  const position = dictionaryPosition === undefined ? previous?.dictionaryPosition : dictionaryPosition;
  if (position) operationState.dictionaryPosition = position;
  return { ...refreshState, [operation]: operationState };
}

// ----------------------------------------------------------------------------------------------
// @desc Digest the inputs a similarity ranking reads beyond the tasks themselves: the project's wording and which
//   rater scored it. The rating cache already keys each score by the project's summary and the task's text, so this
//   records the context those keys do not, letting a later refresh notice a ranking made by a different rater.
// @param {QuarterProject} project - The project ranked.
// @param {object} options - { scorerEm }: "jev", "generative", or null when it is unknown.
// @returns {string} Eight hex characters.
export function similarityInputRevision(project, { scorerEm }) {
  return textDigest(JSON.stringify([project.summary, scorerEm || null]));
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc The fields of a project its readers consume.
// @param {QuarterProject} project - Project to read.
// @returns {object} The OUTPUT_FIELDS values, keyed by field name.
function _outputFields(project) {
  const outputEntries = OUTPUT_FIELDS.map(field => [field, project[field]]);
  return Object.fromEntries(outputEntries);
}
