// The dashboard's two tooltip looks, and the markup for rich tooltips built as HTML strings. See "Tooltips" in
// doc/design-system.md for when each applies.
//   - Hint ("dashboard-hint"): one or two plain sentences about a control or a truncated line. Arrow, compact.
//   - Rich ("dashboard-rich"): anything with structure — a title, rows, rendered task text, actions. The host's
//     Task Stats tooltip: popup surface, no arrow, title row, one row per stat.

export const HINT_TOOLTIP_THEME = "dashboard-hint";
export const RICH_TOOLTIP_THEME = "dashboard-rich";
// Twice tippy's default 350px, for rich tooltips that list whole task rows, so each row has room for its text and
// its project's name. Tippy applies maxWidth inline, so this is passed as an option rather than set in CSS.
export const WIDE_TOOLTIP_MAX_WIDTH = 700;
// Tippy options shared by every rich tooltip; callers add placement and triggers
export const RICH_TOOLTIP_OPTIONS = { arrow: false, offset: [ 0, 8 ], theme: RICH_TOOLTIP_THEME };

// ----------------------------------------------------------------------------------------------
// @desc HTML-escape plain text for tooltip markup.
// @param {*} value - Text to escape.
// @returns {string} Escaped text.
export function escapedTooltipText(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

// ----------------------------------------------------------------------------------------------
// @desc Rich tooltip markup as an HTML string, for tooltips whose content tippy takes as HTML (element tooltips,
//   canvas charts). Same structure and classes as StatsChartTooltipContent / StatsChartTooltipRow, so both look alike.
// @param {Object} options - An object with the following properties:
//   - {string} [className] - Extra class on the content, for a widget's layout hooks.
//   - {Array<Object>} rows - [{ className, html, secondaryText, text, trailing }]: `html` is trusted, already
//     rendered markup shown instead of `text`; `secondaryText` is a muted line under it; `trailing` is right-aligned.
//   - {string} title - Title text.
// @returns {string} HTML.
export function richTooltipHtml({ className, rows, title }) {
  const rowHtml = rows.map(row => {
    const body = row.html ?? escapedTooltipText(row.text);
    const secondary = row.secondaryText
      ? `<span class="stats-chart-tooltip-secondary">${ escapedTooltipText(row.secondaryText) }</span>` : "";
    const trailing = row.trailing ? `<span class="stats-chart-tooltip-trailing">${ escapedTooltipText(row.trailing) }</span>` : "";
    return `<div class="stats-chart-tooltip-stat${ row.className ? ` ${ row.className }` : "" }">`
      + `<span class="stats-chart-tooltip-text">${ body }${ secondary }</span>${ trailing }</div>`;
  }).join("");
  return `<div class="stats-chart-tooltip-content${ className ? ` ${ className }` : "" }">`
    + `<div class="stats-chart-tooltip-title"><span class="stats-chart-tooltip-title-text">`
    + `${ escapedTooltipText(title) }</span></div>${ rowHtml }</div>`;
}
