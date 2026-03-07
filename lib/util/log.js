/**
 * [Claude-authored file]
 * Created: 2026-03-07 | Model: claude-4.6-opus-high-thinking
 * Task: Conditional console logging gated by a runtime-settable flag
 * Prompt summary: "create logIfEnabled utility so all console logging checks whether logging is enabled"
 */
import { useEffect, useRef } from "react";

let _enabled = false;

// [Claude] Task: toggle the module-level logging flag from settings
// Prompt: "create logIfEnabled utility so all console logging checks whether logging is enabled"
// Date: 2026-03-07 | Model: claude-4.6-opus-high-thinking
export function setLoggingEnabled(settingValue) {
  if (typeof settingValue === 'boolean') {
    _enabled = settingValue;
    return;
  }
  const normalized = String(settingValue || '').trim().toLowerCase();
  _enabled = ['true', 'yes', '1', 'on', 'enabled'].includes(normalized);
}

// [Claude] Task: conditionally log to console only when the Console Logging setting is enabled
// Prompt: "create logIfEnabled utility so all console logging checks whether logging is enabled"
// Date: 2026-03-07 | Model: claude-4.6-opus-high-thinking
export function logIfEnabled(...args) {
  if (_enabled) {
    console.log(...args);
  }
}

// [Claude] Task: DRY hook for widget load timing — logs "loading..." on first render, "finished loading in Xms" after paint
// Prompt: "DRY the identical timing boilerplate repeated in every memoized widget cell"
// Date: 2026-03-07 | Model: claude-4.6-opus-high-thinking
export function useWidgetLoadTiming(widgetId) {
  const renderStart = useRef(null);
  if (renderStart.current === null) {
    renderStart.current = performance.now();
    logIfEnabled(`[dashboard] Widget "${widgetId}" loading...`);
  }
  useEffect(() => {
    if (renderStart.current !== null) {
      logIfEnabled(`[dashboard] Widget "${widgetId}" finished loading in ${(performance.now() - renderStart.current).toFixed(1)}ms`);
      renderStart.current = null;
    }
  }, []);
}
