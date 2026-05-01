/**
 * [Claude-authored file]
 * Created: 2026-02-28 | Model: gpt-5.3-codex
 * Task: Shared date parsing, keying, and week-range helpers
 * Prompt summary: "consolidate repeated date functions into lib/util/date-utility.js using from* naming"
 */

// ----------------------------------------------------------------------------------------------
// @desc Normalize date-like input into a local `Date` instance.
// @example
// const date = dateFromDateInput("2026-02-28");
// @param {Date|string|number|null|undefined} dateInput - A date-like value to parse.
// @param {object} [options] - Parsing options.
// @param {boolean} [options.throwOnInvalid=true] - Return null instead of throwing when false.
// @returns {Date|null} Parsed local `Date` object, or null only when throwOnInvalid is false.
export function dateFromDateInput(dateInput, { throwOnInvalid = true } = {}) {
  const fail = () => {
    if (!throwOnInvalid) return null;
    throw new TypeError(`Invalid date input: ${ String(dateInput) }`);
  };
  if (dateInput == null || dateInput === "") return fail();
  if (dateInput instanceof Date) {
    const date = new Date(dateInput);
    return Number.isNaN(date.getTime()) ? fail() : date;
  }

  if (typeof dateInput === "number") {
    if (!Number.isFinite(dateInput)) return fail();
    const millis = Math.abs(dateInput) < 10_000_000_000 ? dateInput * 1000 : dateInput;
    const parsed = new Date(millis);
    return Number.isNaN(parsed.getTime()) ? fail() : parsed;
  }

  if (typeof dateInput === "string") {
    const trimmed = dateInput.trim();
    if (!trimmed) return fail();

    if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
      const [year, month, day] = dateInput.split('-').map(Number);
      return new Date(year, month - 1, day);
    }
  
    const numericValue = Number(trimmed);
    if (!Number.isNaN(numericValue)) return dateFromDateInput(numericValue, { throwOnInvalid });
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? fail() : parsed;
  }

  const parsed = new Date(dateInput);
  return Number.isNaN(parsed.getTime()) ? fail() : parsed;
}

// [Claude] Task: single local `YYYY-MM-DD` key for agenda, task grouping, and tests
// Prompt: "DRY formatDateKey in date-utility.js; consumed by agenda, tests, use-domain-tasks"
// Date: 2026-03-24 | Model: claude-sonnet-4-6
// Builds a local calendar date key (`YYYY-MM-DD`). Numeric timestamps treat values < 1e10 as Unix seconds.
// @example
// formatDateKey(new Date('2026-02-23T10:30:00')) // '2026-02-23'
// @param {Date|string|number|null|undefined} dateValue - Date instance, ISO-ish string, plain `YYYY-MM-DD`, or Unix sec/ms.
// @returns {string} Local date key in `YYYY-MM-DD` format.
export function formatDateKey(dateValue) {
  const date = dateFromDateInput(dateValue);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Builds a local calendar date key (`YYYY-MM-DD`) from date-like input.
// @example
// const key = dateKeyFromDateInput("2026-02-28");
// @param {Date|string|number|null|undefined} dateInput - A date-like value to normalize and format.
// @returns {string} Local date key in `YYYY-MM-DD` format.
export function dateKeyFromDateInput(dateInput) {
  return formatDateKey(dateInput);
}

// [Claude claude-4.6-opus-high-thinking] Task: add optional weekStartDay param (0=Sunday, 1=Monday)
// Prompt: "update weekStartFromDateInput to support configurable week start day"
// Calculates the start of the week for date-like input. Defaults to Monday (weekStartDay=1).
// @example
// const weekStart = weekStartFromDateInput(new Date());
// const sundayStart = weekStartFromDateInput(new Date(), 0);
// @param {Date|string|number|null|undefined} dateInput - A date-like value within the target week.
// @param {number} [weekStartDay=1] - Day the week starts on: 0=Sunday, 1=Monday.
// @returns {Date} Local `Date` set to the week start day at midnight.
export function weekStartFromDateInput(dateInput, weekStartDay = 1) {
  const date = dateFromDateInput(dateInput);
  const dayOfWeek = date.getDay();
  const delta = (dayOfWeek - weekStartDay + 7) % 7;
  const weekStart = new Date(date.getFullYear(), date.getMonth(), date.getDate() - delta);
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
}

// Calculates the end of the week (6 days after week start at 23:59:59.999 local time).
// @example
// const weekEnd = weekEndFromDateInput("2026-02-28");
// @param {Date|string|number|null|undefined} dateInput - A date-like value within the target week.
// @param {number} [weekStartDay=1] - Day the week starts on: 0=Sunday, 1=Monday.
// @returns {Date} Local `Date` set to end-of-day for the last day of the input week.
export function weekEndFromDateInput(dateInput, weekStartDay = 1) {
  const weekStart = weekStartFromDateInput(dateInput, weekStartDay);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  return weekEnd;
}

// Builds 7-day boundaries for the week containing the input date.
// Each boundary includes Unix-second `from`/`to` values and a local `dateKey`.
// @example
// const { boundaries, weekStartKey } = weekBoundariesFromDateInput("2026-02-28");
// @param {Date|string|number|null|undefined} dateInput - A date-like value within the target week.
// @param {number} [weekStartDay=1] - Day the week starts on: 0=Sunday, 1=Monday.
// @returns {{boundaries: Array<{from: number, to: number, dateKey: string}>, weekStartKey: string}} Week boundaries plus week start key.
export function weekBoundariesFromDateInput(dateInput, weekStartDay = 1) {
  const weekStart = weekStartFromDateInput(dateInput, weekStartDay);
  const boundaries = [];

  for (let i = 0; i < 7; i++) {
    const dayStart = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i);
    const dayEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i + 1);
    boundaries.push({
      from: Math.floor(dayStart.getTime() / 1000),
      to: Math.floor(dayEnd.getTime() / 1000),
      dateKey: dateKeyFromDateInput(dayStart)
    });
  }

  return { boundaries, weekStartKey: dateKeyFromDateInput(weekStart) };
}

