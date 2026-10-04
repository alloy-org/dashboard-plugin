// Read what a queued project maintenance job works from, fresh on each attempt: the quarter's scope, its live projects
// from the Vision Guide and the quarterly plan note joined to what the project task store holds, and the domain's
// tasks. A job carries only the small input this module validates (the domain, the quarter, and for a project job the
// project's UUID); everything else is read from the notes that own it, so a job resumed in a later session never acts
// on a snapshot taken before it was saved. Provider and app calls go through the work runtime's dispatchers, so each
// takes its own permit and none is held while waiting on another.
import { resolvePlanScope } from "plan-wizard/plan-models";
import { readVisionGuide } from "plan-wizard/vision-guide-repository";
import { raceWizardPrompt } from "plan-wizard/wizard-prompt-runner";
import { fetchDomainOrAllNotesTasks } from "util/all-notes-tasks";
import { logIfEnabled } from "util/log";
import { resolveQuarterlyPlanNote } from "util/quarterly-plan-notes";

const INPUT_LOG_LABEL = "[project-job-inputs]";

// ----------------------------------------------------------------------------------------------
// @desc Wrap the generative prompt runner so each request waits for the runtime's generative permit. Without a
//   provider dispatcher the runner is returned unwrapped.
// @param {object} context - The job's context, carrying providerDispatch.
// @param {object} [options] - { promptRunner = raceWizardPrompt, signal = null }.
// @returns {function} (app, prompt, llmOptions) => the parsed response.
export function dispatchedPromptRunner(context, { promptRunner = raceWizardPrompt, signal = null } = {}) {
  if (!context?.providerDispatch) return promptRunner;
  return (app, prompt, llmOptions) => context.providerDispatch.generative(() => promptRunner(app, prompt, llmOptions), { signal });
}

// ----------------------------------------------------------------------------------------------
// @desc Resolve the plan scope a job input names.
// @param {object} input - { domainName, domainUuid, quarter, year }.
// @returns {object} The resolved scope.
export function projectJobScope({ domainName, domainUuid, quarter, year }) {
  return resolvePlanScope({ domainName, domainUuid, quarter, year });
}

// ----------------------------------------------------------------------------------------------
// @desc Read the quarter's live projects and the store's projects, and pick out the one a project job is about.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} input - A validated job input.
// @param {object} options - An object with the following properties:
//   - {function} [quarterlyContentReader=readQuarterlyPlanContent] - Injected for tests
//   - {QuarterProjectRepository} repository - Reads and writes the project task store
// @returns {Promise<object>} An object with the following properties:
//   - {QuarterProject|null} liveProject - The job's project as the live plan holds it, null when it left the plan or
//     the job names no project
//   - {Array<QuarterProject>} projects - Every live project
//   - {string|null} quarterlyContent - The quarterly plan note's markdown
//   - {object} scope - The resolved quarter scope
//   - {QuarterProject|undefined} stored - The job's project as the store holds it
export async function readProjectJobInputs(app, input, { quarterlyContentReader = readQuarterlyPlanContent, repository }) {
  const scope = projectJobScope(input);
  const guide = await readVisionGuide(app, scope).catch(error => {
    logIfEnabled(`${ INPUT_LOG_LABEL } guide unavailable, using quarterly plan alone`, error?.message);
    return null;
  });
  const quarterlyContent = await quarterlyContentReader(app, input);
  const { projects, storedProjects } = await repository.readMany(scope, { guide, includeInactive: true, quarterlyContent });
  const liveProject = projects.find(project => project.uuid === input.projectUuid) || null;
  const stored = storedProjects.find(project => project.uuid === input.projectUuid);
  return { liveProject, projects, quarterlyContent, scope, stored };
}

// ----------------------------------------------------------------------------------------------
// @desc Read the domain's tasks through the runtime's app dispatcher, holding one app read permit.
// @param {object} context - The job's context, carrying app and appDispatch.
// @param {object} options - { domainUuid, signal }.
// @returns {Promise<Array<object>>} Tasks.
// @throws When the tasks could not be read.
export async function readProjectJobTasks(context, { domainUuid, signal = null }) {
  const read = currentApp => fetchDomainOrAllNotesTasks(currentApp, domainUuid);
  const tasks = context.appDispatch ? await context.appDispatch.read(read, { signal }) : await read(context.app);
  if (!Array.isArray(tasks)) throw new Error("Could not read tasks for project maintenance");
  return tasks;
}

// ----------------------------------------------------------------------------------------------
// @desc Read the quarter's plan note, which the live projects are drawn from beside the Vision Guide.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} input - { domainName, quarter, year }.
// @returns {Promise<string|null>} The note's markdown, or null when the quarter has no plan note.
export async function readQuarterlyPlanContent(app, { domainName, quarter, year }) {
  const planNote = await resolveQuarterlyPlanNote(app, false, domainName, `Q${ quarter } ${ year }`);
  if (!planNote?.uuid) return null;
  return (await app.getNoteContent({ uuid: planNote.uuid })) || null;
}

// ----------------------------------------------------------------------------------------------
// @desc Check a project job's input before it is queued.
// @param {object} input - { domainName, domainUuid, projectUuid, quarter, year }.
// @param {object} [options] - { requireProject = true }: false for a job about the whole quarter.
// @throws When a field is missing or has the wrong form.
export function validateProjectJobInput(input, { requireProject = true } = {}) {
  if (!input || typeof input !== "object") throw new Error("A project job needs an input");
  const { domainName, domainUuid, projectUuid, quarter, year } = input;
  if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) throw new Error("A project job needs a quarter from 1 to 4");
  if (!Number.isInteger(year)) throw new Error("A project job needs a year");
  if (domainUuid !== null && typeof domainUuid !== "string") throw new Error("A project job's domainUuid must be a string or null");
  if (domainName !== null && typeof domainName !== "string") throw new Error("A project job's domainName must be a string or null");
  if (requireProject && (typeof projectUuid !== "string" || !projectUuid)) throw new Error("A project job needs a projectUuid");
}
