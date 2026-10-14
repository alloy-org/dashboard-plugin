/**
 * [Claude-authored file]
 * Created: 2026-02-21 | Model: claude-opus-4-6
 * Task: Task Domains component — domain selector with refresh and settings links
 * Prompt summary: "allow user to choose which Task Domain their dashboard focuses on"
 */
import MaterialIcon from "material-icon";
import { useState } from "react";
import { refreshTaskDomains, switchTaskDomain } from "task-domain-service";
import { logIfEnabled } from "util/log";
import "styles/task-domains.scss"

// ----------------------------------------------------------------------------------------------
// @desc Refresh control shared by the populated and empty domain bars: an icon button whose label lives in its
//   tooltip and aria-label, spinning while a refresh is in flight.
// @param {boolean} refreshing - True while a refresh request is in flight
// [Claude claude-opus-5] Task: extract the refresh button so mobile can show it as an icon
// Prompt: "an icon to refresh task domains (the least promiment/used of the three)"
// Date: 2026-08-07 | Model: claude-opus-5
function RefreshDomainsButton({ onRefresh, refreshing }) {
  const label = refreshing ? 'Refreshing task domains...' : 'Refresh task domains';
  return (
    <button
      aria-label={label}
      className={ `task-domains-refresh${ refreshing ? ' task-domains-refresh--refreshing' : '' }` }
      disabled={refreshing}
      onClick={onRefresh}
      title={label}
      type="button"
    >
      <MaterialIcon className="task-domains-refresh-icon" name="refresh" size={ 20 } />
    </button>
  );
}

// [Claude] Task: use standalone data-service functions + real API methods
// Prompt: "non-API methods on app should be standalone functions"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
// [Claude claude-4.7-opus] Task: migrate TaskDomains from createElement to JSX
// Prompt: "translate this project to render components with JSX instead"
export default function TaskDomains({ activeTaskDomain, app, domains, onDomainChange }) {
  const [expanded, setExpanded] = useState(false);
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
    setExpanded(false);
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
        <RefreshDomainsButton onRefresh={handleRefresh} refreshing={refreshing} />
      </div>
    );
  }

  // On mobile only one pill stays visible while collapsed: the selected domain, or the first domain when the
  // active uuid does not match anything we were handed (so the bar is never left empty).
  const activeDomain = domains.find(domain => domain.uuid === activeTaskDomain);
  const mobileVisibleUuid = (activeDomain || domains[0]).uuid;
  const containerClassName = 'task-domains' + (expanded ? ' task-domains--expanded' : '');

  return (
    <div className={containerClassName}>
      <div className="task-domains-list">
        {domains.map(domain => {
          const itemClassName = 'task-domain-item' + (domain.uuid === activeTaskDomain ? ' active' : '')
            + (domain.uuid === mobileVisibleUuid ? ' task-domain-item--mobile-visible' : '');
          return (
            <div key={domain.uuid} className={itemClassName} onClick={() => handleSelect(domain.uuid)}>
              <span className="task-domain-name">{domain.name}</span>
            </div>
          );
        })}
      </div>
      {domains.length > 1 ? (
        <button
          aria-expanded={expanded}
          aria-label={expanded ? 'Hide other task domains' : 'Show other task domains'}
          className="task-domains-expand"
          onClick={() => setExpanded(!expanded)}
          title={expanded ? 'Hide other task domains' : 'Show other task domains'}
          type="button"
        >
          <MaterialIcon name={ expanded ? 'expand_less' : 'expand_more' } size={ 20 } />
        </button>
      ) : null}
      <RefreshDomainsButton onRefresh={handleRefresh} refreshing={refreshing} />
    </div>
  );
}
