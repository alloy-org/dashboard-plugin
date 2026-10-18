// Recover the scores behind suggestions the calendar generation report shows when they were served from a cached
// agenda. A cached agenda keeps only what the calendar needs to render a suggestion, so its activities and reserves
// arrive without the similarity, actionability, and relevance that put them forward. Those scores live on in the
// quarter's project task store note, an existing task's as its matchScore and an idea's as its rating, so they are
// read back from there. The store is only read when some reported suggestion lacks its own scores, so a freshly ranked
// pass costs no extra note reads.
import { quarterAfter, quarterFromDate } from "constants/quarters";
import { readCollectedProjectTasks } from "dashboard/project-tasks/project-task-store";
import { suggestionCandidateId } from "dashboard/quarter-project-task-candidates";
import { resolvePlanScope } from "plan-wizard/plan-models";
import { logIfEnabled } from "util/log";

// ----------------------------------------------------------------------------------------------
// @desc Whether a suggestion is missing the scores the report would show for it: an idea's actionability or
//   relevance, or an existing task's similarity.
// @param {object} record - Activity or reserve.
// @param {boolean} isIdea - Whether the record is a generated idea rather than an existing task.
// @returns {boolean}
export function missingSuggestionScores(record, isIdea) {
  if (isIdea) return !Number.isFinite(record?.actionability) || !Number.isFinite(record?.score);
  return !Number.isFinite(record?.score);
}

// ----------------------------------------------------------------------------------------------
// @desc Look up, in the project task store notes of each reported day's quarter and the quarter after it (the two a
//   day can draw projects from), the stored scores of the suggestions that arrived without their own. A store that
//   cannot be read is logged and skipped, so the report falls back to whatever the suggestion carries.
// @param {object} app - Amplenote app bridge.
// @param {object} options - An object with the following properties:
//   - {Array<object>} days - { dayResult } per evaluated day, its day the Date it plans
//   - {string|null} domainName - Active Task Domain name
//   - {string|null} domainUuid - Active Task Domain UUID, null for All Notes
//   - {Array<object>} unscoredRecords - Reported activities and reserves missing their own scores
// @returns {Promise<Map<string, object>>} { actionability, relevance, similarity } by candidate ID, each score null
//   when the store does not hold it; empty when nothing needed looking up.
export async function storedScoresByCandidateId(app, { days, domainName, domainUuid, unscoredRecords }) {
  const wantedCandidateIds = new Set(unscoredRecords.map(suggestionCandidateId).filter(Boolean));
  const scoresByCandidateId = new Map();
  if (!wantedCandidateIds.size) return scoresByCandidateId;
  for (const quarter of _reportedQuarters(days)) {
    const projects = await _quarterProjects(app, { domainName, domainUuid, quarter });
    for (const project of projects) _collectProjectScores(project, { scoresByCandidateId, wantedCandidateIds });
  }
  logIfEnabled("[calendar-report-stored-scores] stored scores found", { found: scoresByCandidateId.size,
    wanted: wantedCandidateIds.size });
  return scoresByCandidateId;
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Add a project's stored task similarities and idea ratings for the wanted candidates, keeping a score already
//   found in an earlier quarter's store.
// @param {QuarterProject} project - Stored project with relatedTaskRecords and suggestedTasks.
// @param {object} options - { scoresByCandidateId, wantedCandidateIds }: the map is filled in place.
function _collectProjectScores(project, { scoresByCandidateId, wantedCandidateIds }) {
  const isWanted = candidateId => wantedCandidateIds.has(candidateId) && !scoresByCandidateId.has(candidateId);
  for (const taskRecord of project.relatedTaskRecords || []) {
    const candidateId = `task:${ taskRecord.taskUuid }`;
    if (!isWanted(candidateId) || !Number.isFinite(taskRecord.matchScore)) continue;
    scoresByCandidateId.set(candidateId, { actionability: null, relevance: null, similarity: taskRecord.matchScore });
  }
  for (const idea of project.suggestedTasks || []) {
    const candidateId = `idea:${ idea.ideaId }`;
    const { actionability = null, relevance = null } = idea.rating || {};
    if (!isWanted(candidateId) || (!Number.isFinite(actionability) && !Number.isFinite(relevance))) continue;
    scoresByCandidateId.set(candidateId, { actionability, relevance, similarity: null });
  }
}

// ----------------------------------------------------------------------------------------------
// @desc A quarter's stored projects, past ones included since a cached suggestion can outlive its project's activity.
// @param {object} app - Amplenote app bridge.
// @param {object} options - { domainName, domainUuid, quarter }: quarter is { quarter, year }.
// @returns {Promise<Array<QuarterProject>>} Empty when the store is missing or unreadable.
async function _quarterProjects(app, { domainName, domainUuid, quarter }) {
  try {
    const scope = resolvePlanScope({ domainName, domainUuid, quarter: quarter.quarter, year: quarter.year });
    return await readCollectedProjectTasks(app, scope, { includeInactive: true });
  } catch (error) {
    logIfEnabled("[calendar-report-stored-scores] could not read project task store", { error: error?.message,
      quarter: quarter.label });
    return [];
  }
}

// ----------------------------------------------------------------------------------------------
// @desc The distinct quarters the reported days can draw projects from: each day's own quarter and the one after it,
//   earliest first.
// @param {Array<object>} days - { dayResult } per evaluated day.
// @returns {Array<object>} { label, quarter, year } per quarter.
function _reportedQuarters(days) {
  const quarterByLabel = new Map();
  for (const { dayResult } of days) {
    if (!(dayResult?.day instanceof Date)) continue;
    const ownQuarter = quarterFromDate(dayResult.day);
    for (const quarter of [ownQuarter, quarterAfter(ownQuarter)]) quarterByLabel.set(quarter.label, quarter);
  }
  const quarters = [...quarterByLabel.values()];
  const earliestFirst = quarters.sort((first, second) => first.year - second.year || first.quarter - second.quarter);
  return earliestFirst;
}
