// The queued job that reads the tasks added since the last recent-task scan for new dictionary terms and people. It
// reads the scan note's watermark, sends the tasks added since (at most MAXIMUM_TASKS_PER_SCAN, oldest first) through
// task term discovery with the owner's names and the people the tasks link to, merges what is accepted into the
// dictionary through the app's note writer, and records the new watermark with the people's links. The people it adds
// are queued for evidence at once, so a new collaborator's definition is filled in from their notes and tasks without
// waiting for the next reconciliation. A provider failure still adds the linked people, leaves the watermark where it
// was, and fails the attempt for the queue to retry; with no provider configured it waits for a settings change.
import { pluralize } from "app-util";
import DashboardNoteWriter from "dashboard/work-queue/dashboard-note-writer";
import { dispatchedPromptRunner, generativeProviderAvailable, jobPriorityContext,
  readProjectJobTasks } from "dashboard/work-queue/jobs/project-job-inputs";
import { DISCOVER_TASK_TERMS_JOB_TYPE, termEvidenceRequest } from "dashboard/work-queue/jobs/project-job-requests";
import { accountOwner, mentionedPeopleFromTasks } from "plan-wizard/stack-rank/person-mentions";
import { discoverTaskTerms, MAXIMUM_TASKS_PER_SCAN } from "plan-wizard/stack-rank/task-term-discovery";
import { readTaskTermScan, savedTaskTermScan, tasksForTermScan } from "plan-wizard/stack-rank/task-term-scan-store";
import { dictionaryEntriesFromContent, dictionaryNoteName, mergedDictionaryContent, openUserTermsDictionary,
  readUserTermsDictionary, writeUserTermsDictionary } from "plan-wizard/stack-rank/user-terms-dictionary";
import { raceWizardPrompt } from "plan-wizard/wizard-prompt-runner";

export { DISCOVER_TASK_TERMS_JOB_TYPE };

// The most new people one scan queues evidence for at once; the rest wait for the reconciliation's schedule.
const PEOPLE_RESEARCHED_AT_ONCE = 2;

