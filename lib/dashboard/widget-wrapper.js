import React from "react"

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
