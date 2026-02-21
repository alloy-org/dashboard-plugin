/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Quick actions widget — grid of shortcut buttons
 * Prompt summary: "widget with a 2x2 grid of quick-action buttons (Daily Jot, Journal, etc.)"
 */
import { createElement } from "react";
import WidgetWrapper from './widget-wrapper';

// [Claude] Task: render 2x2 grid of quick-action shortcut buttons
// Prompt: "widget with a 2x2 grid of quick-action buttons (Daily Jot, Journal, etc.)"
// Date: 2026-02-17 | Model: claude-sonnet-4-5-20250929
export default function QuickActionsWidget() {
  const h = createElement;
  const actions = [
    { label: 'Daily Jot', icon: '📝', action: 'dailyJot' },
    { label: 'Journal', icon: '📓', action: 'journal' },
    { label: 'Add Person', icon: '👤', action: 'addPerson' },
    { label: 'Browse CRM', icon: '📇', action: 'browseCRM' }
  ];

  const handleAction = async (action) => {
    await callPlugin('quickAction', action);
  };

  return h(WidgetWrapper, { title: 'Quick Actions', icon: '⚡', widgetId: 'quick-actions' },
    h('div', { className: 'qa-grid' },
      actions.map(a => h('button', {
        key: a.action,
        className: 'qa-button',
        onClick: () => handleAction(a.action)
      },
        h('span', { className: 'qa-icon' }, a.icon),
        h('span', { className: 'qa-label' }, a.label)
      ))
    )
  );
}
