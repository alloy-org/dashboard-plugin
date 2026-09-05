import { jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const pluginCode = readFileSync(new URL("../build/compiled.js", import.meta.url), "utf8");

// ----------------------------------------------------------------------------------------------
// @desc Evaluate the shipped plugin without require, React, or browser globals.
// [OpenAI GPT-6] Regression for the dynamic React require introduced by the calendar suggestion action.
test("production bundle returns a usable plugin without a module loader", () => {
  const plugin = runInNewContext(pluginCode, {});
  expect(pluginCode).not.toMatch(/\b__require\b/);
  expect(typeof plugin.renderEmbed).toBe("function");
  expect(typeof plugin.suggestScheduledTasks).toBe("function");
  expect(typeof plugin.onEmbedCall).toBe("function");
});

// ----------------------------------------------------------------------------------------------
// @desc Verify request diagnostics at the shipped entry point respect the console logging setting.
// @param {boolean} loggingEnabled - Whether the host has enabled console logging.
// [OpenAI GPT-6] Use a past range to exercise the real action without fetching tasks or calling an LLM.
test.each([true, false])("suggestion request logging respects Console logging=%s", async loggingEnabled => {
  const log = jest.fn();
  const plugin = runInNewContext(pluginCode, { console: { error: jest.fn(), log }, setTimeout });
  const app = { settings: { "Console logging": loggingEnabled } };
  const params = { endAt: 2, schedulableTasks: [{ uuid: "candidate" }], scheduledTasks: [], startAt: 1, taskDomain: "work" };

  await expect(plugin.suggestScheduledTasks(app, params)).resolves.toEqual([]);

  if (loggingEnabled) {
    expect(log).toHaveBeenCalledWith("[Dashboard] suggestScheduledTasks requested", {
      endAt: 2,
      schedulableTaskCount: 1,
      scheduledTaskCount: 0,
      startAt: 1,
      taskDomain: "work",
    });
  } else {
    expect(log).not.toHaveBeenCalled();
  }
});
