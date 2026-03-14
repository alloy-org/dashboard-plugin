/**
 * [Claude-authored file]
 * Created: 2026-02-21 | Model: claude-opus-4-6
 * Task: Local dev server with esbuild watch + serve and SCSS compilation
 * Prompt summary: "dev server that bundles client-entry.js, compiles SCSS on rebuild, and serves on port 3000"
 */
import dotenv from "dotenv";
import esbuild from "esbuild";
import path from "path";
import fs from "fs";
import http from "http";
import * as sass from "sass";
import { fileURLToPath } from "url";
import { createLibImportsPlugin } from "../lib-imports-plugin.js";
import { readSettingsFile, writeSettingsFile, DEFAULT_SETTINGS_PATH, createDevApp } from "./dev-app.js";

dotenv.config();

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
      // sendSSE({ type: "reload" });
      console.trace("[reload] full reload sent");
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

// [Claude] Task: serve all sample tasks from dev-app as a REST endpoint, with optional from/to filtering
// Prompt: "consolidate mock-data.js and dev-app.js so dev-app is the single source of task truth"
// Date: 2026-03-01 | Model: claude-sonnet-4-6
function handleTasksApi(req, res) {
  if (req.method !== "GET") return false;
  const parsedUrl = new URL(req.url, "http://localhost");
  const from = parsedUrl.searchParams.get("from");
  const to = parsedUrl.searchParams.get("to");

  const app = createDevApp();
  app.getTaskDomainTasks(null).then(tasks => {
    let result = tasks;
    if (from != null && to != null) {
      const fromSec = Number(from);
      const toSec = Number(to);
      result = tasks.filter(t => t.completedAt != null && t.completedAt >= fromSec && t.completedAt < toSec);
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  }).catch(err => {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  });
  return true;
}

// [Claude] Task: serve mock mood ratings from dev-app as a REST endpoint
// Prompt: "DRY up mock mood ratings — single source in dev-app.js, mock-data.js fetches via /api/moods"
// Date: 2026-03-08 | Model: claude-4.6-opus-high-thinking
function handleMoodsApi(req, res) {
  if (req.method !== "GET") return false;
  const parsedUrl = new URL(req.url, "http://localhost");
  const from = parsedUrl.searchParams.get("from");

  const app = createDevApp();
  app.getMoodRatings(from ? Number(from) : null).then(moods => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(moods));
  }).catch(err => {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  });
  return true;
}

// [Claude] Task: handle image upload from data URL and save to local file for dev background image
// Prompt: "add background image upload option to DashboardSettings"
// Date: 2026-03-01 | Model: claude-4.6-opus-high-thinking
function handleAttachMediaApi(req, res) {
  if (req.method !== "POST") return false;

  let body = "";
  req.on("data", chunk => { body += chunk; });
  req.on("end", () => {
    try {
      const { dataURL } = JSON.parse(body);
      if (!dataURL || !dataURL.startsWith("data:image/")) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid data URL" }));
        return;
      }

      const matches = dataURL.match(/^data:image\/(\w+);base64,(.+)$/);
      if (!matches) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Could not parse data URL" }));
        return;
      }

      const ext = matches[1] === "jpeg" ? "jpg" : matches[1];
      const buffer = Buffer.from(matches[2], "base64");
      const filename = `background-image.${ext}`;
      const filePath = path.join(devDir, filename);
      fs.writeFileSync(filePath, buffer);
      console.log(`[attach-media] saved ${filename} (${buffer.length} bytes)`);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ url: `/${filename}` }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
  return true;
}

async function main() {
  const ctx = await esbuild.context({
    entryPoints: [path.join(rootDir, "lib/dashboard/client-entry.js")],
    bundle: true,
    format: "iife",
    outfile: path.join(devDir, "bundle.js"),
    define: {
      "process.env.NODE_ENV": '"development"',
      "process.env.OPEN_AI_ACCESS_TOKEN": JSON.stringify(process.env.OPEN_AI_ACCESS_TOKEN || ""),
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

    if (req.url === "/api/tasks" || req.url.startsWith("/api/tasks?")) {
      if (handleTasksApi(req, res)) return;
    }

    if (req.url === "/api/moods" || req.url.startsWith("/api/moods?")) {
      if (handleMoodsApi(req, res)) return;
    }

    if (req.url === "/api/attach-media") {
      if (handleAttachMediaApi(req, res)) return;
    }

    if (req.url.includes("background-image")) {
      console.log(`[proxy] serving background image request: ${req.method} ${req.url}`);
    }

    // [Claude] Task: add error handling to proxy requests to prevent server crash on connection failures
    // Prompt: "confirm that code to load a background image can not trigger multiple full-app reloads"
    // Date: 2026-03-01 | Model: claude-4.6-opus-high-thinking
    const proxyReq = http.request(
      { hostname: host, port: esbuildPort, path: req.url, method: req.method, headers: req.headers },
      (proxyRes) => {
        if (req.url.includes("background-image")) {
          console.log(`[proxy] background image response: ${proxyRes.statusCode} for ${req.url}`);
        }
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      }
    );
    proxyReq.on("error", (err) => {
      console.error(`[proxy] error proxying ${req.method} ${req.url} to esbuild:`, err.message);
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Proxy error", detail: err.message }));
      }
    });
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
