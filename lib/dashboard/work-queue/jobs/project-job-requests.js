// Name the project maintenance job types and build the requests that submit them, so the planner that decides which
// projects to refresh and the handlers that ask for follow-up work describe a job the same way: one key per job type
// and project, so a second request for the same project coalesces into the saved job instead of adding another. A
// dictionary term's jobs are keyed by year and term instead, since one dictionary serves every domain and quarter.
import { quarterLabel } from "constants/quarters";
import { MAXIMUM_INPUT_CHARACTERS } from "dashboard/work-queue/dashboard-work-job";
import { decisionsEndpointForApp } from "providers/decisions-endpoint-for-app";

export const CLASSIFY_COMPLETED_TASKS_JOB_TYPE = "classifyCompletedTasks";
export const COLLECT_TERM_EVIDENCE_JOB_TYPE = "collectTermEvidence";
export const DISCOVER_DICTIONARY_TERMS_JOB_TYPE = "discoverDictionaryTerms";
export const ESTIMATE_TASK_DURATIONS_JOB_TYPE = "estimateTaskDurations";
export const GENERATE_PROJECT_IDEAS_JOB_TYPE = "generateProjectIdeas";
export const RANK_PROJECT_TASKS_JOB_TYPE = "rankProjectTasks";
export const RATE_PROJECT_IDEAS_JOB_TYPE = "rateProjectIdeas";
export const RECONCILE_PROJECTS_JOB_TYPE = "reconcileProjects";
export const REFINE_DICTIONARY_TERM_JOB_TYPE = "refineDictionaryTerm";
export const SCORE_COMPLETED_TASK_POTENTIAL_JOB_TYPE = "scoreCompletedTaskPotential";

// ----------------------------------------------------------------------------------------------
// @desc A request to record which project each task completed in the past week advanced. It runs at maintenance
//   priority, keyed by quarter, so the requests made while one waits coalesce into it. Each request names the time it
//   was made as its revision, so a classification that already completed runs again for tasks completed since.
// @param {object} input - { domainName, domainUuid, quarter, year }.
// @param {object} options - { requestedAt }: epoch milliseconds.
// @returns {object} A request DurableWorkRunner#submit takes.
export function completedTaskClassificationRequest(input, { requestedAt }) {
  return { category: "maintenance", desiredRevision: String(requestedAt), input: _quarterInput(input),
    key: `${ CLASSIFY_COMPLETED_TASKS_JOB_TYPE }:${ _quarterKey(input) }`, type: CLASSIFY_COMPLETED_TASKS_JOB_TYPE };
}

// ----------------------------------------------------------------------------------------------
// @desc A request to rate the potential of the project tasks a quarter's completed task ledger holds and raise the
//   victory value of those rated above it. Like the classification that submits it, it runs at maintenance priority,
//   keyed by quarter, and names the time it was requested as its revision, so tasks recorded since a completed rating
//   are rated too.
// @param {object} input - { domainName, domainUuid, quarter, year }.
// @param {object} options - { requestedAt }: epoch milliseconds.
// @returns {object} A request DurableWorkRunner#submit takes.
export function completedTaskPotentialRequest(input, { requestedAt }) {
  return { category: "maintenance", desiredRevision: String(requestedAt), input: _quarterInput(input),
    key: `${ SCORE_COMPLETED_TASK_POTENTIAL_JOB_TYPE }:${ _quarterKey(input) }`, type: SCORE_COMPLETED_TASK_POTENTIAL_JOB_TYPE };
}

// ----------------------------------------------------------------------------------------------
// @desc A request to grow the terms dictionary from a quarter's projects.
// @param {object} input - { domainName, domainUuid, quarter, year }.
// @param {object} options - { desiredRevision }: identifies the project wording discovery reads.
// @returns {object} A request DurableWorkRunner#submit takes.
export function dictionaryDiscoveryRequest(input, { desiredRevision }) {
  return { desiredRevision, input: _quarterInput(input), key: `${ DISCOVER_DICTIONARY_TERMS_JOB_TYPE }:${ _quarterKey(input) }`,
    type: DISCOVER_DICTIONARY_TERMS_JOB_TYPE };
}

