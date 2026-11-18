// Compile the locally copied host theme snapshots (Classic, and Plum for the style guide) for the development host API.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as sass from "sass";

const THEME_DIRECTORY = fileURLToPath(new URL("./themes/", import.meta.url));
// Host themes with a snapshot in dev/themes
export const DEV_THEME_NAMES = [ "classic", "plum" ];

// ------------------------------------------------------------------------------------------
// @desc Compile a classic light or dark theme into the CSS returned by the simulated host.
// @param {string} lightDarkMode - Explicit light or dark mode.
// @param {object} options - Optional Sass output style; the production build compresses the copy it bundles.
// @returns {string} Root-scoped custom properties, including resolved RGB values.
export function getClassicThemeStyles(lightDarkMode, { style = "expanded" } = {}) {
  return getThemeStyles("classic", lightDarkMode, { style });
}

// ------------------------------------------------------------------------------------------
// @desc Compile a host theme snapshot in light or dark mode into root-scoped custom properties.
// @param {string} themeName - One of DEV_THEME_NAMES.
// @param {string} lightDarkMode - Explicit light or dark mode.
// @param {object} options - Optional Sass output style.
// @returns {string} Root-scoped custom properties, including resolved RGB values.
export function getThemeStyles(themeName, lightDarkMode, { style = "expanded" } = {}) {
  if (!DEV_THEME_NAMES.includes(themeName)) throw new Error("Unsupported development theme");
  if (!["dark", "light"].includes(lightDarkMode)) throw new Error("Unsupported development theme mode");
  const palette = fs.readFileSync(path.join(THEME_DIRECTORY, "_classic-palette.scss"), "utf8");
  const theme = fs.readFileSync(path.join(THEME_DIRECTORY, `_theme-${ themeName }-${ lightDarkMode }.scss`), "utf8");
  const source = `@use "sass:color";
    @function derive-rgb-values-from-hex($hex) {
      @return color.channel($hex, "red", $space: rgb), color.channel($hex, "green", $space: rgb), color.channel($hex, "blue", $space: rgb);
    }
    ${ palette }
    ${ theme }
    :root { @include theme-${ themeName }-${ lightDarkMode }; }`;
  return sass.compileString(source, { silenceDeprecations: ["global-builtin"], style }).css;
}

// ------------------------------------------------------------------------------------------
// @desc Serve compiled local theme variables as CSS without accessing the source checkout at runtime.
// @param {object} request - Node HTTP request.
// @param {object} response - Node HTTP response.
// @returns {void}
export function handleDevThemeApi(request, response) {
  const searchParams = new URL(request.url, "http://localhost").searchParams;
  const mode = searchParams.get("mode") || "light";
  const themeName = searchParams.get("theme") || "classic";
  if (!["dark", "light"].includes(mode) || !DEV_THEME_NAMES.includes(themeName)) {
    response.writeHead(400, { "Content-Type": "text/plain" });
    response.end("Unsupported development theme mode");
    return;
  }
  try {
    const css = getThemeStyles(themeName, mode);
    response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": "text/css; charset=utf-8" });
    response.end(css);
  } catch (error) {
    console.error("Development theme compilation failed:", error);
    response.writeHead(500, { "Content-Type": "text/plain" });
    response.end("Development theme compilation failed");
  }
}
