// Decide which Jev-ranked tasks a project accepts, and remember the minimum match score each project settled on.
// A project accepts tasks rated 6 or higher, the same bar the similarity hash and the sources page apply. One that
// would accept more than 20 is competitive and raises its bar to 7; one with nothing at 6 may take up to three tasks
// rated from 3. The minimum each project used lives in one
// plugin setting as JSON, scoped the way the Quarterly Planning checkboxes are:
// { [domainUuid or "all-notes"]: { "Q4 2026": { [projectUuid]: 7 } } }. Entries for quarters that have ended are
// dropped on dashboard load, as util/quarterly-plan-toggles drops ended quarters' checkbox states.
import { hasQuarterEnded, quarterFromLabel, quarterLabel } from "constants/quarters";
import { SETTING_KEYS } from "constants/settings";
import { logIfEnabled } from "util/log";

export const COMPETITIVE_MINIMUM_MATCH_SCORE = 7;
// More tasks than this at the default minimum means the project is drawing in work that only shares its topic.
export const COMPETITIVE_TASK_COUNT = 20;
export const DEFAULT_MINIMUM_MATCH_SCORE = 6;
export const FALLBACK_MINIMUM_MATCH_SCORE = 3;
// A project with nothing clearly its own still gets a few leads, but too few to bury the ideas it is offered.
export const FALLBACK_TASK_LIMIT = 3;
const ALL_NOTES_DOMAIN_KEY = "all-notes";

// ----------------------------------------------------------------------------------------------
// @desc Choose the tasks a project accepts from its ranking, and the minimum match score that chose them. When some
//   batches failed the distribution is incomplete, so the counts that pick a minimum cannot be trusted; the project's
//   stored minimum is applied instead when it has one. A competitive project whose ranking puts nothing at 7 keeps
//   the default minimum but only its top COMPETITIVE_TASK_COUNT tasks, rather than accepting nothing.
// @param {Array<object>} rankedTasks - Rated tasks, highest rating first, each with a 1–10 `rating`.
// @param {object} [options] - An object with the following properties:
//   - {boolean} [isComplete=true] - False when some of the project's tasks went unrated
//   - {number|null} [storedMinimumMatchScore=null] - The minimum this project used last time
// @returns {object} { acceptedTasks, minimumMatchScore }, with minimumMatchScore null when nothing was rated.
export function acceptedRankedTasks(rankedTasks, { isComplete = true, storedMinimumMatchScore = null } = {}) {
  if (!rankedTasks.length) return { acceptedTasks: [], minimumMatchScore: null };
  if (!isComplete && Number.isFinite(storedMinimumMatchScore)) {
    return { acceptedTasks: _tasksAtMinimum(rankedTasks, storedMinimumMatchScore), minimumMatchScore: storedMinimumMatchScore };
  }
  const defaultTasks = _tasksAtMinimum(rankedTasks, DEFAULT_MINIMUM_MATCH_SCORE);
  if (defaultTasks.length > COMPETITIVE_TASK_COUNT) {
    const competitiveTasks = _tasksAtMinimum(rankedTasks, COMPETITIVE_MINIMUM_MATCH_SCORE);
    if (competitiveTasks.length) return { acceptedTasks: competitiveTasks, minimumMatchScore: COMPETITIVE_MINIMUM_MATCH_SCORE };
    return { acceptedTasks: defaultTasks.slice(0, COMPETITIVE_TASK_COUNT), minimumMatchScore: DEFAULT_MINIMUM_MATCH_SCORE };
  }
  if (defaultTasks.length) return { acceptedTasks: defaultTasks, minimumMatchScore: DEFAULT_MINIMUM_MATCH_SCORE };
  return { acceptedTasks: _tasksAtMinimum(rankedTasks, FALLBACK_MINIMUM_MATCH_SCORE),
    minimumMatchScore: FALLBACK_MINIMUM_MATCH_SCORE };
}

