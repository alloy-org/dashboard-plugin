import fs from "fs";
import path from "path";

// Creates an esbuild plugin that resolves bare imports by checking the
// importer's directory first, then falling back to <libDir>/<path>.js.
// If neither exists, returns null so esbuild uses normal resolution (node_modules).
export function createLibImportsPlugin(libDir) {
  return {
    name: "absolute-imports",
    setup(build) {
      build.onResolve({ filter: /^[^.\/]/ }, (args) => {
        // Skip virtual modules
        if (args.path === "client-bundle" || args.path === "css-content") {
          return null;
        }

        const candidates = [];
        if (args.resolveDir) {
          candidates.push(path.join(args.resolveDir, args.path + ".js"));
        }
        candidates.push(path.join(libDir, args.path + ".js"));

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
