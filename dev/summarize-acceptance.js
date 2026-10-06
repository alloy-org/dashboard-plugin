// Summarize sanitized browser acceptance captures without treating rendering time as commit-phase execution time.
import fs from "fs";
import path from "path";

// ----------------------------------------------------------------------------------------------
// @desc Return the median of measured values, retaining null when a feature supplies no measurement.
// @param {Array<number>} values - Finite measurement values.
// @returns {number|null} Median.
function medianValue(values) {
  const finiteValues = values.filter(Number.isFinite);
  const ordered = finiteValues.sort((left, right) => left - right);
  if (!ordered.length) return null;
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

// ----------------------------------------------------------------------------------------------
// @desc Summarize every saved visit, using the first two seconds for comparable initial long-task measurements.
// @param {object} snapshot - Sanitized acceptance snapshot.
// @returns {object} Load, render, mount, resource admission, and coverage evidence for one visit.
function summarizeSnapshot(snapshot) {
  const { measurements, queue } = snapshot;
  const initialLongTasks = measurements.longTasks.filter(entry => entry.startTime < 2000);
  const mounts = (queue?.mounts || []).filter(mount => mount.status === "mounted");
  const admissions = mounts.map(mount => mount.admittedAt - mount.requestedAt);
  const commits = mounts.map(mount => mount.committedAt - mount.admittedAt);
  const gate = measurements.conditions?.find(condition => condition.loadSettled === true)?.at || null;
  const hasProviderMeasurements = Array.isArray(measurements.providerPermits);
  const backgroundPermits = (measurements.providerPermits || []).filter(permit => permit.background);
  const backgroundBeforeGate = backgroundPermits.filter(permit => permit.admittedAt && (!gate || permit.admittedAt < gate));
  const foregroundPermits = (measurements.providerPermits || []).filter(permit => !permit.background && permit.admittedAt);
  const foregroundWaits = foregroundPermits.map(permit => permit.admittedAt - permit.requestedAt);
  const startedMaintenance = (queue?.diagnostics.events || []).filter(event => event.type === "started"
    && event.effectiveCategory === "maintenance");
  const completedProjects = (queue?.diagnostics.events || []).filter(event => event.type === "completed" && event.jobType === "rankProjectTasks");
  const distinctProjects = new Set(completedProjects.map(event => event.jobKey));
  const renderDurations = measurements.commits.map(commit => commit.actualDuration);
  return { artifact: snapshot.artifact, backgroundBeforeGate: hasProviderMeasurements ? backgroundBeforeGate.length : null,
    backgroundProviderRequests: hasProviderMeasurements ? backgroundPermits.length : null,
    firstMaintenanceAt: startedMaintenance[0]?.at || null, firstUsableMilliseconds: measurements.firstUsableMilliseconds,
    foregroundAdmissionMedianMilliseconds: medianValue(foregroundWaits), initialLongTaskCount: initialLongTasks.length,
    initialLongTaskMilliseconds: initialLongTasks.reduce((total, entry) => total + entry.duration, 0), loadGateOpenedAt: gate,
    maximumReactRenderMilliseconds: Math.max(0, ...renderDurations), mountedWidgets: mounts.length,
    mountingAdmissionMedianMilliseconds: medianValue(admissions), mountingCommitLatencyMedianMilliseconds: medianValue(commits),
    options: snapshot.options, rankedProjects: distinctProjects.size, run: snapshot.run, viewport: snapshot.viewport };
}

// ----------------------------------------------------------------------------------------------
// @desc Read raw browser captures and write a reproducible summary and paired enabled/disabled medians.
// @param {string} directory - Acceptance artifact directory.
// @returns {object} Summary written to summary.json.
export function summarizeAcceptance(directory) {
  const files = fs.readdirSync(directory).filter(name => name.endsWith(".json") && name !== "summary.json");
  const snapshots = files.map(name => ({ ...JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")), artifact: name }));
  const measuredSnapshots = snapshots.filter(snapshot => snapshot.measurements);
  const visits = measuredSnapshots.map(summarizeSnapshot).sort((left, right) => left.run.localeCompare(right.run));
  const comparisons = ["desktop", "mobile"].map(device => {
    const disabled = visits.filter(visit => new RegExp(`^${ device }-off-off-[12]\\.json$`).test(visit.artifact));
    const enabled = visits.filter(visit => new RegExp(`^${ device }-on-on-[12]\\.json$`).test(visit.artifact));
    const disabledMedian = medianValue(disabled.map(visit => visit.firstUsableMilliseconds));
    const enabledMedian = medianValue(enabled.map(visit => visit.firstUsableMilliseconds));
    return { device, disabledMedian, enabledMedian, sampleCount: enabled.length,
      changePercent: disabledMedian ? (enabledMedian - disabledMedian) / disabledMedian * 100 : null };
  });
  const summary = { comparisons, visits };
  fs.writeFileSync(path.join(directory, "summary.json"), JSON.stringify(summary, null, 2));
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const summary = summarizeAcceptance(process.argv[2] || "artifacts/phase-10");
  console.log(JSON.stringify(summary.comparisons, null, 2));
}
