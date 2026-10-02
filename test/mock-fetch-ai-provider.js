// Shared stand-in for providers/fetch-ai-provider. Dream task and the proposed agenda load Jev's Agent Pro
// caller and the generative prompt as soon as the module evaluates, so a mock that only replaces the fallback
// call is missing those exports. The inert defaults let a ranking attempt fall through to the suite's own mock.
import { jest } from "@jest/globals";

// ----------------------------------------------------------------------------------------------
// @desc Install the fetch-ai-provider mock before the suite imports a module that loads it.
// @param {object} [overrides] - Exports that replace the inert defaults. Suites that assert on the generative
//   call pass llmPromptWithPluginFallback here.
// @returns {Promise<void>}
export async function mockFetchAiProvider(overrides = {}) {
  await jest.unstable_mockModule("providers/fetch-ai-provider", async () => ({
    agentProPrompt: jest.fn(), llmPrompt: jest.fn(), ...overrides }));
}
