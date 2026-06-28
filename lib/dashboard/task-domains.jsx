/**
 * [Claude-authored file]
 * Created: 2026-02-21 | Model: claude-opus-4-6
 * Task: Task Domains component — domain selector with refresh and settings links
 * Prompt summary: "allow user to choose which Task Domain their dashboard focuses on"
 */
import { useState } from "react";
import { refreshTaskDomains, switchTaskDomain } from "data-service";
import { logIfEnabled } from "util/log";
import "styles/task-domains.scss"

// [Claude] Task: use standalone data-service functions + real API methods
// Prompt: "non-API methods on app should be standalone functions"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
// [Claude claude-4.7-opus] Task: migrate TaskDomains from createElement to JSX
// Prompt: "translate this project to render components with JSX instead"
export default function TaskDomains({ activeTaskDomain, app, domains, onDomainChange }) {
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    logIfEnabled('[TaskDomains] Refresh triggered');
    setRefreshing(true);
    try {
      const result = await refreshTaskDomains(app);
      logIfEnabled('[TaskDomains] Refresh result', result);
      if (result && onDomainChange) {
        onDomainChange(result.domains, result.activeTaskDomain);
      }
    } catch (err) {
      logIfEnabled('[TaskDomains] Refresh failed', err);
      throw err;
    } finally {
      setRefreshing(false);
    }
  };

  const handleSelect = async (domainUuid) => {
    if (domainUuid === activeTaskDomain) return;
    const result = await switchTaskDomain(app, domainUuid);
    if (result && onDomainChange) {
      onDomainChange(null, domainUuid, result);
    }
  };

  // [Claude] Task: show setup prompt when user has no task domains configured
  // Prompt: "update the Task Domain area to include a message 'Set up a task domain to use the dashboard'"
  // Date: 2026-03-21 | Model: claude-4.6-opus-high-thinking
  if (!domains || domains.length === 0) {
    return (
      <div className="task-domains task-domains--empty">
        <div className="task-domains-list">
          <div className="task-domain-item task-domain-entry active" title="No task domain found \u2014 showing tasks from all notes">
            <span className="task-domain-name">All Notes</span>
          </div>
        </div>
        <div className="task-domains-empty task-domain-entry">{`Task Domains in "Settings"`}</div>
        <button
          className="task-domains-refresh"
          onClick={handleRefresh}
          disabled={refreshing}
          type="button"
        >
          {refreshing ? 'Refreshing...' : '\u21BB Refresh'}
        </button>
      </div>
    );
  }

  return (
    <div className="task-domains">
      <div className="task-domains-list">
        {domains.map(domain => (
          <div
            key={domain.uuid}
            className={'task-domain-item' + (domain.uuid === activeTaskDomain ? ' active' : '')}
            onClick={() => handleSelect(domain.uuid)}
          >
            <span className="task-domain-name">{domain.name}</span>
          </div>
        ))}
      </div>
      <button
        className="task-domains-refresh"
        onClick={handleRefresh}
        disabled={refreshing}
      >
        {refreshing ? 'Refreshing...' : '\u21BB Refresh Task Domains'}
      </button>
    </div>
  );
}
