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

  beforeEach(() => {
    tmpSettingsPath = path.join(os.tmpdir(), `dev-settings-test-${Date.now()}.json`);
  });

  afterEach(() => {
    try { fs.unlinkSync(tmpSettingsPath); } catch { /* already cleaned up */ }
  });

  // --------------------------------------------------
  describe("settings persistence", () => {
    it("starts with empty settings when no JSON file exists", () => {
      const app = createDevApp(tmpSettingsPath);
      expect(app.settings).toEqual({});
    });

    it("writes a setting to the JSON file when setSetting is called", async () => {
      const app = createDevApp(tmpSettingsPath);

      await app.setSetting("LLM Provider", "anthropic");

      const raw = fs.readFileSync(tmpSettingsPath, "utf-8");
      const persisted = JSON.parse(raw);
      expect(persisted["LLM Provider"]).toBe("anthropic");
    });

    it("persists settings across separate app instantiations", async () => {
      const firstApp = createDevApp(tmpSettingsPath);
      await firstApp.setSetting("dashboard_quotes_config", '["motivational"]');
      await firstApp.setSetting("LLM API Key", "sk-test-key-123");

      // Simulate a fresh start by creating a brand-new app instance.
      const secondApp = createDevApp(tmpSettingsPath);

      expect(secondApp.settings["dashboard_quotes_config"]).toBe('["motivational"]');
      expect(secondApp.settings["LLM API Key"]).toBe("sk-test-key-123");
    });

    it("accumulates multiple settings without losing earlier ones", async () => {
      const app = createDevApp(tmpSettingsPath);
      await app.setSetting("key_a", "value_a");
      await app.setSetting("key_b", "value_b");
      await app.setSetting("key_c", "value_c");

      const persisted = readSettingsFile(tmpSettingsPath);
      expect(persisted).toEqual({ key_a: "value_a", key_b: "value_b", key_c: "value_c" });
    });

    it("overwrites an existing setting value", async () => {
      const app = createDevApp(tmpSettingsPath);
      await app.setSetting("theme", "light");
      await app.setSetting("theme", "dark");

      const reloaded = createDevApp(tmpSettingsPath);
      expect(reloaded.settings["theme"]).toBe("dark");
    });

    it("coerces non-string values to strings (matching Amplenote behaviour)", async () => {
      const app = createDevApp(tmpSettingsPath);
      await app.setSetting("counter", 42);

      const reloaded = createDevApp(tmpSettingsPath);
      expect(reloaded.settings["counter"]).toBe("42");
    });
  });

  // --------------------------------------------------
  describe("getTaskDomainTasks", () => {
    it("returns an array of sample tasks", async () => {
      const app = createDevApp(tmpSettingsPath);
      const tasks = await app.getTaskDomainTasks("domain-work-uuid");

      expect(Array.isArray(tasks)).toBe(true);
      expect(tasks.length).toBeGreaterThan(0);
    });

    it("each task has the required Amplenote task shape", async () => {
      const app = createDevApp(tmpSettingsPath);
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
      const app = createDevApp(tmpSettingsPath);
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
      const app = createDevApp(tmpSettingsPath);
      const domains = await app.getTaskDomains();

      expect(domains.length).toBe(3);
      expect(domains[0]).toHaveProperty("name");
      expect(domains[0]).toHaveProperty("uuid");
      expect(domains.map(d => d.name)).toContain("Work");
    });
  });
});
