// isAmplenoteLlmAvailable decides whether the account's plugin LLM license can answer, which is what lets a keyless
// widget skip its upsell. A quota check that throws, reports nothing left, or comes back as the embed bridge's failure
// envelope counts as unavailable; a license that has answered once stays available for the app interface.
import { jest } from "@jest/globals";
import { amplenoteLlmPrompt, isAmplenoteLlmAvailable } from "providers/amplenote-llm";

describe("isAmplenoteLlmAvailable", () => {
  it("reports available when the quota check returns dollars remaining", async () => {
    const app = { callLLM: jest.fn().mockResolvedValue(4.5) };
    await expect(isAmplenoteLlmAvailable(app)).resolves.toBe(true);
    expect(app.callLLM).toHaveBeenCalledWith({ checkQuota: true });
  });

  it.each([
    ["throws for want of a license", jest.fn().mockRejectedValue(new Error("No plugin LLM license"))],
    ["reports no quota remaining", jest.fn().mockResolvedValue(0)],
    ["resolves the bridge's failure envelope", jest.fn().mockResolvedValue({ embedCallFailed: true, error: "no license" })],
  ])("reports unavailable when the quota check %s", async (_label, callLLM) => {
    await expect(isAmplenoteLlmAvailable({ callLLM })).resolves.toBe(false);
  });

  it("shares one check between concurrent callers and keeps a positive answer", async () => {
    const app = { callLLM: jest.fn().mockResolvedValue(2) };
    const [first, second] = await Promise.all([isAmplenoteLlmAvailable(app), isAmplenoteLlmAvailable(app)]);
    app.callLLM.mockRejectedValue(new Error("transient"));
    await expect(isAmplenoteLlmAvailable(app)).resolves.toBe(true);
    expect([first, second]).toEqual([true, true]);
    expect(app.callLLM).toHaveBeenCalledTimes(1);
  });

  it("asks again after an unavailable answer", async () => {
    const app = { callLLM: jest.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(3) };
    await expect(isAmplenoteLlmAvailable(app)).resolves.toBe(false);
    await expect(isAmplenoteLlmAvailable(app)).resolves.toBe(true);
  });

  it("reports available once a prompt has been answered, without a quota check", async () => {
    const app = { callLLM: jest.fn().mockResolvedValue({ textOutput: "hello" }) };
    await amplenoteLlmPrompt(app, "prompt");
    await expect(isAmplenoteLlmAvailable(app)).resolves.toBe(true);
    expect(app.callLLM).toHaveBeenCalledTimes(1);
  });
});

describe("amplenoteLlmPrompt", () => {
  it("asks callLLM's lowest reasoning budget for one it does not offer, and forwards one it does", async () => {
    const app = { callLLM: jest.fn().mockResolvedValue({ textOutput: "ok" }) };
    await amplenoteLlmPrompt(app, "prompt", { reasoningEffort: "none" });
    await amplenoteLlmPrompt(app, "prompt", { reasoningEffort: "high" });
    expect(app.callLLM.mock.calls.map(([options]) => options.reasoningEffort)).toEqual(["low", "high"]);
  });

  it("resolves null rather than rejecting when callLLM throws", async () => {
    const app = { callLLM: jest.fn().mockRejectedValue(new Error("LLM API request timed out")) };
    await expect(amplenoteLlmPrompt(app, "prompt", { jsonResponse: true })).resolves.toBeNull();
  });

  it("sends the key saved for the model's provider as userApiKey", async () => {
    const app = { callLLM: jest.fn().mockResolvedValue({ textOutput: "ok" }), settings: { "OpenAI API Key": " openai-key " } };
    await amplenoteLlmPrompt(app, "prompt", { aiModel: "gpt-5.6" });
    expect(app.callLLM.mock.calls[0][0].userApiKey).toBe("openai-key");
  });

  it("sends no userApiKey when only another provider's key is saved", async () => {
    const app = { callLLM: jest.fn().mockResolvedValue({ textOutput: "ok" }), settings: { "OpenAI API Key": "openai-key" } };
    await amplenoteLlmPrompt(app, "prompt", { aiModel: "claude-sonnet-5-5" });
    expect(app.callLLM.mock.calls[0][0]).not.toHaveProperty("userApiKey");
  });
});

