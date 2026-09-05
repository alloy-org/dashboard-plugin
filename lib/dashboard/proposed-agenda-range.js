// Expands calendar windows into plannable days and combines their generated agendas.
import { generateProposedAgenda } from "proposed-agenda-service";
import { dateFromDateInput, localMidnightFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";

// A calendar view can span a whole month, but each day costs one LLM round trip, so the range is capped.
const MAX_RANGE_DAYS = 5;

const SATURDAY = 6;
const SUNDAY = 0;

// ----------------------------------------------------------------------------------------------
// @desc Group ordered agenda rows into the consecutive day blocks rendered by the widget.
// @param {Array<object>} rows - Rows from mergedAgendaRows (ascending by day, then start time).
// @returns {Array<object>} { dayHeading, rows, targetMidnightSeconds } groups, in row order.
export function agendaRowsGroupedByDay(rows) {
  const groups = [];
  for (const row of rows || []) {
    const targetMidnightSeconds = row.targetMidnightSeconds ?? null;
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.targetMidnightSeconds === targetMidnightSeconds) {
      lastGroup.rows.push(row);
      continue;
    }
    const dayHeading = targetMidnightSeconds
      ? new Date(targetMidnightSeconds * 1000).toLocaleDateString([], { day: "numeric", month: "long", weekday: "long" })
      : null;
    groups.push({ dayHeading, rows: [row], targetMidnightSeconds });
  }
  return groups;
}

// ----------------------------------------------------------------------------------------------
// @desc Generate one agenda per day sequentially, publishing completed days through an optional callback.
// @param {object} app - Amplenote app bridge.
// @param {object} options - { aiModelOverride, calendarEvents, days, domainName, domainUuid, forceRegenerate,
//   obligationsForDay, onDayComplete, priorityKey, providerEmOverride }.
//   - {Array<Date>} days - Local midnights to plan, ascending (from proposedAgendaDaysInRange).
//   - {Function} obligationsForDay - async (day) => obligation records already committed on that day.
//   - {Function|null} onDayComplete - async (dayResult, dayResultsSoFar) => void, awaited after each day.
// @returns {Promise<Array<object>>} One result per day: generateProposedAgenda's payload plus { day,
//   obligations, targetMidnightSeconds }.
export async function generateProposedAgendaRange(app, { aiModelOverride = null, calendarEvents = null, days,
    domainName = null, domainUuid = null, forceRegenerate = false, obligationsForDay, onDayComplete = null,
    priorityKey = null, providerEmOverride = null }) {
  const dayResults = [];
  for (const day of days) {
    const targetMidnightSeconds = Math.floor(day.getTime() / 1000);
    const rawObligations = await obligationsForDay(day);
    // Obligations arrive as time-of-day records with no notion of which day they sit on; stamping the day here
    // is what lets activityKey/mergedAgendaRows keep Monday 09:00 distinct from Tuesday 09:00.
    const obligations = (rawObligations || []).map(obligation => ({ ...obligation, targetMidnightSeconds }));
    const result = await generateProposedAgenda(app, { aiModelOverride, calendarEvents, domainName, domainUuid,
      forceRegenerate, obligations, priorityKey, providerEmOverride, targetDate: day });
    const dayResult = { ...result, day, obligations, targetMidnightSeconds };
    dayResults.push(dayResult);
    if (onDayComplete) await onDayComplete(dayResult, dayResults);
  }
  logIfEnabled("[proposed-agenda-range] generated range", { dayCount: dayResults.length,
    activityCount: dayResults.reduce((total, dayResult) => total + (dayResult.activities?.length || 0), 0) });
  return dayResults;
}

// ----------------------------------------------------------------------------------------------
// @desc Flatten successful per-day results into the widget state shape, surfacing the first error if all fail.
// @param {Array<object>} dayResults - Output of generateProposedAgendaRange.
// @returns {object} { activities, attribution, dateLabel, dismissedKeys, domainName, domainUuid, error,
//   errorCode, isFutureDay, obligations, providerEm, scheduledKeys }.
export function mergedRangeGeneration(dayResults) {
  const succeededDays = (dayResults || []).filter(dayResult => !dayResult.error);
  if (succeededDays.length === 0) {
    const firstFailure = (dayResults || [])[0] || {};
    return { activities: [], dismissedKeys: [], error: firstFailure.error || "No schedule could be proposed.",
      errorCode: firstFailure.errorCode || null, obligations: [], scheduledKeys: [] };
  }
  const activities = succeededDays.flatMap(dayResult => dayResult.activities || []);
  const obligations = succeededDays.flatMap(dayResult => dayResult.obligations || []);
  const dismissedKeys = succeededDays.flatMap(dayResult => dayResult.dismissedKeys || []);
  const scheduledKeys = succeededDays.flatMap(dayResult => dayResult.scheduledKeys || []);
  const firstDay = succeededDays[0];
  const lastDay = succeededDays[succeededDays.length - 1];
  const dateLabel = succeededDays.length === 1 ? firstDay.dateLabel
    : `${ firstDay.dateLabel } – ${ lastDay.dateLabel }`;
  return { activities, attribution: firstDay.llmAttributionFooter || null, dateLabel, dismissedKeys,
    domainName: firstDay.domainName, domainUuid: firstDay.domainUuid, error: null, errorCode: null,
    isFutureDay: succeededDays.every(dayResult => dayResult.isFutureDay), obligations,
    providerEm: firstDay.providerEm || null, scheduledKeys };
}

// ----------------------------------------------------------------------------------------------
// @desc Expand a calendar window into future local-midnight days, preferring weekdays and applying the cap last.
// @param {object|null} dateRange - { endAt, startAt } as unix seconds, unix ms, or Date.
// @param {object} [options] - { maxDays, now }: `now` is injectable so tests need not mock the global clock.
// @returns {Array<Date>} Local midnights, ascending.
export function proposedAgendaDaysInRange(dateRange, { maxDays = MAX_RANGE_DAYS, now = new Date() } = {}) {
  const startDate = dateFromDateInput(dateRange?.startAt, { throwOnInvalid: false });
  const endDate = dateFromDateInput(dateRange?.endAt, { throwOnInvalid: false });
  if (!startDate || !endDate || endDate < startDate) return [];
  const todayMidnight = localMidnightFromDateInput(now);
  const endMidnight = localMidnightFromDateInput(endDate);
  const allDays = [];
  const startMidnight = localMidnightFromDateInput(startDate);
  const cursor = new Date(Math.max(startMidnight.getTime(), todayMidnight.getTime()));
  while (cursor <= endMidnight) {
    allDays.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  const weekdays = allDays.filter(day => day.getDay() !== SATURDAY && day.getDay() !== SUNDAY);
  const preferredDays = weekdays.length > 0 ? weekdays : allDays;
  return preferredDays.slice(0, maxDays);
}
