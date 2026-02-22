/**
 * [Claude-authored file]
 * Created: 2026-02-21 | Model: claude-opus-4-6
 * Task: Local dev server with esbuild watch + serve and SCSS compilation
 * Prompt summary: "dev server that bundles client-entry.js, compiles SCSS on rebuild, and serves on port 3000"
 */
import esbuild from "esbuild";
import path from "path";
import fs from "fs";
import * as sass from "sass";
import { fileURLToPath } from "url";
import { createLibImportsPlugin } from "../lib-imports-plugin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const devDir = __dirname;

// Plugin: compile SCSS after each rebuild
const scssPlugin = {
  name: "scss-compile",
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) return;
      try {
        const scssResult = sass.compile(
          path.join(rootDir, "lib/dashboard/styles/dashboard.scss"),
          { style: "expanded" }
        );
        fs.writeFileSync(path.join(devDir, "styles.css"), scssResult.css);
        console.log("[scss] styles.css updated");
      } catch (err) {
        console.error("[scss] compilation error:", err.message);
      }
    });
  },
};

async function main() {
  const ctx = await esbuild.context({
    entryPoints: [path.join(rootDir, "lib/dashboard/client-entry.js")],
    bundle: true,
    format: "iife",
    outfile: path.join(devDir, "bundle.js"),
    define: {
      "process.env.NODE_ENV": '"development"',
    },
    target: ["chrome91", "firefox90", "safari15", "edge91"],
    sourcemap: true,
    plugins: [createLibImportsPlugin(path.join(rootDir, "lib")), scssPlugin],
  });

  await ctx.watch();
  console.log("[watch] watching for changes...");

  const { host, port } = await ctx.serve({
    servedir: devDir,
    port: 3000,
  });

  console.log(`[dev] server running at http://localhost:${port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
