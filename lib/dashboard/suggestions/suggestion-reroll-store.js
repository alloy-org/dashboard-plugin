// Remember the calendar days a user re-rolled. Clicking Suggest again within REROLL_WINDOW_SECONDS of a pass handing
// its suggestions to the calendar asks the user how to re-roll; the re-roll discards what that pass offered and ranks
// the day again under the focus and projects the user chose. Its suggestions are never stored as the day's agenda,
// since they answer a preference held only for the moment, so the day's record here keeps the suggestions it offered
// and every suggestion it discarded or offered. Until the date the user re-rolled on is over, later passes show the
// re-rolled suggestions again, unless the user re-rolls once more. After that date, the next ordinary pass plans the day
// afresh without any of them, and later passes keep leaving them out until the day itself is over, when its record is
// pared from the archived note.
import { previousSuggestionGeneration, suggestionIdentityKey } from "dashboard/suggestions/suggestion-staleness";
import { readJsonNote, writeJsonNote } from "dashboard/work-queue/dashboard-json-note";
import { dateKeyFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";
import { activeTaskDomainInfo } from "util/task-domain-utility";

// How soon after a pass finishes that a second Suggest click is taken as asking for a re-roll.
export const REROLL_WINDOW_SECONDS = 3 * 60;
// Most quarter projects the user can boost in one re-roll.
export const MAXIMUM_BOOSTED_PROJECTS = 3;
export const DEFAULT_REROLL_FOCUS_KEY = "quarterPlan";
export const DEFAULT_REROLL_SOURCE_KEY = "newAndExisting";
// The focuses a re-roll offers, in the order the popup lists them. instruction is what every ranking question adds.
export const REROLL_FOCUS_OPTIONS = Object.freeze([
  { description: "Projects that correspond with your quarterly plan", instruction: "suggest the tasks that most directly "
      + "advance the projects of the user's quarterly plan.", key: "quarterPlan", label: "Quarter plan" },
  { description: "The easiest wins on your list", instruction: "prioritize easy tasks: rate highest the tasks that are quick "
      + "to finish and obvious where to start, and lowest those that need a long or uncertain effort.", key: "layups",
    label: "Layups" },
  { description: "Ambitious, high-ROI work", instruction: "prioritize high-ROI tasks: rate highest the tasks whose payoff "
      + "for their project is largest relative to the time they take.", key: "moonshots", label: "Moonshots" },
]);

// Where a re-roll's suggestions may come from, in the order the popup lists them. existingTasks and newIdeas say which
// candidates compete: an existing task, or a new idea the plugin proposes.
export const REROLL_SOURCE_OPTIONS = Object.freeze([
  { existingTasks: true, key: "newAndExisting", label: "New + existing", newIdeas: true },
  { existingTasks: true, key: "existing", label: "Existing tasks", newIdeas: false },
  { existingTasks: false, key: "new", label: "New tasks", newIdeas: true },
]);

const NOTE_DESCRIPTION = "This archived note is maintained by the dashboard plugin. Each record names a calendar day "
  + "whose suggestions the user re-rolled, the suggestions the re-roll offered, which are shown again for the rest of the "
  + "date it was chosen on, and the suggestions the day no longer offers after that. Records are removed once their day "
  + "has passed.";
const NOTE_NAME = "Dashboard Suggestion Re-rolls";
const REROLL_LOG_LABEL = "[suggestion-reroll-store]";

// ----------------------------------------------------------------------------------------------
// @desc The suggestions a re-roll leaves out of each day: those the previous pass offered, and those an earlier
//   re-roll of the day already discarded or offered.
// @param {Array<Date>} days - The days to re-roll.
// @param {object} options - { previousPass, rerolledDays }: previousPass as rerollablePreviousPass returns it, and
//   rerolledDays as readRerolledDays reads them.
// @returns {object} Suggestion identity keys by Date#toDateString.
export function discardedKeysByDay(days, { previousPass, rerolledDays }) {
  const discardedEntries = days.map(day => {
    const dayKey = day.toDateString();
    const offeredKeys = previousPass?.offeredKeysByDay?.[dayKey] || [];
    return [dayKey, [...new Set([...offeredKeys, ...(rerolledDays.get(dayKey)?.excludedKeys || [])])]];
  });
  return Object.fromEntries(discardedEntries);
}

// ----------------------------------------------------------------------------------------------
// @desc After an ordinary pass, mark the re-rolled days it planned afresh, so later passes serve their new agendas.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { domainUuid, now, plannedDayKeys, rerolledDays }: plannedDayKeys are the
//   Date#toDateString values the pass planned, and rerolledDays as readRerolledDays read them before it.
// @returns {Promise<void>} Never rejects.
export async function markFreshlyPlannedDays(app, { domainUuid, now = new Date(), plannedDayKeys, rerolledDays }) {
  const freshlyPlannedDayKeys = plannedDayKeys.filter(dayKey => rerolledDays.get(dayKey)?.forceRegenerate);
  if (freshlyPlannedDayKeys.length) await markRerolledDaysPlanned(app, { dayKeys: freshlyPlannedDayKeys, domainUuid, now });
}

// ----------------------------------------------------------------------------------------------
// @desc Forget that a re-rolled day still has to be planned afresh, once an ordinary pass has done so. Its excluded
//   suggestions stay, so later passes keep leaving them out.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { dayKeys, domainUuid, now }: dayKeys are the Date#toDateString values just planned.
// @returns {Promise<void>} Never rejects; a failed write is logged.
export async function markRerolledDaysPlanned(app, { dayKeys, domainUuid, now = new Date() }) {
  const plannedDayKeys = new Set(dayKeys || []);
  await _updateRecords(app, { now }, records => records.map(record => (record.domainUuid === (domainUuid || null)
    && plannedDayKeys.has(record.dayKey) ? { ...record, forceRegenerate: false } : record)));
}

// ----------------------------------------------------------------------------------------------
// @desc Today's and later re-rolled days for a task domain, as generateProposedAgendaRange's rerolledDays reads them.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { domainUuid, now }.
// @returns {Promise<Map<string,object>>} { activities, excludedKeys: Set, forceRegenerate, focusKey, includeEvenings,
//   projectUuids, rerolledAt, sourceKey } by Date#toDateString, where activities are the suggestions the re-roll offered,
//   includeEvenings whether it offered evening hours, and rerolledAt the ISO time it was chosen; empty when nothing was
//   re-rolled or the note cannot be read.
export async function readRerolledDays(app, { domainUuid, now = new Date() }) {
  const { records } = await _currentRecords(app, { now }).catch(error => {
    logIfEnabled(`${ REROLL_LOG_LABEL } could not read re-rolled days`, error?.message);
    return { records: [] };
  });
  const domainRecords = records.filter(record => record.domainUuid === (domainUuid || null));
  return new Map(domainRecords.map(record => [record.dayKey, { activities: Array.isArray(record.activities) ? record.activities : [],
    excludedKeys: new Set(record.excludedKeys || []), focusKey: record.focusKey, forceRegenerate: Boolean(record.forceRegenerate),
    includeEvenings: Boolean(record.includeEvenings), projectUuids: record.projectUuids || [], rerolledAt: record.rerolledAt || null, sourceKey: record.sourceKey || DEFAULT_REROLL_SOURCE_KEY }]));
}

// ----------------------------------------------------------------------------------------------
// @desc Record the days a re-roll just planned, replacing any earlier record of the same day and domain, and mark each
//   to be planned afresh by the next ordinary pass.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { days, domainUuid, focusKey, includeEvenings, now, projectUuids, sourceKey }: days are
//   { activities, day, excludedKeys } with activities the suggestions offered, day the Date planned, and excludedKeys
//   every suggestion identity it discarded or offered.
// @returns {Promise<void>} Never rejects; a failed write is logged.
export async function recordRerolledDays(app, { days, domainUuid, focusKey, includeEvenings = false, now = new Date(), projectUuids,
    sourceKey = DEFAULT_REROLL_SOURCE_KEY }) {
  const rerolledAt = now.toISOString();
  const newRecords = days.map(({ activities = [], day, excludedKeys }) => ({ activities, dateKey: dateKeyFromDateInput(day),
    dayKey: day.toDateString(), domainUuid: domainUuid || null, excludedKeys: [...excludedKeys], focusKey, forceRegenerate: true,
    includeEvenings: Boolean(includeEvenings), projectUuids, rerolledAt, sourceKey }));
  const replacedIdentities = new Set(newRecords.map(_recordIdentity));
  await _updateRecords(app, { now }, records => [...records.filter(record => !replacedIdentities.has(_recordIdentity(record))),
    ...newRecords]);
}

// ----------------------------------------------------------------------------------------------
// @desc Record the days a re-roll pass planned, each with the suggestions it offered, which later passes show again
//   until the date is over, and every suggestion it discarded or offered, which no later pass offers before the day ends.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { dayEntries, dayResults, domainUuid, rerollChoice }: dayEntries are the published
//   { activities, dayKey } per day, dayResults as generateRerolledRange returns them, and rerollChoice as
//   promptedRerollChoice returns it.
// @returns {Promise<void>} Never rejects.
export async function recordRerolledPass(app, { dayEntries, dayResults, domainUuid, rerollChoice }) {
  const activitiesByDay = new Map(dayEntries.map(dayEntry => [dayEntry.dayKey, dayEntry.activities]));
  const days = dayResults.map(dayResult => {
    const activities = activitiesByDay.get(dayResult.day.toDateString()) || [];
    const offeredKeys = activities.map(suggestionIdentityKey);
    const excludedKeys = [...(dayResult.discardedKeys || []), ...offeredKeys].filter(Boolean);
    return { activities, day: dayResult.day, excludedKeys: new Set(excludedKeys) };
  });
  await recordRerolledDays(app, { days, domainUuid, focusKey: rerollChoice.focus.key, includeEvenings: rerollChoice.includeEvenings,
    projectUuids: rerollChoice.projectUuids, sourceKey: rerollChoice.source.key });
}

// ----------------------------------------------------------------------------------------------
// @desc Whether a re-rolled day's suggestions should be shown again in place of planning it: the re-roll offered
//   suggestions, and was chosen on the same local date as now.
// @param {object|null} rerolledDay - The day's entry as readRerolledDays reads it.
// @param {object} [options] - { now }.
// @returns {boolean}
export function replayableRerolledDay(rerolledDay, { now = new Date() } = {}) {
  if (!rerolledDay?.activities?.length || !rerolledDay.rerolledAt) return false;
  const rerolledOnToday = dateKeyFromDateInput(new Date(rerolledDay.rerolledAt)) === dateKeyFromDateInput(now);
  return rerolledOnToday;
}

// ----------------------------------------------------------------------------------------------
// @desc The focus option named by a key, or the default focus for an unknown key.
// @param {string|null} focusKey - A REROLL_FOCUS_OPTIONS key.
// @returns {object} The focus option.
export function rerollFocusFromKey(focusKey) {
  return REROLL_FOCUS_OPTIONS.find(option => option.key === focusKey)
    || REROLL_FOCUS_OPTIONS.find(option => option.key === DEFAULT_REROLL_FOCUS_KEY);
}

// ----------------------------------------------------------------------------------------------
// @desc The source option named by a key, or the default source, new and existing, for an unknown key.
// @param {string|null} sourceKey - A REROLL_SOURCE_OPTIONS key.
// @returns {object} The source option.
export function rerollSourceFromKey(sourceKey) {
  return REROLL_SOURCE_OPTIONS.find(option => option.key === sourceKey)
    || REROLL_SOURCE_OPTIONS.find(option => option.key === DEFAULT_REROLL_SOURCE_KEY);
}

// ----------------------------------------------------------------------------------------------
// @desc Whether a Suggest click asks to re-roll: the previous pass offered suggestions, finished no more than
//   REROLL_WINDOW_SECONDS ago, and covered every day now requested.
// @param {object} app - Amplenote app bridge, with settings.
// @param {object} options - { dayKeys, nowSeconds }: dayKeys are the Date#toDateString values this pass would plan.
// @returns {object|null} The previous pass's record, as previousSuggestionGeneration reads it, or null.
export function rerollablePreviousPass(app, { dayKeys, nowSeconds }) {
  const previous = previousSuggestionGeneration(app);
  if (!previous?.finishedAtSeconds || !previous.suggestionCount) return null;
  const elapsedSeconds = nowSeconds - previous.finishedAtSeconds;
  if (elapsedSeconds < 0 || elapsedSeconds > REROLL_WINDOW_SECONDS) return null;
  const previousDayKeys = new Set(previous.dayKeys);
  if (!dayKeys.length || !dayKeys.every(dayKey => previousDayKeys.has(dayKey))) return null;
  return previous;
}

// ----------------------------------------------------------------------------------------------
// @desc The task domain re-rolls are recorded under: the calendar's, else the Dashboard's active one.
// @param {object} app - Amplenote app bridge.
// @param {object|null} taskDomain - The calendar's { name, uuid }, or null.
// @returns {Promise<object>} { domainName, domainUuid }.
export async function rerollTaskDomain(app, taskDomain) {
  if (taskDomain?.uuid) return { domainName: taskDomain.name || null, domainUuid: taskDomain.uuid };
  const activeDomain = await activeTaskDomainInfo(app);
  return { domainName: taskDomain?.name || activeDomain.domainName || "All Notes", domainUuid: activeDomain.domainUuid || null };
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc The note's records for today and later days.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { now }.
// @returns {Promise<object>} { noteHandle, records }.
async function _currentRecords(app, { now }) {
  const { noteHandle, payload } = await readJsonNote(app, NOTE_NAME);
  const todayKey = dateKeyFromDateInput(now);
  const storedRecords = Array.isArray(payload?.records) ? payload.records : [];
  const records = storedRecords.filter(record => record?.dateKey >= todayKey && record.dayKey);
  return { noteHandle, records };
}

// ----------------------------------------------------------------------------------------------
// @desc The day and domain a record covers.
// @param {object} record - Stored record.
// @returns {string}
function _recordIdentity(record) {
  return `${ record.domainUuid || "" }::${ record.dayKey }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Rewrite the note's current records, leaving out past days. A note that cannot be read is not written, so its
//   records are never replaced by a partial list.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { now }.
// @param {function} update - (records) => the records to store.
// @returns {Promise<void>} Never rejects; a failure is logged.
async function _updateRecords(app, { now }, update) {
  try {
    const { noteHandle, records } = await _currentRecords(app, { now });
    const updatedRecords = update(records);
    await writeJsonNote(app, { description: NOTE_DESCRIPTION, name: NOTE_NAME, noteHandle,
      payload: { records: updatedRecords }, title: "Calendar suggestion re-rolls" });
  } catch (error) {
    logIfEnabled(`${ REROLL_LOG_LABEL } could not record re-rolled days`, error?.message);
  }
}
