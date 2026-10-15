// Relay "Generate ideas" progress from the Dashboard to the progress window. The run lives in the Dashboard embed, while
// its window is a separate embed inside an Amplenote prompt that shares nothing with it, so the Dashboard pushes each
// snapshot to the plugin and the window polls the plugin for it. Snapshots are held in memory for the plugin's
// lifetime, at most a few runs. Host-compatible: no React or DOM.
import { ideaRunProgressView } from "dashboard/idea-generation/idea-run-progress-view";

// The most runs whose snapshots are held; the oldest is dropped first.
const MAXIMUM_HELD_RUNS = 4;
const snapshotsByRunId = new Map();

// ----------------------------------------------------------------------------------------------
// @desc Hold the latest snapshot of a run.
// @param {object} snapshot - A run snapshot carrying runId.
// @returns {boolean} False when the snapshot names no run.
export function updateIdeaRunProgress(snapshot) {
  if (!snapshot?.runId) return false;
  snapshotsByRunId.delete(snapshot.runId);
  snapshotsByRunId.set(snapshot.runId, snapshot);
  while (snapshotsByRunId.size > MAXIMUM_HELD_RUNS) snapshotsByRunId.delete(snapshotsByRunId.keys().next().value);
  return true;
}

// ----------------------------------------------------------------------------------------------
// @desc Describe a run for its progress window.
// @param {string} runId - The run.
// @returns {object} From ideaRunProgressView; found is false when no snapshot is held for the run.
export function readIdeaRunProgress(runId) {
  return ideaRunProgressView(snapshotsByRunId.get(runId) || null);
}
