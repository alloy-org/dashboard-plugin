// Build the self-contained page an Amplenote prompt shows while a "Generate ideas" run works. It carries no bundle:
// a short script polls the plugin once a second for the run's view (see idea-run-progress-relay) and redraws a
// heading beside the status line, four step circles joined by lines that fill as each step completes, what the run has
// found so far, a pulsing spinner with the time left, and the summary once the run finishes.
// Host-compatible: the page is a string, and its script runs only inside the prompt's embed.

// How often the page asks the plugin for the run's progress.
const POLL_MILLISECONDS = 1000;

// Every rule sits under .idea-run-progress, the page's root element. Colors come from the host theme's custom
// properties, with fallbacks for a host that supplies none. A step's connector runs from the edge of its circle to the
// edge of the next one, across the list's 6px gap, and fills left to right once the step is done. The prompt's embed
// frame has a fixed height and does not scroll its document unless html asks to, matching global-reset.scss.
const PROGRESS_PAGE_STYLES = `
  html { overflow-y: scroll; }
  body { margin: 0; background: var(--color-background-primary, #fff); }
  .idea-run-progress { color: var(--color-text-high-contrast, #222); font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    padding: 12px 16px 16px; }
  .idea-run-progress .progress-header-row { align-items: center; display: flex; flex-wrap: wrap; gap: 4px 12px; justify-content: space-between; }
  .idea-run-progress .progress-heading-text { font-size: 20px; font-weight: 600; margin: 0; }
  .idea-run-progress .progress-status-line { align-items: center; color: var(--color-text-low-contrast, #777); display: flex; flex-wrap: wrap;
    font-size: 12px; gap: 4px 12px; margin-left: auto; }
  .idea-run-progress .progress-quota-meter { background: var(--color-background-tertiary, #eee); border-radius: 2px; display: inline-block;
    height: 4px; overflow: hidden; vertical-align: middle; width: 60px; }
  .idea-run-progress .progress-quota-fill { background: var(--color-text-low-contrast, #999); display: block; height: 100%; }
  .idea-run-progress .progress-run-title { font-size: 16px; font-weight: 600; margin: 10px 0 14px; }
  .idea-run-progress .progress-step-list { display: flex; gap: 6px; list-style: none; margin: 0 0 14px; padding: 0; }
  .idea-run-progress .progress-step-item { align-items: center; display: flex; flex: 1; flex-direction: column; font-size: 11px; gap: 4px;
    position: relative; text-align: center; }
  .idea-run-progress .progress-step-item:not(:last-child)::before,
  .idea-run-progress .progress-step-item:not(:last-child)::after { content: ""; height: 2px; left: calc(50% + 17px); position: absolute; top: 12px;
    width: calc(100% - 28px); }
  .idea-run-progress .progress-step-item:not(:last-child)::before { background: var(--color-border-primary, #ccc); }
  .idea-run-progress .progress-step-item:not(:last-child)::after { background: var(--color-text-link, #2a7ae2); transform: scaleX(0);
    transform-origin: left center; transition: transform 0.6s ease-out; }
  .idea-run-progress .progress-step-item--done:not(:last-child)::after,
  .idea-run-progress .progress-step-item--timedOut:not(:last-child)::after { transform: scaleX(1); }
  .idea-run-progress .progress-step-circle { align-items: center; background: var(--color-background-primary, #fff);
    border: 2px solid var(--color-border-primary, #ccc); border-radius: 50%; box-sizing: border-box; display: flex; font-size: 12px; height: 26px;
    justify-content: center; position: relative; transition: background-color 0.3s, border-color 0.3s; width: 26px; z-index: 1; }
  .idea-run-progress .progress-step-item--active .progress-step-circle { animation: progress-pulse 1.2s ease-in-out infinite;
    border-color: var(--color-text-link, #2a7ae2); }
  .idea-run-progress .progress-step-item--done .progress-step-circle,
  .idea-run-progress .progress-step-item--timedOut .progress-step-circle { background: var(--color-text-link, #2a7ae2);
    border-color: var(--color-text-link, #2a7ae2); color: var(--color-text-reversed, #fff); }
  .idea-run-progress .progress-eta-row { align-items: center; display: flex; gap: 8px; }
  .idea-run-progress .progress-spinner-dot { animation: progress-pulse 1.2s ease-in-out infinite; background: var(--color-text-link, #2a7ae2);
    border-radius: 50%; height: 10px; width: 10px; }
  .idea-run-progress .progress-detail-list { color: var(--color-text-low-contrast, #555); font-size: 13px; margin: 0 0 12px; padding-left: 18px; }
  .idea-run-progress .progress-detail-line { margin: 2px 0; }
  .idea-run-progress .progress-note-link { color: var(--color-text-link, #2a7ae2); cursor: pointer; }
  .idea-run-progress .progress-summary-list { margin: 10px 0 0; padding-left: 18px; }
  .idea-run-progress .progress-missing-run { color: var(--color-text-low-contrast, #777); }
  @keyframes progress-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.45; transform: scale(0.85); } }
`;

