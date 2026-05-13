import { widgetTitleFromId } from "constants/settings";
import { createElement, useEffect, useRef, useState } from "react";
import { addLogListener, getLogBuffer, removeLogListener } from "util/log";
import WidgetWrapper from "widget-wrapper";

import "styles/debug-console.scss";

const WIDGET_ID = "debug-console";

// ------------------------------------------------------------------------------------------
// [Claude claude-sonnet-4-6] Task: format a log entry's args array into a readable string
// Prompt: "capture all logIfEnabled messages and show them in a scrollable DebugConsole widget"
function formatArgs(args) {
  return args.map(a => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return `${a.name}: ${a.message}`;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ');
}

// ------------------------------------------------------------------------------------------
// [Claude claude-sonnet-4-6] Task: render debug console widget that subscribes to logIfEnabled messages
// Prompt: "capture all logIfEnabled messages and show them in a scrollable DebugConsole widget"
export default function DebugConsoleWidget() {
  const h = createElement;
  const [entries, setEntries] = useState(() => getLogBuffer());
  const scrollRef = useRef(null);

  useEffect(() => {
    function onEntry(entry) {
      setEntries(prev => {
        const next = [...prev, entry];
        return next.length > 200 ? next.slice(-200) : next;
      });
    }
    addLogListener(onEntry);
    return () => removeLogListener(onEntry);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  const handleClear = () => setEntries([]);

  return h(WidgetWrapper, {
    title: widgetTitleFromId(WIDGET_ID),
    widgetId: WIDGET_ID,
    headerActions: h('button', {
      className: 'debug-console__clear-button',
      type: 'button',
      onClick: handleClear,
      title: 'Clear log entries',
    }, 'Clear'),
  },
    h('div', { className: 'debug-console', ref: scrollRef },
      entries.length === 0
      ? h('div', { className: 'debug-console__empty' }, 'No log messages yet. Enable Console Logging in Settings to start capturing messages.')
      : entries.map(entry =>
          h('div', { key: entry.id, className: 'debug-console__entry' },
            h('span', { className: 'debug-console__timestamp' },
              new Date(entry.ts).toISOString().slice(11, 23)
            ),
            h('span', { className: 'debug-console__message' }, formatArgs(entry.args))
          )
        )
    )
  );
}
