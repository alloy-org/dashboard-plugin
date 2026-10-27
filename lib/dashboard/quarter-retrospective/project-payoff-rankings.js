// Read and write the user's Project Payoff Rankings: after a quarter ends, the Quarter Retrospective asks the user to
// rank that quarter's projects by whether the work really paid off. Each domain keeps one archived note per year, such
// as "Work Project Payoff Rankings 2026", with a `## Q3` section per ranked quarter holding one JSON fence. Plan
// Builder reads the most recent rankings back, to remind the user what paid off and to weigh new project suggestions.
// Host-compatible: the plan wizard's evidence collection reads rankings from the host plugin.
import { quarterBefore, quarterLabel } from "constants/quarters";
import { DASHBOARD_NOTE_TAG } from "constants/settings";
import { readRetrospectiveDataNote, writeRetrospectiveDataSection } from "dashboard/quarter-retrospective/retrospective-data-note";
import { checkedAppResult, resolvedNoteHandle } from "plan-wizard/vision-guide-notes";
import { logIfEnabled } from "util/log";

export const PAYOFF_RANKINGS_VERSION = 1;
export const PAYOFF_RANKINGS_INTRODUCTION = "Written by the Dashboard. Each quarter below lists its projects ranked by "
  + "whether the work paid off, 1 paying off most, as ranked in the Quarter Retrospective. Plan Builder reads them; "
  + "re-rank a quarter from its retrospective rather than here.";
// How many ranked quarters Plan Builder recalls, and how far back it looks for them.
export const RECALLED_PAYOFF_QUARTERS = 2;
const RECALL_LOOKBACK_QUARTERS = 4;
const PAYOFF_LOG_LABEL = "[project-payoff-rankings]";

// ----------------------------------------------------------------------------------------------
// @desc Name the payoff rankings note for one domain and year.
// @param {object} options - { domainName, year }.
// @returns {string} Such as "Work Project Payoff Rankings 2026".
export function projectPayoffRankingsNoteName({ domainName, year }) {
  return `${ domainName } Project Payoff Rankings ${ year }`;
}

