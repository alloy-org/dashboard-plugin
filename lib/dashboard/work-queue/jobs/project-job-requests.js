// Name the project maintenance job types and build the requests that submit them, so the planner that decides which
// projects to refresh and the handlers that ask for follow-up work describe a job the same way: one key per job type
// and project, so a second request for the same project coalesces into the saved job instead of adding another.
import { quarterLabel } from "constants/quarters";

export const DISCOVER_DICTIONARY_TERMS_JOB_TYPE = "discoverDictionaryTerms";
export const GENERATE_PROJECT_IDEAS_JOB_TYPE = "generateProjectIdeas";
export const RANK_PROJECT_TASKS_JOB_TYPE = "rankProjectTasks";
export const RECONCILE_PROJECTS_JOB_TYPE = "reconcileProjects";

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
