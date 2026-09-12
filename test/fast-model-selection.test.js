// Tests for fast-model resolution: the model and API key a short-timeout caller (the plan wizard) should use,
// and the wizard's option builder that wraps it. The behavior under test is that a model is never named without
// the key that authenticates it, which is what a request carrying `key=null` demonstrated was possible.
import { SETTING_KEYS } from "constants/settings";
import { WIZARD_LLM_TIMEOUT_SECONDS } from "plan-wizard/plan-models";
import { wizardLlmOptions } from "plan-wizard/wizard-prompt-diagnostics";
import { fastModelOptions } from "providers/ai-provider-settings";

describe("fastModelOptions", () => {
  it("prefers Gemini's flash tier when a Gemini key is stored, even under another configured provider", () => {
    const settings = { [SETTING_KEYS.LLM_API_KEY_GEMINI]: "gemini-key",
      [SETTING_KEYS.LLM_API_KEY_OPENAI]: "openai-key", [SETTING_KEYS.LLM_PROVIDER_MODEL]: "openai" };
    expect(fastModelOptions(settings)).toEqual({ aiModel: "gemini-3.5-flash-lite", apiKey: "gemini-key",
      providerEm: "gemini" });
  });

  it("uses the dashboard's own configured provider when no Gemini key is stored", () => {
    const settings = { [SETTING_KEYS.LLM_API_KEY_ANTHROPIC]: "anthropic-key",
      [SETTING_KEYS.LLM_API_KEY_OPENAI]: "openai-key", [SETTING_KEYS.LLM_PROVIDER_MODEL]: "anthropic-sonnet" };
    expect(fastModelOptions(settings)).toEqual({ aiModel: "claude-haiku-4-5", apiKey: "anthropic-key",
      providerEm: "anthropic" });
  });

  it("falls back to any keyed provider when the dashboard provider itself has no key", () => {
    const settings = { [SETTING_KEYS.LLM_API_KEY_GROK]: "grok-key", [SETTING_KEYS.LLM_PROVIDER_MODEL]: "none" };
    expect(fastModelOptions(settings)).toEqual({ aiModel: "grok-4.3", apiKey: "grok-key", providerEm: "grok" });
  });

  it("names no model when no provider has a key, rather than one that cannot authenticate", () => {
    expect(fastModelOptions({ [SETTING_KEYS.LLM_PROVIDER_MODEL]: "openai" })).toBeNull();
    expect(fastModelOptions({})).toBeNull();
  });

  it("treats a blank stored key as no key", () => {
    expect(fastModelOptions({ [SETTING_KEYS.LLM_API_KEY_GEMINI]: "   " })).toBeNull();
  });
});

describe("wizardLlmOptions", () => {
  it("carries the resolved model and its key alongside the wizard's timeout", () => {
    const settings = { [SETTING_KEYS.LLM_API_KEY_GEMINI]: "gemini-key" };
    expect(wizardLlmOptions(settings)).toEqual({ aiModel: "gemini-3.5-flash-lite", apiKey: "gemini-key",
      jsonResponse: true, timeoutSeconds: WIZARD_LLM_TIMEOUT_SECONDS });
  });

  it("omits the model entirely when no provider is keyed, leaving Ample Agent Pro to supply its own", () => {
    const options = wizardLlmOptions({});
    expect(options).toEqual({ jsonResponse: true, timeoutSeconds: WIZARD_LLM_TIMEOUT_SECONDS });
    expect("aiModel" in options).toBe(false);
    expect("apiKey" in options).toBe(false);
  });
});
