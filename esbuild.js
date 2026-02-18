const esbuild = require("esbuild");

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
  // The inline: loader is not needed here because widget files
  // export string constants that esbuild bundles normally.
  // If using .html template files, add: loader: { '.html': 'text' }
}).then(() => {
  console.log("Build complete: build/compiled.js");
}).catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
