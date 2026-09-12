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
    await expect(raceWizardPrompt({}, "prompt", KEYED_OPTIONS)).resolves.toEqual({ source: "direct" });
  });

  it("answers with Agent Pro when the direct provider is slower", async () => {
    agentProMock.mockResolvedValue({ source: "agent-pro" });
    llmPromptMock.mockReturnValue(resolveAfter({ source: "direct" }, 80));
    await expect(raceWizardPrompt({}, "prompt", KEYED_OPTIONS)).resolves.toEqual({ source: "agent-pro" });
  });

  it("waits for the slower source when the faster one fails rather than settling on its failure", async () => {
    agentProMock.mockResolvedValue(null);
    llmPromptMock.mockReturnValue(resolveAfter({ source: "direct" }, 40));
    await expect(raceWizardPrompt({}, "prompt", KEYED_OPTIONS)).resolves.toEqual({ source: "direct" });
  });

  it("treats a rejection as a source dropping out, not as the race's answer", async () => {
    llmPromptMock.mockRejectedValue(new Error("Timeout"));
    agentProMock.mockReturnValue(resolveAfter({ source: "agent-pro" }, 40));
    await expect(raceWizardPrompt({}, "prompt", KEYED_OPTIONS)).resolves.toEqual({ source: "agent-pro" });
  });

  it("races Agent Pro alone when no provider key was resolved", async () => {
    agentProMock.mockResolvedValue({ source: "agent-pro" });
    const unkeyedOptions = { jsonResponse: true, timeoutSeconds: 60 };
    await expect(raceWizardPrompt({}, "prompt", unkeyedOptions)).resolves.toEqual({ source: "agent-pro" });
    expect(llmPromptMock).not.toHaveBeenCalled();
  });

  it("resolves null when every source fails, so the pass reports no result", async () => {
    agentProMock.mockResolvedValue(null);
    llmPromptMock.mockRejectedValue(new Error("Timeout"));
    await expect(raceWizardPrompt({}, "prompt", KEYED_OPTIONS)).resolves.toBeNull();
  });

  it("forwards the resolved model to both sources so they answer as the same tier", async () => {
    agentProMock.mockResolvedValue({ source: "agent-pro" });
    llmPromptMock.mockResolvedValue(null);
    await raceWizardPrompt({}, "prompt", KEYED_OPTIONS);
    expect(agentProMock).toHaveBeenCalledWith({}, "prompt", { aiModel: "gemini-3.5-flash-lite", jsonResponse: true });
    expect(llmPromptMock).toHaveBeenCalledWith({}, null, "prompt", "gemini-3.5-flash-lite", "gemini-key", true, 60);
  });
});
