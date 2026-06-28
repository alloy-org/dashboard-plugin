// [Claude claude-opus-4-8 (1M context)-authored file]
// Prompt summary: "shared LLM-provider selection: the AI providers a user can pick to generate dashboard AI
//   content (Anthropic / OpenAI / Google / DeepSeek), each with a one-line note on what it excels at, plus
//   lookup + default helpers. Consumed by the LlmProviderSelector popup used by the proposed-agenda and
//   dream-task widgets."

// ----------------------------------------------------------------------------------------------
// @desc The AI providers offered when a user chooses which model generates dashboard AI content, each with a
//   one-line note on what that provider is known to excel at. `providerEm` is the provider bucket understood by
//   the LLM services (proposed-agenda-service / dream-task-service).
// [Claude claude-opus-4-8 (1M context)] Task: consolidate the offered AI-provider options in one shared module
// Prompt: "Move the LLM selection into llm-provider.js"
export const LLM_PROVIDER_OPTIONS = [
  { description: "Claude — nuanced reasoning, careful instruction-following, and strong writing.",
    label: "Anthropic", providerEm: "anthropic" },
  { description: "GPT — well-rounded general performance with the broadest tooling ecosystem.",
    label: "OpenAI", providerEm: "openai" },
  { description: "Gemini — very large context windows and strong long-document / multimodal handling.",
    label: "Google", providerEm: "gemini" },
  { description: "DeepSeek — cost-efficient, with strong coding and math reasoning.",
    label: "DeepSeek", providerEm: "deepseek" },
];

export const DEFAULT_LLM_PROVIDER_EM = LLM_PROVIDER_OPTIONS[0].providerEm;

// ----------------------------------------------------------------------------------------------
// @desc Resolve a provider option by its provider enum.
// @param {string|null} providerEm - One of LLM_PROVIDER_OPTIONS[].providerEm.
// @returns {object|undefined} The matching option, or undefined when the enum is unknown.
// [Claude claude-opus-4-8 (1M context)] Task: look up an offered provider option by enum
export function providerOptionFromEm(providerEm) {
  return LLM_PROVIDER_OPTIONS.find(option => option.providerEm === providerEm);
}

// ----------------------------------------------------------------------------------------------
// @desc Pick the provider that should be pre-selected when the chooser opens: the supplied current provider
//   when it is one of the offered options, otherwise the first offered provider.
// @param {string|null} currentProviderEm - Currently active provider enum.
// @returns {string} A providerEm guaranteed to exist in LLM_PROVIDER_OPTIONS.
// [Claude claude-opus-4-8 (1M context)] Task: resolve the chooser's default selection
export function defaultSelectedProviderEm(currentProviderEm) {
  return providerOptionFromEm(currentProviderEm) ? currentProviderEm : DEFAULT_LLM_PROVIDER_EM;
}
