// Guard the shared controls (doc/design-system.md, rule 3): widgets, popups, and the Plan Builder build
// buttons, fields, spinners, and states from "dashboard/controls" instead of raw elements, and widget
// stylesheets never restyle the controls' dashboard-* classes. A raw element that truly cannot be a shared
// control goes in ALLOWED_RAW_CONTROLS with its reason; an entry that is no longer needed fails the test, so
// the list only shrinks.
import fs from "node:fs";
import path from "node:path";

const LIB_DIRECTORY = path.resolve("lib");
const CONTROLS_DIRECTORY = path.join(LIB_DIRECTORY, "dashboard", "controls");
const STYLES_DIRECTORY = path.join(LIB_DIRECTORY, "dashboard", "styles");
const CONTROL_STYLESHEET = "dashboard-controls.scss";
// Native inputs that stay native: tinted globally through accent-color, or a slider
const NATIVE_INPUT_TYPES = [ "checkbox", "radio", "range" ];
const RAW_CONTROL_TAGS = [ "button", "input", "select", "textarea" ];
// The control classes that only dashboard-controls.scss may style
const CONTROL_CLASS_PATTERN = new RegExp("\\.dashboard-(badge|button|empty-state|error-state|field"
  + "|icon-button|loading-state|plain-button|select|spinner|text-field|underline-tab)");

// Raw controls allowed outside lib/dashboard/controls/, keyed "relative/path.jsx" or
// "relative/path.jsx .class-name"
const ALLOWED_RAW_CONTROLS = {
  // The hour lines are a ruled-paper editor with per-line focus handling, not form fields
  "dashboard/day-sketch.jsx .day-sketch-input": "ruled-line editor",
  // Auto-growing textarea that measures its own scroll height
  "dashboard/plan-wizard/expanding-textarea.jsx": "auto-grow textarea",
  // Inputs drawn inside a selectable option row, styled as part of that row
  "dashboard/plan-wizard/done-enough-conditions.jsx .done-enough-custom-input": "inline option input",
  "dashboard/plan-wizard/quarter-name-step.jsx .quarter-name-custom-input": "inline option input",
  // HTML string for the host's footnote popup, rendered outside React
  "util/amplenote-markdown-render.js": "footnote popup HTML string",
};
// The only tooltip themes: hint and rich (tooltip-themes.js), and the host's footnote popup look
const TOOLTIP_THEMES = [ "dashboard-hint", "dashboard-rich", "rich-footnote" ];
// Rotation keyframes allowed outside the spinner, by name
const ALLOWED_SPIN_KEYFRAMES = [
  // The task-domain refresh icon turns while a refresh runs; it is the icon, not a loading indicator
  "task-domains-refresh-spin",
];

// ------------------------------------------------------------------------------------------
// @desc Each attribute string of a raw control tag in source code, skipping over `{ … }` expressions so
//   arrow functions inside attributes do not end the tag early.
// @param {string} source - File contents.
// @returns {Array<Object>} [{ attributes, tag }].
function rawControlTagsFromSource(source) {
  const tags = [];
  const openingPattern = new RegExp(`<(${ RAW_CONTROL_TAGS.join("|") })\\b`, "g");
  let match;
  while ((match = openingPattern.exec(source))) {
    let depth = 0;
    let index = match.index + match[0].length;
    for (; index < source.length; index++) {
      const character = source[index];
      if (character === "{") depth++;
      else if (character === "}") depth--;
      else if (character === ">" && depth === 0) break;
    }
    tags.push({ attributes: source.slice(match.index + match[0].length, index), tag: match[1] });
  }
  return tags;
}

