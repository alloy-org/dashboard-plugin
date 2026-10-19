// Guard the design rules in doc/design-system.md that a stylesheet or component can break by accident: emoji and
// Unicode glyphs as UI, font weights above 500, corner radii and shadows outside the tokens, and icons from anywhere
// but react-icons/md. Content (mood faces, text written into notes, debug output) is listed with its reason.
import fs from "node:fs";
import path from "node:path";

const LIB_DIRECTORY = path.resolve("lib");
const STYLES_DIRECTORY = path.join(LIB_DIRECTORY, "dashboard", "styles");
// Emoji, pictographs, dingbats (✓ ✕), arrows (← →), and misc technical symbols (⚙ ⏱)
const GLYPH_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
// An import of another react-icons set or another icon library
const FOREIGN_ICON_IMPORT_PATTERN = new RegExp("from\\s+[\"']((?:react-icons\\/(?!md[\"'])[^\"']*)"
  + "|[^\"']*(?:material-icons|fontawesome|lucide|heroicons)[^\"']*)[\"']", "g");
const MAXIMUM_FONT_WEIGHT = 500;
// Files whose glyphs are content rather than UI, with the reason
const FILES_WITH_CONTENT_GLYPHS = {
  // The mood faces are what the user picks and sees recorded
  "dashboard/mood.jsx": "mood faces",
  // Debug console output for developers
  "dashboard/debug-evaluate-service.js": "debug output",
  // Text written into the user's notes, in the note's own markup
  "dashboard/suggestions/calendar-generation-report.js": "note text (the Debug Console's calendar pass report)",
  "dashboard/projects/completed-task-project-ledger.js": "note text",
  "plan-wizard/quarterly-plan-markdown.js": "note markup (the month focus star)",
};
// The browser dev harness mocks the host, and roboto-font.scss is font data
const SKIPPED_FILES = [ "util/browser-dev-app.js" ];

// ------------------------------------------------------------------------------------------
// @desc A file's code with comments and log statements removed, so prose and diagnostics may use any character.
// @param {string} file - Path.
// @returns {string} Code only.
function codeFromFile(file) {
  return fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
    .split("\n").filter(line => !/\b(logIfEnabled|console\.\w+)\(/.test(line)).join("\n");
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
// @desc Each declaration of a property in a stylesheet, as "file: value".
// @param {string} property - CSS property name.
// @returns {Array<Object>} [{ file, value }].
function declarationsOf(property) {
  const pattern = new RegExp(`(?:^|[\\s;{])${ property }\\s*:\\s*([^;]+);`, "g");
  return stylesheetFiles.flatMap(file => [ ...codeFromFile(file).matchAll(pattern) ]
    .map(match => ({ file: path.basename(file), value: match[1].trim() })));
}

const scriptFiles = filesUnder(LIB_DIRECTORY).filter(file => /\.jsx?$/.test(file))
  .filter(file => !SKIPPED_FILES.includes(path.relative(LIB_DIRECTORY, file)));
const stylesheetFiles = filesUnder(STYLES_DIRECTORY).filter(file => file.endsWith(".scss"))
  .filter(file => path.basename(file) !== "roboto-font.scss");

describe("design rules", () => {
  it("draws no emoji or Unicode glyphs as UI; icons come from react-icons/md", () => {
    const offenders = scriptFiles.filter(file => !(path.relative(LIB_DIRECTORY, file) in FILES_WITH_CONTENT_GLYPHS))
      .flatMap(file => codeFromFile(file).split("\n").filter(line => GLYPH_PATTERN.test(line))
        .map(line => `${ path.relative(LIB_DIRECTORY, file) }: ${ line.trim().slice(0, 80) }`));
    expect(offenders).toEqual([]);
  });

  it("imports icons only from react-icons/md", () => {
    const offenders = scriptFiles.flatMap(file => [ ...codeFromFile(file).matchAll(FOREIGN_ICON_IMPORT_PATTERN) ]
      .map(match => `${ path.relative(LIB_DIRECTORY, file) }: ${ match[1] }`));
    expect(offenders).toEqual([]);
  });

  it(`keeps font weights at ${ MAXIMUM_FONT_WEIGHT } or below`, () => {
    const offenders = declarationsOf("font-weight")
      .filter(({ value }) => value === "bold" || value === "bolder" || Number(value) > MAXIMUM_FONT_WEIGHT);
    expect(offenders.map(({ file, value }) => `${ file }: ${ value }`)).toEqual([]);
  });

  it("rounds corners only with the radius tokens", () => {
    const offenders = declarationsOf("border-radius").filter(({ value }) => value.split(/\s+/)
      .some(part => !/^(0|50%|inherit|\$radius-[\w-]+)$/.test(part)));
    expect(offenders.map(({ file, value }) => `${ file }: ${ value }`)).toEqual([]);
  });

  it("casts shadows only with the elevation tokens; an inset line may mark a selection", () => {
    const offenders = declarationsOf("box-shadow").filter(({ file, value }) => file !== "theme-tokens.scss"
      && !/^(none|\$shadow-elevation-\d+|inset\s.*)$/.test(value));
    expect(offenders.map(({ file, value }) => `${ file }: ${ value }`)).toEqual([]);
  });
});
