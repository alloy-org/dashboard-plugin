// The admin Queue inspector's durable sections: the jobs saved in the current scope's queue note, including those
// claimed by other sessions, the outcomes kept in its history note, and each dictionary term's evidence and refinement.
// All are read when the inspector opens or the operator refreshes, and are labelled unavailable rather than empty when
// durable work is off or a note is unreadable.
import { Button, EmptyState } from "dashboard/controls";
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
        <EmptyState compact>History note unreadable: {history.error}. Showing unsaved outcomes only.</EmptyState>
      )}
      <p className="queue-inspector-detail">{storageText}</p>
      {records.length === 0 ? <EmptyState compact>No durable job has finished in the last week.</EmptyState> : (
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
    return <section className="queue-inspector-section"><h4>Saved work</h4><EmptyState compact>Reading…</EmptyState></section>;
  }
  if (!durable.available && !durable.error) {
    return (
      <section className="queue-inspector-section">
        <h4>Saved work</h4>
        <EmptyState compact>Unavailable: durable work is switched off, so nothing is saved between sessions.</EmptyState>
      </section>
    );
  }
  const rows = savedJobRows(durable.jobs, { now, sessionId });
  return (
    <section className="queue-inspector-section">
      <h4>Saved work for {durable.scopeKey || "—"} ({rows.length})</h4>
      <div className="queue-inspector-toolbar">
        <Button dense disabled={ loading } onClick={ onRefresh } variant="outlined">
          {loading ? "Reading…" : "Refresh saved work"}
        </Button>
        <span className="queue-inspector-status">Read {formattedAge(durable.readAt, now)}</span>
      </div>
      {durable.error && <EmptyState compact>Queue note unreadable: {durable.error}</EmptyState>}
      {durable.unreadableRecords > 0 && <EmptyState compact>{durable.unreadableRecords} records were written by a newer
        version or are damaged; they are kept untouched.</EmptyState>}
      {rows.length === 0 ? <EmptyState compact>No saved jobs.</EmptyState> : (
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
// @desc Each dictionary term's evidence collection and refinement, in dictionary order, with what happens next, so an
//   operator can tell a term whose search found nothing from one not yet looked at.
// @param {object} props - { now, terms }: terms is { error, rows } from useDashboardQueueHistory, or null.
export function DictionaryTermSection({ now, terms }) {
  if (!terms) return null;
  const at = time => (time ? formattedAge(Date.parse(time), now) : "—");
  return (
    <section className="queue-inspector-section">
      <h4>Dictionary terms ({terms.rows.length})</h4>
      {terms.error && <EmptyState compact>Dictionary or evidence note unreadable: {terms.error}</EmptyState>}
      {terms.rows.length === 0 ? <EmptyState compact>This year has no dictionary terms yet.</EmptyState> : (
        <table className="queue-inspector-table">
          <thead>
            <tr><th>Term</th><th>Evidence</th><th>Refinement</th><th>Next</th></tr>
          </thead>
          <tbody>
            {terms.rows.map(row => (
              <tr key={row.term}>
                <td>{row.term}<div className="queue-inspector-detail">{row.isBuilderOwned ? "Plugin-owned" : "User-written"}</div></td>
                <td>
                  {row.evidenceOutcome || "—"}
                  {row.collectedAt ? <div className="queue-inspector-detail">{`${ row.passageCount } passages from ${ row.sourceCount } `
                    + `notes, ${ at(row.collectedAt) }`}</div> : null}
                </td>
                <td>
                  {row.refinementOutcome ? `${ row.refinementOutcome }${ row.evidenceQuality ? ` (${ row.evidenceQuality })` : "" }` : "—"}
                  {row.refinementAttemptedAt ? <div className="queue-inspector-detail">{`Tried ${ at(row.refinementAttemptedAt) }; `
                    + `last rewritten ${ at(row.refinedAt) }`}</div> : null}
                  {row.keptReason ? <div className="queue-inspector-detail">{row.keptReason}</div> : null}
                  {row.uncertainty ? <div className="queue-inspector-detail">Uncertain: {row.uncertainty}</div> : null}
                </td>
                <td>{row.nextStep}</td>
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
