/**
 * [Claude-authored file]
 * Created: 2026-02-28 | Model: gpt-5.3-codex
 * Task: Shared date parsing, keying, and week-range helpers
 * Prompt summary: "consolidate repeated date functions into lib/util/date-utility.js using from* naming"
 */

// Normalizes date-like input into a local `Date` instance.
// Falls back to `new Date()` when input is empty or invalid.
// @example
// const date = dateFromDateInput("2026-02-28");
// @param {Date|string|number|null|undefined} dateInput - A date-like value to parse.
// @returns {Date} Parsed local `Date` object.
export function dateFromDateInput(dateInput) {
  if (!dateInput) return new Date();
  if (dateInput instanceof Date) return new Date(dateInput);

  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    const [year, month, day] = dateInput.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  const parsed = new Date(dateInput);
  if (Number.isNaN(parsed.getTime())) return new Date();
  return parsed;
}

// Builds a local calendar date key (`YYYY-MM-DD`) from date-like input.
// @example
// const key = dateKeyFromDateInput("2026-02-28");
// @param {Date|string|number|null|undefined} dateInput - A date-like value to normalize and format.
// @returns {string} Local date key in `YYYY-MM-DD` format.
export function dateKeyFromDateInput(dateInput) {
  const date = dateFromDateInput(dateInput);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Calculates the start of the week (Monday at 00:00:00.000 local time) for date-like input.
// @example
// const weekStart = weekStartFromDateInput(new Date());
// @param {Date|string|number|null|undefined} dateInput - A date-like value within the target week.
// @returns {Date} Local `Date` set to Monday at midnight for the input week.
export function weekStartFromDateInput(dateInput) {
  const date = dateFromDateInput(dateInput);
  const dayOfWeek = date.getDay(); // 0=Sun, 1=Mon ... 6=Sat
  const mondayDelta = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const weekStart = new Date(date.getFullYear(), date.getMonth(), date.getDate() + mondayDelta);
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
}

// Calculates the end of the week (Sunday at 23:59:59.999 local time) for date-like input.
// @example
// const weekEnd = weekEndFromDateInput("2026-02-28");
// @param {Date|string|number|null|undefined} dateInput - A date-like value within the target week.
// @returns {Date} Local `Date` set to Sunday end-of-day for the input week.
export function weekEndFromDateInput(dateInput) {
  const weekStart = weekStartFromDateInput(dateInput);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  return weekEnd;
}

// Builds Monday-Sunday day boundaries for the week containing the input date.
// Each boundary includes Unix-second `from`/`to` values and a local `dateKey`.
// @example
// const { boundaries, weekStartKey } = weekBoundariesFromDateInput("2026-02-28");
// @param {Date|string|number|null|undefined} dateInput - A date-like value within the target week.
// @returns {{boundaries: Array<{from: number, to: number, dateKey: string}>, weekStartKey: string}} Week boundaries plus week start key.
export function weekBoundariesFromDateInput(dateInput) {
  const weekStart = weekStartFromDateInput(dateInput);
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

// Builds 7 display-ready date slots (Mon-Sun) for chart or table rendering.
// Each slot includes day label, ISO timestamp, and local date key.
// @example
// const slots = weekDateSlotsFromDateInput("2026-02-28");
// @param {Date|string|number|null|undefined} dateInput - A date-like value within the target week.
// @returns {Array<{day: string, date: string, dateKey: string}>} Ordered week date slots.
export function weekDateSlotsFromDateInput(dateInput) {
  const weekStart = weekStartFromDateInput(dateInput);
  return Array.from({ length: 7 }, (_, index) => {
    const current = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + index);
    return {
      day: current.toLocaleDateString(undefined, { weekday: 'short' }),
      date: current.toISOString(),
      dateKey: dateKeyFromDateInput(current)
    };
  });
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
