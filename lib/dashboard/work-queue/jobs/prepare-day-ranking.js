// The queued job that prepares one day's shared ranking of candidate tasks and ideas ahead of the widgets that show
// it. It builds the day's candidates as Dream Task does, from the quarter's projects and the domain's open tasks, and
// stores the ranking under its revision, so Dream Task, the Proposed Agenda, and Calendar reuse it whenever they would
// ask the ranker the same question. A ranking already stored at the current revision completes the job without a
// provider request. Preparing records nothing as shown: only a surface presenting a suggestion records it. The ranker's
// request takes its own provider permit; with nothing able to rank, the job waits for a settings change.
import { prepareDayRanking } from "dashboard/ranked-task-suggestions";
import { jobPriorityContext, readProjectJobTasks } from "dashboard/work-queue/jobs/project-job-inputs";

export const PREPARE_DAY_RANKING_JOB_TYPE = "prepareDayRanking";

// ----------------------------------------------------------------------------------------------
// @desc Create the handler. Its job input is { dateKey, domainName, domainUuid }, dateKey naming the local YYYY-MM-DD
//   day to rank.
// @param {object} [options] - An object with the following properties:
//   - {function} [rankingPreparer=prepareDayRanking] - Injected for tests; prepares and stores the ranking
//   - {function} [requestAnswers] - Injected Jev request for tests, still sent through a permit
// @returns {object} A work handler, as workHandlerRegistry describes one.
export function createPrepareDayRankingHandler({ rankingPreparer = prepareDayRanking, requestAnswers = undefined } = {}) {
  return {
    run: ({ context, job, signal }) => _preparationAttempt({ context: jobPriorityContext(context, job), job, rankingPreparer,
      requestAnswers, signal }),
    type: PREPARE_DAY_RANKING_JOB_TYPE,
    validateInput: input => validateDayRankingInput(input),
  };
}

// ----------------------------------------------------------------------------------------------
// @desc Check a day ranking job's input before it is queued.
// @param {object} input - { dateKey, domainName, domainUuid }.
// @throws When a field is missing or has the wrong form.
export function validateDayRankingInput(input) {
  if (!input || typeof input !== "object") throw new Error("A day ranking job needs an input");
  const { dateKey, domainName, domainUuid } = input;
  if (typeof dateKey !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error("A day ranking job needs a YYYY-MM-DD dateKey");
  if (domainUuid !== null && typeof domainUuid !== "string") throw new Error("A day ranking job's domainUuid must be a string or null");
  if (domainName !== null && typeof domainName !== "string") throw new Error("A day ranking job's domainName must be a string or null");
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Run one attempt: read the domain's open tasks, then prepare and store the day's ranking.
// @param {object} options - { context, job, rankingPreparer, requestAnswers, signal }.
// @returns {Promise<object>} { outcome, revision } once a ranking is stored, or { status: "superseded" } when no
//   project offers a candidate that day.
// @throws When the ranker could not answer, or as a configuration failure when nothing can rank.
async function _preparationAttempt({ context, job, rankingPreparer, requestAnswers, signal }) {
  const { dateKey, domainName, domainUuid } = job.input;
  const tasks = await readProjectJobTasks(context, { domainUuid, signal });
  const openTasks = tasks.filter(task => !task.completedAt && !task.dismissedAt);
  const targetDate = new Date(`${ dateKey }T00:00:00`);
  const { outcome, ranking } = await rankingPreparer(context.app, { domainName, domainUuid, openTasks,
    providerDispatch: context.providerDispatch || null, requestAnswers, signal, targetDate });
  if (outcome === "noCandidates") return { status: "superseded" };
  if (outcome === "noRanker") {
    const error = new Error("Nothing is configured to rank the day's suggestions");
    error.workFailure = "configuration";
    throw error;
  }
  if (!ranking) throw new Error(`Ranking the suggestions for ${ dateKey } failed`);
  return { outcome, revision: ranking.revision };
}
