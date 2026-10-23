// Tests for the wizard's racing prompt runner: both sources answer the same prompt and the first usable result
// wins. The behavior that matters is what the sequential fallback could not do — a slow callLLM must not delay
// a fast direct provider, and a fast failure from either source must not settle the race against a slower success.
import { jest } from "@jest/globals";
import { mockFetchAiProvider } from "./mock-fetch-ai-provider.js";

const amplenoteLlmMock = jest.fn();
const llmPromptMock = jest.fn();

await mockFetchAiProvider({ llmPrompt: (...args) => llmPromptMock(...args) });
await jest.unstable_mockModule("providers/amplenote-llm", async () => ({
  amplenoteDecisionRequester: jest.fn(), amplenoteLlmModel: jest.fn(), amplenoteLlmPrompt: (...args) => amplenoteLlmMock(...args),
  isAmplenoteLlmAvailable: jest.fn() }));

const { raceWizardPrompt } = await import("plan-wizard/wizard-prompt-runner");

const KEYED_OPTIONS = { aiModel: "gemini-3.5-flash-lite", apiKey: "gemini-key", jsonResponse: true,
  timeoutSeconds: 60 };

// ----------------------------------------------------------------------------------------------
// @desc Build a promise resolving to a value after a delay, so one source can be made slower than the other.
// @param {*} value - The value the promise resolves with.
// @param {number} delayMs - Milliseconds to wait before resolving.
// @returns {Promise<*>} The delayed promise.
function resolveAfter(value, delayMs) {
  return new Promise(resolve => setTimeout(() => resolve(value), delayMs));
}

describe("raceWizardPrompt", () => {
  beforeEach(() => {
    amplenoteLlmMock.mockReset();
    llmPromptMock.mockReset();
  });

  it("answers with the direct provider when callLLM is still running", async () => {
    amplenoteLlmMock.mockReturnValue(resolveAfter({ source: "amplenote-llm" }, 80));
    llmPromptMock.mockResolvedValue({ source: "direct" });
    await expect(raceWizardPrompt({}, "prompt", KEYED_OPTIONS)).resolves.toEqual({ source: "direct", wizardPromptSource: "direct-provider" });
  });

  it("answers with callLLM when the direct provider is slower", async () => {
    amplenoteLlmMock.mockResolvedValue({ source: "amplenote-llm" });
    llmPromptMock.mockReturnValue(resolveAfter({ source: "direct" }, 80));
    await expect(raceWizardPrompt({}, "prompt", KEYED_OPTIONS)).resolves.toEqual({ source: "amplenote-llm", wizardPromptSource: "amplenote-llm" });
  });

  it("waits for the slower source when the faster one fails rather than settling on its failure", async () => {
    amplenoteLlmMock.mockResolvedValue(null);
    llmPromptMock.mockReturnValue(resolveAfter({ source: "direct" }, 40));
    await expect(raceWizardPrompt({}, "prompt", KEYED_OPTIONS)).resolves.toEqual({ source: "direct", wizardPromptSource: "direct-provider" });
  });

  it("treats a rejection as a source dropping out, not as the race's answer", async () => {
    llmPromptMock.mockRejectedValue(new Error("Timeout"));
    amplenoteLlmMock.mockReturnValue(resolveAfter({ source: "amplenote-llm" }, 40));
    await expect(raceWizardPrompt({}, "prompt", KEYED_OPTIONS)).resolves.toEqual({ source: "amplenote-llm", wizardPromptSource: "amplenote-llm" });
  });

  it("races callLLM alone when no provider key was resolved", async () => {
    amplenoteLlmMock.mockResolvedValue({ source: "amplenote-llm" });
    const unkeyedOptions = { jsonResponse: true, timeoutSeconds: 60 };
    await expect(raceWizardPrompt({}, "prompt", unkeyedOptions)).resolves.toEqual({ source: "amplenote-llm", wizardPromptSource: "amplenote-llm" });
    expect(llmPromptMock).not.toHaveBeenCalled();
  });

  // A source that states why it failed must reach the caller as a failure, not as an empty answer: the pass that
  // reported "no candidate the evidence supports" to the user had in fact never had a response to evaluate.
  it("throws naming the reason when every source that ran failed", async () => {
    amplenoteLlmMock.mockResolvedValue(null);
    llmPromptMock.mockRejectedValue(new Error("Timeout"));
    await expect(raceWizardPrompt({}, "prompt", KEYED_OPTIONS)).rejects.toThrow(/direct-provider \(Timeout\)/);
  });

  it("resolves null when no source stated a reason, so an absent plugin LLM license is not reported as a failure", async () => {
    amplenoteLlmMock.mockResolvedValue(null);
    const unkeyedOptions = { jsonResponse: true, timeoutSeconds: 60 };
    await expect(raceWizardPrompt({}, "prompt", unkeyedOptions)).resolves.toBeNull();
  });

  it("forwards the resolved model to both sources so they answer as the same tier", async () => {
    amplenoteLlmMock.mockResolvedValue({ source: "amplenote-llm" });
    llmPromptMock.mockResolvedValue(null);
    await raceWizardPrompt({}, "prompt", KEYED_OPTIONS);
    expect(amplenoteLlmMock).toHaveBeenCalledWith({}, "prompt", { aiModel: "gemini-3.5-flash-lite", jsonResponse: true,
      reasoningEffort: undefined, source: "plan-wizard", timeoutSeconds: 60 });
    expect(llmPromptMock).toHaveBeenCalledWith({}, null, "prompt", "gemini-3.5-flash-lite", "gemini-key", true, 60,
      undefined, undefined);
  });

  // Both legs take a reasoning budget: callLLM translates it to each provider's closest equivalent.
  it("forwards a reasoning budget to both sources", async () => {
    amplenoteLlmMock.mockResolvedValue(null);
    llmPromptMock.mockResolvedValue({ source: "direct" });
    await raceWizardPrompt({}, "prompt", { ...KEYED_OPTIONS, reasoningEffort: "low" });
    expect(llmPromptMock).toHaveBeenCalledWith({}, null, "prompt", "gemini-3.5-flash-lite", "gemini-key", true, 60,
      "low", undefined);
    expect(amplenoteLlmMock).toHaveBeenCalledWith({}, "prompt", { aiModel: "gemini-3.5-flash-lite", jsonResponse: true,
      reasoningEffort: "low", source: "plan-wizard", timeoutSeconds: 60 });
  });
});
