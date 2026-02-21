/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: AI & Plugins widget — list of plugin actions with badge counts
 * Prompt summary: "widget showing available AI plugin actions with pending item badges"
 */
import { createElement } from "react";
import WidgetWrapper from './widget-wrapper';

// [Claude] Task: render list of AI/plugin actions with badge counts
// Prompt: "widget showing available AI plugin actions with pending item badges"
// Date: 2026-02-17 | Model: claude-sonnet-4-5-20250929
export default function AIPluginsWidget({ taskCount, flashcardsDue }) {
  const h = createElement;
  const items = [
    { label: 'Propose Task Values', badge: taskCount || 0, icon: '🎯' },
    { label: 'Flashcard Review', badge: flashcardsDue || 0, icon: '🃏' }
  ];
  return h(WidgetWrapper, { title: 'AI & Plugins', icon: '🤖', widgetId: 'ai-plugins' },
    h('div', { className: 'aip-list' },
      items.map(item => h('div', { key: item.label, className: 'aip-item' },
        h('span', { className: 'aip-icon' }, item.icon),
        h('span', { className: 'aip-label' }, item.label),
        item.badge > 0 ? h('span', { className: 'aip-badge' }, item.badge) : null
      ))
    )
  );
}