// Builds 7 display-ready date slots for chart or table rendering.
// Each slot includes day label, ISO timestamp, and local date key.
// @example
// const slots = weekDateSlotsFromDateInput("2026-02-28");
// @param {Date|string|number|null|undefined} dateInput - A date-like value within the target week.
// @param {number} [weekStartDay=1] - Day the week starts on: 0=Sunday, 1=Monday.
// @returns {Array<{day: string, date: string, dateKey: string}>} Ordered week date slots.
export function weekDateSlotsFromDateInput(dateInput, weekStartDay = 1) {
  const weekStart = weekStartFromDateInput(dateInput, weekStartDay);
  return Array.from({ length: 7 }, (_, index) => {
    const current = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + index);
    return {
      day: current.toLocaleDateString(undefined, { weekday: 'short' }),
      date: current.toISOString(),
      dateKey: dateKeyFromDateInput(current)
    };
  });
}

// [Claude claude-4.6-opus-high-thinking] Task: convert weekFormat setting string to numeric weekStartDay
// Prompt: "add helper to convert 'sunday'/'monday' to 0/1 for date-utility functions"
// Converts a weekFormat string ("sunday" | "monday") to the numeric weekStartDay (0 | 1).
// @param {string} [weekFormat="monday"] - "sunday" or "monday"
// @returns {number} 0 for Sunday, 1 for Monday
export function weekStartDayFromFormat(weekFormat) {
  return weekFormat === "sunday" ? 0 : 1;
}

// [Claude] Task: detect whether the current calendar week has fewer than 3 full elapsed days
// Prompt: "when beginning of new week with less than 3 full days of stats, show previous week"
// Date: 2026-03-09 | Model: claude-4.6-opus-high-thinking
export function isCurrentWeekEarly() {
  const now = new Date();
  const weekStart = weekStartFromDateInput(now);
  const elapsedMs = now.getTime() - weekStart.getTime();
  return elapsedMs < 3 * 24 * 60 * 60 * 1000;
}

// [Claude claude-4.6-opus-high-thinking] Task: shared hour label formatter for DaySketch and PeakHours
// Prompt: "relocate formatHourLabel to date-utility so callers share one implementation"
// Formats a 24-hour integer as a display label, respecting time format preference.
// @example
// formatHourLabel(9)          // "9am"
// formatHourLabel(14, "24h")  // "14:00"
// @param {number} hour - Hour of day in 0–23 range.
// @param {string} [timeFormat="meridian"] - "meridian" for am/pm, "24h" for 24-hour.
// @returns {string} Human-readable hour label.
export function formatHourLabel(hour, timeFormat) {
  if (timeFormat === "24h") return `${ String(hour).padStart(2, "0") }:00`;
  if (hour === 0) return "12am";
  if (hour < 12) return `${ hour }am`;
  if (hour === 12) return "12pm";
  return `${ hour - 12 }pm`;
}

// Formats date-like input as a compact tooltip label (weekday, month, day).
// @example
// const label = tooltipLabelFromDateInput("2026-02-28");
// @param {Date|string|number|null|undefined} dateInput - A date-like value to format.
// @returns {string} Locale-aware tooltip label like `Sat, Feb 28`.
export function tooltipLabelFromDateInput(dateInput) {
  const date = dateFromDateInput(dateInput);
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
