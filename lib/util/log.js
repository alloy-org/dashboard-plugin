/**
 * [Claude-authored file]
 * Created: 2026-03-07 | Model: claude-4.6-opus-high-thinking
 * Task: Conditional console logging gated by a runtime-settable flag
 * Prompt summary: "create logIfEnabled utility so all console logging checks whether logging is enabled"
 */

let _enabled = false;
let _entryId = 0;

const MAX_LOG_BUFFER = 200;
const _logBuffer = [];
const _listeners = new Set();

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
    const entry = { id: ++_entryId, ts: Date.now(), args };
    _logBuffer.push(entry);
    if (_logBuffer.length > MAX_LOG_BUFFER) _logBuffer.shift();
    // Defer so listeners (e.g. DebugConsoleWidget setState) don't fire during another component's render
    setTimeout(() => _listeners.forEach(fn => fn(entry)), 0);
  }
}

// [Claude claude-sonnet-4-6] Task: expose log buffer and subscription API for DebugConsole widget
// Prompt: "capture all logIfEnabled messages and show them in a scrollable DebugConsole widget"

// @desc Returns a snapshot of all buffered log entries (up to MAX_LOG_BUFFER most recent).
// @returns {Array<{id: number, ts: number, args: any[]}>}
export function getLogBuffer() {
  return [..._logBuffer];
}

// @desc Registers a listener called with each new log entry as it is emitted.
// @param {function({id: number, ts: number, args: any[]}): void} fn
export function addLogListener(fn) {
  _listeners.add(fn);
}

// @desc Removes a previously registered log listener.
// @param {function} fn
export function removeLogListener(fn) {
  _listeners.delete(fn);
}
