/**
 * [Claude-authored file]
 * Created: 2026-02-21 | Model: claude-opus-4-6
 * Task: Task Domains component — domain selector with refresh and settings links
 * Prompt summary: "allow user to choose which Task Domain their dashboard focuses on"
 */
import { createElement, useState } from "react";
import { refreshTaskDomains, switchTaskDomain } from "data-service";
import "styles/task-domains.scss"

// [Claude] Task: use standalone data-service functions + real API methods
// Prompt: "non-API methods on app should be standalone functions"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
export default function TaskDomains({ activeTaskDomain, app, domains, onDomainChange }) {
  const h = createElement;
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const result = await refreshTaskDomains(app);
      if (result && onDomainChange) {
        onDomainChange(result.domains, result.activeTaskDomain);
      }
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

  const handleOpenDomainSettings = async (event) => {
    event.stopPropagation();
    await app.navigate('https://www.amplenote.com/notes?tag=task_calendar');
  };

  // [Claude] Task: show setup prompt when user has no task domains configured
  // Prompt: "update the Task Domain area to include a message 'Set up a task domain to use the dashboard'"
  // Date: 2026-03-21 | Model: claude-4.6-opus-high-thinking
  if (!domains || domains.length === 0) {
    return h('div', { className: 'task-domains task-domains--empty' },
      h('div', { className: 'task-domains-empty' }, `Visit "Settings" > "Task Calendar" to create a task domain, enabling Dashboard.`),
      h('button', {
        className: 'task-domains-refresh',
        onClick: handleRefresh,
        disabled: refreshing,
        type: 'button',
      }, refreshing ? 'Refreshing...' : '\u21BB Refresh')
    );
  }

  return h('div', { className: 'task-domains' },
    h('div', { className: 'task-domains-list' },
      domains.map(domain =>
        h('div', {
          key: domain.uuid,
          className: 'task-domain-item' + (domain.uuid === activeTaskDomain ? ' active' : ''),
          onClick: () => handleSelect(domain.uuid)
        },
          h('span', { className: 'task-domain-name' }, domain.name),
        )
      )
    ),
    h('button', {
      className: 'task-domains-refresh',
      onClick: handleRefresh,
      disabled: refreshing
    }, refreshing ? 'Refreshing...' : '\u21BB Refresh Task Domains')
  );
}
