// Exercise the two-runs-per-day limit on "Generate ideas": counting runs within the local day and pruning old ones.
import { IDEA_GENERATION_DAILY_MAXIMUM, ideaGenerationRunAllowance, ideaGenerationRunTimes,
  runTimesWithRun } from "dashboard/idea-generation-allowance";

const NOW = new Date(2026, 9, 15, 14, 0, 0);

describe("idea generation allowance", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Only runs since local midnight count; the next run's number follows them, and none is allowed past the limit.
  it("counts the runs started today", () => {
    const yesterday = new Date(2026, 9, 14, 23, 30).toISOString();
    const thisMorning = new Date(2026, 9, 15, 8, 0).toISOString();
    expect(ideaGenerationRunAllowance([yesterday], NOW)).toEqual({ allowed: true, maximum: IDEA_GENERATION_DAILY_MAXIMUM, runNumber: 1,
      usedCount: 0 });
    expect(ideaGenerationRunAllowance([yesterday, thisMorning], NOW)).toMatchObject({ allowed: true, runNumber: 2, usedCount: 1 });
    const spent = ideaGenerationRunAllowance([thisMorning, new Date(2026, 9, 15, 9, 0).toISOString()], NOW);
    expect(spent).toMatchObject({ allowed: false, runNumber: 2, usedCount: 2 });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Unreadable settings count no runs, and recording a run drops times older than two days.
  it("reads and prunes stored run times", () => {
    expect(ideaGenerationRunTimes("not json")).toEqual([]);
    expect(ideaGenerationRunTimes(JSON.stringify(["2026-10-15T08:00:00.000Z", 7, "bad"]))).toEqual(["2026-10-15T08:00:00.000Z"]);
    const old = new Date(2026, 9, 12, 9, 0).toISOString();
    const recent = new Date(2026, 9, 14, 9, 0).toISOString();
    expect(runTimesWithRun([old, recent], NOW)).toEqual([recent, NOW.toISOString()]);
  });
});
