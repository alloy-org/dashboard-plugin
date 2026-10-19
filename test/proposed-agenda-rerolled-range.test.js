// A re-rolled day is planned afresh by the next ordinary calendar pass, leaving out the suggestions the re-roll
// discarded and offered, while the other days of the range keep their cached agendas.
import { jest } from "@jest/globals";

const generateProposedAgendaMock = jest.fn(async () => ({ activities: [] }));

await jest.unstable_mockModule("dashboard/proposed-agenda/proposed-agenda-service", async () => ({
  generateProposedAgenda: (...args) => generateProposedAgendaMock(...args),
}));

const { generateProposedAgendaRange } = await import("dashboard/proposed-agenda/proposed-agenda-range");

describe("generateProposedAgendaRange with re-rolled days", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Only the re-rolled day is forced fresh, and only it excludes the re-roll's suggestions.
  it("plans a re-rolled day afresh without its excluded suggestions", async () => {
    const tuesday = new Date(2026, 9, 6);
    const wednesday = new Date(2026, 9, 7);
    const rerolledDays = new Map([[tuesday.toDateString(), { excludedKeys: new Set(["task:task-1"]), forceRegenerate: true }]]);
    await generateProposedAgendaRange({}, { days: [tuesday, wednesday], obligationsForDay: async () => [], rerolledDays });
    const [[, tuesdayOptions], [, wednesdayOptions]] = generateProposedAgendaMock.mock.calls;
    expect(tuesdayOptions.forceRegenerate).toBe(true);
    expect([...tuesdayOptions.excludedSuggestionKeys]).toEqual(["task:task-1"]);
    expect(wednesdayOptions.forceRegenerate).toBe(false);
    expect(wednesdayOptions.excludedSuggestionKeys.size).toBe(0);
  });
});
