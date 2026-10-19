// Build the self-contained page an Amplenote prompt shows when the user clicks Suggest again soon after a calendar pass:
// a row of focus cards, one of which is always chosen, and a wrapping row of quarter projects the user can boost, up
// to MAXIMUM_BOOSTED_PROJECTS. Every change is sent to the plugin, which stores it as the embed's arguments, so the
// prompt resolves with the user's choice when they press its re-roll button. The page carries no bundle.
// Host-compatible: the page is a string, and its script runs only inside the prompt's embed.
import { MAXIMUM_BOOSTED_PROJECTS, REROLL_FOCUS_OPTIONS } from "dashboard/suggestions/suggestion-reroll-store";

export const SUGGESTION_REROLL_VIEW = "suggestionReroll";

// Every rule sits under .suggestion-reroll, the page's root element. Colors come from the host theme's custom
// properties, with fallbacks for a host that supplies none. A chosen card or chip is drawn with the link color.
const REROLL_PAGE_STYLES = `
  html { overflow-y: scroll; }
  body { margin: 0; background: var(--color-background-primary, #fff); }
  .suggestion-reroll { color: var(--color-text-high-contrast, #222); font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    padding: 12px 16px 16px; }
  .suggestion-reroll .reroll-eyebrow-text { color: var(--color-text-low-contrast, #777); font-size: 11px; letter-spacing: 0.12em;
    text-transform: uppercase; }
  .suggestion-reroll .reroll-heading-text { font-size: 22px; font-weight: 700; margin: 2px 0 2px; }
  .suggestion-reroll .reroll-subheading-text { color: var(--color-text-low-contrast, #777); margin: 0 0 14px; }
  .suggestion-reroll .reroll-section-title { font-weight: 600; margin: 0; }
  .suggestion-reroll .reroll-section-hint { color: var(--color-text-low-contrast, #777); font-size: 12px; margin: 0 0 10px; }
  .suggestion-reroll .reroll-focus-grid { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); margin-bottom: 16px; }
  .suggestion-reroll .reroll-focus-card { background: var(--color-background-secondary, #f6f6f6); border: 1px solid var(--color-border-primary, #ddd);
    border-radius: 10px; cursor: pointer; display: block; padding: 12px; }
  .suggestion-reroll .reroll-focus-card:has(input:checked) { border-color: var(--color-text-link, #2a7ae2);
    box-shadow: 0 0 0 1px var(--color-text-link, #2a7ae2); }
  .suggestion-reroll .reroll-focus-card input { margin: 0 6px 0 0; }
  .suggestion-reroll .reroll-focus-label { font-weight: 600; }
  .suggestion-reroll .reroll-focus-description { color: var(--color-text-low-contrast, #777); display: block; font-size: 12px; margin-top: 4px; }
  .suggestion-reroll .reroll-boost-panel { border: 1px solid var(--color-border-primary, #ddd); border-radius: 10px; padding: 12px 14px; }
  .suggestion-reroll .reroll-boost-header { align-items: baseline; display: flex; gap: 8px; justify-content: space-between; }
  .suggestion-reroll .reroll-boost-count { color: var(--color-text-low-contrast, #777); font-size: 12px; white-space: nowrap; }
  .suggestion-reroll .reroll-project-row { display: flex; flex-wrap: wrap; gap: 8px; }
  .suggestion-reroll .reroll-project-chip { border: 1px solid var(--color-border-primary, #ccc); border-radius: 999px; cursor: pointer;
    font-weight: 600; padding: 6px 14px; user-select: none; }
  .suggestion-reroll .reroll-project-chip input { margin: 0 6px 0 0; }
  .suggestion-reroll .reroll-project-chip:has(input:checked) { background: var(--color-text-link, #2a7ae2); border-color: var(--color-text-link, #2a7ae2);
    color: var(--color-text-reversed, #fff); }
  .suggestion-reroll .reroll-project-chip:has(input:disabled:not(:checked)) { cursor: default; opacity: 0.5; }
  .suggestion-reroll .reroll-empty-text { color: var(--color-text-low-contrast, #777); font-size: 13px; }
  .suggestion-reroll .reroll-summary-text { color: var(--color-text-low-contrast, #777); font-size: 13px; margin: 14px 0 0; }
`;

