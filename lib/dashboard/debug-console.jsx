import DashboardQueueInspector from "dashboard/work-queue/dashboard-queue-inspector";
import { useDashboardWork } from "dashboard/work-queue/dashboard-work-context";
import { runDebugEvaluationSession } from "debug-evaluate-service";
import { useEffect, useRef, useState } from "react";
import { addLogListener, getLogBuffer, logAlways, removeLogListener } from "util/log";
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
// @desc Render the scrollable log viewer, following new entries as they arrive. The header's Debug button
//   opens an expression prompt evaluated by the plugin host, whose result lands in this same log. When admin tools
//   are available, a Queue button switches to the work queue inspector, which subscribes only while it is shown.
// @param {object} props - An object with the following properties:
//   - {boolean} adminToolsEnabled - Whether the admin tools policy allows the Queue inspector
//   - {object} app - Amplenote app bridge, needed only by the expression evaluator
export default function DebugConsoleWidget({ adminToolsEnabled, app }) {
  const [entries, setEntries] = useState(() => getLogBuffer());
  const [queueShown, setQueueShown] = useState(false);
  const scrollRef = useRef(null);
  const work = useDashboardWork();
  const queueInspectorShown = Boolean(adminToolsEnabled) && queueShown;

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
  }, [entries, queueInspectorShown]);

  const handleClear = () => setEntries([]);
  // The session is fire-and-forget: it owns its own dialogs, and a rejection (a host that refuses to prompt)
  // has nowhere to surface but the log.
  const handleDebug = () => {
    runDebugEvaluationSession(app).catch(error => logAlways('[debug-console] evaluation session failed:', error));
  };

  const logActions = (
    <>
      <button
        className="debug-console__header-button"
        type="button"
        onClick={handleDebug}
        title="Evaluate an expression in the plugin host"
      >
        Debug
      </button>
      <button
        className="debug-console__header-button"
        type="button"
        onClick={handleClear}
        title="Clear log entries"
      >
        Clear
      </button>
    </>
  );
  const headerActions = (
    <div className="debug-console__header-actions">
      {adminToolsEnabled ? (
        <button
          className="debug-console__header-button"
          type="button"
          aria-pressed={queueInspectorShown}
          onClick={() => setQueueShown(shown => !shown)}
          title={queueInspectorShown ? "Return to the log" : "Inspect the Dashboard work queue"}
        >
          {queueInspectorShown ? "Log" : "Queue"}
        </button>
      ) : null}
      {queueInspectorShown ? null : logActions}
    </div>
  );
  const logEntries = (
    <div className="debug-console" ref={scrollRef}>
      {entries.length === 0
        ? <div className="debug-console__empty">No log messages yet. Enable Console Logging in Settings to
            start capturing messages, or press Debug to evaluate an expression in the plugin host.</div>
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
  );

  return (
    <WidgetWrapper widgetId={WIDGET_ID} headerActions={headerActions}>
      {queueInspectorShown ? <DashboardQueueInspector work={work} /> : logEntries}
    </WidgetWrapper>
  );
}
