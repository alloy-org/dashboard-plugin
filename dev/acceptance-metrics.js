// Collect browser performance evidence for explicitly isolated acceptance runs without recording note or request bodies.
// ----------------------------------------------------------------------------------------------
// @desc Install browser telemetry before React loads, only in the explicitly enabled acceptance shell.
(() => {
  const parameters = new URLSearchParams(location.search);
  const measurements = { commits: [], conditions: [], firstUsableMilliseconds: null, longTasks: [], providerPermits: [], requests: [], startedAt: Date.now() };
  const options = { backgroundDelayMilliseconds: Math.min(30000, Math.max(0, Number(parameters.get("backgroundDelay") || 0))), failOnce: parameters.get("failure") === "once", maintenance: parameters.get("maintenance") !== "off", mounting: parameters.get("mounting") !== "off" };
  const originalFetch = window.fetch.bind(window);
  window.__acceptance = { measurements, options, recordCommit, snapshot };
  window.fetch = measuredFetch;
  if (parameters.get("observer") === "off") window.IntersectionObserver = undefined;
  const observer = new PerformanceObserver(recordPerformance);
  observer.observe({ buffered: true, type: "longtask" });
  window.addEventListener("DOMContentLoaded", installMeasurementControls);

  // ----------------------------------------------------------------------------------------------
  // @desc Render an export control outside the dashboard so measurements remain accessible when the queue is disabled.
  // @returns {void}
  function installMeasurementControls() {
    const panel = document.createElement("details");
    panel.id = "acceptance-measurements";
    panel.style.cssText = "position:fixed;bottom:0;right:0;z-index:999999;background:white;color:black;max-width:90vw";
    panel.innerHTML = '<summary>Acceptance measurements</summary><button type="button">Capture measurements</button><button type="button" data-probe>Foreground admission probe</button><textarea aria-label="Acceptance snapshot" readonly style="width:350px;height:160px"></textarea>';
    panel.querySelector("button").addEventListener("click", () => {
      const result = snapshot();
      panel.querySelector("textarea").value = JSON.stringify(result);
      panel.open = false;
      originalFetch("/api/acceptance-metrics", { body: JSON.stringify(result), headers: { "Content-Type": "application/json" }, method: "POST" });
    });
    panel.querySelector("[data-probe]").addEventListener("click", runForegroundProbe);
    document.body.appendChild(panel);
    const mutationObserver = new MutationObserver(recordFirstUsable);
    mutationObserver.observe(document.getElementById("dashboard-root"), { childList: true, subtree: true });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Measure fetch start and completion without retaining query parameters, headers, prompts, or response bodies.
  // @param {string|Request} input - Fetch destination.
  // @param {object} settings - Original fetch options.
  // @returns {Promise<Response>} Unmodified response or original failure.
  async function measuredFetch(input, settings) {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    const request = { destination: url.origin === location.origin ? url.pathname : url.hostname,
      finishedAt: null, startedAt: performance.now(), status: null };
    measurements.requests.push(request);
    try {
      const response = await originalFetch(input, settings);
      request.status = response.status;
      return response;
    } catch (error) {
      request.status = "failed";
      throw error;
    } finally { request.finishedAt = performance.now(); }
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Record real React profiler render durations and commit timestamps, bounded to the latest 1,000 commits.
  // @param {string} id - Profile identity.
  // @param {string} phase - Mount or update phase.
  // @param {number} actualDuration - React render duration in milliseconds.
  // @param {number} baseDuration - Estimated unoptimized render duration.
  // @param {number} startTime - Render start on the performance clock.
  // @param {number} commitTime - Commit timestamp; actualDuration measures rendering, not commit-phase work.
  // @returns {void}
  function recordCommit(id, phase, actualDuration, baseDuration, startTime, commitTime) {
    measurements.commits.push({ actualDuration, baseDuration, commitTime, id, phase, startTime });
    if (measurements.commits.length > 1000) measurements.commits.shift();
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Mark the first dashboard with a domain control and a rendered widget title as usable.
  // @returns {void}
  function recordFirstUsable() {
    if (measurements.firstUsableMilliseconds !== null) return;
    if (document.querySelector("#dashboard-root h3") && document.querySelector('[aria-label="Refresh task domains"]')) {
      measurements.firstUsableMilliseconds = performance.now();
    }
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Retain browser long-task timings without attribution containing page or notebook text.
  // @param {PerformanceObserverEntryList} entries - Browser performance entries.
  // @returns {void}
  function recordPerformance(entries) {
    for (const entry of entries.getEntries()) measurements.longTasks.push({ duration: entry.duration, startTime: entry.startTime });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Measure a foreground generative permit on the live budget while maintenance may be in flight.
  // @returns {Promise<void>} Resolves after the reserved foreground permit is admitted and released.
  async function runForegroundProbe() {
    const acceptance = window.__acceptance;
    const requestedAt = Date.now();
    const resourcesBefore = acceptance.runtime?.scheduler.snapshot().resources || null;
    await acceptance.runtime?.providerDispatch.generative(async () => {
      measurements.foregroundProbe = { admittedAt: Date.now(), requestedAt, resourcesBefore };
    }, { background: false });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Export this visit's telemetry and the queue's own sanitized diagnostics together with current mount state.
  // @returns {object} Performance evidence, feature switches, viewport, and sanitized queue snapshot.
  function snapshot() {
    const acceptance = window.__acceptance;
    const mountSnapshot = acceptance.mountCoordinator?.snapshot() || null;
    const queue = acceptance.runtime?.exportSnapshot({ mountSnapshot }) || null;
    const paints = performance.getEntriesByType("paint").map(entry => ({ name: entry.name, startTime: entry.startTime }));
    return { capturedAt: Date.now(), measurements, options, paints, queue, run: parameters.get("run") || "initial", viewport: { height: innerHeight, width: innerWidth } };
  }
})();
