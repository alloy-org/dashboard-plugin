// [Claude claude-opus-4-6] Generated tests for: apiKeyBucketFromLlmProvider
// Prompt: "providerApiKey is blank while settings show a key — evolve extraction"
import { apiKeyBucketFromLlmProvider, apiKeyFromProvider, SETTING_KEYS } from "../lib/constants/settings.js";

describe("apiKeyBucketFromLlmProvider", () => {
  it("maps anthropic-sonnet providerEm to anthropic API key bucket", () => {
    const providerEm = "anthropic-sonnet";
    expect(apiKeyBucketFromLlmProvider(providerEm)).toBe("anthropic");
    expect(apiKeyFromProvider(apiKeyBucketFromLlmProvider(providerEm))).toBe(
      SETTING_KEYS.LLM_API_KEY_ANTHROPIC
    );
  });

  it("passes through canonical providerEm values", () => {
    expect(apiKeyBucketFromLlmProvider("openai")).toBe("openai");
    expect(apiKeyBucketFromLlmProvider("gemini")).toBe("gemini");
  });

  it("returns null for none and empty", () => {
    expect(apiKeyBucketFromLlmProvider("none")).toBeNull();
    expect(apiKeyBucketFromLlmProvider("")).toBeNull();
    expect(apiKeyBucketFromLlmProvider(undefined)).toBeNull();
  });
});
