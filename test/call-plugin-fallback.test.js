// [Claude claude-opus-4-6] Generated tests for: llmPromptWithPluginFallback callPlugin-with-LLM-fallback
import { jest } from "@jest/globals";
import { SETTING_KEYS } from "../lib/constants/settings.js";
import { llmPromptWithPluginFallback } from "../lib/providers/fetch-ai-provider.js";
import { AMPLE_AGENT_PRO_UUID } from "../lib/providers/ai-provider-settings.js";

// -------------------------------------------------------------------------------------
// @desc Build a mock app whose callPlugin resolves to `pluginResult` and whose settings
//   are configured for OpenAI so the LLM fallback path can construct a valid request.
// @param {*} pluginResult - Value that callPlugin will resolve to
// @returns {Object} Mock app object
function buildMockApp(pluginResult) {
  return {
    callPlugin: jest.fn().mockResolvedValue(pluginResult),
    alert: jest.fn(),
    settings: {
      [SETTING_KEYS.LLM_PROVIDER_MODEL]: "openai",
      [SETTING_KEYS.LLM_API_KEY_OPENAI]: "sk-test-key",
    },
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
  jest.restoreAllMocks();
});

describe("llmPromptWithPluginFallback", () => {
  it("returns plugin result when callPlugin returns a truthy object", async () => {
    const pluginResponse = { goalsSummary: "From plugin", tasks: [{ title: "Plugin task" }] };
    const app = buildMockApp(pluginResponse);

    const result = await llmPromptWithPluginFallback(app, "test prompt", { jsonResponse: true });

    expect(app.callPlugin).toHaveBeenCalledTimes(1);
    expect(app.callPlugin).toHaveBeenCalledWith({ uuid: AMPLE_AGENT_PRO_UUID }, "test prompt");
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

  it("does not call fetch when callPlugin succeeds", async () => {
    const app = buildMockApp({ data: "from plugin" });
    global.fetch = jest.fn();

    await llmPromptWithPluginFallback(app, "prompt");

    expect(global.fetch).not.toHaveBeenCalled();
  });
});
