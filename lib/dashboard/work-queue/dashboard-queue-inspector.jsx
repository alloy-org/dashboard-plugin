// The admin Queue inspector, shown inside the Debug Console when admin tools are available. It answers what is
// running, why each job is waiting, and whether the queue is making progress, from the scheduler's own snapshots
// rather than from Console Logging, and shows the scope's saved durable jobs and their history when durable work is on.
// It is read-only: it adds no job controls, and copying or downloading a snapshot
// exports the sanitized copy diagnostics produce without retrying, resuming, or reprioritizing anything.
import { DurableHistorySection, SavedWorkSection } from "dashboard/work-queue/dashboard-queue-durable-sections";
import { ALL_JOBS_FILTER, filteredJobs, queueOverview, recentOutcomes, urgentRenderRows } from "dashboard/work-queue/dashboard-queue-inspector-model";
import { QueueJobSection, QueueOutcomeSection, QueueOverviewSection, QueueResourceSection, QueueTimingSection,
  UrgentRenderSection } from "dashboard/work-queue/dashboard-queue-inspector-sections";
import useDashboardQueueDiagnostics, { useDashboardQueueHistory } from "hooks/use-dashboard-queue-diagnostics";
import { useState } from "react";
import { logAlways } from "util/log";

import "dashboard/styles/dashboard-queue-inspector.scss";

// ------------------------------------------------------------------------------------------
// @desc Render the Queue inspector for the Dashboard's work runtime, or explain that none is running.
// @param {object} props - { work }: { mountCoordinator, runtime } as the Dashboard provides it, or null.
export default function DashboardQueueInspector({ work }) {
  const view = useDashboardQueueDiagnostics(work);
  const { durable, loading, refresh } = useDashboardQueueHistory(work);
  const [filters, setFilters] = useState(ALL_JOBS_FILTER);
  const [exportStatus, setExportStatus] = useState("");

  if (!work) {
    return (
      <div className="dashboard-queue-inspector">
        <p className="queue-inspector-empty">The work queue is not running in this Dashboard: scheduled widget mounting is
          switched off, or this browser lacks IntersectionObserver, so widgets mount on their unscheduled path.</p>
      </div>
    );
  }
  if (!view) return <div className="dashboard-queue-inspector" />;

  const exportText = () => JSON.stringify(work.runtime.exportSnapshot({ mountSnapshot: work.mountCoordinator?.snapshot() }), null, 2);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(exportText());
      setExportStatus("Copied a sanitized snapshot.");
    } catch (error) {
      logAlways("[queue-inspector] copy failed:", error);
      setExportStatus("Copy failed; try Download.");
    }
  };
  const handleDownload = () => {
    try {
      _downloadText(exportText(), `dashboard-queue-${ new Date(view.capturedAt).toISOString().replace(/[:.]/g, "-") }.json`);
      setExportStatus("Downloaded a sanitized snapshot.");
    } catch (error) {
      logAlways("[queue-inspector] download failed:", error);
      setExportStatus("Download failed; try Copy.");
    }
  };

  const allJobs = view.scheduler.jobs;
  const jobs = filteredJobs(allJobs, filters);
  const overview = queueOverview(view);
  return (
    <div className="dashboard-queue-inspector">
      <div className="queue-inspector-toolbar">
        <button type="button" onClick={handleCopy}>Copy snapshot</button>
        <button type="button" onClick={handleDownload}>Download snapshot</button>
        <span className="queue-inspector-status" role="status">{exportStatus}</span>
      </div>
      <QueueOverviewSection now={view.capturedAt} overview={overview} />
      <QueueJobSection allJobs={allJobs} filters={filters} jobs={jobs} now={view.capturedAt} onFiltersChange={setFilters} />
      <UrgentRenderSection now={view.capturedAt} rows={urgentRenderRows(view)} />
      <QueueResourceSection resources={view.scheduler.resources} />
      <QueueOutcomeSection now={view.capturedAt} outcomes={recentOutcomes(view.diagnostics.events)} />
      <QueueTimingSection timings={view.diagnostics.timings} />
      <SavedWorkSection durable={durable} loading={loading} now={view.capturedAt} onRefresh={refresh} sessionId={view.session.sessionId} />
      <DurableHistorySection history={durable?.history || null} now={view.capturedAt} sessionId={view.session.sessionId} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// @desc Save text as a file through a temporary link.
// @param {string} text - File contents.
// @param {string} fileName - Suggested file name.
function _downloadText(text, fileName) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