// A saved key that is out of credit fails every call made on it, and callLLM sends a userApiKey straight to the
// provider, so without these paths a subscriber holding such a key never reaches the license they paid for.
describe("amplenoteLlmPrompt with a failing saved key", () => {
  const KEYED_SETTINGS = { "OpenAI API Key": "openai-key" };

  // ----------------------------------------------------------------------------------------------
  // @desc Build an app whose callLLM answers a quota check with dollars remaining, rejects a call carrying userApiKey
  //   with a 429, and answers a call on the license.
  // @param {number} [remainingQuota=5] - What the quota check reports; zero models an account without a license.
  // @returns {object} An app with a mocked callLLM and a saved OpenAI key.
  function appWithExhaustedKey(remainingQuota = 5) {
    const callLLM = jest.fn(async options => {
      if (options.checkQuota) return remainingQuota;
      if (options.userApiKey) throw Object.assign(new Error("You exceeded your current quota"), { status: 429 });
      if (!remainingQuota) throw new Error("app.callLLM requires a plugin license or a userApiKey option");
      return { textOutput: "license answer" };
    });
    return { callLLM, settings: KEYED_SETTINGS };
  }

  // ----------------------------------------------------------------------------------------------
  // @desc The prompt calls an app made, leaving out quota checks.
  // @param {object} app - An app from appWithExhaustedKey.
  // @returns {Array<object>} The options of each prompt call, in order.
  function promptCalls(app) {
    const allCallOptions = app.callLLM.mock.calls.map(([options]) => options);
    return allCallOptions.filter(options => !options.checkQuota);
  }

  it("asks again on the license when the key fails and the account holds one", async () => {
    const app = appWithExhaustedKey();
    await expect(amplenoteLlmPrompt(app, "prompt", { aiModel: "gpt-5.6" })).resolves.toBe("license answer");
    const sentKeys = promptCalls(app).map(options => options.userApiKey ?? null);
    expect(sentKeys).toEqual(["openai-key", null]);
  });

  it("asks on the license alone when preferLicense is set and the account holds one", async () => {
    const app = appWithExhaustedKey();
    await expect(amplenoteLlmPrompt(app, "prompt", { aiModel: "gpt-5.6", preferLicense: true })).resolves.toBe("license answer");
    expect(promptCalls(app)).toHaveLength(1);
    expect(promptCalls(app)[0]).not.toHaveProperty("userApiKey");
  });

  it("does not ask again after a timeout, which would spend the caller's budget twice", async () => {
    const app = appWithExhaustedKey();
    app.callLLM.mockImplementation(async options => {
      if (options.checkQuota) return 5;
      throw new Error("LLM API request timed out");
    });
    await expect(amplenoteLlmPrompt(app, "prompt", { aiModel: "gpt-5.6" })).resolves.toBeNull();
    expect(promptCalls(app)).toHaveLength(1);
  });

  it("rejects naming the key's failure when there is no license to ask instead", async () => {
    const app = appWithExhaustedKey(0);
    const request = amplenoteLlmPrompt(app, "prompt", { aiModel: "gpt-5.6", preferLicense: true, rejectWithReason: true });
    await expect(request).rejects.toThrow("your saved API key: You exceeded your current quota");
    expect(promptCalls(app)).toHaveLength(1);
  });

  it("resolves null with rejectWithReason when there is neither a license nor a saved key", async () => {
    const app = appWithExhaustedKey(0);
    app.settings = {};
    await expect(amplenoteLlmPrompt(app, "prompt", { rejectWithReason: true })).resolves.toBeNull();
  });

  it("does not take an answer on the user's key as proof of a license", async () => {
    const app = { callLLM: jest.fn(async options => (options.checkQuota ? 0 : { textOutput: "key answer" })), settings: KEYED_SETTINGS };
    await amplenoteLlmPrompt(app, "prompt", { aiModel: "gpt-5.6" });
    await expect(isAmplenoteLlmAvailable(app)).resolves.toBe(false);
  });
});
