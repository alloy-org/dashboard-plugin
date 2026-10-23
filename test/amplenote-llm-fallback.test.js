// llmPromptWithAmplenoteFallback asks app.callLLM on the account's plugin LLM license first, and the user's configured
// provider only when callLLM produces nothing: no text, an error, a bridge failure envelope, or no callLLM at all.
import { jest } from "@jest/globals";
import { SETTING_KEYS } from "constants/settings";
import { llmPromptWithAmplenoteFallback } from "providers/fetch-ai-provider";
import { setPluginData } from "plugin-data";
import { setLoggingEnabled } from "util/log";

// -------------------------------------------------------------------------------------
// @desc Build a mock app whose callLLM resolves with `callLlmResult`, with settings configured for OpenAI so the
//   fallback can construct a valid request.
// @param {*} callLlmResult - Value callLLM resolves with
// @returns {Object} Mock app object
function buildMockApp(callLlmResult) {
  const settings = {
    [SETTING_KEYS.LLM_PROVIDER_MODEL]: "openai",
    [SETTING_KEYS.LLM_API_KEY_OPENAI]: "sk-test-key",
  };
  setPluginData({ settings, context: {} });
  return { alert: jest.fn(), callLLM: jest.fn().mockResolvedValue(callLlmResult) };
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

describe("llmPromptWithAmplenoteFallback", () => {
  it("returns callLLM's parsed reply and asks it with the prompt as the only user message", async () => {
    const app = buildMockApp({ callCost: 0.002, textOutput: '{"goalsSummary":"From callLLM","tasks":[]}' });
    global.fetch = jest.fn();

    const result = await llmPromptWithAmplenoteFallback(app, "test prompt", { jsonResponse: true, source: "dream-task",
      timeoutSeconds: 45 });

    expect(result).toEqual({ goalsSummary: "From callLLM", tasks: [] });
    expect(app.callLLM).toHaveBeenCalledWith({ input: [{ content: "test prompt", role: "user" }], model: "claude-sonnet-5-5",
      source: "dream-task", timeoutMs: 45000 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns callLLM's text as-is when jsonResponse is not set, and keeps a model callLLM can serve", async () => {
    const app = buildMockApp({ textOutput: "plain text from callLLM" });

    const result = await llmPromptWithAmplenoteFallback(app, "prompt", { aiModel: "gpt-5.6" });

    expect(result).toBe("plain text from callLLM");
    expect(app.callLLM.mock.calls[0][0].model).toBe("gpt-5.6");
  });

  it("asks callLLM's default model for a model it cannot serve", async () => {
    const app = buildMockApp({ textOutput: "ok" });

    await llmPromptWithAmplenoteFallback(app, "prompt", { aiModel: "sonar-pro" });

    expect(app.callLLM.mock.calls[0][0].model).toBe("claude-sonnet-5-5");
  });

  it.each([
    ["resolves the bridge's failure envelope", { embedCallFailed: true, error: "app.callLLM has no quota remaining" }],
    ["answers with empty text", { functionCalls: [], textOutput: "" }],
  ])("falls back to the configured provider when callLLM %s", async (_label, callLlmResult) => {
    const app = buildMockApp(callLlmResult);
    global.fetch = buildMockFetch('{"fallback":true}');

    const result = await llmPromptWithAmplenoteFallback(app, "prompt", { jsonResponse: true });

    expect(app.callLLM).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalled();
    expect(result).toEqual({ fallback: true });
  });

  it("falls back to the configured provider when callLLM throws", async () => {
    const app = buildMockApp(null);
    app.callLLM.mockRejectedValue(Object.assign(new Error("LLM API request timed out"), { status: 504 }));
    global.fetch = buildMockFetch('{"recovered":true}');

    const result = await llmPromptWithAmplenoteFallback(app, "prompt", { jsonResponse: true });

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

    await llmPromptWithAmplenoteFallback(app, longPrompt, { jsonResponse: true });

    const callingLog = consoleSpy.mock.calls.map(args => args.join(" "))
      .find(line => line.startsWith("Calling openai"));
    const requestBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(callingLog).toContain(`"content":"${ truncatedPrompt }"`);
    expect(callingLog).not.toContain(`"content":"${ longPrompt }"`);
    expect(requestBody.messages[0].content).toBe(longPrompt);
  });

  it("throws an actionable error when callLLM produces nothing and no provider is configured", async () => {
    // Regression: Goal Coach crashed with the cryptic "Model undefined not found in any provider" when the first
    //   leg returned nothing and no direct LLM provider was configured.
    setPluginData({ settings: { [SETTING_KEYS.LLM_PROVIDER_MODEL]: "none" }, context: {} });
    const app = { alert: jest.fn(), callLLM: jest.fn().mockResolvedValue(null) };
    global.fetch = jest.fn();

    await expect(llmPromptWithAmplenoteFallback(app, "prompt", { jsonResponse: true }))
      .rejects.toThrow(/No AI provider is configured/);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