// ----------------------------------------------------------------------------------------------
// @desc Requests to grow the terms dictionary and then rank projects against it: the discovery request holds as many
//   of the rankings as its input has room for, each as { projectUuid, desiredRevision }, and submits them once it
//   finishes (see heldRankingRequests). Each ranking repeats the quarter input, key, and type when written out in
//   full, so a handful of projects would overflow a job input; the compact form holds dozens. Rankings that still do
//   not fit are returned beside the discovery request to run at once against the dictionary as it stands.
// @param {object} input - { domainName, domainUuid, quarter, year }.
// @param {object} options - An object with the following properties:
//   - {string|null} [category] - Category for the discovery request and the rankings it holds; omitted for the default
//   - {string} desiredRevision - Identifies the project wording discovery reads
//   - {Array<object>} rankingRequests - From projectRankingRequest, all in the same category
// @returns {Array<object>} The discovery request first, then any rankings it could not hold.
export function dictionaryDiscoveryRequests(input, { category = null, desiredRevision, rankingRequests }) {
  const discoveryRequest = dictionaryDiscoveryRequest(input, { desiredRevision });
  const discoveryInput = { ...discoveryRequest.input, ...(category ? { heldRankingCategory: category } : {}), heldRankings: [] };
  const overflowRequests = [];
  for (const rankingRequest of rankingRequests) {
    const heldRanking = rankingRequest.desiredRevision === null || rankingRequest.desiredRevision === undefined
      ? { projectUuid: rankingRequest.entityId } : { desiredRevision: rankingRequest.desiredRevision, projectUuid: rankingRequest.entityId };
    const candidateRankings = [...discoveryInput.heldRankings, heldRanking];
    const candidateLength = JSON.stringify({ ...discoveryInput, heldRankings: candidateRankings }).length;
    if (candidateLength <= MAXIMUM_INPUT_CHARACTERS) discoveryInput.heldRankings = candidateRankings;
    else overflowRequests.push(rankingRequest);
  }
  const heldDiscoveryRequest = { ...discoveryRequest, ...(category ? { category } : {}), input: discoveryInput };
  return [heldDiscoveryRequest, ...overflowRequests];
}

// ----------------------------------------------------------------------------------------------
// @desc Rebuild the ranking requests a discovery job's input holds, in their compact heldRankings form, together
//   with any written out in full as heldRequests by an earlier version.
// @param {object} discoveryInput - A discovery job's input.
// @returns {Array<object>} Requests as DurableWorkRunner#submit takes them.
export function heldRankingRequests(discoveryInput) {
  const { heldRankingCategory = null, heldRankings = [], heldRequests = [] } = discoveryInput || {};
  const rebuiltRequests = heldRankings.map(({ desiredRevision = null, projectUuid }) => projectRankingRequest(discoveryInput, {
    category: heldRankingCategory, desiredRevision, projectUuid }));
  return [...heldRequests, ...rebuiltRequests];
}

// ----------------------------------------------------------------------------------------------
// @desc Queue a quarter's missing-duration pass at maintenance priority, coalescing repeated requests within its scope.
// @param {object} input - { domainName, domainUuid, quarter, year }.
// @param {object} options - { requestedAt }: epoch milliseconds, allowing a completed pass to run for new candidates.
// @returns {object} Durable work request.
export function taskDurationEstimatesRequest(input, { requestedAt }) {
  return { category: "maintenance", desiredRevision: String(requestedAt), input: _quarterInput(input),
    key: `${ ESTIMATE_TASK_DURATIONS_JOB_TYPE }:${ _quarterKey(input) }`, type: ESTIMATE_TASK_DURATIONS_JOB_TYPE };
}

