/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Quick actions widget — grid of shortcut buttons
 * Prompt summary: "widget with a 2x2 grid of quick-action buttons (Daily Jot, Journal, etc.)"
 */
import { widgetTitleFromId } from "constants/settings";
import { createElement } from "react";
import WidgetWrapper from "widget-wrapper";

// [Claude] Task: render 2x2 grid of quick-action shortcut buttons
// Prompt: "replace Amplenote Blog with Calendar (app.navigate) and Dashboard Plugin with Random Note (task-domain note picker)"
// Date: 2026-03-07 | Model: claude-4.6-sonnet-medium-thinking
export default function QuickActionsWidget({ app }) {
  const h = createElement;

  const actions = [
    { label: 'Daily Jot',    icon: '📝', action: 'dailyJot' },
    { label: 'Journal',      icon: '📓', action: 'journal' },
    { label: 'Calendar',     icon: '📅', action: 'calendar' },
    { label: 'Random Note',  icon: '🎲', action: 'randomNote' }
  ];

  const handleAction = async (action) => {
    if (action === 'calendar') {
      await app.navigateToUrl('https://www.amplenote.com/notes/calendar');
      return;
    }
    if (action === 'randomNote') {
      await app.randomNote();
      return;
    }
    await app.quickAction(action);
  };

  return h(WidgetWrapper, { title: widgetTitleFromId('quick-actions'), icon: '⚡', widgetId: 'quick-actions' },
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
