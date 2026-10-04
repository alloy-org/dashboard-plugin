// The sections of the admin Queue inspector: an overview of the runtime and its admission conditions, the active and
// pending jobs with their filters, urgent widget renders, resource permits, recent outcomes, and timings by job type.
// Each section only displays the view it is given; none of them changes the queue.
import { formattedAge, formattedDuration, jobFilterOptions } from "dashboard/work-queue/dashboard-queue-inspector-model";

// ------------------------------------------------------------------------------------------
// @desc A labelled select over a list of values, with an "All" choice that clears the filter.
// @param {object} props - { label, onChange, options, value }.
function JobFilterSelect({ label, onChange, options, value }) {
  return (
    <label className="queue-inspector-filter">
      <span>{label}</span>
      <select value={value} onChange={event => onChange(event.target.value)}>
        <option value="">All</option>
        {options.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

// ------------------------------------------------------------------------------------------
// @desc The active and pending jobs, with filters for priority, status, type, scope, and key text.
// @param {object} props - An object with the following properties:
//   - {Array<object>} allJobs - Every job, from which the filter choices are drawn
//   - {object} filters - { category, keyText, scopeKey, status, type }
//   - {Array<object>} jobs - The jobs matching the filters
//   - {number} now - Epoch milliseconds the view was captured at
//   - {function} onFiltersChange - Receives the next filters
export function QueueJobSection({ allJobs, filters, jobs, now, onFiltersChange }) {
  const options = jobFilterOptions(allJobs);
  const setFilter = name => value => onFiltersChange({ ...filters, [name]: value });
  return (
    <section className="queue-inspector-section">
      <h4>Active and pending work ({jobs.length} of {allJobs.length})</h4>
      <div className="queue-inspector-filters">
        <JobFilterSelect label="Priority" onChange={setFilter("category")} options={options.categories} value={filters.category} />
        <JobFilterSelect label="Status" onChange={setFilter("status")} options={options.statuses} value={filters.status} />
        <JobFilterSelect label="Type" onChange={setFilter("type")} options={options.types} value={filters.type} />
        <JobFilterSelect label="Scope" onChange={setFilter("scopeKey")} options={options.scopeKeys} value={filters.scopeKey} />
        <label className="queue-inspector-filter">
          <span>Key or project</span>
          <input type="search" value={filters.keyText} onChange={event => setFilter("keyText")(event.target.value)} />
        </label>
      </div>
      {jobs.length === 0 ? <p className="queue-inspector-empty">No jobs match.</p> : (
        <table className="queue-inspector-table">
          <thead>
            <tr>
              <th>Job</th><th>Priority</th><th>Status</th><th>Resource</th><th>Attempt</th><th>Enqueued</th><th>Started</th>
              <th>Waiting because</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map(job => (
              <tr key={job.key}>
                <td title={job.key}>{job.type}<div className="queue-inspector-detail">{job.key}</div></td>
                <td>{job.effectiveCategory}{job.effectiveCategory !== job.category ? ` (from ${ job.category })` : ""}</td>
                <td>{job.status}</td>
                <td>{job.resource || "—"}</td>
                <td>{job.attempt}</td>
                <td>{formattedAge(job.enqueuedAt, now)}</td>
                <td>{formattedAge(job.startedAt, now)}</td>
                <td title={job.waitingReason || ""}>{job.waitingExplanation || (job.status === "pending" ? "Not yet considered" : "—")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ------------------------------------------------------------------------------------------
// @desc Recently finished jobs, newest first, with failure messages already sanitized by diagnostics.
// @param {object} props - { now, outcomes }.
export function QueueOutcomeSection({ now, outcomes }) {
  return (
    <section className="queue-inspector-section">
      <h4>Recent outcomes</h4>
      {outcomes.length === 0 ? <p className="queue-inspector-empty">No job has finished yet.</p> : (
        <table className="queue-inspector-table">
          <thead><tr><th>When</th><th>Outcome</th><th>Job</th><th>Ran for</th><th>Detail</th></tr></thead>
          <tbody>
            {outcomes.map((event, index) => (
              <tr key={`${ event.at }:${ event.jobKey }:${ index }`} className={`queue-inspector-outcome--${ event.type }`}>
                <td>{formattedAge(event.at, now)}</td>
                <td>{event.type}</td>
                <td title={event.jobKey}>{event.jobType}<div className="queue-inspector-detail">{event.jobKey}</div></td>
                <td>{formattedDuration(event.durationMilliseconds)}</td>
                <td>{event.error || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ------------------------------------------------------------------------------------------
// @desc The runtime, its scope and features, the conditions admission consults, and whether the queue is progressing.
//   Facts the queue cannot know before durable jobs exist are labelled unavailable rather than guessed.
// @param {object} props - { now, overview }: overview from queueOverview.
export function QueueOverviewSection({ now, overview }) {
  const { conditions } = overview;
  const waitingReasons = Object.entries(overview.waitingByReason);
  const rows = [
    ["Session", `${ overview.session?.sessionId || "—" }, started ${ formattedAge(overview.session?.startedAt, now) }`],
    ["Scope", overview.scopeKey || "—"],
    ["Features", `Scheduled widget mounting on; project maintenance ${ overview.projectCoverage ? "on the queue" : "on its legacy path" }`],
    ["Page", conditions.hidden ? "Hidden: near renders and maintenance paused" : "Visible"],
    ["Overlay", conditions.overlayHeld ? "Holding renders and maintenance" : "None"],
    ["Load gate", conditions.loadSettled ? "Open" : "Closed: maintenance waits for the initial load and its grace period"],
    ["Foreground demand", overview.foregroundDemand ? "Yes" : "None"],
    ["Jobs", `${ overview.running } running, ${ overview.pending } pending`],
    ["Oldest pending", formattedDuration(overview.oldestPendingMilliseconds)],
    ["Waiting reasons", waitingReasons.length ? waitingReasons.map(([reason, count]) => `${ reason } ${ count }`).join(", ") : "None"],
    ["Last progress", formattedAge(overview.lastProgressAt, now)],
    ["Project coverage", _projectCoverageText(overview.projectCoverage)],
    ["Durable history", overview.durableEnabled ? "Saved work and history below, read when opened"
      : "Unavailable: durable work is switched off; this view shows this session only"],
  ];
  return (
    <section className="queue-inspector-section">
      <h4>Overview</h4>
      <dl className="queue-inspector-overview">
        {rows.map(([label, value]) => [<dt key={`${ label }-label`}>{label}</dt>, <dd key={`${ label }-value`}>{value}</dd>])}
      </dl>
    </section>
  );
}

// ------------------------------------------------------------------------------------------
// @desc Permits in use and free for each resource, split between foreground work and maintenance. A resource that
//   holds maintenance below its limit shows the cap beside maintenance's count, as "0 of 1".
// @param {object} props - { resources }: from the scheduler snapshot.
export function QueueResourceSection({ resources }) {
  return (
    <section className="queue-inspector-section">
      <h4>Resources</h4>
      <table className="queue-inspector-table">
        <thead><tr><th>Resource</th><th>Limit</th><th>Foreground</th><th>Maintenance</th><th>Available</th></tr></thead>
        <tbody>
          {Object.entries(resources).map(([resource, permits]) => (
            <tr key={resource}>
              <td>{resource}</td><td>{permits.limit}</td><td>{permits.foreground}</td><td>{_maintenancePermits(permits)}</td><td>{permits.available}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ------------------------------------------------------------------------------------------
// @desc Run and wait timings per job type since the runtime started.
// @param {object} props - { timings }: from the diagnostics snapshot.
export function QueueTimingSection({ timings }) {
  const timingEntries = Object.entries(timings);
  return (
    <section className="queue-inspector-section">
      <h4>Timings by job type</h4>
      {timingEntries.length === 0 ? <p className="queue-inspector-empty">No timings yet.</p> : (
        <table className="queue-inspector-table">
          <thead><tr><th>Type</th><th>Runs</th><th>Average run</th><th>Longest run</th><th>Average wait</th></tr></thead>
          <tbody>
            {timingEntries.map(([jobType, timing]) => (
              <tr key={jobType}>
                <td>{jobType}</td>
                <td>{timing.runs}</td>
                <td>{formattedDuration(timing.runs ? timing.totalRunMilliseconds / timing.runs : null)}</td>
                <td>{formattedDuration(timing.runs ? timing.maximumRunMilliseconds : null)}</td>
                <td>{formattedDuration(timing.waits ? timing.totalWaitMilliseconds / timing.waits : null)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ------------------------------------------------------------------------------------------
// @desc Each lazily mounted widget: its visibility, its request, why it waits, and how long admission and commit took.
// @param {object} props - { now, rows }: rows from urgentRenderRows.
export function UrgentRenderSection({ now, rows }) {
  return (
    <section className="queue-inspector-section">
      <h4>Urgent renders</h4>
      {rows.length === 0 ? <p className="queue-inspector-empty">No widget is registered for scheduled mounting.</p> : (
        <table className="queue-inspector-table">
          <thead>
            <tr>
              <th>Widget</th><th>Visibility</th><th>Status</th><th>Request</th><th>Waiting because</th><th>To admission</th><th>To commit</th>
              <th>Permit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.widgetId}>
                <td>{row.widgetId}</td>
                <td>{row.visible ? "Visible" : row.nearViewport ? "Near" : "Out of range"}</td>
                <td>{row.status}</td>
                <td>{row.queuedCategory ? `${ row.queuedCategory }, ${ formattedAge(row.requestedAt, now) }` : "—"}</td>
                <td title={row.waitingReason || ""}>{row.waitingExplanation || "—"}</td>
                <td>{formattedDuration(row.admittedAt !== null && row.requestedAt !== null ? row.admittedAt - row.requestedAt : null)}</td>
                <td>{formattedDuration(row.committedAt !== null && row.admittedAt !== null ? row.committedAt - row.admittedAt : null)}</td>
                <td>{row.watchdogActive ? "Held, watchdog armed" : row.releasedBy ? `Released by ${ row.releasedBy }` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ------------------------------------------------------------------------------------------
// Local helpers
// ------------------------------------------------------------------------------------------

// ------------------------------------------------------------------------------------------
// @desc Describe this visit's project coverage in one line.
// @param {object|null} coverage - From QuarterProjectWorkPlanner#coverage, or null without queued maintenance.
// @returns {string} Such as "3 of 5 covered: 2 refreshed (1 ranked), 1 current; 1 in flight, 0 failed".
function _projectCoverageText(coverage) {
  if (!coverage) return "Unavailable: project maintenance runs on its legacy path";
  if (!coverage.target) return "No reconciliation has planned this scope yet";
  return `${ coverage.covered } of ${ coverage.target } covered: ${ coverage.succeeded } refreshed (${ coverage.rated } ranked), `
    + `${ coverage.checked } current; ${ coverage.inFlight } in flight, ${ coverage.failed } failed`;
}

// ------------------------------------------------------------------------------------------
// @desc The maintenance cell's text: the permits maintenance holds, with its cap when that is below the full limit.
// @param {object} permits - { limit, maintenance, maintenanceLimit } from the scheduler snapshot.
// @returns {string|number} The count, or "<count> of <cap>".
function _maintenancePermits({ limit, maintenance, maintenanceLimit }) {
  if (!Number.isInteger(maintenanceLimit) || maintenanceLimit >= limit) return maintenance;
  return `${ maintenance } of ${ maintenanceLimit }`;
}
