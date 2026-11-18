// The queued job that prepares one day's shared ranking of candidate tasks and ideas ahead of the widgets that show
// it. For each surface that will plan that day, it builds the day's candidates the way that surface does and stores the
// ranking under its revision: Goal Coach's question, from the quarter's projects and their guide, on the current day,
// and the agenda's, from every enabled quarter's progress projects, on any day the agenda would plan. When the two
// questions are the same, the second finds the first's ranking stored and sends no request. A ranking already stored
// at the current revision completes the job without a provider request. Preparing records nothing as shown: only a
// surface presenting a suggestion records it. The ranker's requests take their own provider permits; with nothing able
// to rank, the job waits for a settings change.
import { agendaRankingProjects, resolveProposedAgendaDate } from "dashboard/proposed-agenda/proposed-agenda-service";
import { prepareDayRanking } from "dashboard/suggestions/ranked-task-suggestions";
import { jobPriorityContext, readProjectJobTasks } from "dashboard/work-queue/jobs/project-job-inputs";
import { dateKeyFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";

export const PREPARE_DAY_RANKING_JOB_TYPE = "prepareDayRanking";
// The surfaces whose questions a preparation can ask, in the order it asks them.
export const DAY_RANKING_SURFACES = ["dreamTask", "agenda"];
const PREPARE_LOG_LABEL = "[prepare-day-ranking]";

// ----------------------------------------------------------------------------------------------
// @desc Create the handler. Its job input is { dateKey, domainName, domainUuid, surface }, dateKey naming the local
//   YYYY-MM-DD day to rank and surface, when present, limiting the job to that one surface's question.
// @param {object} [options] - An object with the following properties:
//   - {function} [agendaProjectsReader=agendaRankingProjects] - (app, { domainName, domainUuid, targetDate }) => the
//     projects the agenda ranks from; injected for tests
//   - {function} [rankingPreparer=prepareDayRanking] - Injected for tests; prepares and stores one question's ranking
//   - {function} [requestAnswers] - Injected Jev request for tests, still sent through a permit
// @returns {object} A work handler, as workHandlerRegistry describes one.
export function createPrepareDayRankingHandler({ agendaProjectsReader = agendaRankingProjects, rankingPreparer = prepareDayRanking,
  requestAnswers = undefined } = {}) {
  const dependencies = { agendaProjectsReader, rankingPreparer, requestAnswers };
  return {
    run: ({ context, job, signal }) => _preparationAttempt({ context: jobPriorityContext(context, job), dependencies, job, signal }),
    type: PREPARE_DAY_RANKING_JOB_TYPE,
    validateInput: input => validateDayRankingInput(input),
  };
}

// ----------------------------------------------------------------------------------------------
// @desc A request to prepare a domain's ranking for one day. Without a surface the request prepares every surface
//   that plans the day, under one key per domain and day. A widget waiting on the ranking names its own surface, which
//   gives the request a key of its own, so the widget waits only for its own question rather than for another
//   surface's ranking it will not show, and a second widget asking for the same surface coalesces into that job. Each
//   request names the time it was made as its revision, so a preparation that completed earlier runs again; a ranking
//   still current makes that run cheap.
// @param {object} input - { dateKey, domainName, domainUuid, surface = null }: surface is one of DAY_RANKING_SURFACES.
// @param {object} options - { category = "maintenance", requestedAt }: requestedAt is epoch milliseconds.
// @returns {object} A request DurableWorkRunner#submit takes.
export function dayRankingRequest({ dateKey, domainName, domainUuid, surface = null }, { category = "maintenance", requestedAt }) {
  const surfaceInput = surface ? { surface } : {};
  const surfaceKeySuffix = surface ? `:${ surface }` : "";
  return { category, desiredRevision: String(requestedAt), entityId: dateKey,
    input: { dateKey, domainName: domainName ?? null, domainUuid: domainUuid ?? null, ...surfaceInput },
    key: `${ PREPARE_DAY_RANKING_JOB_TYPE }:${ domainUuid || "all" }:${ dateKey }${ surfaceKeySuffix }`, type: PREPARE_DAY_RANKING_JOB_TYPE };
}

// ----------------------------------------------------------------------------------------------
// @desc The surfaces that will plan a day: Goal Coach plans only the current day, and the agenda plans any later day,
//   and the current day until late afternoon, when it moves on to the next working day.
// @param {string} dateKey - The YYYY-MM-DD day.
// @param {Date} now - Current time.
// @returns {Array<string>} Surfaces from DAY_RANKING_SURFACES, in its order.
export function dayRankingSurfaces(dateKey, now) {
  const todayKey = dateKeyFromDateInput(now);
  const agendaPlansToday = dateKeyFromDateInput(resolveProposedAgendaDate(now)) === todayKey;
  const agendaPlansDay = dateKey > todayKey || (dateKey === todayKey && agendaPlansToday);
  return DAY_RANKING_SURFACES.filter(surface => surface === "dreamTask" ? dateKey === todayKey : agendaPlansDay);
}

// ----------------------------------------------------------------------------------------------
// @desc Check a day ranking job's input before it is queued.
// @param {object} input - { dateKey, domainName, domainUuid, surface }.
// @throws When a field is missing or has the wrong form.
export function validateDayRankingInput(input) {
  if (!input || typeof input !== "object") throw new Error("A day ranking job needs an input");
  const { dateKey, domainName, domainUuid, surface = null } = input;
  if (surface !== null && !DAY_RANKING_SURFACES.includes(surface)) {
    throw new Error(`A day ranking job's surface must be one of ${ DAY_RANKING_SURFACES.join(", ") }`);
  }
  if (typeof dateKey !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error("A day ranking job needs a YYYY-MM-DD dateKey");
  if (domainUuid !== null && typeof domainUuid !== "string") throw new Error("A day ranking job's domainUuid must be a string or null");
  if (domainName !== null && typeof domainName !== "string") throw new Error("A day ranking job's domainName must be a string or null");
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Run one attempt: read the domain's open tasks, then prepare and store each planning surface's ranking, or only
//   the surface the input names. Each phase's duration is logged, since a widget waiting on this job shows only the
//   total.
// @param {object} options - { context, dependencies, job, signal }.
// @returns {Promise<object>} { outcomes, revision } once every surface with candidates has a stored ranking, outcomes
//   naming each surface's outcome and revision naming each surface's ranking revision; { status: "superseded" } when
//   no surface plans the day or none has a candidate.
// @throws When a ranker could not answer, or as a configuration failure when nothing can rank.
async function _preparationAttempt({ context, dependencies, job, signal }) {
  const { dateKey, domainName, domainUuid, surface: requestedSurface = null } = job.input;
  const plannedSurfaces = dayRankingSurfaces(dateKey, new Date(context.clock()));
  const surfaces = requestedSurface ? plannedSurfaces.filter(surface => surface === requestedSurface) : plannedSurfaces;
  if (!surfaces.length) return { status: "superseded" };
  const attemptStartedAt = Date.now();
  const tasks = await readProjectJobTasks(context, { domainUuid, signal });
  const openTasks = tasks.filter(task => !task.completedAt && !task.dismissedAt);
  logIfEnabled(`${ PREPARE_LOG_LABEL } tasks read`, { dateKey, durationMs: Date.now() - attemptStartedAt, openTaskCount: openTasks.length });
  const targetDate = new Date(`${ dateKey }T00:00:00`);
  const outcomes = {};
  const revisions = [];
  for (const surface of surfaces) {
    const projectsStartedAt = Date.now();
    const projects = surface === "agenda" ? await dependencies.agendaProjectsReader(context.app, { domainName: domainName || "All Notes",
      domainUuid, targetDate }) : null;
    const rankingStartedAt = Date.now();
    const { outcome, ranking } = await dependencies.rankingPreparer(context.app, { domainName, domainUuid, openTasks, projects,
      providerDispatch: context.providerDispatch || null, requestAnswers: dependencies.requestAnswers, signal, targetDate });
    logIfEnabled(`${ PREPARE_LOG_LABEL } surface prepared`, { dateKey, outcome, projectsMs: rankingStartedAt - projectsStartedAt, rankingMs: Date.now() - rankingStartedAt, surface });
    if (outcome === "noRanker") throw _configurationError();
    if (outcome === "noCandidates") continue;
    if (!ranking) throw new Error(`Ranking the ${ surface } suggestions for ${ dateKey } failed`);
    outcomes[surface] = outcome;
    revisions.push(`${ surface }=${ ranking.revision }`);
  }
  if (!revisions.length) return { status: "superseded" };
  return { outcomes, revision: revisions.join(" ") };
}

// ----------------------------------------------------------------------------------------------
// @desc The failure a preparation reports when nothing is configured to rank, so it waits for a settings change.
// @returns {Error} An error classified as a configuration failure.
function _configurationError() {
  const error = new Error("Nothing is configured to rank the day's suggestions");
  error.workFailure = "configuration";
  return error;
}
