import dotenv from "dotenv"
import esbuild from "esbuild"
import path from "path"
import * as sass from "sass"
import { fileURLToPath } from "url"

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Step 0: Compile SCSS to CSS string
const scssResult = sass.compile(path.join(__dirname, 'lib/dashboard/styles/dashboard.scss'), {
  style: 'compressed',
});
const compiledCSS = scssResult.css;

// Plugin to resolve absolute imports from lib directory
const absoluteImportsPlugin = {
  name: 'absolute-imports',
  setup(build) {
    build.onResolve({ filter: /^[^.\/]/ }, args => {
      // Skip node_modules packages and virtual modules
      if (args.path.startsWith('dotenv') ||
        args.path.startsWith('esbuild') ||
        args.path.startsWith('isomorphic-fetch') ||
        args.path.startsWith('react') ||
        args.path === 'client-bundle' ||
        args.path === 'css-content') {
        return null;
      }

      // Resolve from lib directory and add .js extension
      const libPath = path.join(__dirname, 'lib', args.path + '.js');
      return { path: libPath };
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