// ----------------------------------------------------------------------------------------------
// @desc Parse the stored match scores setting, treating a missing or malformed value as no scores at all.
// @param {string|object|null} rawSetting - Value of SETTING_KEYS.PROJECT_MATCH_SCORES.
// @returns {object} Scores keyed by domain key, then quarter label, then project UUID.
export function matchScoresFromSetting(rawSetting) {
  if (!rawSetting) return {};
  try {
    const parsed = typeof rawSetting === "string" ? JSON.parse(rawSetting) : rawSetting;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Record one project's minimum match score.
// @param {object} matchScores - Parsed scores from matchScoresFromSetting.
// @param {object} params - { domainUuid, minimumMatchScore, projectUuid, quarter, year }.
// @returns {object} A new scores object; the input is not modified.
export function matchScoresWithProjectScore(matchScores, { domainUuid, minimumMatchScore, projectUuid, quarter, year }) {
  const domainKey = _domainKey(domainUuid);
  const label = quarterLabel(year, quarter);
  const quarterScores = { ...matchScores?.[domainKey]?.[label], [projectUuid]: minimumMatchScore };
  return { ...matchScores, [domainKey]: { ...matchScores?.[domainKey], [label]: quarterScores } };
}

// ----------------------------------------------------------------------------------------------
// @desc Apply prunedMatchScores to the stored setting and write it back when anything was dropped. Called on the
//   plugin-side dashboard load beside the quarterly plan checkbox promotion, with the same freshly synced settings.
// @param {object} app - Amplenote app interface; only setSetting is called.
// @param {object} params - An object with the following properties:
//   - {Date} [now] - Clock to read; defaults to the current local time
//   - {string|null} rawSetting - Current value of SETTING_KEYS.PROJECT_MATCH_SCORES
// @returns {Promise<string>} The setting's JSON after pruning, whether or not it was written.
export async function persistPrunedMatchScores(app, { now = new Date(), rawSetting }) {
  const { changed, matchScores } = prunedMatchScores(matchScoresFromSetting(rawSetting), { now });
  const serialized = JSON.stringify(matchScores);
  if (!changed) return serialized;
  try {
    await app.setSetting(SETTING_KEYS.PROJECT_MATCH_SCORES, serialized);
    logIfEnabled("[project-match-scores] pruned match scores saved", matchScores);
  } catch (error) {
    logIfEnabled("[project-match-scores] could not save pruned match scores", error?.message);
  }
  return serialized;
}

// ----------------------------------------------------------------------------------------------
// @desc Drop the scores of quarters that have ended, and of any domain left with none. A project's minimum only
//   matters while its quarter is current, and the setting would otherwise grow by a quarter's projects every quarter.
// @param {object} matchScores - Parsed scores from matchScoresFromSetting.
// @param {object} params - { now }.
// @returns {object} { changed, matchScores }, the pruned scores and whether they differ from the input.
export function prunedMatchScores(matchScores, { now = new Date() }) {
  let changed = false;
  const pruned = {};
  for (const [domainKey, scoresByLabel] of Object.entries(matchScores || {})) {
    const liveEntries = Object.entries(scoresByLabel || {}).filter(([label]) => {
      const parsed = quarterFromLabel(label);
      return parsed && !hasQuarterEnded({ now, ...parsed });
    });
    if (liveEntries.length !== Object.keys(scoresByLabel || {}).length) changed = true;
    if (liveEntries.length) pruned[domainKey] = Object.fromEntries(liveEntries);
  }
  return { changed, matchScores: pruned };
}

// ----------------------------------------------------------------------------------------------
// @desc Read one project's stored minimum match score.
// @param {object} matchScores - Parsed scores from matchScoresFromSetting.
// @param {object} params - { domainUuid, projectUuid, quarter, year }.
// @returns {number|null} The stored minimum, or null when none has been recorded.
export function storedMinimumMatchScore(matchScores, { domainUuid, projectUuid, quarter, year }) {
  const value = matchScores?.[_domainKey(domainUuid)]?.[quarterLabel(year, quarter)]?.[projectUuid];
  return Number.isFinite(value) ? value : null;
}

// ----------------------------------------------------------------------------------------------
// @desc The key a Task Domain's scores are stored under. All Notes, which has no domain UUID, gets its own key.
// @param {string|null} domainUuid - Active Task Domain UUID, or null for All Notes.
// @returns {string} Key into the stored scores object.
function _domainKey(domainUuid) {
  return domainUuid || ALL_NOTES_DOMAIN_KEY;
}

// ----------------------------------------------------------------------------------------------
// @desc Keep the ranked tasks at or above a minimum. The fallback minimum keeps only FALLBACK_TASK_LIMIT, since it
//   is only ever applied to a project with nothing rated at the default.
// @param {Array<object>} rankedTasks - Rated tasks, highest rating first.
// @param {number} minimumMatchScore - Lowest rating accepted.
// @returns {Array<object>} Accepted tasks, highest rating first.
function _tasksAtMinimum(rankedTasks, minimumMatchScore) {
  const qualifyingTasks = rankedTasks.filter(task => task.rating >= minimumMatchScore);
  if (minimumMatchScore > FALLBACK_MINIMUM_MATCH_SCORE) return qualifyingTasks;
  return qualifyingTasks.slice(0, FALLBACK_TASK_LIMIT);
}