// ------------------------------------------------------------------------------------------
// @desc A file's contents with comments removed, so documentation may mention raw elements.
// @param {string} file - Path.
// @returns {string} Code only.
function codeFromFile(file) {
  return fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

// ------------------------------------------------------------------------------------------
// @desc Every file under a directory, recursively.
// @param {string} directory - Directory to walk.
// @returns {Array<string>} Absolute file paths.
function filesUnder(directory) {
  return fs.readdirSync(directory, { recursive: true }).map(file => path.join(directory, file))
    .filter(file => fs.statSync(file).isFile());
}

// ------------------------------------------------------------------------------------------
// @desc The allowlist key for a raw control: the file, plus its first class name when it has one.
// @param {string} relativePath - Path relative to lib/.
// @param {string} attributes - The tag's attribute string.
// @returns {Array<string>} Candidate keys, most specific first.
function keysFromRawControl(relativePath, attributes) {
  const className = (attributes.match(/className=["{]\s*["'`]?([\w-]+)/) || [])[1];
  return className ? [ `${ relativePath } .${ className }`, relativePath ] : [ relativePath ];
}

const scriptFiles = filesUnder(LIB_DIRECTORY).filter(file => /\.jsx?$/.test(file))
  .filter(file => !file.startsWith(CONTROLS_DIRECTORY + path.sep));
const stylesheetFiles = filesUnder(STYLES_DIRECTORY).filter(file => file.endsWith(".scss"))
  .filter(file => path.basename(file) !== CONTROL_STYLESHEET);

describe("shared controls usage", () => {
  it("uses Button, IconButton, PlainButton, Select, and TextField instead of raw controls", () => {
    const usedAllowlistKeys = new Set();
    const offenders = scriptFiles.flatMap(file => {
      const relativePath = path.relative(LIB_DIRECTORY, file);
      return rawControlTagsFromSource(codeFromFile(file)).filter(({ attributes, tag }) => {
        const inputType = (attributes.match(/type=["'](\w+)["']/) || [])[1];
        if (tag === "input" && NATIVE_INPUT_TYPES.includes(inputType)) return false;
        const allowedKey = keysFromRawControl(relativePath, attributes)
          .find(key => key in ALLOWED_RAW_CONTROLS);
        if (allowedKey) usedAllowlistKeys.add(allowedKey);
        return !allowedKey;
      }).map(({ attributes, tag }) => (
        `${ relativePath }: <${ tag }${ attributes.slice(0, 60).replace(/\s+/g, " ") }`
      ));
    });
    expect(offenders).toEqual([]);
    expect(Object.keys(ALLOWED_RAW_CONTROLS).filter(key => !usedAllowlistKeys.has(key))).toEqual([]);
  });

  it("never fakes a button with a href=\"#\" link", () => {
    const offenders = scriptFiles.filter(file => /href=["'{]\s*["']?#["']/.test(codeFromFile(file)));
    expect(offenders.map(file => path.relative(LIB_DIRECTORY, file))).toEqual([]);
  });

  it("draws loading only with the shared spinner", () => {
    const offenders = stylesheetFiles.flatMap(file => {
      const code = codeFromFile(file);
      const spinnerClasses = code.match(/\.[\w-]*spinner[\w-]*/g) || [];
      const spinKeyframes = (code.match(/@keyframes\s+[\w-]*(spin|rotat)[\w-]*/g) || [])
        .filter(rule => !ALLOWED_SPIN_KEYFRAMES.includes(rule.replace(/@keyframes\s+/, "")));
      return [ ...spinnerClasses, ...spinKeyframes ].map(rule => `${ path.basename(file) }: ${ rule }`);
    });
    expect(offenders).toEqual([]);
  });

  it("never restyles a control's dashboard-* class outside dashboard-controls.scss", () => {
    const offenders = stylesheetFiles.flatMap(file => codeFromFile(file).split("\n")
      // Excluding a control class (`:not(.dashboard-field-label)`) is fine; styling it is not
      .map(line => line.replace(/:not\((?:[^()]|\([^()]*\))*\)/g, ""))
      .filter(line => CONTROL_CLASS_PATTERN.test(line))
      .map(line => `${ path.basename(file) }: ${ line.trim() }`));
    expect(offenders).toEqual([]);
  });

  it("uses only the hint and rich tooltip themes", () => {
    const scriptThemes = scriptFiles.flatMap(file => [ ...codeFromFile(file).matchAll(/theme:\s*["']([\w-]+)["']/g) ]
      .map(match => ({ file, theme: match[1] })));
    const stylesheetThemes = stylesheetFiles.flatMap(file => [ ...codeFromFile(file)
      .matchAll(/data-theme~=['"]([\w-]+)['"]/g) ].map(match => ({ file, theme: match[1] })));
    const offenders = [ ...scriptThemes, ...stylesheetThemes ].filter(({ theme }) => !TOOLTIP_THEMES.includes(theme))
      .map(({ file, theme }) => `${ path.relative(LIB_DIRECTORY, file) }: ${ theme }`);
    expect(offenders).toEqual([]);
  });
});
