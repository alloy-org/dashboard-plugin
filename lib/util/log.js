/**
 * [Claude-authored file]
 * Created: 2026-03-07 | Model: claude-4.6-opus-high-thinking
 * Task: Conditional console logging gated by a runtime-settable flag
 * Prompt summary: "create logIfEnabled utility so all console logging checks whether logging is enabled"
 */

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
