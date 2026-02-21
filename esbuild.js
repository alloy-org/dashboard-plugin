import esbuild from "esbuild";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Plugin to resolve absolute imports from root
const absoluteImportPlugin = {
  name: "absolute-import",
  setup(build) {
    build.onResolve({ filter: /^lib\// }, (args) => {
      return {
        path: path.resolve(__dirname, args.path)
      };
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
