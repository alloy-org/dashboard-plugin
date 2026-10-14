// Tooltip content for dashboard charts, in the layout the host app's Task Stats tooltips use: a title row with an icon,
// then one stat row per value, each with a small icon in front.
import { MATERIAL_ICON_PATHS } from "constants/material-icon-paths";

// Shown with useCanvasTippy; the theme is styled in styles/dashboard-tippy.scss.
export const STATS_CHART_TOOLTIP_OPTIONS = { arrow: false, interactive: true, offset: [ 0, 8 ],
  placement: "right-start", popperOptions: { modifiers: [ { name: "flip",
    options: { fallbackPlacements: [ "left-start", "bottom", "top" ] } } ] }, theme: "dashboard-chart" };

// ------------------------------------------------------------------------------------------
// @desc Escape text for placing inside tooltip HTML.
// @param {string} text - Plain text.
// @returns {string} The text with HTML's special characters escaped.
export function escapedHtml(text) {
  const replacements = { '"': "&quot;", "&": "&amp;", "'": "&#39;", "<": "&lt;", ">": "&gt;" };
  return String(text).replace(/[&<>"']/g, character => replacements[character]);
}

// ------------------------------------------------------------------------------------------
// @desc Inline SVG markup for a Material icon, for HTML strings that cannot render the MaterialIcon component.
// @param {string} name - Material icon name.
// @param {string} className - Extra class names.
// @returns {string} SVG markup, or an empty string for an unknown icon.
export function materialIconHtml(name, className = "") {
  const pathData = MATERIAL_ICON_PATHS[name];
  if (!pathData) return "";
  return `<svg aria-hidden="true" class="material-icon ${ className }" fill="currentColor" height="14" `
    + `viewBox="0 0 24 24" width="14"><path d="${ pathData }"/></svg>`;
}

// ------------------------------------------------------------------------------------------
// @desc Build a chart tooltip: a title row, then stat rows.
// @param {Object} params - { rows, title, titleIconName }:
//   - {Array<Object>} rows - Each { className, html, iconName, iconStyle, text, trailing }: `html` replaces the escaped
//     `text` when the row carries rendered markup; `iconStyle` colors the icon; `trailing` is right-aligned text.
//   - {string} title - Title text.
//   - {string} titleIconName - Material icon shown before the title.
// @returns {string} Tooltip HTML.
export function statsChartTooltipHtml({ rows, title, titleIconName }) {
  const titleHtml = `<div class="stats-chart-tooltip-title">${ materialIconHtml(titleIconName, "stats-chart-tooltip-icon") }`
    + `<span class="stats-chart-tooltip-title-text">${ escapedHtml(title) }</span></div>`;
  const rowHtmls = rows.map(row => {
    const icon = row.iconName ? materialIconHtml(row.iconName, "stats-chart-tooltip-icon") : "";
    const styledIcon = row.iconStyle && icon ? `<span class="stats-chart-tooltip-icon-wrap" style="${ row.iconStyle }">${ icon }</span>` : icon;
    const text = row.html ?? escapedHtml(row.text ?? "");
    const trailing = row.trailing ? `<span class="stats-chart-tooltip-trailing">${ escapedHtml(row.trailing) }</span>` : "";
    return `<div class="stats-chart-tooltip-stat ${ row.className || "" }">${ styledIcon }`
      + `<span class="stats-chart-tooltip-text">${ text }</span>${ trailing }</div>`;
  });
  return `<div class="stats-chart-tooltip-content">${ titleHtml }${ rowHtmls.join("") }</div>`;
}
