/**
 * [Claude-authored file]
 * Created: 2026-02-20 | Model: claude-sonnet-4-5-20250929
 * Task: Production build script — SCSS + client bundle + plugin bundle
 * Prompt summary: "esbuild config that compiles SCSS, bundles React client as base64, and produces compiled.js"
 */
import dotenv from "dotenv"
import esbuild from "esbuild"
import path from "path"
import * as sass from "sass"
import fs from "fs"
import { fileURLToPath } from "url"

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Step 0: Compile SCSS to CSS string
const scssResult = sass.compile(path.join(__dirname, 'lib/dashboard/styles/dashboard.scss'), {
  style: 'compressed',
});
const compiledCSS = scssResult.css;

// Plugin to resolve bare imports by searching the importer's directory first, then lib/
const absoluteImportsPlugin = {
  name: 'absolute-imports',
  setup(build) {
    build.onResolve({ filter: /^[^.\/]/ }, args => {
      // Skip virtual modules
      if (args.path === 'client-bundle' || args.path === 'css-content') {
        return null;
      }

      // Try the importer's directory first, then lib/ root; skip if neither exists
      const candidates = [];
      if (args.resolveDir) {
        candidates.push(path.join(args.resolveDir, args.path + '.js'));
      }
      candidates.push(path.join(__dirname, 'lib', args.path + '.js'));

      for (const candidate of candidates) {
        try {
          fs.accessSync(candidate);
          return { path: candidate };
        } catch {}
      }
      return null;
    });
  },
};

// Step 1: Bundle client-side dashboard code (with React included)
const clientBuild = await esbuild.build({
  entryPoints: [path.join(__dirname, 'lib/dashboard/client-entry.js')],
  bundle: true,
  format: 'iife',
  write: false,
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  target: ["chrome91", "firefox90", "safari15", "edge91"],
  plugins: [absoluteImportsPlugin],
});
const clientBase64 = Buffer.from(clientBuild.outputFiles[0].text).toString("base64");

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
  // minify: true,
  outfile: "build/compiled.js",
  packages: "external",
  platform: "node",
  plugins: [clientBundlePlugin, cssContentPlugin, absoluteImportsPlugin],
  write: true,
});
console.log("Result was", result)