// ----------------------------------------------------------------------------------------------
// @desc Schedule duration choices whenever DecisionsEndpoint has a decision-model route, independent of the ranker's
//   provider or batching label. The score-only generative fallback cannot answer categorical duration questions.
// @param {object} app - Host-compatible Amplenote API used to resolve configured keys or Ample Agent Pro.
// @param {object} input - { domainName, domainUuid, quarter, year }.
// @param {object} options - { requestedAt }: epoch milliseconds.
// @returns {Promise<object|null>} Duration maintenance request, or null when no decision provider is available.
export async function taskDurationEstimatesRequestIfAvailable(app, input, { requestedAt }) {
  const endpoint = await decisionsEndpointForApp(app, { includeFastScore: false });
  return endpoint ? taskDurationEstimatesRequest(input, { requestedAt }) : null;
}

// ----------------------------------------------------------------------------------------------
// @desc A request to collect one dictionary term's evidence from the notebook. The dictionary is annual, so the key
//   names the year and the term, never a domain or quarter: two quarters asking about one term share one job. Each
//   request names the time it was made as its revision, so a collection that completed earlier runs again.
// @param {object} input - { term, year }.
// @param {object} [options] - { category = "maintenance", mentionDigest = null, requestedAt = null }: mentionDigest
//   digests the open tasks naming the term when the request was made, saved with the evidence; requestedAt is epoch
//   milliseconds; category is foregroundData when the user asked for the collection.
// @returns {object} A request DurableWorkRunner#submit takes.
export function termEvidenceRequest({ term, year }, { category = "maintenance", mentionDigest = null, requestedAt = null } = {}) {
  const termKey = term.trim().toLowerCase();
  return { category, desiredRevision: requestedAt === null ? null : String(requestedAt), entityId: termKey,
    input: { mentionDigest, term: term.trim(), year }, key: `${ COLLECT_TERM_EVIDENCE_JOB_TYPE }:${ year }:${ termKey }`,
    type: COLLECT_TERM_EVIDENCE_JOB_TYPE };
}

// ----------------------------------------------------------------------------------------------
// @desc A request to refine one dictionary term's definition from its collected evidence, keyed like the evidence
//   request. Its revision is the evidence's source digest, so the same evidence is never sent to a provider twice.
// @param {object} input - { term, year }.
// @param {object} options - { category = "maintenance", sourceDigest }: sourceDigest is the digest of the evidence the
//   refinement is to read; category is the collection's own, so a collection the user asked for is refined as promptly.
// @returns {object} A request DurableWorkRunner#submit takes.
export function termRefinementRequest({ term, year }, { category = "maintenance", sourceDigest }) {
  const termKey = term.trim().toLowerCase();
  return { category, desiredRevision: sourceDigest, entityId: termKey, input: { term: term.trim(), year },
    key: `${ REFINE_DICTIONARY_TERM_JOB_TYPE }:${ year }:${ termKey }`, type: REFINE_DICTIONARY_TERM_JOB_TYPE };
}

// ----------------------------------------------------------------------------------------------
// @desc A request to rate one project's open ideas for actionability and relevance. Like idea generation it runs at
//   maintenance priority, since a recommendation uses whatever ratings are stored and never waits for one, unless the
//   user asked for the ideas being rated.
// @param {object} input - { domainName, domainUuid, quarter, year }.
// @param {object} options - { category = "maintenance", desiredRevision, projectUuid }: desiredRevision names the ideas
//   awaiting a rating, as ideaRatingsRevision digests them.
// @returns {object} A request DurableWorkRunner#submit takes.
export function projectIdeaRatingsRequest(input, { category = "maintenance", desiredRevision, projectUuid }) {
  return { category, desiredRevision, entityId: projectUuid, input: { ..._quarterInput(input), projectUuid },
    key: `${ RATE_PROJECT_IDEAS_JOB_TYPE }:${ projectUuid }`, type: RATE_PROJECT_IDEAS_JOB_TYPE };
}

