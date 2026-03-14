/**
 * [Claude-authored file]
 * Created: 2026-03-14 | Model: claude-4.6-opus-high-thinking
 * Task: Shared esbuild plugin that compiles .scss imports to CSS
 * Prompt summary: "refactor so widgets load their own scss instead of dashboard.scss importing everything"
 */
import path from "path";
import * as sass from "sass";

// [Claude] Task: esbuild plugin to compile .scss imports inline during bundling
// Prompt: "refactor so widgets load their own scss instead of dashboard.scss importing everything"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
export function createScssPlugin(options = {}) {
  const style = options.style || "compressed";

  return {
    name: "scss",
    setup(build) {
      build.onLoad({ filter: /\.scss$/ }, (args) => {
        const result = sass.compile(args.path, {
          style,
          loadPaths: [path.dirname(args.path)],
        });

        const watchFiles = result.loadedUrls
          .filter((url) => url.protocol === "file:")
          .map((url) => url.pathname);

        return {
          contents: result.css,
          loader: "css",
          watchFiles,
        };
      });
    },
  };
}