// Polls the plugin and redraws the page. Text is set through textContent, never parsed as markup. The step list is
// kept between draws and only its classes and circle text change, so a connector's fill and a circle's pulse animate
// rather than restarting with every poll.
const PROGRESS_PAGE_SCRIPT = `
  (function () {
    var root = document.getElementById("idea-run-progress-root");
    var runId = root.getAttribute("data-run-id");
    var stepList = null;
    function element(tagName, className, text) {
      var created = document.createElement(tagName);
      if (className) created.className = className;
      if (text !== undefined) created.textContent = text;
      return created;
    }
    function lineItem(className, line) {
      var item = element("li", className);
      var segments = Array.isArray(line) ? line : [{ text: String(line) }];
      segments.forEach(function (segment) {
        if (segment.noteUuid) {
          var link = element("a", "progress-note-link", segment.text);
          link.href = "https://www.amplenote.com/notes/" + encodeURIComponent(segment.noteUuid);
          link.addEventListener("click", function (event) {
            event.preventDefault();
            window.callAmplenotePlugin("navigate", link.href);
          });
          item.appendChild(link);
        } else {
          item.appendChild(element(segment.strong ? "strong" : "span", null, segment.text));
        }
      });
      return item;
    }
    function drawSteps(steps) {
      if (!stepList || stepList.children.length !== steps.length) {
        stepList = element("ol", "progress-step-list");
        steps.forEach(function (step) {
          var item = element("li");
          item.appendChild(element("span", "progress-step-circle"));
          item.appendChild(element("span", "progress-step-label", step.label));
          stepList.appendChild(item);
        });
      }
      steps.forEach(function (step, index) {
        var item = stepList.children[index];
        var finished = step.state === "done" || step.state === "timedOut";
        item.className = "progress-step-item progress-step-item--" + step.state;
        item.firstChild.textContent = finished ? "✓" : String(step.number);
      });
      return stepList;
    }
    function draw(view) {
      root.textContent = "";
      if (!view || !view.found) {
        root.appendChild(element("div", "progress-missing-run", "This run's progress is no longer available. Its work continues in the Dashboard's queue."));
        return;
      }
      var headerRow = element("div", "progress-header-row");
      headerRow.appendChild(element("h2", "progress-heading-text", view.heading));
      var statusLine = element("div", "progress-status-line");
      view.statusParts.forEach(function (part) { statusLine.appendChild(element("span", "progress-status-part", part)); });
      if (view.quotaPercent !== null) {
        var meter = element("span", "progress-quota-meter");
        var fill = element("span", "progress-quota-fill");
        fill.style.width = Math.min(100, Math.max(0, view.quotaPercent)) + "%";
        meter.appendChild(fill);
        statusLine.appendChild(meter);
      }
      headerRow.appendChild(statusLine);
      root.appendChild(headerRow);
      root.appendChild(element("div", "progress-run-title", view.title));
      root.appendChild(drawSteps(view.steps));
      if (view.progressLines && view.progressLines.length) {
        var detailList = element("ul", "progress-detail-list");
        view.progressLines.forEach(function (line) { detailList.appendChild(lineItem("progress-detail-line", line)); });
        root.appendChild(detailList);
      }
      var etaRow = element("div", "progress-eta-row");
      etaRow.appendChild(view.finished ? element("span", "progress-done-mark", "✅") : element("span", "progress-spinner-dot"));
      etaRow.appendChild(element("span", "progress-eta-label", view.etaLabel));
      root.appendChild(etaRow);
      if (view.summaryLines.length) {
        var summaryList = element("ul", "progress-summary-list");
        view.summaryLines.forEach(function (line) { summaryList.appendChild(lineItem("progress-summary-line", line)); });
        root.appendChild(summaryList);
      }
    }
    function poll() {
      Promise.resolve(window.callAmplenotePlugin("ideaRunProgressRead", runId)).then(function (view) {
        if (view && !view.embedCallFailed) draw(view);
        if (!view || !view.finished) setTimeout(poll, ${ POLL_MILLISECONDS });
      }).catch(function () { setTimeout(poll, ${ POLL_MILLISECONDS }); });
    }
    poll();
  })();
`;

// ----------------------------------------------------------------------------------------------
// @desc Build the progress page for one run.
// @param {object} options - { hostTheme, runId }: hostTheme as readHostTheme returns it.
// @returns {string} A complete HTML document.
export function buildIdeaRunProgressHTML({ hostTheme = {}, runId }) {
  const { lightDarkMode, styleProperties = "" } = hostTheme;
  const themeAttribute = ["light", "dark"].includes(lightDarkMode) ? ` data-theme="${ lightDarkMode }"` : "";
  const safeStyleProperties = styleProperties.replace(/<\/style/gi, "<\\/style");
  const safeRunId = String(runId || "").replace(/[^A-Za-z0-9:_-]/g, "");
  return (`<!DOCTYPE html>
<html lang="en"${ themeAttribute }>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${ safeStyleProperties }</style>
  <style>${ PROGRESS_PAGE_STYLES }</style>
</head>
<body>
  <div class="idea-run-progress" id="idea-run-progress-root" data-run-id="${ safeRunId }">Starting…</div>
  <script type="text/javascript">${ PROGRESS_PAGE_SCRIPT }</script>
</body>
</html>`);
}

// ----------------------------------------------------------------------------------------------
// @desc Read the run a prompt embed was opened for from renderEmbed's arguments, which carry the embed input's value.
// @param {Array<*>} renderArgs - The arguments after app.
// @returns {string|null} The run's ID, or null when the embed is not a progress window.
export function ideaRunProgressRunId(renderArgs) {
  for (const renderArg of renderArgs || []) {
    let value = renderArg;
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch {
        continue;
      }
    }
    if (value?.view === "ideaRunProgress" && typeof value.runId === "string") return value.runId;
  }
  return null;
}
