// Decide which of a quarter's projects the work queue refreshes, and count how many it covers in one Dashboard visit.
// A project is due a ranking when it was never ranked, when tasks changed since its last complete ranking, when that
// ranking has aged past the staleness window, when its search is due a second page, when the sources page cites a
// task it has no score for, or when an open task mentions a dictionary term whose definition changed since. A project
// whose ranking is current may still be due ideas, when they are stale or the tasks they were asked about have
// changed, and one whose ideas are current may still hold open ideas awaiting an actionability rating. Due projects are taken changed first, then never ranked, then those with no usable tasks, then the oldest
// refresh, and only so many are in flight at once that one visit's target is met without sending every project's
// requests at the same moment. While the terms dictionary has projects to examine,
// rankings are held inside the discovery request, so they read the terms discovery adds rather than racing it. A
// current project counts as checked without any provider call. Coverage is kept per scope for the planner's lifetime,
// which is one mounted Dashboard.
import { PROJECT_STALENESS_HOURS, projectNeedsRefresh } from "dashboard/project-refresh-schedule";
import { ideaRatingsRevision } from "dashboard/project-task-idea-ratings";
import { ideasInputRevision, refreshRevision, similarityInputRevision } from "dashboard/quarter-project-refresh-state";
import { GENERATE_PROJECT_IDEAS_JOB_TYPE, RANK_PROJECT_TASKS_JOB_TYPE, RATE_PROJECT_IDEAS_JOB_TYPE, dictionaryDiscoveryRequest,
  projectIdeaRatingsRequest, projectIdeasRequest, projectRankingRequest } from "dashboard/work-queue/jobs/project-job-requests";
import { needsSecondSearchPage } from "plan-wizard/stack-rank/stack-rank-project-tasks";
import { dateFromDateInput } from "util/date-utility";
import { textDigest } from "util/text-digest";

// The fewest projects one visit aims to cover, when the quarter has that many.
export const MINIMUM_PROJECTS_PER_VISIT = 5;
// Attempt outcomes that count a project as failed for this visit.
const FAILED_OUTCOMES = ["blockedConfiguration", "failed", "retryWaiting"];
// The project job types whose outcomes count toward a visit's coverage.
const PROJECT_JOB_TYPES = [GENERATE_PROJECT_IDEAS_JOB_TYPE, RANK_PROJECT_TASKS_JOB_TYPE, RATE_PROJECT_IDEAS_JOB_TYPE];
const STALENESS_MILLISECONDS = PROJECT_STALENESS_HOURS * 60 * 60 * 1000;

// ----------------------------------------------------------------------------------------------
// @desc The rating request a project is due when it holds open ideas whose rating is missing, judged different text,
//   or was left unanswered long enough ago to ask again, unless its last rating already judged exactly those ideas.
// @param {object} input - { domainName, domainUuid, quarter, year }.
// @param {QuarterProject} project - The project as the store holds it.
// @param {Date} now - Current time.
// @returns {object|null} The request, or null when no idea awaits a rating.
export function ideaRatingsRequestIfDue(input, project, now) {
  const desiredRevision = ideaRatingsRevision(project.suggestedTasks, now);
  if (!desiredRevision || project.refreshState.ideaRatings?.inputRevision === desiredRevision) return null;
  return projectIdeaRatingsRequest(input, { desiredRevision, projectUuid: project.uuid });
}

// ----------------------------------------------------------------------------------------------
// @desc Decide whether a project's ideas should be asked for again: they never were, their last request has aged past
//   the staleness window, or the project's wording or associated tasks changed since.
// @param {QuarterProject|null|undefined} project - The project as the store holds it.
// @param {Date} now - Current time.
// @returns {boolean} True when an ideas request is due.
export function ideasRefreshDue(project, now) {
  const success = project?.refreshState.ideas;
  if (!success?.succeededAt || _isStale(success.succeededAt, now)) return true;
  return success.inputRevision !== ideasInputRevision(project);
}

