// Verify host theme loading, error handling, safe embedding, and live refresh.
import { jest } from "@jest/globals";
import { buildEmbedHTML } from "embed-html";
import { installHostThemeRefresh } from "dashboard/host-theme";
import plugin from "plugin";

// ------------------------------------------------------------------------------------------
// @desc Verify host CSS is present before the client payload and app mode overrides system preferences.
// @returns {Promise<void>}
test("renderEmbed installs host colors and explicit mode before the client", async () => {
  const styleProperties = ":root { --color-text-high-contrast: #123456; }";
  const context = { getStyleProperties: jest.fn().mockResolvedValue(styleProperties), lightDarkMode: "light" };
  const html = await plugin.renderEmbed({ context });
  expect(context.getStyleProperties).toHaveBeenCalledTimes(1);
  expect(html).toContain('data-theme="light"');
  expect(html).toContain(styleProperties);
  expect(html.indexOf('id="dashboard-host-theme"')).toBeLessThan(html.indexOf('id="dashboard-script-payload"'));
});

// ------------------------------------------------------------------------------------------
// @desc Route theme API failures through the existing render and bridge error handlers.
// @returns {Promise<void>}
test("theme retrieval failures use the existing plugin error handlers", async () => {
  const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    const context = { getStyleProperties: jest.fn().mockRejectedValue(new Error("unavailable")), lightDarkMode: "dark" };
    expect(await plugin.renderEmbed({ context })).toContain("Dashboard failed to load: unavailable");
    const result = await plugin.onEmbedCall({ context }, "getDashboardTheme");
    expect(result.embedCallFailed).toBe(true);
    expect(result.error).toBe("unavailable");
  } finally { errorLog.mockRestore(); }
});

// ------------------------------------------------------------------------------------------
// @desc Prevent supplied CSS and invalid mode values from injecting HTML into the embed document.
// @returns {void}
test("host CSS cannot close its style element", () => {
  const html = buildEmbedHTML({ lightDarkMode: '\" onclick=\"bad', styleProperties: '</style><script id="injected">bad()</script>' });
  const parsedDocument = new DOMParser().parseFromString(html, "text/html");
  expect(parsedDocument.querySelector("#injected")).toBeNull();
  expect(parsedDocument.documentElement.hasAttribute("data-theme")).toBe(false);
});

// ------------------------------------------------------------------------------------------
// @desc Refresh colors without duplicate requests or redraws, and stop applying responses after disposal.
// @returns {Promise<void>}
test("focus refresh replaces CSS and notifies charts only when the theme changes", async () => {
  document.head.innerHTML = '<style id="dashboard-host-theme">old</style>';
  document.documentElement.dataset.theme = "light";
  const app = { getDashboardTheme: jest.fn().mockResolvedValue({ lightDarkMode: "dark", styleProperties: ":root { --color-text-high-contrast: white; }" }) };
  const changed = jest.fn();
  window.addEventListener("dashboard-theme-change", changed);
  const dispose = installHostThemeRefresh(app);
  try {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("focus"));
    await Promise.resolve();
    expect(app.getDashboardTheme).toHaveBeenCalledTimes(1);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.getElementById("dashboard-host-theme").textContent).toContain("white");
    expect(changed).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("focus"));
    await Promise.resolve();
    expect(changed).toHaveBeenCalledTimes(1);
    dispose();
    window.dispatchEvent(new Event("focus"));
    expect(app.getDashboardTheme).toHaveBeenCalledTimes(2);
  } finally {
    dispose();
    window.removeEventListener("dashboard-theme-change", changed);
    delete document.documentElement.dataset.theme;
  }
});

// ------------------------------------------------------------------------------------------
// @desc Ignore a refresh that finishes after its listeners have been disposed.
// @returns {Promise<void>}
test("a disposed refresh cannot apply a late host response", async () => {
  document.head.innerHTML = '<style id="dashboard-host-theme">previous</style>';
  let completeRequest;
  const response = new Promise(resolve => { completeRequest = resolve; });
  const dispose = installHostThemeRefresh({ getDashboardTheme: () => response });
  window.dispatchEvent(new Event("focus"));
  dispose();
  completeRequest({ lightDarkMode: "dark", styleProperties: "replacement" });
  await Promise.resolve();
  expect(document.getElementById("dashboard-host-theme").textContent).toBe("previous");
});

// ------------------------------------------------------------------------------------------
// @desc Load the development palette immediately and subscribe to browser preference changes.
// @returns {Promise<void>}
test("development refresh creates its stylesheet and follows browser mode changes", async () => {
  document.head.innerHTML = "";
  let theme = { lightDarkMode: "light", styleProperties: ":root { --color-background-primary: white; }" };
  let notifyPreferenceChange;
  const previousMatchMedia = window.matchMedia;
  const removeListener = jest.fn();
  window.matchMedia = () => ({ addEventListener(_event, listener) { notifyPreferenceChange = listener; }, removeEventListener: removeListener });
  const dispose = installHostThemeRefresh({ getDashboardTheme: async () => theme }, { refreshImmediately: true, watchSystemTheme: true });
  try {
    await Promise.resolve();
    expect(document.getElementById("dashboard-host-theme").textContent).toContain("white");
    theme = { lightDarkMode: "dark", styleProperties: ":root { --color-background-primary: black; }" };
    notifyPreferenceChange();
    await Promise.resolve();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.getElementById("dashboard-host-theme").textContent).toContain("black");
  } finally {
    dispose();
    window.matchMedia = previousMatchMedia;
    delete document.documentElement.dataset.theme;
  }
  expect(removeListener).toHaveBeenCalled();
});
