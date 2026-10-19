// Guard the dashboard's color tokens: stylesheets use only the host-named tokens in styles/theme-tokens.scss, never the
// removed legacy names, never a host --color-* variable directly, and never a raw color outside the theme files and a
// short list of fixed colors that have no host equivalent.
import fs from "node:fs";
import path from "node:path";

const LIB_DIRECTORY = path.resolve("lib");
const STYLES_DIRECTORY = path.join(LIB_DIRECTORY, "dashboard", "styles");
// Files that define tokens, where raw colors and host --color-* variables belong
const THEME_FILES = [ "data-colors.scss", "theme-dark.scss", "theme-light.scss", "theme-tokens.scss" ];

// SCSS color names replaced by host-named tokens; see the color section of styles/theme-tokens.scss
const REMOVED_SCSS_TOKENS = [ "accent", "action-low", "background-accent", "bg-card", "bg-element", "bg-element-medium",
  "bg-hover", "bg-page", "bg-page-hover", "bg-popup", "bg-primary", "bg-secondary", "bg-warning", "blue", "blue-light",
  "border", "danger", "header-bg", "header-text", "info", "link", "navy", "overlay-backdrop", "success", "text",
  "text-lower", "text-muted", "text-on-accent", "text-on-accent-muted", "text-secondary", "tooltip-accent", "tooltip-bg",
  "tooltip-border", "tooltip-shadow", "tooltip-text", "tooltip-text-muted", "victory-value-0", "victory-value-1",
  "victory-value-2", "victory-value-3", "victory-value-4", "warning" ];

// Scripts allowed to hold color literals: the browser dev harness, which mocks the host's theme
const SCRIPT_FILES_WITH_COLORS = [ "util/browser-dev-app.js" ];

// Raw colors allowed outside the theme files, each a fixed color with no host equivalent, by file
const ALLOWED_RAW_COLORS = {
  // Darkening the action color on hover, as MDC does
  "calendar.scss": [ "#000000" ],
  "controls.scss": [ "#000000" ],
  // The banner's fade mask, where only the alpha matters, as in ample-web's note banner
  "dashboard-banner-image.scss": [ "rgb(0 0 0 / 100%)" ],
  // Hover fill on the dialog title bar, which is dark in every theme
  "config-popup.scss": [ "rgba(255, 255, 255, 0.08)" ],
  // The quarterly plan video frame and the play button drawn over its thumbnail
  "quarterly-plan-entry.scss": [ "#152033", "rgba(0, 0, 0, 0.85)", "rgba(0, 0, 0, 0.65)", "#ffffff",
    "rgba(255, 255, 255, 0.6)" ],
  // Quote text drawn over photos
  "quotes.scss": [ "rgba(0, 0, 0, 0.5)", "rgba(0, 0, 0, 0.6)", "#fff", "rgba(255, 255, 255, 0.85)" ],
  // The inlined Roboto font has no colors, but its base64 data can contain color-like text
  "roboto-font.scss": null,
};

// ------------------------------------------------------------------------------------------
// @desc Every file under a directory, recursively.
// @param {string} directory - Directory to walk.
// @returns {Array<string>} Absolute file paths.
function filesUnder(directory) {
  return fs.readdirSync(directory, { recursive: true }).map(file => path.join(directory, file))
    .filter(file => fs.statSync(file).isFile());
}

// ------------------------------------------------------------------------------------------
// @desc A file's contents with comments removed, so documentation may mention old names and raw colors.
// @param {string} file - Path.
// @returns {string} Code only.
function codeFromFile(file) {
  const source = fs.readFileSync(file, "utf8");
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const stylesheetFiles = filesUnder(STYLES_DIRECTORY).filter(file => file.endsWith(".scss"));
const componentStylesheetFiles = stylesheetFiles.filter(file => !THEME_FILES.includes(path.basename(file)));
const scriptFiles = filesUnder(LIB_DIRECTORY).filter(file => /\.jsx?$/.test(file));

describe("dashboard color tokens", () => {
  it("never uses a removed SCSS color name", () => {
    const pattern = new RegExp(`\\$color-(${ REMOVED_SCSS_TOKENS.join("|") })(?![\\w-])`, "g");
    const offenders = componentStylesheetFiles.flatMap(file => (codeFromFile(file).match(pattern) || [])
      .map(match => `${ path.basename(file) }: ${ match }`));
    expect(offenders).toEqual([]);
  });

  it("reads host colors only through tokens, never a host --color-* variable directly", () => {
    const offenders = [ ...componentStylesheetFiles, ...scriptFiles ].filter(file => /var\(--color-/.test(codeFromFile(file)));
    expect(offenders.map(file => path.relative(LIB_DIRECTORY, file))).toEqual([]);
  });

  it("refers to dashboard color variables only by their current names", () => {
    const currentNames = new Set([ "data-colors.scss", "theme-light.scss" ].flatMap(file => codeFromFile(path
      .join(STYLES_DIRECTORY, file)).match(/--dashboard-[\w-]+(?=:)/g)));
    const references = [ ...componentStylesheetFiles, ...scriptFiles ].flatMap(file => (codeFromFile(file)
      .match(/--dashboard-(?:color|victory-value-color)-[\w-]*[\w]/g) || []).map(name => ({ file, name })));
    // Template strings build some names from a prefix, e.g. `--dashboard-color-category-${ slot }`
    const unknownNames = references.filter(({ name }) => !currentNames.has(name)
      && ![ ...currentNames ].some(currentName => currentName.startsWith(`${ name }-`)));
    expect(unknownNames.map(({ file, name }) => `${ path.relative(LIB_DIRECTORY, file) }: ${ name }`)).toEqual([]);
  });

  it("keeps raw colors in the theme files, apart from the listed fixed colors", () => {
    const colorPattern = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;
    const offenders = componentStylesheetFiles.flatMap(file => {
      const allowed = ALLOWED_RAW_COLORS[path.basename(file)];
      if (allowed === null) return [];
      const colors = codeFromFile(file).match(colorPattern) || [];
      return colors.filter(color => !(allowed || []).includes(color)).map(color => `${ path.basename(file) }: ${ color }`);
    });
    expect(offenders).toEqual([]);
  });

  it("keeps color literals out of scripts; data colors are named in data-colors.scss", () => {
    const colorPattern = /["'`]#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/;
    const offenders = scriptFiles.filter(file => !SCRIPT_FILES_WITH_COLORS.includes(path.relative(LIB_DIRECTORY, file)))
      .filter(file => colorPattern.test(codeFromFile(file)));
    expect(offenders.map(file => path.relative(LIB_DIRECTORY, file))).toEqual([]);
  });
});
