// Verify the copied classic theme palettes compile into CSS for the simulated development host.
import { jest } from "@jest/globals";
import { createBrowserDevApp } from "util/browser-dev-app";
import { execFileSync } from "node:child_process";

// ------------------------------------------------------------------------------------------
// @desc Run the Sass-backed endpoint in Node, avoiding Jest's incompatible resolution of Sass browser exports.
// @param {string} expression - Script that prints a JSON result.
// @returns {*} Parsed result.
function runThemeScript(expression) {
  const script = `import { getClassicThemeStyles, handleDevThemeApi } from "./dev/dev-theme-api.js"; ${ expression }`;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" }));
}

// ------------------------------------------------------------------------------------------
// @desc Check resolved classic colors and RGB tuples in both development palettes.
// @returns {void}
test("classic snapshots compile into resolved host variables", () => {
  const { dark, light } = runThemeScript('console.log(JSON.stringify({ dark: getClassicThemeStyles("dark"), light: getClassicThemeStyles("light") }));');
  expect(light).toContain("--color-background-primary: #fff;");
  expect(light).toContain("--color-background-primary-rgb: 255, 255, 255;");
  expect(dark).toContain("--color-background-primary: #192025;");
  expect(dark).toContain("--color-background-primary-rgb: 25, 32, 37;");
  expect(light).toContain("--color-background-action-high-contrast: #3e92cc;");
  expect(dark).toContain("--color-text-high-contrast: #f9fbfc;");
  expect(light).toContain("--color-background-code: rgba(180, 191, 204, 0.32);");
  expect(dark).not.toMatch(/derive-rgb|\$ample|#\{/);
  expect(light.match(/--[\w-]+:/g)).toHaveLength(dark.match(/--[\w-]+:/g).length);
});

// ------------------------------------------------------------------------------------------
// @desc Reject unsupported modes before any filename is constructed from input.
// @returns {void}
test("theme endpoint rejects unsupported modes", () => {
  const result = runThemeScript(`
    let status;
    let errorMessage;
    handleDevThemeApi({ url: "/api/theme-styles?mode=../invalid" }, { end() {}, writeHead(value) { status = value; } });
    try { getClassicThemeStyles("invalid"); } catch (error) { errorMessage = error.message; }
    console.log(JSON.stringify({ errorMessage, status }));
  `);
  expect(result.status).toBe(400);
  expect(result.errorMessage).toBe("Unsupported development theme mode");
});

// ------------------------------------------------------------------------------------------
// @desc Expose the selected classic palette through getStyles and the host-compatible bridge methods.
// @returns {Promise<void>}
test("development app selects the current browser mode for its theme API", async () => {
  const previousFetch = globalThis.fetch;
  const previousMatchMedia = window.matchMedia;
  window.matchMedia = () => ({ matches: true });
  globalThis.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => ":root { --color-background-primary: #192025; }" });
  try {
    const app = createBrowserDevApp();
    const theme = await app.getDashboardTheme();
    expect(theme.lightDarkMode).toBe("dark");
    expect(theme.styleProperties).toContain("#192025");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/theme-styles?mode=dark");
    await app.context.getStyleProperties();
    await app.getStyles("light");
    expect(globalThis.fetch).toHaveBeenLastCalledWith("/api/theme-styles?mode=light");
  } finally {
    globalThis.fetch = previousFetch;
    window.matchMedia = previousMatchMedia;
  }
});
