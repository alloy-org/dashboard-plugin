// [OpenAI GPT-5.5-authored file]
// Created: 2026-08-02 | Model: GPT-5.5
// Task: Verify Proposed Agenda generation does not swallow unexpected exceptions.
// Prompt summary: "Unexpected runProposedAgendaGeneration errors should be observable in tests while loading
//   state still resets."
import { jest } from "@jest/globals";

const generateProposedAgendaMock = jest.fn();
const requestTodayObligationsMock = jest.fn();

await jest.unstable_mockModule("dashboard/proposed-agenda/proposed-agenda-service", async () => ({
  approveProposedAgenda: jest.fn(),
  generateProposedAgenda: (...args) => generateProposedAgendaMock(...args),
  resolveProposedAgendaDate: () => new Date(2026, 5, 24, 0, 0, 0),
  scheduleProposedActivity: jest.fn(),
}));

await jest.unstable_mockModule("dashboard/proposed-agenda/proposed-agenda-obligations", async () => ({
  obligationsFromTasksAndEvents: () => [],
  requestTodayObligations: (...args) => requestTodayObligationsMock(...args),
}));

const { runProposedAgendaGeneration } = await import("dashboard/proposed-agenda/proposed-agenda-llm-generator");

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

describe("runProposedAgendaGeneration deferred benefits", () => {
  it("shows the placed tasks before their benefit sentences, then fills the benefits in", async () => {
    const setters = generationSetters();
    let proposed = [];
    setters.setProposed = jest.fn(next => { proposed = typeof next === "function" ? next(proposed) : next; });
    requestTodayObligationsMock.mockResolvedValue([]);
    const activity = { durationMinutes: 60, reason: "Ranked first.", startMinutes: 540, taskUuid: "task-1",
      title: "Draft the launch post" };
    let resolveBenefits;
    const benefitRationales = new Promise(resolve => { resolveBenefits = resolve; });
    generateProposedAgendaMock.mockResolvedValue({ activities: [activity], benefitRationales, dateLabel: "Wednesday",
      fromRanking: true });

    const generation = runProposedAgendaGeneration({}, { currentDate: "2026-06-24", domainUuid: "dom-work",
      priorityKey: "goal-progress", providerEm: "openai", ...setters });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(generateProposedAgendaMock).toHaveBeenCalledWith({}, expect.objectContaining({ deferBenefitRationales: true }));
    expect(proposed).toEqual([activity]);
    expect(setters.setLoading).toHaveBeenLastCalledWith(false);

    resolveBenefits({ activities: [{ ...activity, benefit: "The launch reaches readers sooner." }] });
    await generation;
    expect(proposed[0].benefit).toBe("The launch reaches readers sooner.");
  });
});
