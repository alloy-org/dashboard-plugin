// The admin Queue inspector's durable sections: the jobs saved in the current scope's queue note, including those
// claimed by other sessions, and the outcomes kept in its history note. Both are read when the inspector opens or the
// operator refreshes, and are labelled unavailable rather than empty when durable work is off or a note is unreadable.
import { formattedAge, formattedDuration, formattedRevision, savedJobRows } from "dashboard/work-queue/dashboard-queue-inspector-model";

// ------------------------------------------------------------------------------------------
// @desc Outcomes of durable jobs from this and earlier sessions, newest first, with how saving history has gone.
// @param {object} props - { history, now, sessionId }: history from DashboardWorkDiagnosticsStore#readHistory, or null.
export function DurableHistorySection({ history, now, sessionId }) {
  if (!history) return null;
  const { records, storage } = history;
  const storageText = `${ storage.writes } saved batches, ${ storage.failures } failed`
    + (storage.lastFailure ? `; last failure ${ formattedAge(storage.lastFailure.at, now) }: ${ storage.lastFailure.message }` : "");
  return (
    <section className="queue-inspector-section">
      <h4>Durable history</h4>
      {!history.available && (
        <p className="queue-inspector-empty">History note unreadable: {history.error}. Showing unsaved outcomes only.</p>
      )}
      <p className="queue-inspector-detail">{storageText}</p>
      {records.length === 0 ? <p className="queue-inspector-empty">No durable job has finished in the last week.</p> : (
        <table className="queue-inspector-table">
          <thead>
            <tr><th>When</th><th>Outcome</th><th>Job</th><th>Attempt</th><th>Ran for</th><th>Revision</th><th>Session</th><th>Detail</th></tr>
          </thead>
          <tbody>
            {records.map((record, index) => (
              <tr key={`${ record.at }:${ record.jobKey }:${ index }`} className={`queue-inspector-outcome--${ record.status }`}>
                <td>{formattedAge(record.at, now)}</td>
                <td>{record.status}{record.recovered ? " (output already written)" : ""}</td>
                <td title={record.jobKey}>{record.jobType}<div className="queue-inspector-detail">{record.jobKey}</div></td>
                <td>{record.attempt ?? "—"}</td>
                <td>{formattedDuration(record.durationMilliseconds)}</td>
                <td>{record.outputRevision ?? "—"}</td>
                <td>{record.sessionId === sessionId ? "This session" : record.sessionId || "—"}</td>
                <td>{record.error ? `${ record.failureClassification }: ${ record.error }` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ------------------------------------------------------------------------------------------
// @desc The jobs saved for the current scope, with a refresh button that re-reads the queue and history notes.
// @param {object} props - { durable, loading, now, onRefresh, sessionId }: durable from useDashboardQueueHistory.
export function SavedWorkSection({ durable, loading, now, onRefresh, sessionId }) {
  if (!durable) {
    return <section className="queue-inspector-section"><h4>Saved work</h4><p className="queue-inspector-empty">Reading…</p></section>;
  }
  if (!durable.available && !durable.error) {
    return (
      <section className="queue-inspector-section">
        <h4>Saved work</h4>
        <p className="queue-inspector-empty">Unavailable: durable work is switched off, so nothing is saved between sessions.</p>
      </section>
    );
  }
  const rows = savedJobRows(durable.jobs, { now, sessionId });
  return (
    <section className="queue-inspector-section">
      <h4>Saved work for {durable.scopeKey || "—"} ({rows.length})</h4>
      <div className="queue-inspector-toolbar">
        <button type="button" onClick={onRefresh} disabled={loading}>{loading ? "Reading…" : "Refresh saved work"}</button>
        <span className="queue-inspector-status">Read {formattedAge(durable.readAt, now)}</span>
      </div>
      {durable.error && <p className="queue-inspector-empty">Queue note unreadable: {durable.error}</p>}
      {durable.unreadableRecords > 0 && <p className="queue-inspector-empty">{durable.unreadableRecords} records were written by a newer
        version or are damaged; they are kept untouched.</p>}
      {rows.length === 0 ? <p className="queue-inspector-empty">No saved jobs.</p> : (
        <table className="queue-inspector-table">
          <thead>
            <tr><th>Job</th><th>Status</th><th>Attempt</th><th>Wanted</th><th>Done</th><th>Progress</th><th>Updated</th><th>Last failure</th></tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.key}>
                <td title={row.key}>{row.type}<div className="queue-inspector-detail">{row.key}</div></td>
                <td>
                  {row.statusLabel}
                  {row.claimExpiresAt ? <div className="queue-inspector-detail">{_claimText(row.claimExpiresAt, now)}</div> : null}
                </td>
                <td>{row.attempt}</td>
                <td title={row.desiredRevision ?? undefined}>{formattedRevision(row.desiredRevision, now)}</td>
                <td title={row.succeededRevision ?? undefined}>
                  {formattedRevision(row.succeededRevision, now)}
                  {row.succeededAt ? <div className="queue-inspector-detail">{formattedAge(row.succeededAt, now)}</div> : null}
                </td>
                <td>{row.cursor === null ? "—" : "Checkpoint saved"}</td>
                <td>{formattedAge(row.updatedAt, now)}</td>
                <td>{row.lastFailure ? `${ row.lastFailure.classification }: ${ row.lastFailure.message }` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ------------------------------------------------------------------------------------------
// @desc When a running job's claim lapses, or that it has.
// @param {number} claimExpiresAt - Epoch milliseconds.
// @param {number} now - Epoch milliseconds.
// @returns {string} Such as "Claim lapses in 1.5 min".
function _claimText(claimExpiresAt, now) {
  return claimExpiresAt > now ? `Claim lapses in ${ formattedDuration(claimExpiresAt - now) }` : "Claim lapsed";
}
