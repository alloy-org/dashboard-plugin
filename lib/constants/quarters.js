/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Quarter date math utilities
 * Prompt summary: "helpers for current/next quarter labels and date ranges"
 */

// [Claude] Task: return current calendar quarter info
// Prompt: "helpers for current/next quarter labels and date ranges"
// Date: 2026-02-17 | Model: claude-sonnet-4-5-20250929
export function getCurrentQuarter() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const quarter = Math.floor(month / 3) + 1;
  return {
    year,
    quarter,
    label: `Q${quarter} ${year}`
  };
}

// [Claude] Task: return next calendar quarter info
// Prompt: "helpers for current/next quarter labels and date ranges"
// Date: 2026-02-17 | Model: claude-sonnet-4-5-20250929
export function getNextQuarter() {
  const current = getCurrentQuarter();
  let { year, quarter } = current;

  quarter++;
  if (quarter > 4) {
    quarter = 1;
    year++;
  }

  return {
    year,
    quarter,
    label: `Q${quarter} ${year}`
  };
}

// [Claude] Task: format a quarter label string
// Prompt: "helpers for current/next quarter labels and date ranges"
// Date: 2026-02-17 | Model: claude-sonnet-4-5-20250929
export function quarterLabel(year, quarter) {
  return `Q${quarter} ${year}`;
}

export const FULL_MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

// [Claude] Task: build enriched month objects for current + next quarter with plan references
// Prompt: "when a month is clicked, check the quarterly plan note for a section that corresponds with the month"
// Date: 2026-03-08 | Model: claude-4.6-opus-high-thinking
export function getQuarterMonths(current, next) {
  const SHORT_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const startMonth = (current.quarter - 1) * 3;
  const months = [];
  for (let i = 0; i < 6; i++) {
    const idx = (startMonth + i) % 12;
    months.push({
      index: idx,
      short: SHORT_NAMES[idx],
      full: FULL_MONTH_NAMES[idx],
      plan: i < 3 ? current : next,
    });
  }
  return months;
}

// [Claude] Task: extract the content beneath a month heading from quarterly plan markdown
// Prompt: "use a regular expression to retrieve only the content within the section that includes the name of the month"
// Date: 2026-03-08 | Model: claude-4.6-opus-high-thinking
export function extractMonthSectionContent(markdown, monthName) {
  const escaped = monthName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headingRe = new RegExp(`(^|\\n)(#{1,6})\\s+${escaped}\\s*\\n`, 'i');
  const headingMatch = markdown.match(headingRe);
  if (!headingMatch) return null;

  const contentStart = headingMatch.index + headingMatch[0].length;
  const rest = markdown.substring(contentStart);
  const nextHeading = rest.match(/\n#{1,6}\s/);
  const content = nextHeading ? rest.substring(0, nextHeading.index) : rest;
  return content.trim();
}

// [Claude] Task: generate a single-month template for appending to an existing quarterly plan
// Prompt: "append to the existing quarterly plan note the content from _defaultQuarterlyTemplate for a particular month"
// Date: 2026-03-08 | Model: claude-4.6-opus-high-thinking
export function defaultMonthTemplate(monthName) {
  return `\n### ${monthName}\n- Focus:\n- Key move:\n`;
}