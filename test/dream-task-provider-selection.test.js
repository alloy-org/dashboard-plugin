/**
 * [gpt-5.3-codex-authored file]
 * Prompt summary: "Test DreamTask reseed provider selection when multiple API keys are configured"
 */
import { chooseReseedProvider, configuredProvidersFromSettings } from "dashboard/dream-task-provider-selection";
import { SETTING_KEYS } from "constants/settings";
import { setPluginData } from "plugin-data";
import { jest } from "@jest/globals";

// [Claude gpt-5.3-codex] Generated tests for: DreamTask reseed provider chooser
describe("DreamTask provider selection", () => {
  it("returns only providers that have non-empty API keys", () => {
    const configured = configuredProvidersFromSettings({
      [SETTING_KEYS.LLM_API_KEY_ANTHROPIC]: "anthropic-key",
      [SETTING_KEYS.LLM_API_KEY_GEMINI]: "   ",
      [SETTING_KEYS.LLM_API_KEY_OPENAI]: "openai-key",
      [SETTING_KEYS.LLM_PROVIDER_MODEL]: "openai",
    });
    expect(configured.map(entry => entry.providerEm).sort()).toEqual(["anthropic", "openai"]);
    const openai = configured.find(entry => entry.providerEm === "openai");
    const anthropic = configured.find(entry => entry.providerEm === "anthropic");
    expect(openai?.isCurrentDefaultLlmProvider).toBe(true);
    expect(anthropic?.isCurrentDefaultLlmProvider).toBe(false);
  });

  it("returns the only configured provider without opening prompt", async () => {
    setPluginData({ settings: { [SETTING_KEYS.LLM_API_KEY_OPENAI]: "openai-key" }, context: {} });
    const app = { prompt: jest.fn() };
    const selected = await chooseReseedProvider(app, "openai");
    expect(selected?.providerEm).toBe("openai");
    expect(app.prompt).not.toHaveBeenCalled();
  });

  it("prompts and returns selected provider when multiple providers are configured", async () => {
    setPluginData({ settings: {
      [SETTING_KEYS.LLM_API_KEY_ANTHROPIC]: "anthropic-key",
      [SETTING_KEYS.LLM_API_KEY_GEMINI]: "gemini-key",
      [SETTING_KEYS.LLM_PROVIDER_MODEL]: "gemini",
    }, context: {} });
    const app = { prompt: jest.fn().mockResolvedValue(["gemini"]) };
    const selected = await chooseReseedProvider(app, "anthropic");
    expect(app.prompt).toHaveBeenCalledTimes(1);
    const promptOptions = app.prompt.mock.calls[0][1];
    const labels = promptOptions.inputs[0].options.map(option => option.label);
    expect(labels).toContain("Gemini (current default)");
    expect(labels).toContain("Anthropic (last used)");
    expect(selected?.providerEm).toBe("gemini");
  });

  it("shows only current default suffix when current default and last used are the same provider", async () => {
    setPluginData({ settings: {
      [SETTING_KEYS.LLM_API_KEY_ANTHROPIC]: "anthropic-key",
      [SETTING_KEYS.LLM_API_KEY_OPENAI]: "openai-key",
      [SETTING_KEYS.LLM_PROVIDER_MODEL]: "anthropic",
    }, context: {} });
    const app = { prompt: jest.fn().mockResolvedValue(["anthropic"]) };
    await chooseReseedProvider(app, "anthropic");
    const promptOptions = app.prompt.mock.calls[0][1];
    const labels = promptOptions.inputs[0].options.map(option => option.label);
    expect(labels).toContain("Anthropic (current default)");
    expect(labels).not.toContain("Anthropic (last used)");
  });

  it("returns null when chooser is cancelled", async () => {
    setPluginData({ settings: {
      [SETTING_KEYS.LLM_API_KEY_OPENAI]: "openai-key",
      [SETTING_KEYS.LLM_API_KEY_GROK]: "grok-key",
    }, context: {} });
    const app = { prompt: jest.fn().mockResolvedValue(null) };
    const selected = await chooseReseedProvider(app, "openai");
    expect(selected).toBeNull();
  });
});