// Draws the cards and chips from the page's JSON data, and sends the whole choice to the plugin after every change, so
// a re-render from the stored arguments shows the same choice. Text is set through textContent, never parsed as markup.
const REROLL_PAGE_SCRIPT = `
  (function () {
    var root = document.getElementById("suggestion-reroll-root");
    var value = JSON.parse(document.getElementById("suggestion-reroll-data").textContent);
    var focusOptions = value.focusOptions;
    var maximumProjects = value.maximumProjects;
    function element(tagName, className, text) {
      var created = document.createElement(tagName);
      if (className) created.className = className;
      if (text !== undefined) created.textContent = text;
      return created;
    }
    function summaryText() {
      var focus = focusOptions.filter(function (option) { return option.key === value.focusKey; })[0] || focusOptions[0];
      var count = value.projectUuids.length;
      var projects = count ? " from " + count + " boosted project" + (count === 1 ? "" : "s") : " across your usual projects";
      return "Re-roll replaces the current suggestions with " + focus.label.toLowerCase() + " picks" + projects + ".";
    }
    function send() {
      summary.textContent = summaryText();
      boostCount.textContent = value.projectUuids.length + " of " + maximumProjects + " boosted";
      chipInputs.forEach(function (input) { input.disabled = !input.checked && value.projectUuids.length >= maximumProjects; });
      var choice = { focusKey: value.focusKey, projectUuids: value.projectUuids.slice(), projects: value.projects,
        dayLabel: value.dayLabel, view: value.view };
      try { window.callAmplenotePlugin("suggestionRerollChoice", choice); } catch (error) { console.error(error); }
    }
    root.appendChild(element("div", "reroll-eyebrow-text", "Steer your suggestions" + (value.dayLabel ? " · " + value.dayLabel : "")));
    root.appendChild(element("h2", "reroll-heading-text", "Pick your loadout"));
    root.appendChild(element("p", "reroll-subheading-text", "Choose a focus, and boost up to " + maximumProjects + " projects to get first claim on open slots."));
    var grid = element("div", "reroll-focus-grid");
    focusOptions.forEach(function (option) {
      var card = element("label", "reroll-focus-card");
      var input = element("input");
      input.type = "radio";
      input.name = "reroll-focus";
      input.value = option.key;
      input.checked = option.key === value.focusKey;
      input.addEventListener("change", function () { value.focusKey = option.key; send(); });
      card.appendChild(input);
      card.appendChild(element("span", "reroll-focus-label", option.label));
      card.appendChild(element("span", "reroll-focus-description", option.description));
      grid.appendChild(card);
    });
    root.appendChild(grid);
    var panel = element("div", "reroll-boost-panel");
    var header = element("div", "reroll-boost-header");
    header.appendChild(element("p", "reroll-section-title", "Boost quarter projects"));
    var boostCount = element("span", "reroll-boost-count");
    header.appendChild(boostCount);
    panel.appendChild(header);
    panel.appendChild(element("p", "reroll-section-hint", "With none boosted, suggestions follow the projects you chose for each weekday."));
    var row = element("div", "reroll-project-row");
    var chipInputs = [];
    value.projects.forEach(function (project) {
      var chip = element("label", "reroll-project-chip");
      var input = element("input");
      input.type = "checkbox";
      input.checked = value.projectUuids.indexOf(project.uuid) !== -1;
      input.addEventListener("change", function () {
        value.projectUuids = value.projectUuids.filter(function (uuid) { return uuid !== project.uuid; });
        if (input.checked) value.projectUuids.push(project.uuid);
        send();
      });
      chipInputs.push(input);
      chip.appendChild(input);
      chip.appendChild(element("span", null, project.name));
      row.appendChild(chip);
    });
    if (!value.projects.length) row.appendChild(element("span", "reroll-empty-text", "No active quarter projects to boost."));
    panel.appendChild(row);
    root.appendChild(panel);
    var summary = element("p", "reroll-summary-text");
    root.appendChild(summary);
    send();
  })();
`;

// ----------------------------------------------------------------------------------------------
// @desc Build the re-roll page for a prompt embed.
// @param {object} options - { hostTheme, value }: hostTheme as readHostTheme returns it, and value the embed's
//   arguments, { dayLabel, focusKey, projectUuids, projects, view }, projects being { name, uuid }.
// @returns {string} Self-contained page HTML.
export function buildSuggestionRerollHTML({ hostTheme = {}, value }) {
  const { lightDarkMode, styleProperties = "" } = hostTheme;
  const themeAttribute = ["light", "dark"].includes(lightDarkMode) ? ` data-theme="${ lightDarkMode }"` : "";
  const safeStyleProperties = styleProperties.replace(/<\/style/gi, "<\\/style");
  const pageData = { ...value, focusOptions: REROLL_FOCUS_OPTIONS.map(({ description, key, label }) => ({ description, key, label })),
    maximumProjects: MAXIMUM_BOOSTED_PROJECTS, projectUuids: value.projectUuids || [], projects: value.projects || [] };
  const safePageData = JSON.stringify(pageData).replace(/</g, "\\u003c");
  return (`<!DOCTYPE html>
<html lang="en"${ themeAttribute }>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${ safeStyleProperties }</style>
  <style>${ REROLL_PAGE_STYLES }</style>
</head>
<body>
  <div class="suggestion-reroll" id="suggestion-reroll-root"></div>
  <script type="application/json" id="suggestion-reroll-data">${ safePageData }</script>
  <script type="text/javascript">${ REROLL_PAGE_SCRIPT }</script>
</body>
</html>`);
}

// ----------------------------------------------------------------------------------------------
// @desc Read the re-roll choice a prompt embed was opened with from renderEmbed's arguments, which carry the embed
//   input's value, or from the prompt's result, which carries the arguments the embed last stored.
// @param {Array<*>} embedArgs - The arguments after app, or the prompt's result values.
// @returns {object|null} { dayLabel, focusKey, projectUuids, projects, view }, or null when none is a re-roll choice.
export function suggestionRerollValue(embedArgs) {
  for (const embedArg of embedArgs || []) {
    let value = embedArg;
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch {
        continue;
      }
    }
    if (value?.view === SUGGESTION_REROLL_VIEW) return value;
  }
  return null;
}
