// [Claude claude-opus-4-6] Generated tests for: llmPromptWithPluginFallback callPlugin-with-LLM-fallback
import { jest } from "@jest/globals";
import { SETTING_KEYS } from "constants/settings";
import { AMPLE_AGENT_PRO_UUID } from "providers/ai-provider-settings";
import { llmPromptWithPluginFallback } from "providers/fetch-ai-provider";
import { setPluginData } from "plugin-data";
import { setLoggingEnabled } from "util/log";

// -------------------------------------------------------------------------------------
// @desc Build a mock app whose callPlugin resolves to `pluginResult` and whose settings
//   are configured for OpenAI so the LLM fallback path can construct a valid request.
// @param {*} pluginResult - Value that callPlugin will resolve to
// @returns {Object} Mock app object
function buildMockApp(pluginResult) {
  const settings = {
    [SETTING_KEYS.LLM_PROVIDER_MODEL]: "openai",
    [SETTING_KEYS.LLM_API_KEY_OPENAI]: "sk-test-key",
  };
  setPluginData({ settings, context: {} });
  return {
    callPlugin: jest.fn().mockResolvedValue(pluginResult),
    alert: jest.fn(),
  };
}

// -------------------------------------------------------------------------------------
// @desc Build a mock fetch that returns an OpenAI-shaped JSON response containing `content`.
// @param {string} content - The content string to embed in choices[0].message.content
// @returns {Function} Mock global.fetch
function buildMockFetch(content) {
  const body = { choices: [{ message: { content } }] };
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    headers: new Headers({ "content-type": "application/json" }),
    body: null,
  });
}

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  setLoggingEnabled(false);
  jest.restoreAllMocks();
});

describe("llmPromptWithPluginFallback", () => {
  it("returns plugin result when callPlugin returns a truthy object", async () => {
    const pluginResponse = { goalsSummary: "From plugin", tasks: [{ title: "Plugin task" }] };
    const app = buildMockApp(pluginResponse);

    const result = await llmPromptWithPluginFallback(app, "test prompt", { jsonResponse: true });

    expect(app.callPlugin).toHaveBeenCalledTimes(1);
    expect(app.callPlugin).toHaveBeenCalledWith({ source: AMPLE_AGENT_PRO_UUID }, "test prompt");
    expect(result).toEqual(pluginResponse);
  });

  it("returns string plugin response as-is when jsonResponse is not set", async () => {
    const app = buildMockApp("plain text from plugin");

    const result = await llmPromptWithPluginFallback(app, "prompt");

    expect(result).toBe("plain text from plugin");
  });

  it("parses JSON from a string plugin response when jsonResponse is true", async () => {
    const jsonString = '{"goalsSummary":"test","tasks":[]}';
    const app = buildMockApp(jsonString);

    const result = await llmPromptWithPluginFallback(app, "prompt", { jsonResponse: true });

    expect(app.callPlugin).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ goalsSummary: "test", tasks: [] });
  });

  it("falls back to LLM when callPlugin returns null", async () => {
    const app = buildMockApp(null);
    global.fetch = buildMockFetch('{"fallback":true}');

    const result = await llmPromptWithPluginFallback(app, "prompt", { jsonResponse: true });

    expect(app.callPlugin).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalled();
    expect(result).toEqual({ fallback: true });
  });

  it("falls back to LLM when callPlugin returns undefined", async () => {
    const app = buildMockApp(undefined);
    global.fetch = buildMockFetch('{"source":"llm"}');

    const result = await llmPromptWithPluginFallback(app, "prompt", { jsonResponse: true });

    expect(app.callPlugin).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalled();
    expect(result).toEqual({ source: "llm" });
  });

  it("falls back to LLM when callPlugin returns empty string", async () => {
    const app = buildMockApp("");
    global.fetch = buildMockFetch('{"source":"llm"}');

    const result = await llmPromptWithPluginFallback(app, "prompt", { jsonResponse: true });

    expect(app.callPlugin).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalled();
    expect(result).toEqual({ source: "llm" });
  });

  it("falls back to LLM when callPlugin throws an error", async () => {
    const app = {
      callPlugin: jest.fn().mockRejectedValue(new Error("Plugin not installed")),
      alert: jest.fn(),
      settings: {
        [SETTING_KEYS.LLM_PROVIDER_MODEL]: "openai",
        [SETTING_KEYS.LLM_API_KEY_OPENAI]: "sk-test-key",
      },
    };
    global.fetch = buildMockFetch('{"recovered":true}');

    const result = await llmPromptWithPluginFallback(app, "prompt", { jsonResponse: true });

    expect(app.callPlugin).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalled();
    expect(result).toEqual({ recovered: true });
  });

  it("truncates long content fields in the LLM request log without changing the request body", async () => {
    const app = buildMockApp(null);
    const longPrompt = "x".repeat(80);
    const truncatedPrompt = `${ "x".repeat(47) }...`;
    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    global.fetch = buildMockFetch('{"logged":true}');
    setLoggingEnabled(true);

    await llmPromptWithPluginFallback(app, longPrompt, { jsonResponse: true });

    const callingLog = consoleSpy.mock.calls.map(args => args.join(" "))
      .find(line => line.startsWith("Calling openai"));
    const requestBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(callingLog).toContain(`"content":"${ truncatedPrompt }"`);
    expect(callingLog).not.toContain(`"content":"${ longPrompt }"`);
    expect(requestBody.messages[0].content).toBe(longPrompt);
  });

  it("throws an actionable error when callPlugin returns null and no provider is configured", async () => {
    // [Claude claude-opus-4-8 (1M context)] Regression: Goal Coach crashed with the cryptic
    //   "Model undefined not found in any provider" when Ample Agent Pro returned null and no
    //   direct LLM provider was configured. The fallback must now surface a clear, actionable message.
    setPluginData({ settings: { [SETTING_KEYS.LLM_PROVIDER_MODEL]: "none" }, context: {} });
    const app = { callPlugin: jest.fn().mockResolvedValue(null), alert: jest.fn() };
    global.fetch = jest.fn();

    await expect(llmPromptWithPluginFallback(app, "prompt", { jsonResponse: true }))
      .rejects.toThrow(/No AI provider is configured/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not call fetch when callPlugin succeeds", async () => {
    const app = buildMockApp({ data: "from plugin" });
    global.fetch = jest.fn();

    await llmPromptWithPluginFallback(app, "prompt");

    expect(global.fetch).not.toHaveBeenCalled();
  });
});
