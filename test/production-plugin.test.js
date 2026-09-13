import { jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const pluginCode = readFileSync(new URL("../build/compiled.js", import.meta.url), "utf8");

// ----------------------------------------------------------------------------------------------
// @desc Evaluate the shipped plugin without require, React, or browser globals.
// [OpenAI GPT-6] Regression for the dynamic React require introduced by the calendar suggestion action.
// The artifact is minified, so this no longer looks for esbuild's `__require` helper by name — minification renames
// it, and an assertion on the old name would pass whether or not the helper was present. What minification cannot
// rename is a reference to an unbound `require` global, which is the shape an escaped module loader actually takes.
// The exhaustive check is the dependency-graph guard in host-plugin-boundary.js, which rejects every external import
// before this file is written; this is the belt to that suspenders.
test("production bundle returns a usable plugin without a module loader", () => {
  const plugin = runInNewContext(pluginCode, {});
  expect(pluginCode).not.toMatch(/[^.\w]require\s*\(/);
  expect(typeof plugin.renderEmbed).toBe("function");
  expect(typeof plugin.suggestScheduledTasks).toBe("function");
  expect(typeof plugin.onEmbedCall).toBe("function");
});

// ----------------------------------------------------------------------------------------------
// @desc Guard the wrapper that makes the minified artifact evaluate to the plugin object. Amplenote reads the note's
//   code block as a single expression, and the previous approach — rewriting esbuild's `var plugin_default = plugin;`
//   line into a `return` — silently produced an artifact evaluating to undefined once names were minified. This test
//   fails loudly on that class of regression rather than shipping a plugin that defines nothing.
// [Claude claude-opus-5 (1M context)] Generated test for: the globalName-based plugin expression wrapper.
test("production bundle is a single expression evaluating to the plugin object", () => {
  const plugin = runInNewContext(pluginCode, {});
  expect(plugin).not.toBeUndefined();
  expect(typeof plugin).toBe("object");
  expect(Object.keys(plugin)).toEqual(expect.arrayContaining([ "appOption", "onEmbedCall", "renderEmbed" ]));
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

// ----------------------------------------------------------------------------------------------
// @desc Verify the Debug Console's evaluator works through the shipped bundle, whose host has no module
//   loader — the evaluator builds its runner from the AsyncFunction constructor for exactly that reason.
// [Claude claude-opus-5 (1M context)] Generated test for: the debugEvaluate embed action.
test("debugEvaluate embed action evaluates an expression against the host app", async () => {
  const plugin = runInNewContext(pluginCode, { console: { error: jest.fn(), log: jest.fn() }, setTimeout });
  const app = { findNote: async ({ uuid }) => ({ name: "Daily jots", uuid }), settings: {} };

  const evaluation = await plugin.onEmbedCall(app, "debugEvaluate", 'await app.findNote({ uuid: "note-9" })');

  expect(evaluation.error).toBeNull();
  expect(JSON.parse(evaluation.output)).toEqual({ name: "Daily jots", uuid: "note-9" });
  expect(evaluation.resultType).toBe("Object");
});

// ----------------------------------------------------------------------------------------------
// @desc Parse the embed document the shipped plugin actually produces, with the environment's real HTML parser.
//   The client bundle is inlined rather than base64-encoded, so its bytes reach the HTML tokenizer; this is the
//   end-to-end counterpart to inline-script-safety.js, which makes the same judgement from a state machine at build
//   time. It asserts on the real artifact, so a bundle whose contents drift into an unsafe arrangement fails here
//   even if the build-time guard were ever bypassed.
// [Claude claude-opus-5 (1M context)] Generated test for: inlining the client bundle into the embed document.
test("shipped embed document survives HTML parsing with the client bundle inlined", async () => {
  const plugin = runInNewContext(pluginCode, { console: { debug: jest.fn(), error: jest.fn(), log: jest.fn() }, setTimeout });

  const embedHTML = await plugin.renderEmbed({ settings: {} });

  const parsedDocument = new DOMParser().parseFromString(embedHTML, "text/html");
  const scriptElements = [ ...parsedDocument.querySelectorAll("script") ];
  expect(scriptElements.every(script => !(script.getAttribute("src") || "").startsWith("data:"))).toBe(true);
  const bundleScript = scriptElements.find(script => script.textContent.length > 10_000);
  expect(bundleScript).toBeDefined();
  // The root the client mounts into precedes the bundle, and </body></html> follows it. Both surviving the parse is
  // what proves the script element opened and closed where it was supposed to.
  expect(parsedDocument.querySelector("#dashboard-root")).not.toBeNull();
  expect(parsedDocument.body.lastElementChild.tagName).toBe("SCRIPT");
});
