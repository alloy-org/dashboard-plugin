/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Reusable widget wrapper with header, icon, and optional configure button
 * Prompt summary: "shared widget chrome component used by all dashboard widgets"
 */
import React from "react"

/**
 * [Claude] Task: add full JSDoc parameter documentation to WidgetWrapper
 * Prompt: "Update WidgetWrapper with full JSDoc for each of its parameters"
 * Date: 2026-02-21 | Model: claude-sonnet-4-6
 *
 * Shared chrome component rendered around every dashboard widget. Provides a
 * consistent header bar (icon + title + optional configure button) and a body
 * region for widget-specific content.
 *
 * @param {object}      props
 * @param {string}      props.title        - Human-readable label displayed in the widget header.
 * @param {string}      props.icon         - Icon character or short string rendered before the title (e.g. an emoji).
 * @param {string}      props.widgetId     - Unique identifier for this widget instance; used as a CSS modifier
 *                                           class (`widget-<widgetId>`) and passed to the `configure` plugin call.
 * @param {boolean}     props.configurable - When `true`, a "Configure" button is shown in the header that invokes
 *                                           the plugin's `configure` action and reloads the page on success.
 * @param {React.ReactNode} props.children - Widget body content rendered inside the `.widget-body` container.
 * @returns {React.ReactElement} The composed widget element.
 */
// [Claude] Task: add onConfigure callback prop to support inline popup configuration
// Prompt: "popup component that pops up setting options upon clicking Configure"
// Date: 2026-02-22 | Model: claude-opus-4-6
export default function WidgetWrapper({ title, icon, widgetId, configurable, onConfigure, headerActions, children }) {
  const h = React.createElement;
  const handleConfigure = async () => {
    if (onConfigure) {
      onConfigure();
    } else {
      const result = await callPlugin('configure', widgetId);
      if (result) window.location.reload();
    }
  };
  return h('div', { className: 'widget widget-' + widgetId },
    h('div', { className: 'widget-header' },
      h('span', { className: 'widget-icon' }, icon),
      h('h3', { className: 'widget-title' }, title),
      headerActions || null,
      configurable ? h('button', { className: 'widget-configure', onClick: handleConfigure }, '⚙ Configure') : null
    ),
    h('div', { className: 'widget-body' }, children)
  );
}
