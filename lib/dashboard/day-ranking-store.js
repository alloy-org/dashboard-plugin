// Keep each task domain's prepared day rankings in an archived "Dashboard Day Ranking" note, so Dream Task, the
// Proposed Agenda, and Calendar's suggestions can share one ranking of a day's candidates instead of each asking a
// provider for its own. A ranking is stored under the day it ranks and its revision, which digests everything the
// ranker read, so a ranking is reused only by a request that would have asked the same question. Only each candidate's
// ID and the ranker's rating are kept; the rest is read from the candidates as they are listed when the ranking is used.
// Preparing and storing a ranking never records that a suggestion was shown. A note this version cannot read,
// including one a later version wrote, is never overwritten.
import { readJsonNote, writeJsonNote } from "dashboard/work-queue/dashboard-json-note";
import DashboardNoteWriter from "dashboard/work-queue/dashboard-note-writer";
import { dateKeyFromDateInput } from "util/date-utility";

export const DAY_RANKING_SCHEMA_VERSION = 1;
// Names the note of the "All Notes" fallback, which ranks tasks without a task domain.
const ALL_NOTES_DOMAIN_KEY = "all-notes";
// Shown above the JSON in the ranking note.
const DAY_RANKING_NOTE_DESCRIPTION = "This archived note is maintained by the dashboard plugin. It keeps the order in "
  + "which each day's candidate tasks and ideas were last ranked, so the Dashboard's suggestion widgets can share one "
  + "ranking instead of asking an AI provider again.";
// Most rankings kept for one day: one per distinct question asked of the ranker that day.
const MAXIMUM_RANKINGS_PER_DAY = 3;
// Most days with rankings kept; a day before today is always dropped.
const MAXIMUM_RANKED_DAYS = 4;
// Most candidates a ranking keeps, best first.
const MAXIMUM_RANKED_CANDIDATES = 60;

