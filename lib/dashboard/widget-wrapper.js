/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Reusable widget wrapper with header, icon, and optional configure button
 * Prompt summary: "shared widget chrome component used by all dashboard widgets"
 */
import React from "react"

// [Claude] Task: widget wrapper with header bar and optional configure action
// Prompt: "shared widget chrome component used by all dashboard widgets"
// Date: 2026-02-17 | Model: claude-sonnet-4-5-20250929
export default function WidgetWrapper({ title, icon, widgetId, configurable, children }) {
  const h = React.createElement;
  const handleConfigure = async () => {
    const result = await callPlugin('configure', widgetId);
    if (result) window.location.reload(); // Re-render with new config
  };
  return h('div', { className: 'widget widget-' + widgetId },
    h('div', { className: 'widget-header' },
      h('span', { className: 'widget-icon' }, icon),
      h('h3', { className: 'widget-title' }, title),
      configurable ? h('button', { className: 'widget-configure', onClick: handleConfigure }, '⚙ Configure') : null
    ),
    h('div', { className: 'widget-body' }, children)
  );
}
