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