// ----------------------------------------------------------------------------------------------
// @desc The ideas request a project is due, as a ranking's follow-up or on its own.
// @param {object} input - { domainName, domainUuid, quarter, year }.
// @param {QuarterProject} project - The project as the store holds it.
// @param {Date} now - Current time.
// @returns {object|null} The request, or null when the project's ideas are current.
export function ideasRequestIfDue(input, project, now) {
  if (!ideasRefreshDue(project, now)) return null;
  const success = project.refreshState.ideas;
  const inputsChanged = success?.succeededAt && !_isStale(success.succeededAt, now);
  return projectIdeasRequest(input, { desiredRevision: inputsChanged ? ideasInputRevision(project) : null,
    projectUuid: project.uuid });
}

// ----------------------------------------------------------------------------------------------
// @desc How many distinct projects one visit aims to refresh: half the quarter's projects, but at least
//   MINIMUM_PROJECTS_PER_VISIT, and never more than there are.
// @param {number} projectCount - The quarter's live projects.
// @returns {number} The target.
export function projectCoverageTarget(projectCount) {
  return Math.min(projectCount, Math.max(MINIMUM_PROJECTS_PER_VISIT, Math.ceil(projectCount / 2)));
}

// ----------------------------------------------------------------------------------------------
// @desc Plans project maintenance jobs and keeps the visit's coverage per scope.
export default class QuarterProjectWorkPlanner {
  coverageByScope = new Map(); // {Map<string, object>} { checked, failed, rated, submitted, succeeded, target } per scope.

