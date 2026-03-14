import fs from "fs";
import path from "path";

// [Claude] Task: resolve bare imports for both .js and non-.js files (e.g. .scss)
// Prompt: "update style imports to allow them to be imported absolutely, relative to lib"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
function buildCandidates(baseDir, importPath) {
  const ext = path.extname(importPath);
  const candidates = [];
  if (ext) {
    candidates.push(path.join(baseDir, importPath));
    if (ext === '.scss') {
      const dir = path.dirname(importPath);
      const base = path.basename(importPath);
      if (!base.startsWith('_')) {
        candidates.push(path.join(baseDir, dir, '_' + base));
      }
    }
  } else {
    candidates.push(path.join(baseDir, importPath + ".js"));
  }
  return candidates;
}

// Creates an esbuild plugin that resolves bare imports by checking the
// importer's directory first, then falling back to <libDir>/<path>.
// Handles .js (appended automatically for extensionless imports) and
// .scss (including SCSS partial _-prefix convention).
// If neither exists, returns null so esbuild uses normal resolution (node_modules).
export function createLibImportsPlugin(libDir) {
  return {
    name: "absolute-imports",
    setup(build) {
      build.onResolve({ filter: /^[^.\/]/ }, (args) => {
        if (args.path === "client-bundle" || args.path === "css-content") {
          return null;
        }

        const candidates = [];
        if (args.resolveDir) {
          candidates.push(...buildCandidates(args.resolveDir, args.path));
        }
        candidates.push(...buildCandidates(libDir, args.path));

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
}
