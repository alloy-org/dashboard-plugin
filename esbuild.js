import dotenv from "dotenv"
import esbuild from "esbuild"
import path from "path"
import { fileURLToPath } from "url"

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Plugin to resolve react/react-dom imports to browser globals
const reactGlobalsPlugin = {
  name: 'react-globals',
  setup(build) {
    build.onResolve({ filter: /^react(-dom(\/client)?)?$/ }, args => ({
      path: args.path,
      namespace: 'react-global',
    }));
    build.onLoad({ filter: /.*/, namespace: 'react-global' }, args => {
      if (args.path === 'react') {
        return {
          contents: `var R = globalThis.React; export default R; export var createElement = R.createElement; export var useState = R.useState; export var useEffect = R.useEffect; export var useRef = R.useRef; export var useCallback = R.useCallback; export var useMemo = R.useMemo;`,
          loader: 'js',
        };
      }
      if (args.path === 'react-dom' || args.path === 'react-dom/client') {
        return {
          contents: `var RD = globalThis.ReactDOM; export default RD; export var createRoot = RD.createRoot;`,
          loader: 'js',
        };
      }
    });
  }
};

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
        args.path === 'client-bundle') {
        return null;
      }

      // Resolve from lib directory and add .js extension
      const libPath = path.join(__dirname, 'lib', args.path + '.js');
      return { path: libPath };
    });
  },
};

// Step 1: Bundle client-side dashboard code into a string
const clientBuild = await esbuild.build({
  entryPoints: [path.join(__dirname, 'lib/dashboard/client-entry.js')],
  bundle: true,
  format: 'iife',
  write: false,
  plugins: [reactGlobalsPlugin],
});
const clientCode = clientBuild.outputFiles[0].text;

// Plugin to provide the client bundle as a virtual module
const clientBundlePlugin = {
  name: 'client-bundle',
  setup(build) {
    build.onResolve({ filter: /^client-bundle$/ }, () => ({
      path: 'client-bundle',
      namespace: 'client-bundle',
    }));
    build.onLoad({ filter: /.*/, namespace: 'client-bundle' }, () => ({
      contents: `export const clientBundle = ${JSON.stringify(clientCode)};`,
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
  plugins: [clientBundlePlugin, absoluteImportsPlugin],
  write: true,
});
console.log("Result was", result)
