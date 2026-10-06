// Instrument isolated acceptance builds without changing production feature defaults or runtime modules.
import fs from "fs";

// ----------------------------------------------------------------------------------------------
// @desc Transform selected modules only in the explicitly enabled acceptance server bundle.
// @returns {object} esbuild plugin collecting profiler, scheduler, and mount snapshots.
export function createAcceptanceBuildPlugin() {
  return { name: "acceptance-instrumentation", setup: installAcceptanceTransforms };
}

// ----------------------------------------------------------------------------------------------
// @desc Install source instrumentation and independently selectable mounting and maintenance switches.
// @param {object} build - esbuild plugin context.
// @returns {void}
function installAcceptanceTransforms(build) {
  build.onLoad({ filter: /(?:dashboard-work-features|dashboard-work-runtime|dashboard-provider-dispatch|dashboard-work-scheduler|widget-mount-coordinator|dashboard-load)\.(?:js|jsx)$/ }, loadAcceptanceSource);
}

// ----------------------------------------------------------------------------------------------
// @desc Preserve normal module behavior while publishing read-only measurement snapshots in acceptance builds.
// @param {object} args - Source path supplied by esbuild.
// @returns {object} Instrumented source and loader.
function loadAcceptanceSource(args) {
  let contents = fs.readFileSync(args.path, "utf8");
  if (args.path.endsWith("dashboard-work-features.js")) {
    contents = contents.replace("SCHEDULED_WIDGET_MOUNTING_ENABLED = true", 'SCHEDULED_WIDGET_MOUNTING_ENABLED = window.__acceptance.options.mounting');
    contents = contents.replace("DURABLE_WORK_ENABLED = true", 'DURABLE_WORK_ENABLED = window.__acceptance.options.maintenance');
  } else if (args.path.endsWith("dashboard-work-runtime.js")) {
    contents = contents.replace("  return { budget, diagnostics,", "  window.__acceptance.runtime = { exportSnapshot, providerDispatch, scheduler };\n  return { budget, diagnostics,");
  } else if (args.path.endsWith("dashboard-provider-dispatch.js")) {
    contents = contents.replace("    const permit = await budget.acquire(resource, { background, signal });",
      "    const measurement = { background, requestedAt: Date.now(), resource };\n"
      + "    window.__acceptance.measurements.providerPermits.push(measurement);\n"
      + "    const permit = await budget.acquire(resource, { background, signal });\n"
      + "    measurement.admittedAt = Date.now();");
    contents = contents.replace("      return await operation({ signal });",
      "      if (background && resource === 'generative' && window.__acceptance.options.failOnce && !window.__acceptance.failureInjected) {\n"
      + "        window.__acceptance.failureInjected = true;\n        throw new Error('Acceptance transient provider failure');\n      }\n"
      + "      if (background && resource === 'generative') await new Promise(resolve => setTimeout(resolve, window.__acceptance.options.backgroundDelayMilliseconds));\n"
      + "      return await operation({ signal });");
    contents = contents.replace("      permit.release();", "      measurement.finishedAt = Date.now();\n      permit.release();");
  } else if (args.path.endsWith("dashboard-work-scheduler.js")) {
    contents = contents.replace("  setConditions(conditions) {", "  setConditions(conditions) {\n    window.__acceptance.measurements.conditions.push({ at: Date.now(), ...conditions });");
  } else if (args.path.endsWith("widget-mount-coordinator.js")) {
    contents = contents.replace("    Object.assign(this,", "    window.__acceptance.mountCoordinator = this;\n    Object.assign(this,");
  } else {
    contents = 'import { Profiler } from "react";\n' + contents;
    contents = contents.replace('<DashboardApp app={app} initPromise={initPromise} />',
      '<Profiler id="dashboard" onRender={window.__acceptance.recordCommit}><DashboardApp app={app} initPromise={initPromise} /></Profiler>');
  }
  return { contents, loader: args.path.endsWith(".jsx") ? "jsx" : "js", watchFiles: [args.path] };
}