// ----------------------------------------------------------------------------------------------
// @desc Name a domain's ranking note.
// @param {string|null} domainUuid - Task domain UUID, or null for the All Notes fallback.
// @returns {string} Note name.
export function dayRankingNoteName(domainUuid) {
  return `Dashboard Day Ranking ${ domainUuid || ALL_NOTES_DOMAIN_KEY }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Reads and saves each domain's prepared day rankings.
export default class DayRankingStore {
  app; // {object} Host-compatible Amplenote API.
  clock; // {function} Returns epoch milliseconds; injected for tests.
  noteWriter; // {DashboardNoteWriter} Serializes each ranking note's read-then-write changes.

  // ----------------------------------------------------------------------------------------------
  // @desc Construct a store, sharing the app's note writer unless given another.
  // @param {object} options - { app, clock = Date.now, noteWriter }.
  constructor({ app, clock = Date.now, noteWriter = DashboardNoteWriter.forApp(app) }) {
    Object.assign(this, { app, clock, noteWriter });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Read the ranking stored for a day at a revision. A note that cannot be read finds nothing.
  // @param {string|null} domainUuid - Task domain UUID, or null for the All Notes fallback.
  // @param {object} options - { dateKey, revision }: the YYYY-MM-DD day ranked and dayRankingRevision's revision.
  // @returns {Promise<object|null>} { dateKey, preparedAt, rankerEm, ratings, revision }, ratings being
  //   [candidateId, rankerRating] pairs best first, or null when no ranking matches.
  async read(domainUuid, { dateKey, revision }) {
    const { payload } = await this._readNote(domainUuid);
    const rankings = payload?.rankings || [];
    return rankings.find(ranking => ranking.dateKey === dateKey && ranking.revision === revision) || null;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Save a day's ranking at its revision, replacing one saved at that revision and dropping past days, a day's
  //   oldest rankings beyond MAXIMUM_RANKINGS_PER_DAY, and the furthest days beyond MAXIMUM_RANKED_DAYS.
  // @param {string|null} domainUuid - Task domain UUID, or null for the All Notes fallback.
  // @param {object} options - { dateKey, rankedTasks, rankerEm, revision }: rankedTasks as rankDayTasks returns them.
  // @returns {Promise<object>} The ranking saved, as read returns one.
  // @throws When the note cannot be read, holds rankings a newer version wrote, or cannot be written.
  save(domainUuid, { dateKey, rankedTasks, rankerEm, revision }) {
    const name = dayRankingNoteName(domainUuid);
    return this.noteWriter.update(name, async () => {
      const { noteHandle, payload } = await this._readNote(domainUuid, { strict: true });
      const ranking = { dateKey, preparedAt: new Date(this.clock()).toISOString(), rankerEm,
        ratings: _ratingsFromRankedTasks(rankedTasks), revision };
      const todayKey = dateKeyFromDateInput(new Date(this.clock()));
      const earliestKey = dateKey < todayKey ? dateKey : todayKey;
      const rankings = _retainedRankings([ranking, ...(payload?.rankings || [])], earliestKey);
      await writeJsonNote(this.app, { description: DAY_RANKING_NOTE_DESCRIPTION, name, noteHandle,
        payload: { rankings, schemaVersion: DAY_RANKING_SCHEMA_VERSION }, title: "Dashboard day ranking" });
      return ranking;
    });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Read a domain's note and its payload.
  // @param {string|null} domainUuid - Task domain UUID, or null for the All Notes fallback.
  // @param {object} [options] - { strict = false }: true throws for a note this version cannot read, so a save never
  //   overwrites it; otherwise such a note reads as holding no rankings.
  // @returns {Promise<object>} { noteHandle, payload }, both null when the note does not exist.
  async _readNote(domainUuid, { strict = false } = {}) {
    const name = dayRankingNoteName(domainUuid);
    try {
      const { noteHandle, payload } = await readJsonNote(this.app, name);
      if (payload && Number(payload.schemaVersion) > DAY_RANKING_SCHEMA_VERSION) {
        throw new Error(`"${ name }" was written by a newer version of the plugin`);
      }
      if (payload && !Array.isArray(payload.rankings)) throw new Error(`"${ name }" holds no readable rankings`);
      return { noteHandle, payload };
    } catch (error) {
      if (strict) throw error;
      return { noteHandle: null, payload: null };
    }
  }
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc The pairs a ranking keeps: each candidate's ID and the rating the ranker gave it, best first.
// @param {Array<object>} rankedTasks - Ranked candidates carrying candidateId and rankerRating.
// @returns {Array<Array>} [candidateId, rankerRating] pairs.
function _ratingsFromRankedTasks(rankedTasks) {
  const rated = (rankedTasks || []).filter(task => task?.candidateId && Number.isFinite(task.rankerRating));
  const kept = rated.slice(0, MAXIMUM_RANKED_CANDIDATES);
  return kept.map(task => [task.candidateId, task.rankerRating]);
}

// ----------------------------------------------------------------------------------------------
// @desc The rankings worth keeping, newest first: none before the earliest day kept, one per day and revision, a few
//   per day, and the nearest few days.
// @param {Array<object>} rankings - Rankings, newest first.
// @param {string} earliestKey - The earliest YYYY-MM-DD day kept.
// @returns {Array<object>} Rankings to save.
function _retainedRankings(rankings, earliestKey) {
  const keptByDay = new Map();
  for (const ranking of rankings) {
    if (!ranking?.dateKey || ranking.dateKey < earliestKey) continue;
    const dayRankings = keptByDay.get(ranking.dateKey) || [];
    if (dayRankings.length >= MAXIMUM_RANKINGS_PER_DAY || dayRankings.some(kept => kept.revision === ranking.revision)) continue;
    keptByDay.set(ranking.dateKey, [...dayRankings, ranking]);
  }
  const nearestDays = [...keptByDay.keys()].sort().slice(0, MAXIMUM_RANKED_DAYS);
  return nearestDays.flatMap(dateKey => keptByDay.get(dateKey));
}
