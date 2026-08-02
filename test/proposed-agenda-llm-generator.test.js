// [OpenAI GPT-5.5-authored file]
// Created: 2026-08-02 | Model: GPT-5.5
// Task: Verify Proposed Agenda generation does not swallow unexpected exceptions.
// Prompt summary: "Unexpected runProposedAgendaGeneration errors should be observable in tests while loading
//   state still resets."
import { jest } from "@jest/globals";

const generateProposedAgendaMock = jest.fn();
const requestTodayObligationsMock = jest.fn();

await jest.unstable_mockModule("proposed-agenda-service", async () => ({
  approveProposedAgenda: jest.fn(),
  generateProposedAgenda: (...args) => generateProposedAgendaMock(...args),
  resolveProposedAgendaDate: () => new Date(2026, 5, 24, 0, 0, 0),
  scheduleProposedActivity: jest.fn(),
}));

await jest.unstable_mockModule("proposed-agenda-obligations", async () => ({
  requestTodayObligations: (...args) => requestTodayObligationsMock(...args),
}));

const { runProposedAgendaGeneration } = await import("proposed-agenda-llm-generator");

// ----------------------------------------------------------------------------------------------
// @desc Build the setter bundle runProposedAgendaGeneration expects, using jest spies for assertions.
// @returns {object} Setter bundle.
// [OpenAI GPT-5.5] Task: stub Proposed Agenda generation state setters
function generationSetters() {
  return {
    setApproving: jest.fn(),
    setAttribution: jest.fn(),
    setDateLabel: jest.fn(),
    setDismissedKeys: jest.fn(),
    setError: jest.fn(),
    setIsFutureDay: jest.fn(),
    setLoading: jest.fn(),
    setObligations: jest.fn(),
    setProposed: jest.fn(),
    setRecordProviderEm: jest.fn(),
    setScheduledKeys: jest.fn(),
  };
}

beforeEach(() => {
  generateProposedAgendaMock.mockReset();
  requestTodayObligationsMock.mockReset();
});

// [OpenAI GPT-5.5] Generated tests for: Proposed Agenda exception propagation
describe("runProposedAgendaGeneration exception behavior", () => {
  it("rethrows unexpected generation errors while clearing loading state", async () => {
    const setters = generationSetters();
    requestTodayObligationsMock.mockResolvedValue([]);
    generateProposedAgendaMock.mockRejectedValue(new Error("boom"));

    await expect(runProposedAgendaGeneration({}, { currentDate: "2026-06-24", domainUuid: "dom-work",
      priorityKey: "goal-progress", providerEm: "openai", ...setters })).rejects.toThrow("boom");
    expect(setters.setError).not.toHaveBeenCalledWith(expect.objectContaining({ errorCode: "llm_error" }));
    expect(setters.setLoading).toHaveBeenLastCalledWith(false);
  });
});
