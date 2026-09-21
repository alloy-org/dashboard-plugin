// Tests for the wizard's racing prompt runner: both sources answer the same prompt and the first usable result
// wins. The behavior that matters is what the sequential fallback could not do — a slow Agent Pro must not delay
// a fast direct provider, and a fast failure from either source must not settle the race against a slower success.
import { jest } from "@jest/globals";

const agentProMock = jest.fn();
const llmPromptMock = jest.fn();

await jest.unstable_mockModule("providers/fetch-ai-provider", () => ({
  agentProPrompt: (...args) => agentProMock(...args),
  llmPrompt: (...args) => llmPromptMock(...args),
}));

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
    agentProMock.mockReset();
    llmPromptMock.mockReset();
  });

  it("answers with the direct provider when Agent Pro is still running", async () => {
    agentProMock.mockReturnValue(resolveAfter({ source: "agent-pro" }, 80));
    llmPromptMock.mockResolvedValue({ source: "direct" });
    await expect(raceWizardPrompt({}, "prompt", KEYED_OPTIONS)).resolves.toEqual({ source: "direct", wizardPromptSource: "direct-provider" });
  });

  it("answers with Agent Pro when the direct provider is slower", async () => {
    agentProMock.mockResolvedValue({ source: "agent-pro" });
    llmPromptMock.mockReturnValue(resolveAfter({ source: "direct" }, 80));
    await expect(raceWizardPrompt({}, "prompt", KEYED_OPTIONS)).resolves.toEqual({ source: "agent-pro", wizardPromptSource: "agent-pro" });
  });

  it("waits for the slower source when the faster one fails rather than settling on its failure", async () => {
    agentProMock.mockResolvedValue(null);
    llmPromptMock.mockReturnValue(resolveAfter({ source: "direct" }, 40));
    await expect(raceWizardPrompt({}, "prompt", KEYED_OPTIONS)).resolves.toEqual({ source: "direct", wizardPromptSource: "direct-provider" });
  });

  it("treats a rejection as a source dropping out, not as the race's answer", async () => {
    llmPromptMock.mockRejectedValue(new Error("Timeout"));
    agentProMock.mockReturnValue(resolveAfter({ source: "agent-pro" }, 40));
    await expect(raceWizardPrompt({}, "prompt", KEYED_OPTIONS)).resolves.toEqual({ source: "agent-pro", wizardPromptSource: "agent-pro" });
  });

  it("races Agent Pro alone when no provider key was resolved", async () => {
    agentProMock.mockResolvedValue({ source: "agent-pro" });
    const unkeyedOptions = { jsonResponse: true, timeoutSeconds: 60 };
    await expect(raceWizardPrompt({}, "prompt", unkeyedOptions)).resolves.toEqual({ source: "agent-pro", wizardPromptSource: "agent-pro" });
    expect(llmPromptMock).not.toHaveBeenCalled();
  });

  // A source that states why it failed must reach the caller as a failure, not as an empty answer: the pass that
  // reported "no candidate the evidence supports" to the user had in fact never had a response to evaluate.
  it("throws naming the reason when every source that ran failed", async () => {
    agentProMock.mockResolvedValue(null);
    llmPromptMock.mockRejectedValue(new Error("Timeout"));
    await expect(raceWizardPrompt({}, "prompt", KEYED_OPTIONS)).rejects.toThrow(/direct-provider \(Timeout\)/);
  });

  it("resolves null when no source stated a reason, so an absent Agent Pro is not reported as a failure", async () => {
    agentProMock.mockResolvedValue(null);
    const unkeyedOptions = { jsonResponse: true, timeoutSeconds: 60 };
    await expect(raceWizardPrompt({}, "prompt", unkeyedOptions)).resolves.toBeNull();
  });

  it("forwards the resolved model to both sources so they answer as the same tier", async () => {
    agentProMock.mockResolvedValue({ source: "agent-pro" });
    llmPromptMock.mockResolvedValue(null);
    await raceWizardPrompt({}, "prompt", KEYED_OPTIONS);
    expect(agentProMock).toHaveBeenCalledWith({}, "prompt", { aiModel: "gemini-3.5-flash-lite", jsonResponse: true });
    expect(llmPromptMock).toHaveBeenCalledWith({}, null, "prompt", "gemini-3.5-flash-lite", "gemini-key", true, 60,
      undefined, undefined);
  });

  // Only the direct provider takes a reasoning budget; Agent Pro runs the model on its own terms and would reject
  // an unrecognized field, so the option must not reach it.
  it("forwards a reasoning budget to the direct provider alone", async () => {
    agentProMock.mockResolvedValue(null);
    llmPromptMock.mockResolvedValue({ source: "direct" });
    await raceWizardPrompt({}, "prompt", { ...KEYED_OPTIONS, reasoningEffort: "low" });
    expect(llmPromptMock).toHaveBeenCalledWith({}, null, "prompt", "gemini-3.5-flash-lite", "gemini-key", true, 60,
      "low", undefined);
    expect(agentProMock).toHaveBeenCalledWith({}, "prompt", { aiModel: "gemini-3.5-flash-lite", jsonResponse: true });
  });
});
