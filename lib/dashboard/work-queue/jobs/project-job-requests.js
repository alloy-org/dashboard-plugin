// Name the project maintenance job types and build the requests that submit them, so the planner that decides which
// projects to refresh and the handlers that ask for follow-up work describe a job the same way: one key per job type
// and project, so a second request for the same project coalesces into the saved job instead of adding another. A
// dictionary term's jobs are keyed by year and term instead, since one dictionary serves every domain and quarter.
import { quarterLabel } from "constants/quarters";

export const COLLECT_TERM_EVIDENCE_JOB_TYPE = "collectTermEvidence";
export const DISCOVER_DICTIONARY_TERMS_JOB_TYPE = "discoverDictionaryTerms";
export const GENERATE_PROJECT_IDEAS_JOB_TYPE = "generateProjectIdeas";
export const RANK_PROJECT_TASKS_JOB_TYPE = "rankProjectTasks";
export const RECONCILE_PROJECTS_JOB_TYPE = "reconcileProjects";
export const REFINE_DICTIONARY_TERM_JOB_TYPE = "refineDictionaryTerm";

// ----------------------------------------------------------------------------------------------
// @desc A request to grow the terms dictionary from a quarter's projects, optionally holding requests that should read
//   the grown dictionary, which the discovery job submits once it finishes.
// @param {object} input - { domainName, domainUuid, quarter, year }.
// @param {object} options - { desiredRevision, heldRequests = [] }: desiredRevision identifies the project wording
//   discovery reads; heldRequests are requests as DurableWorkRunner#submit takes them.
// @returns {object} A request DurableWorkRunner#submit takes.
export function dictionaryDiscoveryRequest(input, { desiredRevision, heldRequests = [] }) {
  const quarterInput = _quarterInput(input);
  const discoveryInput = heldRequests.length ? { ...quarterInput, heldRequests } : quarterInput;
  return { desiredRevision, input: discoveryInput, key: `${ DISCOVER_DICTIONARY_TERMS_JOB_TYPE }:${ _quarterKey(input) }`,
    type: DISCOVER_DICTIONARY_TERMS_JOB_TYPE };
}

// ----------------------------------------------------------------------------------------------
// @desc A request to collect one dictionary term's evidence from the notebook. The dictionary is annual, so the key
//   names the year and the term, never a domain or quarter: two quarters asking about one term share one job. Each
//   request names the time it was made as its revision, so a collection that completed earlier runs again.
// @param {object} input - { term, year }.
// @param {object} [options] - { mentionDigest = null, requestedAt = null }: mentionDigest digests the open tasks
//   naming the term when the request was made, saved with the evidence; requestedAt is epoch milliseconds.
// @returns {object} A request DurableWorkRunner#submit takes.
export function termEvidenceRequest({ term, year }, { mentionDigest = null, requestedAt = null } = {}) {
  const termKey = term.trim().toLowerCase();
  return { category: "maintenance", desiredRevision: requestedAt === null ? null : String(requestedAt), entityId: termKey,
    input: { mentionDigest, term: term.trim(), year }, key: `${ COLLECT_TERM_EVIDENCE_JOB_TYPE }:${ year }:${ termKey }`,
    type: COLLECT_TERM_EVIDENCE_JOB_TYPE };
}

// ----------------------------------------------------------------------------------------------
// @desc A request to refine one dictionary term's definition from its collected evidence, keyed like the evidence
//   request. Its revision is the evidence's source digest, so the same evidence is never sent to a provider twice.
// @param {object} input - { term, year }.
// @param {object} options - { sourceDigest }: the digest of the evidence the refinement is to read.
// @returns {object} A request DurableWorkRunner#submit takes.
export function termRefinementRequest({ term, year }, { sourceDigest }) {
  const termKey = term.trim().toLowerCase();
  return { category: "maintenance", desiredRevision: sourceDigest, entityId: termKey, input: { term: term.trim(), year },
    key: `${ REFINE_DICTIONARY_TERM_JOB_TYPE }:${ year }:${ termKey }`, type: REFINE_DICTIONARY_TERM_JOB_TYPE };
}

// ----------------------------------------------------------------------------------------------
// @desc A request to generate one project's ideas. It always runs at maintenance priority, even when foreground work
//   asked for it, since nothing on screen waits for ideas.
// @param {object} input - { domainName, domainUuid, quarter, year }.
// @param {object} options - { desiredRevision, projectUuid }: desiredRevision is null to ask whatever the stored
//   ideas reflect.
// @returns {object} A request DurableWorkRunner#submit takes.
export function projectIdeasRequest(input, { desiredRevision, projectUuid }) {
  return { category: "maintenance", desiredRevision, entityId: projectUuid, input: { ..._quarterInput(input), projectUuid },
    key: `${ GENERATE_PROJECT_IDEAS_JOB_TYPE }:${ projectUuid }`, type: GENERATE_PROJECT_IDEAS_JOB_TYPE };
}

// ----------------------------------------------------------------------------------------------
// @desc A request to rank one project's tasks.
// @param {object} input - { domainName, domainUuid, quarter, year }.
// @param {object} options - { desiredRevision, projectUuid }: desiredRevision is null to rank whatever the stored
//   similarity refresh reflects.
// @returns {object} A request DurableWorkRunner#submit takes.
export function projectRankingRequest(input, { desiredRevision, projectUuid }) {
  return { desiredRevision, entityId: projectUuid, input: { ..._quarterInput(input), projectUuid },
    key: `${ RANK_PROJECT_TASKS_JOB_TYPE }:${ projectUuid }`, type: RANK_PROJECT_TASKS_JOB_TYPE };
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
