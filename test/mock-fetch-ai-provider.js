// Shared stand-in for providers/fetch-ai-provider. Goal Coach and the proposed agenda load the generative prompt as
// soon as the module evaluates, so a mock that only replaces the fallback call is missing that export. The inert
// default lets a ranking attempt fall through to the suite's own mock.
import { jest } from "@jest/globals";

// ----------------------------------------------------------------------------------------------
// @desc Install the fetch-ai-provider mock before the suite imports a module that loads it.
// @param {object} [overrides] - Exports that replace the inert defaults. Suites that assert on the generative
//   call pass llmPromptWithAmplenoteFallback here.
// @returns {Promise<void>}
export async function mockFetchAiProvider(overrides = {}) {
  await jest.unstable_mockModule("providers/fetch-ai-provider", async () => ({
    llmPrompt: jest.fn(), ...overrides }));
}