// ----------------------------------------------------------------------------------------------
// @desc The section heading for one quarter within its year's note.
// @param {number} quarter - 1 through 4.
// @returns {string} Such as "Q3".
export function payoffQuarterSection(quarter) {
  return `Q${ quarter }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Build a quarter's ranking from its projects in ranked order.
// @param {Array<object>} rankedProjects - { derivedFrom, name, uuid } per project, the one that paid off most first.
// @param {string} rankedAt - ISO timestamp of the ranking.
// @returns {object} { rankedAt, rankings, version }, rankings being { derivedFrom, projectName, projectUuid, rank,
//   rankedAt } per project with rank starting at 1.
export function payoffRankingFromProjects(rankedProjects, rankedAt) {
  const rankings = rankedProjects.map((project, index) => ({ derivedFrom: project.derivedFrom || null, projectName: project.name,
    projectUuid: project.uuid || null, rank: index + 1, rankedAt }));
  return { rankedAt, rankings, version: PAYOFF_RANKINGS_VERSION };
}

// ----------------------------------------------------------------------------------------------
// @desc Order a quarter's projects as the user last ranked them. Projects the ranking doesn't name keep their order
//   after the ranked ones; a project is matched by UUID, or by name when either side has no UUID.
// @param {Array<object>} projects - { derivedFrom, name, uuid } per project.
// @param {object|null} ranking - A stored ranking, or null.
// @returns {Array<object>} The same projects, reordered.
export function projectsInPayoffOrder(projects, ranking) {
  if (!ranking?.rankings?.length) return [...projects];
  const rankOf = project => {
    const match = ranking.rankings.find(entry => (entry.projectUuid && project.uuid ? entry.projectUuid === project.uuid
      : entry.projectName === project.name));
    return match ? match.rank : Number.POSITIVE_INFINITY;
  };
  const indexedProjects = projects.map((project, index) => ({ index, project, rank: rankOf(project) }));
  const sortedProjects = indexedProjects.sort((first, second) => first.rank - second.rank || first.index - second.index);
  const orderedProjects = sortedProjects.map(entry => entry.project);
  return orderedProjects;
}

// ----------------------------------------------------------------------------------------------
// @desc Read one quarter's ranking.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { domainName, quarter, year }.
// @returns {Promise<object|null>} { rankedAt, rankings, version }, or null when the quarter was never ranked.
export async function readProjectPayoffRanking(app, { domainName, quarter, year }) {
  const payloads = await _yearPayloads(app, { domainName, year });
  return _validRanking(payloads?.get(payoffQuarterSection(quarter)));
}

// ----------------------------------------------------------------------------------------------
// @desc The most recently ranked quarters before a planning quarter, newest first, looking back a year at most. A
//   quarter whose note can't be read is skipped, so a missing ranking never blocks planning.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { domainName, quarter, year }: the quarter being planned, which is itself left out.
// @param {object} [limits] - { quarterCount }: how many ranked quarters to return.
// @returns {Promise<Array<object>>} { label, quarter, rankings, year } per ranked quarter, rankings in rank order.
export async function recentProjectPayoffRankings(app, { domainName, quarter, year }, { quarterCount = RECALLED_PAYOFF_QUARTERS } = {}) {
  const payloadsByYear = new Map();
  const recalled = [];
  let candidate = quarterBefore({ quarter, year });
  for (let step = 0; step < RECALL_LOOKBACK_QUARTERS && recalled.length < quarterCount; step += 1) {
    if (!payloadsByYear.has(candidate.year)) payloadsByYear.set(candidate.year, await _yearPayloads(app, { domainName, year: candidate.year }));
    const ranking = _validRanking(payloadsByYear.get(candidate.year)?.get(payoffQuarterSection(candidate.quarter)));
    if (ranking) {
      const rankings = [...ranking.rankings].sort((first, second) => first.rank - second.rank);
      recalled.push({ label: quarterLabel(candidate.year, candidate.quarter), quarter: candidate.quarter, rankings, year: candidate.year });
    }
    candidate = quarterBefore(candidate);
  }
  return recalled;
}

// ----------------------------------------------------------------------------------------------
// @desc Save a quarter's ranking, replacing any earlier ranking of that quarter. The year's note is created archived
//   and tagged the first time any of its quarters is ranked.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - An object with the following properties:
//   - {string} domainName - Task domain display name
//   - {number} quarter - 1 through 4
//   - {Array<object>} rankedProjects - { derivedFrom, name, uuid } per project, the one that paid off most first
//   - {number} year - Calendar year
// @returns {Promise<object>} The ranking as saved: { rankedAt, rankings, version }.
export async function saveProjectPayoffRanking(app, { domainName, quarter, rankedProjects, year }) {
  const ranking = payoffRankingFromProjects(rankedProjects, new Date().toISOString());
  const noteHandle = await _rankingsNoteHandle(app, { domainName, year });
  const { content } = await readRetrospectiveDataNote(app, noteHandle.uuid);
  const startingContent = content.trim() ? content : `${ PAYOFF_RANKINGS_INTRODUCTION }\n`;
  await writeRetrospectiveDataSection(app, { content: startingContent, heading: payoffQuarterSection(quarter), noteHandle, payload: ranking });
  return ranking;
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc A bare { uuid } handle for the year's rankings note, creating the note when it doesn't exist yet.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { domainName, year }.
// @returns {Promise<object>} { uuid }.
async function _rankingsNoteHandle(app, { domainName, year }) {
  const name = projectPayoffRankingsNoteName({ domainName, year });
  const found = checkedAppResult(await app.findNote({ name }));
  if (found?.uuid) return { uuid: found.uuid };
  const created = checkedAppResult(await app.createNote(name, [DASHBOARD_NOTE_TAG], { archive: true }));
  const createdUuid = typeof created === "string" ? created : created?.uuid;
  if (!createdUuid) throw new Error(`Could not create payoff rankings note "${ name }"`);
  // createNote can hand back a local identifier the host stops resolving, so look the note up for the current one.
  return { uuid: (await resolvedNoteHandle(app, createdUuid)).uuid };
}

// ----------------------------------------------------------------------------------------------
// @desc A stored ranking when it holds at least one ranked project, otherwise null.
// @param {object|undefined} payload - A section's payload.
// @returns {object|null} The ranking.
function _validRanking(payload) {
  return Array.isArray(payload?.rankings) && payload.rankings.length ? payload : null;
}

// ----------------------------------------------------------------------------------------------
// @desc Every section payload in one year's rankings note.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { domainName, year }.
// @returns {Promise<Map<string, object>|null>} Payloads by section heading, or null when the note is missing or unreadable.
async function _yearPayloads(app, { domainName, year }) {
  try {
    const found = checkedAppResult(await app.findNote({ name: projectPayoffRankingsNoteName({ domainName, year }) }));
    if (!found?.uuid) return null;
    const { payloads } = await readRetrospectiveDataNote(app, found.uuid);
    return payloads;
  } catch (error) {
    logIfEnabled(`${ PAYOFF_LOG_LABEL } could not read ${ year } rankings`, error?.message);
    return null;
  }
}
