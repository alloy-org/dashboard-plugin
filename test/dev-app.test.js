/**
 * [Claude-authored file]
 * Created: 2026-03-01 | Model: claude-opus-4-6
 * Task: Tests for dev-mode app harness — settings persistence and sample task retrieval
 * Prompt summary: "test that setSetting updates a JSON file, which is used on subsequent instantiation"
 */
import fs from "fs";
import path from "path";
import os from "os";
import { createDevApp, readSettingsFile } from "../dev/dev-app.js";

// [Claude] Generated tests for: dev-mode app harness settings persistence
// Date: 2026-03-01 | Model: claude-opus-4-6
describe("Dev App Harness", () => {
  let tmpSettingsPath;
  let tmpNotesDir;

  beforeEach(() => {
    tmpSettingsPath = path.join(os.tmpdir(), `dev-settings-test-${Date.now()}.json`);
    tmpNotesDir = path.join(os.tmpdir(), `dev-notes-test-${Date.now()}`);
    fs.mkdirSync(tmpNotesDir, { recursive: true });
  });

  afterEach(() => {
    try { fs.unlinkSync(tmpSettingsPath); } catch { /* already cleaned up */ }
    try { fs.rmSync(tmpNotesDir, { recursive: true, force: true }); } catch { /* already cleaned up */ }
  });

  // --------------------------------------------------
  describe("settings persistence", () => {
    it("starts with empty settings when no JSON file exists", () => {
      const app = createDevApp(tmpSettingsPath, tmpNotesDir);
      expect(app.settings).toEqual({});
    });

    it("writes a setting to the JSON file when setSetting is called", async () => {
      const app = createDevApp(tmpSettingsPath, tmpNotesDir);

      await app.setSetting("LLM Provider", "anthropic");

      const raw = fs.readFileSync(tmpSettingsPath, "utf-8");
      const persisted = JSON.parse(raw);
      expect(persisted["LLM Provider"]).toBe("anthropic");
    });

    it("persists settings across separate app instantiations", async () => {
      const firstApp = createDevApp(tmpSettingsPath, tmpNotesDir);
      await firstApp.setSetting("dashboard_quotes_config", '["motivational"]');
      await firstApp.setSetting("LLM API Key", "sk-test-key-123");

      // Simulate a fresh start by creating a brand-new app instance.
      const secondApp = createDevApp(tmpSettingsPath, tmpNotesDir);

      expect(secondApp.settings["dashboard_quotes_config"]).toBe('["motivational"]');
      expect(secondApp.settings["LLM API Key"]).toBe("sk-test-key-123");
    });

    it("accumulates multiple settings without losing earlier ones", async () => {
      const app = createDevApp(tmpSettingsPath, tmpNotesDir);
      await app.setSetting("key_a", "value_a");
      await app.setSetting("key_b", "value_b");
      await app.setSetting("key_c", "value_c");

      const persisted = readSettingsFile(tmpSettingsPath);
      expect(persisted).toEqual({ key_a: "value_a", key_b: "value_b", key_c: "value_c" });
    });

    it("overwrites an existing setting value", async () => {
      const app = createDevApp(tmpSettingsPath, tmpNotesDir);
      await app.setSetting("theme", "light");
      await app.setSetting("theme", "dark");

      const reloaded = createDevApp(tmpSettingsPath, tmpNotesDir);
      expect(reloaded.settings["theme"]).toBe("dark");
    });

    it("coerces non-string values to strings (matching Amplenote behaviour)", async () => {
      const app = createDevApp(tmpSettingsPath, tmpNotesDir);
      await app.setSetting("counter", 42);

      const reloaded = createDevApp(tmpSettingsPath, tmpNotesDir);
      expect(reloaded.settings["counter"]).toBe("42");
    });
  });

  // --------------------------------------------------
  describe("getTaskDomainTasks", () => {
    it("returns an array of sample tasks", async () => {
      const app = createDevApp(tmpSettingsPath, tmpNotesDir);
      const tasks = await app.getTaskDomainTasks("domain-work-uuid");

      expect(Array.isArray(tasks)).toBe(true);
      expect(tasks.length).toBeGreaterThan(0);
    });

    it("each task has the required Amplenote task shape", async () => {
      const app = createDevApp(tmpSettingsPath, tmpNotesDir);
      const tasks = await app.getTaskDomainTasks("domain-work-uuid");
      const requiredKeys = ["uuid", "content", "important", "urgent", "completedAt",
        "dismissedAt", "victoryValue", "noteUUID", "startAt"];

      for (const task of tasks) {
        for (const key of requiredKeys) {
          expect(task).toHaveProperty(key);
        }
      }
    });

    it("includes both open and completed tasks", async () => {
      const app = createDevApp(tmpSettingsPath, tmpNotesDir);
      const tasks = await app.getTaskDomainTasks("domain-work-uuid");

      const openTasks = tasks.filter(t => t.completedAt == null);
      const completedTasks = tasks.filter(t => t.completedAt != null);

      expect(openTasks.length).toBeGreaterThan(0);
      expect(completedTasks.length).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------
  describe("getTaskDomains", () => {
    it("returns the sample domains array", async () => {
      const app = createDevApp(tmpSettingsPath, tmpNotesDir);
      const domains = await app.getTaskDomains();

      expect(domains.length).toBe(3);
      expect(domains[0]).toHaveProperty("name");
      expect(domains[0]).toHaveProperty("uuid");
      expect(domains.map(d => d.name)).toContain("Work");
    });
  });

  // --------------------------------------------------
  // [Claude] Generated tests for: filterNotes searches /notes directory frontmatter
  // Date: 2026-03-14 | Model: claude-4.6-sonnet-medium-thinking
  describe("filterNotes", () => {
    function writeFrontmatterNote(dir, title, uuid, tags = []) {
      const now = new Date().toISOString();
      const tagLines = tags.map(t => `  - ${t}`).join("\n");
      const content = [
        "---",
        `title: ${title}`,
        `uuid: ${uuid}`,
        `version: 1`,
        `created: '${now}'`,
        `updated: '${now}'`,
        tagLines ? `tags:\n${tagLines}` : "tags: []",
        "---",
        "",
      ].join("\n");
      fs.writeFileSync(path.join(dir, `${uuid}.md`), content, "utf-8");
    }

    it("returns an empty array when the notes directory contains no matching files", async () => {
      const app = createDevApp(tmpSettingsPath, tmpNotesDir);
      const results = await app.filterNotes({ query: "Q1 2026 Plan" });
      expect(results).toEqual([]);
    });

    it("finds a note whose frontmatter title exactly matches the query", async () => {
      const uuid = "test-quarterly-uuid-001";
      writeFrontmatterNote(tmpNotesDir, "Q1 2026 Plan", uuid);

      const app = createDevApp(tmpSettingsPath, tmpNotesDir);
      const results = await app.filterNotes({ query: "Q1 2026 Plan" });

      expect(results).toHaveLength(1);
      expect(results[0].uuid).toBe(uuid);
      expect(results[0].name).toBe("Q1 2026 Plan");
    });

    it("does not return notes whose title does not match the query", async () => {
      writeFrontmatterNote(tmpNotesDir, "Q2 2026 Plan", "test-uuid-q2");
      writeFrontmatterNote(tmpNotesDir, "Random Note", "test-uuid-random");

      const app = createDevApp(tmpSettingsPath, tmpNotesDir);
      const results = await app.filterNotes({ query: "Q1 2026 Plan" });

      expect(results).toEqual([]);
    });

    it("returns all notes when no query is given", async () => {
      writeFrontmatterNote(tmpNotesDir, "Q1 2026 Plan", "uuid-a");
      writeFrontmatterNote(tmpNotesDir, "Q2 2026 Plan", "uuid-b");
      writeFrontmatterNote(tmpNotesDir, "Random Note",  "uuid-c");

      const app = createDevApp(tmpSettingsPath, tmpNotesDir);
      const results = await app.filterNotes({});

      expect(results).toHaveLength(3);
    });

    it("returns multiple notes when more than one file matches the query", async () => {
      writeFrontmatterNote(tmpNotesDir, "Q1 2026 Plan", "uuid-match-1");
      writeFrontmatterNote(tmpNotesDir, "Q1 2026 Plan", "uuid-match-2");
      writeFrontmatterNote(tmpNotesDir, "Q2 2026 Plan", "uuid-no-match");

      const app = createDevApp(tmpSettingsPath, tmpNotesDir);
      const results = await app.filterNotes({ query: "Q1 2026 Plan" });

      expect(results).toHaveLength(2);
      expect(results.map(r => r.uuid)).toContain("uuid-match-1");
      expect(results.map(r => r.uuid)).toContain("uuid-match-2");
    });
  });
});