// ----------------------------------------------------------------------------------------------
// @desc A request to generate one project's ideas. It runs at maintenance priority, even when foreground work such as
//   a ranking asked for it, since nothing on screen waits for ideas; only the user asking for ideas raises it.
// @param {object} input - { domainName, domainUuid, quarter, year }.
// @param {object} options - { category = "maintenance", desiredRevision, ideaCount, projectUuid }: desiredRevision is
//   null to ask whatever the stored ideas reflect; ideaCount, when given, is how many ideas to ask for in place of the
//   background pass's few.
// @returns {object} A request DurableWorkRunner#submit takes.
export function projectIdeasRequest(input, { category = "maintenance", desiredRevision, ideaCount, projectUuid }) {
  const jobInput = { ..._quarterInput(input), projectUuid };
  if (ideaCount) jobInput.ideaCount = ideaCount;
  return { category, desiredRevision, entityId: projectUuid, input: jobInput, key: `${ GENERATE_PROJECT_IDEAS_JOB_TYPE }:${ projectUuid }`,
    type: GENERATE_PROJECT_IDEAS_JOB_TYPE };
}

// ----------------------------------------------------------------------------------------------
// @desc A request to rank one project's tasks.
// @param {object} input - { domainName, domainUuid, quarter, year }.
// @param {object} options - { category, desiredRevision, projectUuid }: desiredRevision is null to rank whatever the
//   stored similarity refresh reflects; category is left to the handler's when omitted.
// @returns {object} A request DurableWorkRunner#submit takes.
export function projectRankingRequest(input, { category, desiredRevision, projectUuid }) {
  const request = { desiredRevision, entityId: projectUuid, input: { ..._quarterInput(input), projectUuid },
    key: `${ RANK_PROJECT_TASKS_JOB_TYPE }:${ projectUuid }`, type: RANK_PROJECT_TASKS_JOB_TYPE };
  return category ? { ...request, category } : request;
}

// ----------------------------------------------------------------------------------------------
// @desc A request to reconcile a quarter's projects and plan their maintenance. Each request names a new revision,
//   so a reconciliation that already completed runs again rather than counting as current.
// @param {object} input - { domainName, domainUuid, quarter, year }.
// @param {object} options - { category = "maintenance", requestedAt }: requestedAt is epoch milliseconds.
// @returns {object} A request DurableWorkRunner#submit takes.
export function projectReconciliationRequest(input, { category = "maintenance", requestedAt }) {
  return { category, desiredRevision: String(requestedAt), input: _quarterInput(input),
    key: `${ RECONCILE_PROJECTS_JOB_TYPE }:${ _quarterKey(input) }`, type: RECONCILE_PROJECTS_JOB_TYPE };
}

// ----------------------------------------------------------------------------------------------
// @desc Name the queue scope a quarter's project jobs are saved and run in: the Dashboard's work scope for that domain
//   and quarter, so the Dashboard and Plan Builder agree on which queue a quarter's work belongs to.
// @param {object} input - { domainUuid, quarter, year }.
// @returns {string} Such as "<domainUuid>:Q4 2026", or "all:Q4 2026" without a domain.
export function projectWorkScopeKey({ domainUuid, quarter, year }) {
  return `${ domainUuid || "all" }:${ quarterLabel(year, quarter) }`;
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc The quarter fields of a job input, without any project.
// @param {object} input - { domainName, domainUuid, quarter, year }.
// @returns {object} { domainName, domainUuid, quarter, year }.
function _quarterInput({ domainName, domainUuid, quarter, year }) {
  return { domainName: domainName ?? null, domainUuid: domainUuid ?? null, quarter, year };
}

// ----------------------------------------------------------------------------------------------
// @desc Name a quarter within a job key.
// @param {object} input - { quarter, year }.
// @returns {string} Such as "2026-Q4".
function _quarterKey({ quarter, year }) {
  return `${ year }-Q${ quarter }`;
}
