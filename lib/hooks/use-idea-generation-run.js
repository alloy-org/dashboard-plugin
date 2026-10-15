// Start and follow a "Generate ideas" run from the Quarterly Planning widget. A click records the run against the
// day's allowance, opens its progress window in an Amplenote prompt at once, plans the run over the current quarter's
// projects in focus this month, and drives it with IdeaGenerationRun on the Dashboard's durable work runner. The run is
// held at module level, so a widget that remounts finds it still going; while it goes, the run's work scope is kept
// on the scheduler. Each snapshot is pushed to the plugin, at most once a second, for the progress window to read.
// A host that cannot open the prompt gets the same progress drawn inside the Dashboard instead.
import { currentIdeaGenerationAllowance, recordIdeaGenerationRun } from "dashboard/idea-generation-allowance";
import IdeaGenerationRun, { STEP_LABELS } from "dashboard/idea-generation-run";
import { planIdeaGenerationRun, RUN_STEP_KEYS } from "dashboard/idea-generation-run-plan";
import { pendingRunSnapshot } from "dashboard/idea-run-progress-view";
import QuarterProjectRepository from "dashboard/quarter-project-repository";
import { useDashboardWork } from "dashboard/work-queue/dashboard-work-context";
import { queuedMaintenanceSelected } from "dashboard/work-queue/dashboard-work-features";
import { projectJobScope } from "dashboard/work-queue/jobs/project-job-inputs";
import { projectWorkScopeKey } from "dashboard/work-queue/jobs/project-job-requests";
import { useCallback, useState, useSyncExternalStore } from "react";
import { logIfEnabled } from "util/log";

const RUN_HOOK_LOG_LABEL = "[idea-generation-run]";
// The shortest interval between two snapshots pushed to the plugin.
const SNAPSHOT_PUSH_MILLISECONDS = 1000;
// The message above the progress window's embed.
const PROGRESS_PROMPT_MESSAGE = "Generate ideas";

// The run this Dashboard started, if any: { pushTimer, pushedAt, run, snapshot }.
let activeRunRecord = null;
const runListeners = new Set();

