/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Quarter date math utilities
 * Prompt summary: "helpers for current/next quarter labels and date ranges"
 */

// ────────────────────────────────────────────────────────────────
export const FULL_MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const SHORT_MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

// ────────────────────────────────────────────────────────────────
/**
 * Represents a month within a quarter's planning context.
 * Provides a typed shape for month objects returned by {@link getQuarterMonths}.
 */
export class Month {
  /**
   * @param {Object} props
   * @param {number} props.index - 0-based month index (0 = January, 11 = December).
   * @param {string} props.short - Abbreviated name, e.g. "Jan".
   * @param {string} props.full - Full name, e.g. "January".
   * @param {Object} props.plan - Parent quarterly plan object
   *   ({ year, quarter, label, noteUUID, hasAllMonthlyDetails }).
   * @param {boolean} props.current - True when this is the current calendar month.
   */
  constructor({ index, short, full, plan, current }) {
    this.index = index;
    this.short = short;
    this.full = full;
    this.plan = plan;
    this.current = current;
  }
}

// ────────────────────────────────────────────────────────────────
/**
 * Returns the current calendar quarter.
 * @returns {{ year: number, quarter: number, label: string }}
 */
export function getCurrentQuarter() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const quarter = Math.floor(month / 3) + 1;
  return { year, quarter, label: `Q${quarter} ${year}` };
}

// ────────────────────────────────────────────────────────────────
/**
 * Returns the next calendar quarter after the current one.
 * @returns {{ year: number, quarter: number, label: string }}
 */
export function getNextQuarter() {
  let { year, quarter } = getCurrentQuarter();
  quarter++;
  if (quarter > 4) {
    quarter = 1;
    year++;
  }
  return { year, quarter, label: `Q${quarter} ${year}` };
}

// ────────────────────────────────────────────────────────────────
/**
 * Formats a quarter label string from year and quarter number.
 * @param {number} year
 * @param {number} quarter
 * @returns {string} e.g. "Q1 2026"
 */
export function quarterLabel(year, quarter) {
  return `Q${quarter} ${year}`;
}

// ────────────────────────────────────────────────────────────────
/**
 * Builds an array of six {@link Month} instances spanning the current and next quarter,
 * with the current calendar month flagged.
 * @param {Object} current - Current quarter plan object.
 * @param {Object} next - Next quarter plan object.
 * @returns {Month[]}
 */
export function getQuarterMonths(current, next) {
  const startMonth = (current.quarter - 1) * 3;
  const currentMonthIndex = new Date().getMonth();
  const months = [];
  for (let i = 0; i < 6; i++) {
    const idx = (startMonth + i) % 12;
    months.push(new Month({
      index: idx,
      short: SHORT_MONTH_NAMES[idx],
      full: FULL_MONTH_NAMES[idx],
      plan: i < 3 ? current : next,
      current: idx === currentMonthIndex,
    }));
  }
  return months;
}

// ────────────────────────────────────────────────────────────────
/**
 * Returns the Monday of the "upcoming week". On Saturday and Sunday this is the
 * following Monday; on Monday–Friday it is the current week's Monday.
 * @returns {Date}
 */
export function getUpcomingWeekMonday() {
  const now = new Date();
  const day = now.getDay();
  let offset;
  if (day === 6) offset = 2;
  else if (day === 0) offset = 1;
  else offset = 1 - day;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
}

// ────────────────────────────────────────────────────────────────
/**
 * Formats a Monday date into a week label suitable for use as a note section heading.
 * @param {Date} monday
 * @returns {string} e.g. "Week of March 16"
 */
export function formatWeekLabel(monday) {
  return `Week of ${FULL_MONTH_NAMES[monday.getMonth()]} ${monday.getDate()}`;
}

// ────────────────────────────────────────────────────────────────
/**
 * Extracts the content beneath a heading that matches `sectionName` in a markdown string.
 * Works for any heading level (h1–h6). Returns null if the heading is not found.
 * @param {string} markdown - Full markdown content.
 * @param {string} sectionName - Heading text to search for (case-insensitive).
 * @returns {string|null}
 */
export function extractMonthSectionContent(markdown, sectionName) {
  const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headingRe = new RegExp(`(^|\\n)(#{1,6})\\s+${escaped}\\s*\\n`, 'i');
  const headingMatch = markdown.match(headingRe);
  if (!headingMatch) return null;

  const contentStart = headingMatch.index + headingMatch[0].length;
  const rest = markdown.substring(contentStart);
  const nextHeading = rest.match(/\n#{1,6}\s/);
  const content = nextHeading ? rest.substring(0, nextHeading.index) : rest;
  return content.trim();
}

// ────────────────────────────────────────────────────────────────
/**
 * Generates the default markdown template for a single-month section.
 * @param {string} monthName - Full month name, e.g. "March".
 * @returns {string}
 */
export function defaultMonthTemplate(monthName) {
  return `\n### ${monthName}\n- Focus:\n- Key move:\n`;
}

// ────────────────────────────────────────────────────────────────
/**
 * Generates the default markdown template for a weekly plan section.
 * @param {string} weekLabel - Week heading, e.g. "Week of March 16".
 * @returns {string}
 */
export function defaultWeekTemplate(weekLabel) {
  return `\n### ${weekLabel}\n- Primary focus:\n- Key tasks:\n- Commitments:\n`;
}
