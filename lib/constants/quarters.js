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

// ------------------------------------------------------------------------------------------
// @desc Count whole local days from the start of today until the first day of a quarter.
// @param {object} params - An object with the following properties:
//   - {Date} [now] - Clock to read; defaults to the current local time.
//   - {number} quarter - Quarter number, 1 through 4.
//   - {number} year - Year the quarter belongs to.
// @returns {number} Days remaining, which is zero on the quarter's first day and negative once it has begun.
export function daysUntilQuarterStart({ now = new Date(), quarter, year }) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.round((quarterStartDate(year, quarter).getTime() - today.getTime()) / millisecondsPerDay);
}

// ------------------------------------------------------------------------------------------
// @desc Report whether a quarter has finished, meaning the day read from `now` falls after its last day.
// @param {object} params - An object with the following properties:
//   - {Date} [now] - Clock to read; defaults to the current local time.
//   - {number} quarter - Quarter number, 1 through 4.
//   - {number} year - Year the quarter belongs to.
// @returns {boolean} True once the quarter after it has begun.
export function hasQuarterEnded({ now = new Date(), quarter, year }) {
  const following = quarterAfter({ quarter, year });
  return daysUntilQuarterStart({ now, quarter: following.quarter, year: following.year }) <= 0;
}

// ------------------------------------------------------------------------------------------
// @desc Name the quarter that follows another, rolling Q4 over to Q1 of the next year.
// @param {object} params - { quarter, year } of the earlier quarter.
// @returns {{ label: string, quarter: number, year: number }} The following quarter.
export function quarterAfter({ quarter, year }) {
  const nextQuarter = quarter === 4 ? 1 : quarter + 1;
  const nextYear = quarter === 4 ? year + 1 : year;
  return { label: quarterLabel(nextYear, nextQuarter), quarter: nextQuarter, year: nextYear };
}

// ------------------------------------------------------------------------------------------
// @desc Name the quarter containing a date.
// @param {Date} date - Local date to classify.
// @returns {{ label: string, quarter: number, year: number }} The date's quarter.
export function quarterFromDate(date) {
  const quarter = Math.floor(date.getMonth() / 3) + 1;
  return { label: quarterLabel(date.getFullYear(), quarter), quarter, year: date.getFullYear() };
}

// ------------------------------------------------------------------------------------------
// @desc Parse a quarter label back into its parts.
// @param {string} label - Label as produced by quarterLabel, e.g. "Q4 2026".
// @returns {{ quarter: number, year: number }|null} The quarter, or null when the label does not match.
export function quarterFromLabel(label) {
  const match = /^Q([1-4]) (\d{4})$/.exec(label || "");
  if (!match) return null;
  return { quarter: Number(match[1]), year: Number(match[2]) };
}

// ------------------------------------------------------------------------------------------
// @desc First local midnight of a quarter.
// @param {number} year - Year the quarter belongs to.
// @param {number} quarter - Quarter number, 1 through 4.
// @returns {Date} January 1, April 1, July 1, or October 1 of that year.
export function quarterStartDate(year, quarter) {
  return new Date(year, (quarter - 1) * 3, 1);
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

// ----------------------------------------------------------------------------------------------
// @desc The full names of a quarter's three months, which are also the headings a quarterly plan note gives them.
// @param {number} quarter - 1-based quarter number.
// @returns {Array<string>} e.g. ["July", "August", "September"] for quarter 3
export function quarterMonthNames(quarter) {
  const firstMonthIndex = (quarter - 1) * 3;
  return FULL_MONTH_NAMES.slice(firstMonthIndex, firstMonthIndex + 3);
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
  // [Claude claude-opus-4-8] Task: strip trailing Amplenote blank-line markers ("\") so they don't render as a stray <p>\</p>
  return stripTrailingBackslashLines(content);
}

// ────────────────────────────────────────────────────────────────
/**
 * Removes trailing blank-line markers from extracted markdown. Amplenote exports
 * an empty trailing paragraph as a line containing only a backslash ("\"), which
 * `marked` would otherwise render as a visible "\" at the bottom of the section.
 * @param {string} content - Extracted section markdown.
 * @returns {string} Content with trailing whitespace/backslash-only lines removed.
 */
// [Claude claude-opus-4-8] Task: strip trailing Amplenote blank-line markers
function stripTrailingBackslashLines(content) {
  return content.replace(/(\s*\\\s*)+$/g, '').trim();
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
// Generates the default markdown template for a whole quarterly plan note, substituting the
// calendar month names belonging to the quarter that was clicked.
// @param {string} label - Quarter label, e.g. "Q1 2026".
// @param {number} quarter - Quarter number, 1 through 4.
// @returns {string} Complete note markdown.
export function defaultQuarterlyTemplate(label, quarter) {
  const quarterMonths = {
    1: ["January", "February", "March"],
    2: ["April", "May", "June"],
    3: ["July", "August", "September"],
    4: ["October", "November", "December"],
  };
  const months = quarterMonths[quarter] || ["Month 1", "Month 2", "Month 3"];

  return `# Quarter Theme
[One sentence describing the main focus of this quarter.]

## Success Looks Like
- [ ] [Top outcome]
- [ ] [Top outcome]
- [ ] [Top outcome]

# Projects

## [Project 1]
- Outcome:
- Why now:
- Weekly rhythm:
- Deadline:
- Constraints:
- Done enough when:

## [Project 2]
- Outcome:
- Why now:
- Weekly rhythm:
- Deadline:
- Constraints:
- Done enough when:

## [Project 3]
- Outcome:
- Why now:
- Weekly rhythm:
- Deadline:
- Constraints:
- Done enough when:

# Not This Quarter
- [ ] [Lower-priority project]
- [ ] [Commitment to decline]
- [ ] [Area to intentionally ignore]

# Day-of-Week Breakdown
Any category of task you would like to have be the focus for different days-of-week (sometimes called "day striping")?
Separate your task categories with a semicolon (i.e., ";"). We will consider them when proposing possible 
daily agendas from your existing tasks.  

- Mondays: 
- Tuesdays: 
- Wednesdays: 
- Thursdays: 
- Fridays: 

[Amplenote message]
You can also add Saturday and Sunday if you like; they're not in the list since by default because we suspect 
you're best off preserving your weekend for unplanned family & restoration activities.   

# Month-by-Month Breakdown

## ${ months[0] }
- Focus:
- Key move:

## ${ months[1] }
- Focus:
- Key move:

## ${ months[2] }
- Focus:
- Key move:

# Weekly Planning Prompt
Which projects need time on my calendar this week?

# Quarterly Review
- Finished:
- Progress made:
- Lessons learned:
- Carry forward:`;
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
