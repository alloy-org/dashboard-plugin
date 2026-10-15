// Define conservative duration choices and persist a shared task/idea index in the quarterly Project Tasks note.
import DashboardNoteWriter from "dashboard/work-queue/dashboard-note-writer";
import { guideSectionRange, jsonPayloadMarkdown, parseJsonPayload } from "plan-wizard/vision-guide-markdown";
import { checkedAppResult, replaceGuideSection } from "plan-wizard/vision-guide-notes";
import { openProjectTaskStore, projectTaskStoreNoteName } from "project-task-store";
import { choiceQuestion } from "providers/decisions-endpoint";
import { stableJson } from "util/json-utility";
import { textDigest } from "util/text-digest";

export const DURATION_ESTIMATES_HEADING = "Task duration estimates";
export const DURATION_MINUTE_CHOICES = [30, 60, 90, 120, 180, 240, 300];
export const DURATION_BATCH_SIZE = 20;

// ----------------------------------------------------------------------------------------------
// @desc Read valid estimates from the index section, rejecting malformed or unsupported payloads before any write.
// @param {string} content - Full Project Tasks markdown.
// @returns {object} Estimate records keyed by task UUID or idea:<ideaId>; empty when the section has not been created.
export function durationEstimatesFromContent(content) {
  const section = guideSectionRange(content, DURATION_ESTIMATES_HEADING);
  if (!section) return {};
  const { payload } = parseJsonPayload(content.slice(section.bodyStart, section.end));
  if (payload?.schemaVersion !== 1 || !payload.estimates || typeof payload.estimates !== "object"
    || Array.isArray(payload.estimates)) throw new Error("Invalid task duration estimates index");
  const validEntries = Object.entries(payload.estimates).filter(([, estimate]) =>
    DURATION_MINUTE_CHOICES.includes(estimate?.durationMinutes) && typeof estimate.inputRevision === "string");
  return Object.fromEntries(validEntries);
}

// ----------------------------------------------------------------------------------------------
// @desc Digest everything the duration question reads so changed task, note, parent, or dictionary context is rejudged.
// @param {object} context - { candidateId, hierarchicalTags, noteName, noteUuid, parentTaskText, taskText }.
// @param {object} dictionary - User terms keyed by term.
// @returns {string} Input revision for one estimate.
export function durationInputRevision(context, dictionary) {
  return textDigest(stableJson({ choices: DURATION_MINUTE_CHOICES, context, dictionary }));
}

// ----------------------------------------------------------------------------------------------
// @desc Ask one categorical duration question per task or idea, sharing the user's dictionary across the batch.
// @param {Array<object>} contexts - Context records, each identifying one task or idea.
// @param {object} dictionary - User terms keyed by term.
// @returns {object} { questions, state } for a DecisionsEndpoint.
export function durationQuestions(contexts, dictionary) {
  const criteria = Object.fromEntries(DURATION_MINUTE_CHOICES.map(minutes => [String(minutes), `${ minutes } minutes`]));
  const questions = {};
  const tasks = {};
  contexts.forEach((context, index) => {
    const name = `duration_${ index + 1 }`;
    tasks[name] = context;
    questions[name] = choiceQuestion(`How many minutes should ${ name } conservatively take to complete? `
      + "Use its task text, note name, hierarchical tags, parent task text, and the user's terms dictionary. "
      + "Estimate the whole task, including reasonable preparation and checking. Allow a realistic buffer; "
      + "when uncertain between choices, prefer the longer one. Choose 300 for work likely to exceed five hours.", criteria);
  });
  return { questions, state: { tasks, userTermsDictionary: dictionary } };
}

// ----------------------------------------------------------------------------------------------
// @desc Read estimates without creating a note. Both tasks and ideas share the index, even when used by several projects.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} scope - Resolved quarter/domain scope.
// @returns {Promise<object>} Estimate records keyed by task UUID or idea:<ideaId>.
export async function readDurationEstimates(app, scope) {
  await DashboardNoteWriter.forApp(app).refreshNotesList();
  const note = checkedAppResult(await app.findNote({ name: projectTaskStoreNoteName(scope) }));
  if (!note?.uuid) return {};
  const content = checkedAppResult(await app.getNoteContent({ uuid: note.uuid }));
  return durationEstimatesFromContent(content);
}

// ----------------------------------------------------------------------------------------------
// @desc Merge paid-for estimates into the note as freshly read under the same writer used by project updates.
//   Existing sections are updated alone; a missing section is appended without rewriting project prose or footnotes.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} scope - Resolved quarter/domain scope.
// @param {object} additions - Valid estimate records keyed by task UUID or idea:<ideaId>.
// @returns {Promise<void>}
export async function writeDurationEstimates(app, scope, additions) {
  if (!Object.keys(additions).length) return;
  await DashboardNoteWriter.forApp(app).update(projectTaskStoreNoteName(scope), async () => {
    const { content, noteHandle } = await openProjectTaskStore(app, scope);
    const estimates = { ...durationEstimatesFromContent(content), ...additions };
    const sortedEstimates = Object.fromEntries(Object.entries(estimates).sort(([first], [second]) => first.localeCompare(second)));
    const body = "Conservative minutes for tasks (by UUID) and generated ideas (by idea ID). Explicit task durations take precedence.\n\n"
      + jsonPayloadMarkdown({ estimates: sortedEstimates, schemaVersion: 1 });
    const section = guideSectionRange(content, DURATION_ESTIMATES_HEADING);
    if (section) await replaceGuideSection(app, body, noteHandle, { heading: { level: 1, text: DURATION_ESTIMATES_HEADING } });
    else checkedAppResult(await app.insertNoteContent(noteHandle, `\n# ${ DURATION_ESTIMATES_HEADING }\n\n${ body }`, { atEnd: true }));
  });
}
