import esbuild from "esbuild";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Plugin to resolve absolute imports from project root and lib directory
const absoluteImportPlugin = {
  name: "absolute-import",
  setup(build) {
    // Resolve imports that aren't relative (don't start with . or /) and aren't node_modules
    build.onResolve({ filter: /^[^./]/ }, (args) => {
      // Skip if it's a node package or external dependency
      if (args.path === 'react' || args.path === 'react-dom') {
        return null; // Let esbuild handle externals
      }

      // Try resolving from lib directory first, then project root
      const tryPaths = [
        path.resolve(__dirname, 'lib', args.path),
        path.resolve(__dirname, 'lib', `${args.path}.js`),
        path.resolve(__dirname, 'lib', args.path, 'index.js'),
        path.resolve(__dirname, args.path),
        path.resolve(__dirname, `${args.path}.js`),
        path.resolve(__dirname, args.path, 'index.js')
      ];

      // Check which path exists
      for (const tryPath of tryPaths) {
        if (existsSync(tryPath)) {
          return { path: tryPath };
        }
      }

      // If nothing found, return null to let esbuild handle it
      return null;
    });
  }
};

esbuild.build({
  entryPoints: ["lib/plugin.js"],
  bundle: true,
  format: "iife",
  outfile: "build/compiled.js",
  platform: "browser",
  target: ["es2020"],
  minify: false,       // Keep readable for debugging
  sourcemap: false,
  define: {
    "process.env.NODE_ENV": '"production"'
  },
  plugins: [absoluteImportPlugin],
  // Mark React as external since it's loaded via CDN in the embed HTML
  external: ["react", "react-dom"],
  // Handle different file types
  loader: {
    '.css': 'text',
    '.scss': 'text',
    '.html': 'text'
  }
}).then(() => {
  console.log("Build complete: build/compiled.js");
}).catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