// ----------------------------------------------------------------------------------------------
// @desc Create the handler. Its job input is { domainUuid, year }, domainUuid null for every task.
// @param {object} [options] - An object with the following properties:
//   - {function} [promptRunner=raceWizardPrompt] - The request each generative permit admits; injected for tests
//   - {function} [providerAvailable=generativeProviderAvailable] - (app) => whether any generative provider is configured
//   - {function} [taskReader] - (context, { domainUuid, signal }) => tasks; readProjectJobTasks by default
// @returns {object} A work handler, as workHandlerRegistry describes one.
export function createDiscoverTaskTermsHandler({ promptRunner = raceWizardPrompt, providerAvailable = generativeProviderAvailable,
  taskReader = readProjectJobTasks } = {}) {
  const dependencies = { promptRunner, providerAvailable, taskReader };
  return {
    run: ({ context, job, signal }) => _scanAttempt({ context: jobPriorityContext(context, job), dependencies, job, signal }),
    type: DISCOVER_TASK_TERMS_JOB_TYPE,
    validateInput: input => _validateScanInput(input),
  };
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Merge accepted entries into the year's dictionary, serialized with every other dictionary write and merged into
//   the note as read again then, so a definition edited while the provider answered is kept.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { entries, year }.
// @returns {Promise<Array<string>>} The terms and people added.
async function _mergedIntoDictionary(app, { entries, year }) {
  if (!entries.length) return [];
  return DashboardNoteWriter.forApp(app).update(dictionaryNoteName(year), async () => {
    const { content, noteHandle } = await openUserTermsDictionary(app, year);
    const merged = mergedDictionaryContent(content, { incomingEntries: entries });
    if (merged.content !== content) await writeUserTermsDictionary(app, noteHandle, merged.content);
    return merged.addedTerms;
  });
}

// ----------------------------------------------------------------------------------------------
// @desc Run one scan: read the watermark, the dictionary, and the tasks added since; discover terms and people; merge
//   them; record the scan; and queue evidence for the first people added.
// @param {object} options - { context, dependencies, job, signal }.
// @returns {Promise<object>} { addedTerms, followUps, outcomeDetail, outcomeFacts, taskCount }, or { status: "superseded" }
//   when the attempt was cancelled while the provider answered.
// @throws When a note cannot be read or written, or the provider call failed.
async function _scanAttempt({ context, dependencies, job, signal }) {
  const { app } = context;
  const { domainUuid = null, year } = job.input;
  const now = new Date(context.clock());
  const read = operation => (context.appDispatch ? context.appDispatch.read(operation, { signal }) : operation(app));
  const scan = await read(currentApp => readTaskTermScan(currentApp, year));
  const content = await read(currentApp => readUserTermsDictionary(currentApp, year));
  const dictionaryEntries = dictionaryEntriesFromContent(content || "");
  const allTasks = await dependencies.taskReader(context, { domainUuid, signal });
  const { backlog, tasks } = tasksForTermScan(allTasks, { limit: MAXIMUM_TASKS_PER_SCAN, now, scannedThrough: scan.scannedThrough });
  const owner = tasks.length ? await accountOwner(app, dictionaryEntries) : { names: [], uuid: null };
  const mentionedPeople = mentionedPeopleFromTasks(tasks, { owner });
  const promptRunner = dispatchedPromptRunner(context, { promptRunner: dependencies.promptRunner, signal });
  const { entries, failureReason } = await discoverTaskTerms(app, { dictionaryEntries, mentionedPeople, ownerNames: owner.names,
    promptRunner, tasks });
  if (signal?.aborted) return { status: "superseded" };
  const addedTerms = await _mergedIntoDictionary(app, { entries, year });
  if (failureReason) throw await _scanFailure(app, { failureReason, providerAvailable: dependencies.providerAvailable });
  const scannedThrough = tasks.length ? Math.max(...tasks.map(task => task.createdAtMilliseconds)) : null;
  await savedTaskTermScan(app, { backlog, mentionedPeople, scannedAt: now.getTime(), scannedThrough, year });
  const addedPeople = entries.filter(entry => entry.isPerson && addedTerms.includes(entry.term));
  const followUps = addedPeople.slice(0, PEOPLE_RESEARCHED_AT_ONCE).map(person => termEvidenceRequest({ domainUuid, term: person.term, year },
    { requestedAt: now.getTime() }));
  const peopleText = addedPeople.length === 1 ? "1 person" : `${ addedPeople.length } people`;
  const outcomeDetail = `Read ${ pluralize(tasks.length, "task") }; added ${ pluralize(addedTerms.length, "term") }, ${ peopleText } among them`;
  return { addedTerms, followUps, outcomeDetail, outcomeFacts: { addedTerms }, taskCount: tasks.length };
}

// ----------------------------------------------------------------------------------------------
// @desc The error a failed scan throws, marked as a configuration failure when no provider is configured, so the queue
//   waits for a settings change rather than retrying.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { failureReason, providerAvailable }.
// @returns {Promise<Error>} The error.
async function _scanFailure(app, { failureReason, providerAvailable }) {
  const error = new Error(`Task term discovery failed: ${ failureReason }`);
  if (!(await providerAvailable(app))) error.workFailure = "configuration";
  return error;
}

// ----------------------------------------------------------------------------------------------
// @desc Check a scan job's input before it is queued.
// @param {object} input - { domainUuid, year }.
// @throws When the year is not a whole number, or domainUuid is neither a string nor null.
function _validateScanInput(input) {
  if (!input || typeof input !== "object") throw new Error("A task term scan needs an input");
  if (!Number.isInteger(input.year)) throw new Error("A task term scan needs a year");
  if (input.domainUuid !== undefined && input.domainUuid !== null && typeof input.domainUuid !== "string") {
    throw new Error("A task term scan's domainUuid must be a string or null");
  }
}
