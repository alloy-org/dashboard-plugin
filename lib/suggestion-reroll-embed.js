// Build the self-contained page an Amplenote prompt shows when the user clicks Suggest again soon after a calendar pass:
// a row of focus cards, one of which is always chosen, a wrapping row of quarter projects the user can boost, up to
// MAXIMUM_BOOSTED_PROJECTS, and a row choosing whether suggestions come from new ideas, existing tasks, or both. Every
// change is sent to the plugin, which remembers it under the prompt's token and stores it as the embed's arguments, so
// the prompt resolves with the user's whole choice when they press its re-roll button. The page carries no bundle.
// Host-compatible: the page is a string, and its script runs only inside the prompt's embed.
import { MAXIMUM_BOOSTED_PROJECTS, REROLL_FOCUS_OPTIONS, REROLL_SOURCE_OPTIONS } from "dashboard/suggestions/suggestion-reroll-store";

export const SUGGESTION_REROLL_VIEW = "suggestionReroll";

// The last choice an open re-roll prompt's embed sent, with the token of the prompt it belongs to.
let rememberedChoice = null;

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
  .suggestion-reroll .reroll-source-panel { margin-top: 16px; }
  .suggestion-reroll .reroll-source-row { display: flex; flex-wrap: wrap; gap: 8px; }
  .suggestion-reroll .reroll-source-option { border: 1px solid var(--color-border-primary, #ccc); border-radius: 8px; cursor: pointer;
    font-weight: 600; padding: 6px 14px; user-select: none; }
  .suggestion-reroll .reroll-source-option input { margin: 0 6px 0 0; }
  .suggestion-reroll .reroll-source-option:has(input:checked) { border-color: var(--color-text-link, #2a7ae2);
    box-shadow: 0 0 0 1px var(--color-text-link, #2a7ae2); }
  .suggestion-reroll .reroll-summary-text { color: var(--color-text-low-contrast, #777); font-size: 13px; margin: 14px 0 0; }
`;

// Draws the cards, chips and source options from the page's JSON data, and sends the whole choice to the plugin after
// every change, so a re-render shows the same choice. Nothing is sent when the page loads: a re-render from the
// prompt's opening arguments would otherwise replace the user's choice with the defaults. Text is set through
// textContent, never parsed as markup.
const REROLL_PAGE_SCRIPT = `
  (function () {
    var root = document.getElementById("suggestion-reroll-root");
    var value = JSON.parse(document.getElementById("suggestion-reroll-data").textContent);
    var focusOptions = value.focusOptions;
    var maximumProjects = value.maximumProjects;
    var sourceOptions = value.sourceOptions;
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
      var source = sourceOptions.filter(function (option) { return option.key === value.sourceKey; })[0] || sourceOptions[0];
      return "Re-roll replaces the current suggestions with " + focus.label.toLowerCase() + " picks" + projects
        + ", drawn from " + source.label.toLowerCase() + ".";
    }
    function refresh() {
      summary.textContent = summaryText();
      boostCount.textContent = value.projectUuids.length + " of " + maximumProjects + " boosted";
      chipInputs.forEach(function (input) { input.disabled = !input.checked && value.projectUuids.length >= maximumProjects; });
    }
    function send() {
      refresh();
      var choice = { focusKey: value.focusKey, projectUuids: value.projectUuids.slice(), projects: value.projects,
        dayLabel: value.dayLabel, promptToken: value.promptToken, sourceKey: value.sourceKey, view: value.view };
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
    var sourcePanel = element("div", "reroll-source-panel");
    sourcePanel.appendChild(element("p", "reroll-section-title", "Suggestions come from"));
    sourcePanel.appendChild(element("p", "reroll-section-hint", "New tasks are ideas the plugin proposes for your projects."));
    var sourceRow = element("div", "reroll-source-row");
    sourceOptions.forEach(function (option) {
      var sourceLabel = element("label", "reroll-source-option");
      var input = element("input");
      input.type = "radio";
      input.name = "reroll-source";
      input.value = option.key;
      input.checked = option.key === value.sourceKey;
      input.addEventListener("change", function () { value.sourceKey = option.key; send(); });
      sourceLabel.appendChild(input);
      sourceLabel.appendChild(element("span", null, option.label));
      sourceRow.appendChild(sourceLabel);
    });
    sourcePanel.appendChild(sourceRow);
    root.appendChild(sourcePanel);
    var summary = element("p", "reroll-summary-text");
    root.appendChild(summary);
    refresh();
  })();
`;

// ----------------------------------------------------------------------------------------------
// @desc Build the re-roll page for a prompt embed.
// @param {object} options - { hostTheme, value }: hostTheme as readHostTheme returns it, and value the embed's
//   arguments, { dayLabel, focusKey, projectUuids, projects, promptToken, sourceKey, view }, projects being { name, uuid }.
// @returns {string} Self-contained page HTML.
export function buildSuggestionRerollHTML({ hostTheme = {}, value }) {
  const { lightDarkMode, styleProperties = "" } = hostTheme;
  const themeAttribute = ["light", "dark"].includes(lightDarkMode) ? ` data-theme="${ lightDarkMode }"` : "";
  const safeStyleProperties = styleProperties.replace(/<\/style/gi, "<\\/style");
  const pageData = { ...value, focusOptions: REROLL_FOCUS_OPTIONS.map(({ description, key, label }) => ({ description, key, label })),
    maximumProjects: MAXIMUM_BOOSTED_PROJECTS, projectUuids: value.projectUuids || [], projects: value.projects || [],
    sourceOptions: REROLL_SOURCE_OPTIONS.map(({ key, label }) => ({ key, label })) };
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
// @desc The last choice remembered for a re-roll prompt.
// @param {string|null} promptToken - The token the prompt was opened with.
// @returns {object|null} The choice as the embed sent it, or null when none was sent for that prompt.
export function rememberedSuggestionRerollChoice(promptToken) {
  if (!promptToken || rememberedChoice?.promptToken !== promptToken) return null;
  return rememberedChoice;
}

// ----------------------------------------------------------------------------------------------
// @desc Remember the choice an open re-roll prompt's embed just sent, so the prompt reads the user's whole choice even
//   when the host resolves it without the embed's latest arguments, and a re-render shows the choice made so far.
// @param {object} choice - { focusKey, projectUuids, promptToken, sourceKey, view, ... } as the embed sends it.
// @returns {boolean} Whether the choice was remembered; one without a prompt token is not.
export function rememberSuggestionRerollChoice(choice) {
  if (choice?.view !== SUGGESTION_REROLL_VIEW || !choice.promptToken) return false;
  rememberedChoice = choice;
  return true;
}

// ----------------------------------------------------------------------------------------------
// @desc Read the re-roll choice a prompt embed was opened with from renderEmbed's arguments, which carry the embed
//   input's value, or from the prompt's result, which carries the arguments the embed last stored.
// @param {Array<*>} embedArgs - The arguments after app, or the prompt's result values.
// @returns {object|null} { dayLabel, focusKey, projectUuids, projects, promptToken, sourceKey, view }, or null when none
//   is a re-roll choice.
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
