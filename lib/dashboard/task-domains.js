/**
 * [Claude-authored file]
 * Created: 2026-02-21 | Model: claude-opus-4-6
 * Task: Task Domains component — domain selector with refresh and settings links
 * Prompt summary: "allow user to choose which Task Domain their dashboard focuses on"
 */
import { createElement, useState } from "react";

// [Claude] Task: render task domain list with selection, refresh, and settings link
// Prompt: "allow user to choose which Task Domain their dashboard focuses on"
// Date: 2026-02-21 | Model: claude-opus-4-6
export default function TaskDomains({ domains, activeTaskDomain, onDomainChange }) {
  const h = createElement;
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const result = await callPlugin('refreshTaskDomains');
      if (result && onDomainChange) {
        onDomainChange(result.domains, result.activeTaskDomain);
      }
    } finally {
      setRefreshing(false);
    }
  };

  const handleSelect = async (domainUuid) => {
    if (domainUuid === activeTaskDomain) return;
    const result = await callPlugin('setActiveTaskDomain', domainUuid);
    if (result && onDomainChange) {
      onDomainChange(null, domainUuid, result);
    }
  };

  const handleOpenDomainSettings = async (event) => {
    event.stopPropagation();
    await callPlugin('navigateToUrl', 'https://www.amplenote.com/notes?tag=task_calendar');
  };

  if (!domains || domains.length === 0) {
    return h('div', { className: 'task-domains' },
      h('span', { className: 'task-domains-empty' }, 'No task domains found.'),
      h('button', {
        className: 'task-domains-refresh',
        onClick: handleRefresh,
        disabled: refreshing
      }, refreshing ? 'Refreshing...' : 'Refresh')
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
