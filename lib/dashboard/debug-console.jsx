import { useEffect, useRef, useState } from "react";
import { addLogListener, getLogBuffer, removeLogListener } from "util/log";
import WidgetWrapper from "widget-wrapper";

import "styles/debug-console.scss";

const WIDGET_ID = "debug-console";
// Cap each rendered message so a single oversized log (e.g. a large object dump) cannot dominate the
// scrollable console. 5 KB is enough for useful diagnostics without multi-page walls of text.
const MAX_MESSAGE_CHARS = 5 * 1024;

// ------------------------------------------------------------------------------------------
// @desc Format a log entry's args array into a readable string, truncating when the joined result
//   exceeds MAX_MESSAGE_CHARS so one dump cannot flood the Debug Console.
// @param {Array<*>} args - The logIfEnabled argument list stored on the buffer entry.
// @returns {string} A single display string, possibly truncated with a length marker.
// [Claude claude-sonnet-4-6] Task: format a log entry's args array into a readable string
// Prompt: "capture all logIfEnabled messages and show them in a scrollable DebugConsole widget"
function formatArgs(args) {
  const formatted = args.map(a => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return `${ a.name }: ${ a.message }`;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ');
  if (formatted.length <= MAX_MESSAGE_CHARS) return formatted;
  return `${ formatted.slice(0, MAX_MESSAGE_CHARS) }… [truncated, ${ formatted.length } chars]`;
}

// ------------------------------------------------------------------------------------------
// [Claude claude-sonnet-4-6] Task: render debug console widget that subscribes to logIfEnabled messages
// Prompt: "capture all logIfEnabled messages and show them in a scrollable DebugConsole widget"
// [Claude claude-4.7-opus] Task: migrate DebugConsoleWidget from createElement to JSX
// Prompt: "translate this project to render components with JSX instead"
export default function DebugConsoleWidget() {
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

  const clearButton = (
    <button
      className="debug-console__clear-button"
      type="button"
      onClick={handleClear}
      title="Clear log entries"
    >
      Clear
    </button>
  );

  return (
    <WidgetWrapper widgetId={WIDGET_ID} headerActions={clearButton}>
      <div className="debug-console" ref={scrollRef}>
        {entries.length === 0
          ? <div className="debug-console__empty">No log messages yet. Enable Console Logging in Settings to start capturing messages.</div>
          : entries.map(entry => (
              <div key={entry.id} className="debug-console__entry">
                <span className="debug-console__timestamp">
                  {new Date(entry.ts).toISOString().slice(11, 23)}
                </span>
                <span className="debug-console__message">{formatArgs(entry.args)}</span>
              </div>
            ))
        }
      </div>
    </WidgetWrapper>
  );
}
