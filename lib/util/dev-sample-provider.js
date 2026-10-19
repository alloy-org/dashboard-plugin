// A sample AI provider for development only, so the Plan Builder can be opened and styled without an API key. The
// dev style guide (dev/styleguide) installs it on globalThis; production builds define NODE_ENV as "production",
// which makes this always return null, and esbuild drops the lookup.

// ----------------------------------------------------------------------------------------------
// @desc The installed development sample provider, or null outside a development build or when none is installed.
// @returns {Function|null} (prompt, llmOptions) => Promise of the parsed response the real provider would give.
export function devSampleProvider() {
  if (process.env.NODE_ENV !== "development") return null;
  return typeof globalThis.dashboardDevSampleProvider === "function" ? globalThis.dashboardDevSampleProvider : null;
}
