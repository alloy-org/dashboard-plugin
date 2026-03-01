/**
 * [Claude-authored file]
 * Created: 2026-02-21 | Model: claude-opus-4-6
 * Task: Local dev server with esbuild watch + serve and SCSS compilation
 * Prompt summary: "dev server that bundles client-entry.js, compiles SCSS on rebuild, and serves on port 3000"
 */
import esbuild from "esbuild";
import path from "path";
import fs from "fs";
import http from "http";
import * as sass from "sass";
import { fileURLToPath } from "url";
import { createLibImportsPlugin } from "../lib-imports-plugin.js";
import { readSettingsFile, writeSettingsFile, DEFAULT_SETTINGS_PATH } from "./dev-app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const devDir = __dirname;

// ---------- SSE live-reload infrastructure ----------

// [Claude] Task: add SSE-based live reload for the dev server
// Prompt: "set up the dev version of the project to use hot reloading"
// Date: 2026-03-01 | Model: claude-opus-4-6
const sseClients = new Set();

function sendSSE(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

function compileSCSS() {
  try {
    const scssResult = sass.compile(
      path.join(rootDir, "lib/dashboard/styles/dashboard.scss"),
      { style: "expanded" }
    );
    fs.writeFileSync(path.join(devDir, "styles.css"), scssResult.css);
    console.log("[scss] styles.css updated");
    return true;
  } catch (err) {
    console.error("[scss] compilation error:", err.message);
    return false;
  }
}

// Plugin: compile SCSS after each rebuild
const scssPlugin = {
  name: "scss-compile",
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) return;
      compileSCSS();
    });
  },
};

// Plugin: notify connected browsers after a successful rebuild
const liveReloadPlugin = {
  name: "live-reload",
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) return;
      sendSSE({ type: "reload" });
      console.log("[reload] full reload sent");
    });
  },
};

// [Claude] Task: add settings API endpoints so browser-side mock can persist state
// Prompt: "dev mode should persist settings to a JSON file"
// Date: 2026-03-01 | Model: claude-opus-4-6
function handleSettingsApi(req, res) {
  if (req.method === "GET") {
    const settings = readSettingsFile();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(settings));
    return true;
  }

  if (req.method === "POST") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const { key, value } = JSON.parse(body);
        const settings = readSettingsFile();
        settings[key] = value;
        writeSettingsFile(settings);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return true;
  }

  return false;
}

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
    plugins: [createLibImportsPlugin(path.join(rootDir, "lib")), scssPlugin, liveReloadPlugin],
  });

  await ctx.watch();
  console.log("[watch] watching for changes...");

  const { host, port: esbuildPort } = await ctx.serve({
    servedir: devDir,
    port: 3001,
  });

  // Watch SCSS files for CSS-only hot reload (changes that don't trigger esbuild)
  const stylesDir = path.join(rootDir, "lib/dashboard/styles");
  let scssDebounce = null;
  fs.watch(stylesDir, { recursive: true }, (_eventType, filename) => {
    if (!filename?.endsWith(".scss")) return;
    clearTimeout(scssDebounce);
    scssDebounce = setTimeout(() => {
      console.log(`[scss] ${filename} changed`);
      if (compileSCSS()) {
        sendSSE({ type: "css" });
        console.log("[reload] css-only reload sent");
      }
    }, 100);
  });

  const proxyServer = http.createServer((req, res) => {
    // SSE endpoint for live reload
    if (req.url === "/esbuild-live-reload") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(":\n\n"); // SSE comment as keep-alive
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }

    if (req.url === "/api/settings") {
      if (handleSettingsApi(req, res)) return;
    }

    const proxyReq = http.request(
      { hostname: host, port: esbuildPort, path: req.url, method: req.method, headers: req.headers },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      }
    );
    req.pipe(proxyReq, { end: true });
  });

  proxyServer.listen(3000, () => {
    console.log("[dev] server running at http://localhost:3000");
    console.log("[reload] live reload enabled");
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
