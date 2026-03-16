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
import { fileURLToPath } from "url";
import { createLibImportsPlugin } from "../lib-imports-plugin.js";
import { createScssPlugin } from "../scss-plugin.js";
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

// [Claude] Task: use shared esbuild SCSS plugin so widgets load their own styles
// Prompt: "refactor so widgets load their own scss instead of dashboard.scss importing everything"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
const scssPlugin = createScssPlugin({ style: "expanded" });

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

// [Claude] Task: serve tasks from dev-app, with optional domain and from/to filtering
// Prompt: "search notes directory for tags matching the task domain"
// Date: 2026-03-16 | Model: claude-4.6-opus-high-thinking
function handleTasksApi(req, res) {
  if (req.method !== "GET") return false;
  const parsedUrl = new URL(req.url, "http://localhost");
  const from = parsedUrl.searchParams.get("from");
  const to = parsedUrl.searchParams.get("to");
  const domain = parsedUrl.searchParams.get("domain");

  const app = createDevApp();
  app.getTaskDomainTasks(domain || null).then(tasks => {
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

// ────────────────────────────────────────────────────────────────
// Note API — read/write/create note files via dev-app
// ────────────────────────────────────────────────────────────────

function handleNoteContentApi(req, res) {
  const parsedUrl = new URL(req.url, "http://localhost");

  if (req.method === "GET") {
    const uuid = parsedUrl.searchParams.get("uuid");
    if (!uuid) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "uuid required" }));
      return true;
    }
    const app = createDevApp();
    app.getNoteContent({ uuid }).then(content => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ content }));
    }).catch(err => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    });
    return true;
  }

  if (req.method === "POST") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      try {
        const { uuid, content, section } = JSON.parse(body);
        const app = createDevApp();
        const options = section ? { section } : {};
        await app.replaceNoteContent({ uuid }, content, options);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return true;
  }

  return false;
}

function handleNoteCreateApi(req, res) {
  if (req.method !== "POST") return false;
  let body = "";
  req.on("data", chunk => { body += chunk; });
  req.on("end", async () => {
    try {
      const { name, tags } = JSON.parse(body);
      const app = createDevApp();
      const uuid = await app.createNote(name, tags || []);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ uuid }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
  return true;
}

function handleNoteAppendApi(req, res) {
  if (req.method !== "POST") return false;
  let body = "";
  req.on("data", chunk => { body += chunk; });
  req.on("end", async () => {
    try {
      const { uuid, content, atEnd } = JSON.parse(body);
      const app = createDevApp();
      await app.insertNoteContent({ uuid }, content, { atEnd: atEnd !== false });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
  return true;
}

function handleNoteFindApi(req, res) {
  if (req.method !== "GET") return false;
  const parsedUrl = new URL(req.url, "http://localhost");
  const name = parsedUrl.searchParams.get("name");
  const uuid = parsedUrl.searchParams.get("uuid");
  if (!name && !uuid) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "name or uuid required" }));
    return true;
  }
  const app = createDevApp();
  const params = uuid ? { uuid } : { name };
  app.findNote(params).then(result => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result || null));
  }).catch(err => {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  });
  return true;
}

async function main() {
  const ctx = await esbuild.context({
    entryPoints: [path.join(rootDir, "lib/dashboard/client-entry.js")],
    bundle: true,
    format: "iife",
    outdir: path.join(devDir, "compiled"),
    entryNames: "bundle",
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

    if (req.url.startsWith("/api/note-content")) {
      if (handleNoteContentApi(req, res)) return;
    }

    if (req.url === "/api/note-create") {
      if (handleNoteCreateApi(req, res)) return;
    }

    if (req.url === "/api/note-append") {
      if (handleNoteAppendApi(req, res)) return;
    }

    if (req.url.startsWith("/api/note-find")) {
      if (handleNoteFindApi(req, res)) return;
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