// ----------------------------------------------------------------------------------------------
// @desc Follow the active run and start new ones.
// @param {object} options - { app, domainName, domainUuid }: the Dashboard's active task domain.
// @returns {object} An object with the following properties:
//   - {object} allowance - From currentIdeaGenerationAllowance
//   - {boolean} available - False when the Dashboard has no durable work runner to run the jobs on
//   - {function} closeFallback - Closes the in-Dashboard progress window
//   - {boolean} fallbackOpen - True while the in-Dashboard progress window is shown
//   - {function} openProgress - Opens the active run's progress window again
//   - {boolean} running - True while a run is under way
//   - {object|null} snapshot - The active run's latest snapshot
//   - {function} start - Starts a run, or reopens the window of one under way
export function useIdeaGenerationRun({ app, domainName, domainUuid }) {
  const work = useDashboardWork();
  const durable = queuedMaintenanceSelected() ? work?.runtime.durable || null : null;
  const scheduler = durable ? work.runtime.scheduler : null;
  const snapshot = useSyncExternalStore(_subscribeRun, () => activeRunRecord?.snapshot ?? null);
  const [allowance, setAllowance] = useState(() => currentIdeaGenerationAllowance(new Date()));
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const running = !!snapshot && !snapshot.finished;

  const openProgress = useCallback(() => {
    const runId = activeRunRecord?.snapshot?.runId;
    if (runId) _openProgressPrompt(app, runId, () => setFallbackOpen(true));
  }, [app]);

  const start = useCallback(async () => {
    if (activeRunRecord && !activeRunRecord.snapshot.finished) return openProgress();
    const now = new Date();
    if (!durable || !currentIdeaGenerationAllowance(now).allowed) return null;
    const runId = `run-${ now.getTime().toString(36) }`;
    const runAllowance = await recordIdeaGenerationRun(app, now);
    setAllowance(currentIdeaGenerationAllowance(now));
    const stepLabels = RUN_STEP_KEYS.map(stepKey => ({ key: stepKey, label: STEP_LABELS[stepKey] }));
    _publishSnapshot(app, pendingRunSnapshot({ allowance: runAllowance, runId, startedAt: now.getTime(), stepLabels }), { run: null });
    _openProgressPrompt(app, runId, () => setFallbackOpen(true));
    return _runIdeaGeneration(app, { domainName, domainUuid, durable, now, runAllowance, runId, scheduler });
  }, [app, domainName, domainUuid, durable, openProgress, scheduler]);

  return { allowance, available: !!durable, closeFallback: () => setFallbackOpen(false), fallbackOpen, openProgress, running, snapshot, start };
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Open the run's progress window in an Amplenote prompt without waiting for it to close. A host that answers
//   with an error, or rejects, gets the in-Dashboard window instead.
// @param {object} app - Amplenote app bridge.
// @param {string} runId - The run.
// @param {function} onUnavailable - Opens the in-Dashboard window.
function _openProgressPrompt(app, runId, onUnavailable) {
  const embedInput = { type: "embed", value: { runId, view: "ideaRunProgress" } };
  Promise.resolve().then(() => app.prompt(PROGRESS_PROMPT_MESSAGE, { inputs: [embedInput] })).then(result => {
    if (result?.embedCallFailed) onUnavailable();
  }).catch(error => {
    logIfEnabled(`${ RUN_HOOK_LOG_LABEL } could not open the progress prompt`, error?.message);
    onUnavailable();
  });
}

// ----------------------------------------------------------------------------------------------
// @desc Hold a snapshot as the active run's, tell the widget, and push it to the plugin: at once when the last push
//   was a second or more ago or the run finished, otherwise once that second has passed.
// @param {object} app - Amplenote app bridge.
// @param {object} snapshot - The run's snapshot.
// @param {object} [options] - { run }: the IdeaGenerationRun, once one exists.
function _publishSnapshot(app, snapshot, { run } = {}) {
  if (!activeRunRecord || activeRunRecord.snapshot.runId !== snapshot.runId) {
    clearTimeout(activeRunRecord?.pushTimer);
    activeRunRecord = { pushTimer: null, pushedAt: 0, run: null, snapshot };
  }
  activeRunRecord.snapshot = snapshot;
  if (run) activeRunRecord.run = run;
  for (const listener of runListeners) listener();
  const record = activeRunRecord;
  const push = () => {
    record.pushTimer = null;
    record.pushedAt = Date.now();
    Promise.resolve().then(() => app.ideaRunProgressUpdate(record.snapshot))
      .catch(error => logIfEnabled(`${ RUN_HOOK_LOG_LABEL } could not relay progress`, error?.message));
  };
  if (snapshot.finished || Date.now() - record.pushedAt >= SNAPSHOT_PUSH_MILLISECONDS) {
    clearTimeout(record.pushTimer);
    push();
  } else if (!record.pushTimer) {
    record.pushTimer = setTimeout(push, SNAPSHOT_PUSH_MILLISECONDS - (Date.now() - record.pushedAt));
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Plan the run and drive it to its summary, keeping its work scope on the scheduler meanwhile. A plan that
//   cannot be read finishes the run at once with that failure as its summary.
// @param {object} app - Amplenote app bridge.
// @param {object} options - { domainName, domainUuid, durable, now, runAllowance, runId, scheduler }.
// @returns {Promise<void>}
async function _runIdeaGeneration(app, { domainName, domainUuid, durable, now, runAllowance, runId, scheduler }) {
  const input = { domainName, domainUuid, quarter: Math.floor(now.getMonth() / 3) + 1, year: now.getFullYear() };
  const scopeKey = projectWorkScopeKey(input);
  const releaseScope = scheduler ? scheduler.retainScope(scopeKey) : () => {};
  let plan;
  try {
    plan = await planIdeaGenerationRun(app, input, { now, runId });
  } catch (error) {
    logIfEnabled(`${ RUN_HOOK_LOG_LABEL } could not plan the run`, error?.message);
    releaseScope();
    const failure = { detail: error?.message || "Could not read the quarter's projects", entityId: null, jobType: "plan", subject: null };
    _publishSnapshot(app, { ...activeRunRecord.snapshot, etaSeconds: null, finished: true, summary: { failures: [failure], projects: [],
      refinedTermCount: 0 }, title: "Could not generate ideas" });
    return;
  }
  const repository = new QuarterProjectRepository({ app });
  const projectReader = () => repository.readStored(projectJobScope(input), { includeInactive: true });
  const run = new IdeaGenerationRun({ allowance: runAllowance, durable, plan, projectReader, runId, scopeKey });
  run.subscribe(snapshot => {
    _publishSnapshot(app, snapshot, { run });
    if (snapshot.finished) releaseScope();
  });
  _publishSnapshot(app, run.snapshot(), { run });
  await run.start();
}

// ----------------------------------------------------------------------------------------------
// @desc Listen for changes to the active run, for useSyncExternalStore.
// @param {function} listener - Called on each change.
// @returns {function} Stops listening.
function _subscribeRun(listener) {
  runListeners.add(listener);
  return () => runListeners.delete(listener);
}
