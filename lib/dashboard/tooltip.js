/**
 * [Claude-authored file]
 * Created: 2026-02-22 | Model: claude-opus-4-6
 * Task: Reusable tooltip component positioned relative to a parent container
 * Prompt summary: "standalone tooltip component for hover popups across dashboard widgets"
 */
import { createElement } from "react";

// [Claude] Task: self-contained tooltip with direction-aware above/below positioning
// Prompt: "calculate whether more space above or below chart and pop tooltip on whichever side"
// Date: 2026-03-08 | Model: claude-sonnet-4-6
export default function DashboardTooltip({ left, visible, direction, children }) {
  if (!visible) return null;
  const h = createElement;
  const className = direction === 'below'
    ? 'dashboard-tooltip dashboard-tooltip--below'
    : 'dashboard-tooltip';

  return h('div', {
      className,
      style: { left: `${left}px` }
    },
    h('div', { className: 'dashboard-tooltip-arrow' }),
    h('div', { className: 'dashboard-tooltip-content' }, children)
  );
}
