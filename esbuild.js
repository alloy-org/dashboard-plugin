/**
 * [Claude-authored file]
 * Created: 2026-02-20 | Model: claude-sonnet-4-5-20250929
 * Task: Production build script — SCSS + client bundle + plugin bundle
 * Prompt summary: "esbuild config that compiles SCSS, bundles React client as base64, and produces compiled.js"
 */
import dotenv from "dotenv"
import esbuild from "esbuild"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { assertHostPluginBoundary } from "./host-plugin-boundary.js"
import { createLibImportsPlugin } from "./lib-imports-plugin.js"
import { assertInlineScriptSafe } from "./inline-script-safety.js"
import { createScssPlugin } from "./scss-plugin.js"

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const absoluteImportsPlugin = createLibImportsPlugin(path.join(__dirname, 'lib'));
const scssPlugin = createScssPlugin({ style: "compressed" });

// ------------------------------------------------------------------------------------------
// @desc The local date this build ran, as YYYY-MM-DD. Baked into the bundle so a loaded dashboard can report
//   which compile it came from — the compiled.js is pasted into a note by hand, so the only way to tell a stale
//   paste from a current one is to have the build stamp itself.
// @returns {string} The build date in YYYY-MM-DD form
function buildDateString() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${ now.getFullYear() }-${ month }-${ day }`;
}

// ------------------------------------------------------------------------------------------
// @desc Build-time defines shared by the client IIFE and the plugin bundle (embed HTML reads
//   SENTRY_DSN when assembling the optional CDN loader).
// @returns {Object<string, string>} esbuild define map
function productionDefines() {
  return {
    "process.env.BUILD_DATE": JSON.stringify(buildDateString()),
    "process.env.NODE_ENV": '"production"',
    "process.env.SENTRY_DSN": JSON.stringify(process.env.SENTRY_DSN || ""),
  };
}

// [Claude] Task: bundle client JS + CSS in one esbuild pass; widgets import their own SCSS
// Prompt: "refactor so widgets load their own scss instead of dashboard.scss importing everything"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
const clientBuild = await esbuild.build({
  entryPoints: [path.join(__dirname, 'lib/dashboard/dashboard-load.jsx')],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  outdir: path.join(__dirname, 'build/client'),
  define: productionDefines(),
  target: ["chrome91", "firefox90", "safari15", "edge91"],
  jsx: 'automatic',
  jsxImportSource: 'react',
  loader: { '.jsx': 'jsx' },
  plugins: [absoluteImportsPlugin, scssPlugin],
});
const jsOutput = clientBuild.outputFiles.find(f => f.path.endsWith('.js'));
const cssOutput = clientBuild.outputFiles.find(f => f.path.endsWith('.css'));
const compiledCSS = cssOutput ? cssOutput.text : "";

// The bundle goes into the embed document as an inline <script>, so its bytes are read by the HTML tokenizer. Verify
// it holds no sequence the tokenizer would treat as markup before it can reach a user's note.
assertInlineScriptSafe(jsOutput.text);
const clientScript = jsOutput.text;

// Plugin to provide the client bundle as a virtual module
const clientBundlePlugin = {
  name: 'client-bundle',
  setup(build) {
    build.onResolve({ filter: /^client-bundle$/ }, () => ({
      path: 'client-bundle',
      namespace: 'client-bundle',
    }));
    build.onLoad({ filter: /.*/, namespace: 'client-bundle' }, () => ({
      contents: `export const clientScript = ${JSON.stringify(clientScript)};`,
      loader: 'js',
    }));
  }
};

// Plugin to provide compiled CSS as a virtual module
const cssContentPlugin = {
  name: 'css-content',
  setup(build) {
    build.onResolve({ filter: /^css-content$/ }, () => ({
      path: 'css-content',
      namespace: 'css-content',
    }));
    build.onLoad({ filter: /.*/, namespace: 'css-content' }, () => ({
      contents: `export const compiledCSS = ${JSON.stringify(compiledCSS)};`,
      loader: 'js',
    }));
  }
};

// Name esbuild assigns the bundle to via globalName. Any identifier works; it only has to survive minification,
// which a globalName does and esbuild's own internal names do not.
const PLUGIN_GLOBAL_NAME = "dashboardPlugin";

// ------------------------------------------------------------------------------------------
// @desc Wrap esbuild's `var dashboardPlugin = (() => { ... })();` output in an outer closure that returns the
//   plugin object, so the artifact is a single expression evaluating to the plugin — the shape Amplenote expects
//   from the note's code block.
// @param {string} bundledCode - esbuild IIFE output, which assigns the module namespace to PLUGIN_GLOBAL_NAME.
// @returns {string} A self-contained expression evaluating to the plugin object
// Earlier builds instead rewrote esbuild's own `var plugin_default = plugin;` line into a `return`. That worked only
// while the bundle was unminified: minification renames plugin_default, the rewrite silently fails to match, and the
// artifact evaluates to undefined. Going through globalName is stable because esbuild never renames it.
function wrapAsPluginExpression(bundledCode) {
  return `(() => {\n${ bundledCode }\nreturn ${ PLUGIN_GLOBAL_NAME }.default;\n})()\n`;
}

// Step 2: Bundle the plugin (with client code injected via virtual module)
//
// The host plugin is minified because the whole bundle is pasted into the plugin note's code block, and that code
// block is parsed and held in memory by every Amplenote client that opens the note — including mobile, where the
// dashboard already fights iOS Jetsam kills (see lib/dashboard/crash-breadcrumb.js). keepNames is on so the saving
// does not cost readable host stack traces: the host has no Sentry (that is embed-side only), so a console trace is
// the only diagnostic available when a host action fails on a user's device.
const result = await esbuild.build({
  entryPoints: [`lib/plugin.js`],
  bundle: true,
  format: "iife",
  globalName: PLUGIN_GLOBAL_NAME,
  keepNames: true,
  minify: true,
  outfile: "build/compiled.js",
  metafile: true,
  packages: "external",
  platform: "browser",
  define: productionDefines(),
  jsx: 'automatic',
  jsxImportSource: 'react',
  loader: { '.jsx': 'jsx' },
  plugins: [clientBundlePlugin, cssContentPlugin, absoluteImportsPlugin],
  write: false,
});

// ------------------------------------------------------------------------------------------
// @desc Validate the full host dependency graph before writing the production artifact.
// [OpenAI GPT-6] Reject hooks and components even when tree shaking removes their client-only code.
assertHostPluginBoundary(result.metafile);

const code = wrapAsPluginExpression(result.outputFiles[0].text);
fs.writeFileSync("build/compiled.js", code);
console.log(`Built build/compiled.js (${ Math.round(code.length / 1024) } KB)`)