  // ----------------------------------------------------------------------------------------------
  // @desc Report a scope's coverage so far this visit.
  // @param {string|null} scopeKey - The scope.
  // @returns {object} { checked, covered, failed, inFlight, rated, submitted, succeeded, target }: counts of distinct
  //   projects, covered being those checked as current or refreshed successfully.
  coverage(scopeKey) {
    const coverage = this._scopeCoverage(scopeKey);
    const coveredUuids = new Set([...coverage.checked, ...coverage.succeeded]);
    return { checked: coverage.checked.size, covered: coveredUuids.size, failed: coverage.failed.size,
      inFlight: this._inFlight(coverage).length, rated: coverage.rated.size, submitted: coverage.submitted.size,
      succeeded: coverage.succeeded.size, target: coverage.target };
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Plan a quarter's maintenance from a fresh reconciliation: a dictionary discovery request when a rater exists,
  //   then a ranking or ideas request for each due project, most urgent first, so that no more than the visit's target
  //   are in flight. Projects in flight are requested again so their saved jobs pick up the newest revision. When the
  //   dictionary has projects to examine, the ranking requests ride inside the discovery request instead, which then
  //   names a new revision so a discovery that completed earlier still runs and submits them.
  // @param {object} options - An object with the following properties:
  //   - {boolean} [dictionaryDiscoveryDue=false] - Whether the dictionary has projects it has not examined
  //   - {object} input - { domainName, domainUuid, quarter, year }
  //   - {Date} now - Current time
  //   - {Array<QuarterProject>} projects - The quarter's live projects, each already held by the store
  //   - {string|null} scopeKey - The queue scope the requests are submitted to
  //   - {string|null} scorerEm - "jev", "generative", or null when nothing can rate
  //   - {Array<QuarterProject>} storedProjects - The store's projects
  //   - {object|null} taskWatermark - { sequence, snapshotId } of the domain's task snapshot, or null without one
  //   - {Map<string, number>} [termChangedCounts] - Open tasks mentioning a term whose definition changed since the
  //     project's last ranking, by project UUID
  //   - {Map<string, number>} [unscoredCitedCounts] - Cited tasks with no score, by project UUID
  // @returns {Array<object>} Requests for DurableWorkRunner#submitAll, in order.
  plan({ dictionaryDiscoveryDue = false, input, now, projects, scopeKey, scorerEm, storedProjects, taskWatermark,
    termChangedCounts = new Map(), unscoredCitedCounts = new Map() }) {
    const coverage = this._scopeCoverage(scopeKey);
    coverage.target = projectCoverageTarget(projects.length);
    const storedByUuid = new Map(storedProjects.map(project => [project.uuid, project]));
    const works = projects.map(project => _projectWork(project, { input, now, scorerEm, stored: storedByUuid.get(project.uuid),
      taskWatermark, termChangedCount: termChangedCounts.get(project.uuid) || 0,
      unscoredCitedCount: unscoredCitedCounts.get(project.uuid) || 0 }));
    const dueWorks = works.filter(work => work.request);
    works.filter(work => !work.request).forEach(work => coverage.checked.add(work.projectUuid));
    dueWorks.sort((first, second) => first.priority - second.priority || first.refreshedAt - second.refreshedAt);
    const inFlightUuids = new Set(this._inFlight(coverage));
    let openSlots = Math.max(0, coverage.target - inFlightUuids.size);
    const selectedWorks = dueWorks.filter(work => {
      if (inFlightUuids.has(work.projectUuid)) return true;
      if (openSlots <= 0) return false;
      openSlots -= 1;
      return true;
    });
    for (const work of selectedWorks) {
      coverage.submitted.add(work.projectUuid);
      coverage.failed.delete(work.projectUuid);
      coverage.succeeded.delete(work.projectUuid);
    }
    const projectRequests = selectedWorks.map(work => work.request);
    if (!scorerEm || !projects.length) return projectRequests;
    const summaries = projects.map(project => project.summary).sort();
    const summaryDigest = textDigest(JSON.stringify(summaries));
    const heldRequests = dictionaryDiscoveryDue ? projectRequests.filter(request => request.type === RANK_PROJECT_TASKS_JOB_TYPE) : [];
    if (!heldRequests.length) return [dictionaryDiscoveryRequest(input, { desiredRevision: summaryDigest }), ...projectRequests];
    const unheldRequests = projectRequests.filter(request => request.type !== RANK_PROJECT_TASKS_JOB_TYPE);
    const discoveryRequest = dictionaryDiscoveryRequest(input, { desiredRevision: `${ summaryDigest }@${ now.getTime() }`, heldRequests });
    return [discoveryRequest, ...unheldRequests];
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Count a finished project job toward its scope's coverage: a completed ranking, ideas, or rating request
  //   covers the project, and one that failed, waits to retry, or waits for configuration counts it as failed for now.
  // @param {object} outcome - { entityId, jobType, scopeKey, status }, as DurableWorkRunner#subscribeOutcomes reports.
  recordOutcome({ entityId, jobType, scopeKey, status }) {
    if (!entityId || !PROJECT_JOB_TYPES.includes(jobType)) return;
    const coverage = this._scopeCoverage(scopeKey);
    if (status === "completed") {
      coverage.failed.delete(entityId);
      coverage.succeeded.add(entityId);
      if (jobType === RANK_PROJECT_TASKS_JOB_TYPE) coverage.rated.add(entityId);
    } else if (FAILED_OUTCOMES.includes(status)) coverage.failed.add(entityId);
    else if (status === "superseded") coverage.submitted.delete(entityId);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Projects submitted this visit that have neither finished nor failed.
  // @param {object} coverage - A scope's coverage.
  // @returns {Array<string>} Project UUIDs.
  _inFlight(coverage) {
    return [...coverage.submitted].filter(projectUuid => !coverage.succeeded.has(projectUuid) && !coverage.failed.has(projectUuid));
  }

  // ----------------------------------------------------------------------------------------------
  // @desc A scope's coverage, created empty on first use.
  // @param {string|null} scopeKey - The scope.
  // @returns {object} { checked, failed, rated, submitted, succeeded, target }: Sets of project UUIDs and the target.
  _scopeCoverage(scopeKey) {
    if (!this.coverageByScope.has(scopeKey)) {
      this.coverageByScope.set(scopeKey, { checked: new Set(), failed: new Set(), rated: new Set(), submitted: new Set(),
        succeeded: new Set(), target: 0 });
    }
    return this.coverageByScope.get(scopeKey);
  }
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Whether a time lies outside the staleness window, or cannot be read.
// @param {string|null|undefined} time - ISO time.
// @param {Date} now - Current time.
// @returns {boolean} True when the time is missing, unreadable, or older than the window.
function _isStale(time, now) {
  const date = time ? dateFromDateInput(time, { throwOnInvalid: false }) : null;
  return !date || now.getTime() - date.getTime() >= STALENESS_MILLISECONDS;
}

// ----------------------------------------------------------------------------------------------
// @desc Decide what one project is due and how urgently.
// @param {QuarterProject} project - The live project.
// @param {object} options - { input, now, scorerEm, stored, taskWatermark, termChangedCount, unscoredCitedCount }.
// @returns {object} { priority, projectUuid, refreshedAt, request }: request is null when the project is current;
//   priority is 0 for changed, 1 for never ranked, 2 for no usable tasks, 3 otherwise.
function _projectWork(project, { input, now, scorerEm, stored, taskWatermark, termChangedCount, unscoredCitedCount }) {
  const projectUuid = project.uuid;
  const similarity = _similarityState(project, { now, scorerEm, stored, taskWatermark, termChangedCount, unscoredCitedCount });
  const rankingRequest = similarity.due ? projectRankingRequest(input, { desiredRevision: similarity.desiredRevision,
    projectUuid }) : null;
  const storedView = stored ? _storedView(project, stored) : null;
  const ideasRequest = storedView ? ideasRequestIfDue(input, storedView, now) : null;
  const ratingRequest = storedView && scorerEm ? ideaRatingsRequestIfDue(input, storedView, now) : null;
  const request = rankingRequest || ideasRequest || ratingRequest;
  const refreshDate = similarity.refreshedAt ? dateFromDateInput(similarity.refreshedAt, { throwOnInvalid: false }) : null;
  let priority = 3;
  if (similarity.changed) priority = 0;
  else if (similarity.neverRanked) priority = 1;
  else if (!stored?.relatedTaskRecords.length) priority = 2;
  return { priority, projectUuid, refreshedAt: refreshDate ? refreshDate.getTime() : 0, request };
}

// ----------------------------------------------------------------------------------------------
// @desc Decide whether a project's similarity ranking is due, and the revision a ranking should bring it to. Without a
//   rater, the ranking only refreshes the local task match, on the staleness window of the last refresh. With one, a
//   ranking is due when tasks changed since the recorded watermark, and is also forced, with no desired revision, when
//   it never ran, has aged, is due its second page, is missing a cited task's score, or has open tasks mentioning a
//   term whose definition changed since it ran.
// @param {QuarterProject} project - The live project.
// @param {object} options - { now, scorerEm, stored, taskWatermark, termChangedCount = 0, unscoredCitedCount }.
// @returns {object} { changed, desiredRevision, due, neverRanked, refreshedAt }.
function _similarityState(project, { now, scorerEm, stored, taskWatermark, termChangedCount = 0, unscoredCitedCount }) {
  if (!scorerEm) {
    return { changed: false, desiredRevision: null, due: projectNeedsRefresh(stored, now), neverRanked: !stored?.lastAttemptedAt,
      refreshedAt: stored?.lastAttemptedAt || null };
  }
  const success = stored?.refreshState.similarity;
  const refreshedAt = success?.succeededAt || stored?.lastRankedAt || null;
  const neverRanked = !stored?.lastRankedAt;
  const targetRevision = taskWatermark ? `${ similarityInputRevision(project, { scorerEm }) }@${ taskWatermark.snapshotId }:`
    + `${ taskWatermark.sequence }` : null;
  const currentRevision = stored ? refreshRevision(stored.refreshState, "similarity") : null;
  const changed = !neverRanked && Boolean(targetRevision) && currentRevision !== targetRevision;
  const forced = neverRanked || _isStale(refreshedAt, now) || unscoredCitedCount > 0 || termChangedCount > 0
    || needsSecondSearchPage(stored, { scorerEm });
  return { changed, desiredRevision: changed ? targetRevision : null, due: changed || forced, neverRanked, refreshedAt };
}

// ----------------------------------------------------------------------------------------------
// @desc The project as a job reads it: the live plan's fields with the store's fields adopted, so its ideas inputs are
//   digested exactly as the ideas job digests them.
// @param {QuarterProject} project - The live project.
// @param {QuarterProject} stored - The project as the store holds it.
// @returns {QuarterProject} A detached copy.
function _storedView(project, stored) {
  const view = project.detachedCopy();
  view.adoptStoreFields(stored);
  return view;
}
