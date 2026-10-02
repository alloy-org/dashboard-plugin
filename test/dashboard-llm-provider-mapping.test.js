// [Claude claude-opus-4-6] Generated tests for: apiKeyBucketFromLlmProvider
// Prompt: "providerApiKey is blank while settings show a key — evolve extraction"
import { apiKeyBucketFromLlmProvider, apiKeyFromProvider, apiKeySettingFromKeyProvider, configuredProviderEms,
  JEV_KEY_PROVIDER, SETTING_KEYS } from "constants/settings";

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

// [Claude claude-opus-4-8 (1M context)] Generated tests for: configuredProviderEms
// Prompt: "only show options that correspond to an LLM whose API key has been given by the user"
describe("configuredProviderEms", () => {
  it("lists only providers whose API key setting holds a non-empty value", () => {
    const settings = {
      [SETTING_KEYS.LLM_API_KEY_ANTHROPIC]: "sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      [SETTING_KEYS.LLM_API_KEY_OPENAI]: "  ",      // whitespace-only → not configured
      [SETTING_KEYS.LLM_API_KEY_GEMINI]: "AIza-key",
    };
    expect(configuredProviderEms(settings).sort()).toEqual(["anthropic", "gemini"]);
  });

  it("returns an empty array when no keys are present or settings is missing", () => {
    expect(configuredProviderEms({})).toEqual([]);
    expect(configuredProviderEms(undefined)).toEqual([]);
  });
});

describe("apiKeySettingFromKeyProvider", () => {
  it("stores the Jev option's key in the Jev Access Token setting", () => {
    expect(apiKeySettingFromKeyProvider(JEV_KEY_PROVIDER)).toBe(SETTING_KEYS.JEV_ACCESS_TOKEN);
  });

  it("stores a generative provider's key where apiKeyFromProvider does", () => {
    expect(apiKeySettingFromKeyProvider("anthropic")).toBe(SETTING_KEYS.LLM_API_KEY_ANTHROPIC);
    expect(apiKeySettingFromKeyProvider(null)).toBeNull();
  });

  it("keeps a Jev key out of the generative providers a chooser offers", () => {
    const settings = { [SETTING_KEYS.JEV_ACCESS_TOKEN]: "sk-or-v1-abc" };
    expect(configuredProviderEms(settings)).toEqual([]);
  });
});
