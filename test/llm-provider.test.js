// [Claude claude-opus-4-8 (1M context)-authored file]
// Prompt summary: "tests for the shared llm-provider module: the offered AI-provider catalog, lookup by enum,
//   and the chooser's default-selection resolution"
import { DEFAULT_LLM_PROVIDER_EM, LLM_PROVIDER_OPTIONS, defaultSelectedProviderEm,
  providerOptionFromEm, selectableProviderOptions } from "dashboard/llm-provider";

// [Claude claude-opus-4-8 (1M context)] Generated tests for: shared LLM provider catalog + helpers
describe("llm-provider", () => {
  it("offers the four providers shown in the chooser, each with a label and description", () => {
    expect(LLM_PROVIDER_OPTIONS.map(option => option.providerEm)).toEqual(
      ["anthropic", "openai", "gemini", "deepseek"]);
    for (const option of LLM_PROVIDER_OPTIONS) {
      expect(typeof option.label).toBe("string");
      expect(option.label.length).toBeGreaterThan(0);
      expect(typeof option.description).toBe("string");
      expect(option.description.length).toBeGreaterThan(0);
    }
  });

  it("defaults to the first offered provider", () => {
    expect(DEFAULT_LLM_PROVIDER_EM).toBe("anthropic");
  });

  it("resolves a provider option by enum and returns undefined for unknown enums", () => {
    expect(providerOptionFromEm("gemini")?.label).toBe("Google");
    expect(providerOptionFromEm("nope")).toBeUndefined();
    expect(providerOptionFromEm(null)).toBeUndefined();
  });

  it("pre-selects the current provider when offered, else the default", () => {
    expect(defaultSelectedProviderEm("deepseek")).toBe("deepseek");
    expect(defaultSelectedProviderEm("anthropic-sonnet")).toBe(DEFAULT_LLM_PROVIDER_EM);
    expect(defaultSelectedProviderEm(null)).toBe(DEFAULT_LLM_PROVIDER_EM);
  });

  // [Claude claude-opus-4-8 (1M context)] Generated tests for: selectableProviderOptions
  // Prompt: "only show options that correspond to an LLM whose API key has been given by the user"
  describe("selectableProviderOptions", () => {
    const ems = (options) => options.map(option => option.providerEm);

    it("shows only providers with a configured key, plus the current provider", () => {
      const options = selectableProviderOptions({ configuredProviderEms: ["openai"], currentProviderEm: "gemini" });
      expect(ems(options).sort()).toEqual(["gemini", "openai"]);
    });

    it("shows every offered provider when keyless providers are allowed (Agent Pro fallback path)", () => {
      const options = selectableProviderOptions({ allowKeyless: true, configuredProviderEms: [] });
      expect(ems(options)).toEqual(ems(LLM_PROVIDER_OPTIONS));
    });

    it("falls back to all options when nothing is configured, so the chooser is never empty", () => {
      const options = selectableProviderOptions({ configuredProviderEms: [], currentProviderEm: null });
      expect(ems(options)).toEqual(ems(LLM_PROVIDER_OPTIONS));
    });
  });
});
