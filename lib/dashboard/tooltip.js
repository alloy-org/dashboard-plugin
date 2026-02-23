/**
 * [Claude-authored file]
 * Created: 2026-02-22 | Model: claude-opus-4-6
 * Task: Reusable tooltip component positioned relative to a parent container
 * Prompt summary: "standalone tooltip component for hover popups across dashboard widgets"
 */
import { createElement } from "react";

// [Claude] Task: self-contained tooltip with header, section, row, and empty content slots
// Prompt: "make DashboardTooltip fully self-contained with all styling included"
// Date: 2026-02-22 | Model: claude-opus-4-6
export default function DashboardTooltip({ left, visible, children }) {
  if (!visible) return null;
  const h = createElement;

  return h('div', {
      className: 'dashboard-tooltip',
      style: { left: `${left}px` }
    },
    h('div', { className: 'dashboard-tooltip-arrow' }),
    h('div', { className: 'dashboard-tooltip-content' }, children)
  );
}
