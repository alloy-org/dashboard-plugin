/**
 * [gpt-5.3-codex-authored file]
 * Prompt summary: "Test DreamTask reseed provider selection when multiple API keys are configured"
 */
import { chooseReseedProvider, configuredProvidersFromSettings } from "../lib/dashboard/dream-task-provider-selection.js";
import { SETTING_KEYS } from "../lib/constants/settings.js";
import { jest } from "@jest/globals";

// [Claude gpt-5.3-codex] Generated tests for: DreamTask reseed provider chooser
describe("DreamTask provider selection", () => {
  it("returns only providers that have non-empty API keys", () => {
    const configured = configuredProvidersFromSettings({
      [SETTING_KEYS.LLM_API_KEY_ANTHROPIC]: "anthropic-key",
      [SETTING_KEYS.LLM_API_KEY_GEMINI]: "   ",
      [SETTING_KEYS.LLM_API_KEY_OPENAI]: "openai-key",
    });
    expect(configured.map(entry => entry.providerEm).sort()).toEqual(["anthropic", "openai"]);
  });

  it("returns the only configured provider without opening prompt", async () => {
    const app = {
      settings: {
        [SETTING_KEYS.LLM_API_KEY_OPENAI]: "openai-key",
      },
      prompt: jest.fn(),
    };
    const selected = await chooseReseedProvider(app, "openai");
    expect(selected?.providerEm).toBe("openai");
    expect(app.prompt).not.toHaveBeenCalled();
  });

  it("prompts and returns selected provider when multiple providers are configured", async () => {
    const app = {
      settings: {
        [SETTING_KEYS.LLM_API_KEY_ANTHROPIC]: "anthropic-key",
        [SETTING_KEYS.LLM_API_KEY_GEMINI]: "gemini-key",
      },
      prompt: jest.fn().mockResolvedValue(["gemini"]),
    };
    const selected = await chooseReseedProvider(app, "anthropic");
    expect(app.prompt).toHaveBeenCalledTimes(1);
    expect(selected?.providerEm).toBe("gemini");
  });

  it("returns null when chooser is cancelled", async () => {
    const app = {
      settings: {
        [SETTING_KEYS.LLM_API_KEY_OPENAI]: "openai-key",
        [SETTING_KEYS.LLM_API_KEY_GROK]: "grok-key",
      },
      prompt: jest.fn().mockResolvedValue(null),
    };
    const selected = await chooseReseedProvider(app, "openai");
    expect(selected).toBeNull();
  });
});
