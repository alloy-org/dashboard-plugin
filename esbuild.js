/**
 * [Claude-authored file]
 * Created: 2026-02-20 | Model: claude-sonnet-4-5-20250929
 * Task: Production build script — SCSS + client bundle + plugin bundle
 * Prompt summary: "esbuild config that compiles SCSS, bundles React client as base64, and produces compiled.js"
 */
import dotenv from "dotenv"
import esbuild from "esbuild"
import path from "path"
import { fileURLToPath } from "url"
import { createLibImportsPlugin } from "./lib-imports-plugin.js"
import { createScssPlugin } from "./scss-plugin.js"

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const absoluteImportsPlugin = createLibImportsPlugin(path.join(__dirname, 'lib'));
const scssPlugin = createScssPlugin({ style: "compressed" });

// [Claude] Task: bundle client JS + CSS in one esbuild pass; widgets import their own SCSS
// Prompt: "refactor so widgets load their own scss instead of dashboard.scss importing everything"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
const clientBuild = await esbuild.build({
  entryPoints: [path.join(__dirname, 'lib/dashboard/client-entry.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  outdir: path.join(__dirname, 'build/client'),
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  target: ["chrome91", "firefox90", "safari15", "edge91"],
  plugins: [absoluteImportsPlugin, scssPlugin],
});
const jsOutput = clientBuild.outputFiles.find(f => f.path.endsWith('.js'));
const cssOutput = clientBuild.outputFiles.find(f => f.path.endsWith('.css'));
const clientBase64 = Buffer.from(jsOutput.text).toString("base64");
const compiledCSS = cssOutput ? cssOutput.text : "";

// Plugin to provide the client bundle as a virtual module
const clientBundlePlugin = {
  name: 'client-bundle',
  setup(build) {
    build.onResolve({ filter: /^client-bundle$/ }, () => ({
      path: 'client-bundle',
      namespace: 'client-bundle',
    }));
    build.onLoad({ filter: /.*/, namespace: 'client-bundle' }, () => ({
      contents: `export const clientBase64 = ${JSON.stringify(clientBase64)};`,
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

// Step 2: Bundle the plugin (with client code injected via virtual module)
const result = await esbuild.build({
  entryPoints: [`lib/plugin.js`],
  bundle: true,
  format: "iife",
  minify: true,
  outfile: "build/compiled.js",
  packages: "external",
  platform: "browser",
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  plugins: [clientBundlePlugin, cssContentPlugin, absoluteImportsPlugin],
  write: true,
});
console.log("Result was", result)
