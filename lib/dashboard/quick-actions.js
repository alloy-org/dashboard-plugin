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
// Prompt: "fix amplenoteBlog and visitPlugin not opening new tab — open synchronously on click"
// Date: 2026-03-05 | Model: claude-4.6-sonnet-medium-thinking
export default function QuickActionsWidget() {
  const h = createElement;

  const NEW_WINDOW_URLS = {
    amplenoteBlog: "https://www.amplenote.com/blog",
    visitPlugin:   "https://www.amplenote.com/plugins/HXRa7ADW88bnyfA7hDwbXSLY"
  };

  const actions = [
    { label: 'Daily Jot', icon: '📝', action: 'dailyJot' },
    { label: 'Journal', icon: '📓', action: 'journal' },
    { label: 'Amplenote Blog', icon: '📰', action: 'amplenoteBlog' },
    { label: 'Dashboard Plugin', icon: '🧩', action: 'visitPlugin' }
  ];

  // Open new-window actions synchronously during the click event so browsers
  // treat it as a user-gesture and don't block the popup.
  const handleAction = async (action) => {
    if (NEW_WINDOW_URLS[action]) {
      window.open(NEW_WINDOW_URLS[action], "_blank");
      return;
    }
    await callPlugin('quickAction', action);
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
