// Compile the locally copied classic theme snapshots for the development host API.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as sass from "sass";

const THEME_DIRECTORY = fileURLToPath(new URL("./themes/", import.meta.url));

// ------------------------------------------------------------------------------------------
// @desc Compile a classic light or dark theme into the CSS returned by the simulated host.
// @param {string} lightDarkMode - Explicit light or dark mode.
// @returns {string} Root-scoped custom properties, including resolved RGB values.
export function getClassicThemeStyles(lightDarkMode) {
  if (!["dark", "light"].includes(lightDarkMode)) throw new Error("Unsupported development theme mode");
  const palette = fs.readFileSync(path.join(THEME_DIRECTORY, "_classic-palette.scss"), "utf8");
  const theme = fs.readFileSync(path.join(THEME_DIRECTORY, `_theme-classic-${ lightDarkMode }.scss`), "utf8");
  const source = `@use "sass:color";
    @function derive-rgb-values-from-hex($hex) {
      @return color.channel($hex, "red", $space: rgb), color.channel($hex, "green", $space: rgb), color.channel($hex, "blue", $space: rgb);
    }
    ${ palette }
    ${ theme }
    :root { @include theme-classic-${ lightDarkMode }; }`;
  return sass.compileString(source, { silenceDeprecations: ["global-builtin"], style: "expanded" }).css;
}

// ------------------------------------------------------------------------------------------
// @desc Serve compiled local theme variables as CSS without accessing the source checkout at runtime.
// @param {object} request - Node HTTP request.
// @param {object} response - Node HTTP response.
// @returns {void}
export function handleDevThemeApi(request, response) {
  const mode = new URL(request.url, "http://localhost").searchParams.get("mode") || "light";
  if (!["dark", "light"].includes(mode)) {
    response.writeHead(400, { "Content-Type": "text/plain" });
    response.end("Unsupported development theme mode");
    return;
  }
  try {
    const css = getClassicThemeStyles(mode);
    response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": "text/css; charset=utf-8" });
    response.end(css);
  } catch (error) {
    console.error("Development theme compilation failed:", error);
    response.writeHead(500, { "Content-Type": "text/plain" });
    response.end("Development theme compilation failed");
  }
}
