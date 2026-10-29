// Decide what one user-initiated "Generate ideas" run asks the work queue for. The run covers the quarter's projects in
// focus this month (a project naming no focus months is in focus every month) and requests their work at foreground
// priority in three steps: refining dictionary terms and re-ranking every active project's tasks, so a task not yet
// checked can join a project under the current definitions; generating ideas for the active projects not already
// saturated with well-rated ideas; and rating ideas still awaiting a rating in active projects the ideas step leaves
// alone. Every request names a revision unique to the run, or none, so work that already completed runs again.
// Host-compatible: no React or DOM.
import QuarterProjectRepository from "dashboard/quarter-project-repository";
import { ideaRatingsRevision, ideasSaturated, projectTooAbstract } from "dashboard/project-tasks/project-task-idea-ratings";
import { DICTIONARY_REFINEMENT_ENABLED } from "dashboard/work-queue/dashboard-work-features";
import { readProjectJobInputs } from "dashboard/work-queue/jobs/project-job-inputs";
import { dictionaryDiscoveryRequests, projectIdeaRatingsRequest, projectIdeasRequest,
  projectRankingRequest } from "dashboard/work-queue/jobs/project-job-requests";
import { dueTermEvidenceRequests } from "plan-wizard/stack-rank/dictionary-term-schedule";
import { projectTaskScorer } from "plan-wizard/stack-rank/stack-rank-project-tasks";
import { userTermsDictionarySummary } from "plan-wizard/stack-rank/user-terms-dictionary";
import { fetchDomainOrAllNotesTasks } from "util/all-notes-tasks";
import { monthKeyFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";

// The priority category of every request a run makes, since the user is watching it.
export const RUN_CATEGORY = "foregroundData";
// The most dictionary terms one run collects evidence for. Terms still honor their evidence cooldown.
export const RUN_TERM_LIMIT = 4;
// How many new ideas a run asks for per project, against the background pass's three, so a run alone can bring a
// project most of the way to saturation once its ideas are rated.
export const RUN_IDEA_COUNT = 10;
// The run's steps, in order. The summarize step submits no work.
export const RUN_STEP_KEYS = Object.freeze(["refine", "ideas", "rate", "summarize"]);
const RUN_PLAN_LOG_LABEL = "[idea-generation-run-plan]";

// ----------------------------------------------------------------------------------------------
// @desc The projects in focus during the month holding now: those whose focusMonths name that month, and those naming
//   none, which occupy the whole quarter.
// @param {Array<QuarterProject>} projects - The quarter's live projects.
// @param {Date} now - Current time.
// @returns {Array<QuarterProject>} The active projects, in the order given.
export function activeMonthProjects(projects, now) {
  const monthKey = monthKeyFromDateInput(now);
  const activeProjects = projects.filter(project => !project.focusMonths?.length || project.focusMonths.includes(monthKey));
  return activeProjects;
}

// ----------------------------------------------------------------------------------------------
// @desc The active projects a run generates ideas for: those whose stored ideas are not saturated, as ideasSaturated
//   judges them, and that were not judged too abstract under their current summary. A project the store does not hold
//   yet has no ideas, so it is a target.
// @param {Array<QuarterProject>} activeProjects - From activeMonthProjects.
// @param {Array<QuarterProject>} storedProjects - Every project the store holds.
// @returns {Array<QuarterProject>} The targets, in the order given.
export function ideaGenerationTargets(activeProjects, storedProjects) {
  const storedByUuid = new Map(storedProjects.map(project => [project.uuid, project]));
  const targets = activeProjects.filter(project => {
    const stored = storedByUuid.get(project.uuid);
    if (stored && projectTooAbstract({ suggestedTasks: stored.suggestedTasks, summary: project.summary })) return false;
    return !ideasSaturated(stored?.suggestedTasks || []);
  });
  return targets;
}

// ----------------------------------------------------------------------------------------------
// @desc Build every request a run submits, grouped by the step that submits it.
// @param {object} options - An object with the following properties:
//   - {Array<QuarterProject>} activeProjects - From activeMonthProjects
//   - {object} input - { domainName, domainUuid, quarter, year }
//   - {Date} now - Current time
//   - {string} runId - Identifies the run; the discovery and ideas revisions name it
//   - {string|null} scorerEm - "jev", "generative", or null when nothing can rate tasks or ideas
//   - {Array<QuarterProject>} storedProjects - Every project the store holds
//   - {Array<QuarterProject>} targets - From ideaGenerationTargets
//   - {Array<object>} termRequests - Evidence collection requests for the terms due
// @returns {object} { ideas, rate, refine }: arrays of requests for DurableWorkRunner#submitAll. Rankings are held
//   inside the discovery request, so they read the terms it adds; any its input has no room for follow it in refine.
export function ideaGenerationRunRequests({ activeProjects, input, now, runId, scorerEm, storedProjects, targets, termRequests }) {
  const rankingRequests = activeProjects.map(project => projectRankingRequest(input, { category: RUN_CATEGORY, desiredRevision: null,
    projectUuid: project.uuid }));
  const discoveryRequests = dictionaryDiscoveryRequests(input, { category: RUN_CATEGORY, desiredRevision: `run:${ runId }`, rankingRequests });
  const refine = [...discoveryRequests, ...termRequests];
  const ideas = targets.map(project => projectIdeasRequest(input, { category: RUN_CATEGORY, desiredRevision: `run:${ runId }`,
    ideaCount: RUN_IDEA_COUNT, projectUuid: project.uuid }));
  const targetUuids = new Set(targets.map(project => project.uuid));
  const storedByUuid = new Map(storedProjects.map(project => [project.uuid, project]));
  const rate = [];
  for (const project of activeProjects) {
    const stored = storedByUuid.get(project.uuid);
    if (!scorerEm || !stored || targetUuids.has(project.uuid)) continue;
    const desiredRevision = ideaRatingsRevision(stored.suggestedTasks, now);
    if (!desiredRevision || stored.refreshState.ideaRatings?.inputRevision === desiredRevision) continue;
    rate.push(projectIdeaRatingsRequest(input, { category: RUN_CATEGORY, desiredRevision, projectUuid: project.uuid }));
  }
  return { ideas, rate, refine };
}

// ----------------------------------------------------------------------------------------------
// @desc Read what a run is planned from and plan it: the quarter's live and stored projects, the domain's tasks for
//   the term evidence due, whether anything can rate, and the year's terms dictionary for the progress window.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} input - { domainName, domainUuid, quarter, year }.
// @param {object} options - An object with the following properties:
//   - {function} [dictionaryReader=userTermsDictionarySummary] - (app, year) => { noteUuid, termCount } or null
//   - {Date} now - Current time
//   - {string} runId - Identifies the run
//   - {function} [repositoryFactory] - (app) => QuarterProjectRepository; injected for tests
//   - {function} [taskReader=fetchDomainOrAllNotesTasks] - (app, domainUuid) => tasks
//   - {function|null} [termEvidenceScheduler] - (app, { category, limit, now, tasks }) => evidence requests; null when
//     dictionary refinement is switched off
//   - {function} [taskScorer=projectTaskScorer] - (app) => "jev", "generative", or null
// @returns {Promise<object>} { activeProjects, dictionary, requests, storedProjects, targets }: dictionary as
//   dictionaryReader returns it, null when it cannot be read; requests as ideaGenerationRunRequests groups them;
//   storedProjects as the store held them before the run, which its summary compares against.
export async function planIdeaGenerationRun(app, input, { dictionaryReader = userTermsDictionarySummary, now, runId, repositoryFactory = currentApp => new QuarterProjectRepository({ app: currentApp }),
    taskReader = fetchDomainOrAllNotesTasks, taskScorer = projectTaskScorer,
    termEvidenceScheduler = DICTIONARY_REFINEMENT_ENABLED ? dueTermEvidenceRequests : null }) {
  const { projects, storedProjects } = await readProjectJobInputs(app, input, { repository: repositoryFactory(app) });
  const activeProjects = activeMonthProjects(projects, now);
  const targets = ideaGenerationTargets(activeProjects, storedProjects);
  const scorerEm = activeProjects.length ? await taskScorer(app) : null;
  const termRequests = scorerEm ? await _runTermRequests(app, input, { now, taskReader, termEvidenceScheduler }) : [];
  const requests = ideaGenerationRunRequests({ activeProjects, input, now, runId, scorerEm, storedProjects, targets, termRequests });
  const dictionary = await _runDictionarySummary(app, input, dictionaryReader);
  return { activeProjects, dictionary, requests, storedProjects, targets };
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Where the year's terms dictionary is and how many terms it defines before the run. A dictionary that cannot be
//   read leaves the progress window without its count, never the run without its plan.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} input - { year }.
// @param {function} dictionaryReader - (app, year) => { noteUuid, termCount } or null.
// @returns {Promise<object|null>} { noteUuid, termCount }, or null.
async function _runDictionarySummary(app, { year }, dictionaryReader) {
  try {
    return await dictionaryReader(app, year);
  } catch (error) {
    logIfEnabled(`${ RUN_PLAN_LOG_LABEL } could not read the terms dictionary`, error?.message);
    return null;
  }
}

// ----------------------------------------------------------------------------------------------
// @desc The term evidence collections due for a run. Tasks or a dictionary that cannot be read schedule none, so the
//   run goes on to rank and generate without them.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} input - { domainUuid }.
// @param {object} options - { now, taskReader, termEvidenceScheduler }.
// @returns {Promise<Array<object>>} Requests for DurableWorkRunner#submitAll.
async function _runTermRequests(app, { domainUuid }, { now, taskReader, termEvidenceScheduler }) {
  if (!termEvidenceScheduler) return [];
  try {
    const tasks = await taskReader(app, domainUuid);
    return await termEvidenceScheduler(app, { category: RUN_CATEGORY, domainUuid, limit: RUN_TERM_LIMIT, now, tasks: tasks || [] });
  } catch (error) {
    logIfEnabled(`${ RUN_PLAN_LOG_LABEL } could not schedule term evidence`, error?.message);
    return [];
  }
}
