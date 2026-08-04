// [Cursor Grok 4.5-authored file]
// Created: 2026-08-04 | Model: Cursor Grok 4.5
// Task: Unit tests for domain-scoped quarterly plan note naming and legacy migration
// Prompt summary: "Quarterly Goals module name must include the Task Domain; migrate legacy plans"
import { jest } from "@jest/globals";
import { legacyQuarterlyPlanNoteName, quarterlyPlanNoteName, resolveQuarterlyPlanNote } from "util/quarterly-plan-notes";

describe("quarterlyPlanNoteName", () => {
  it("includes the Task Domain between the quarter label and Plan", () => {
    expect(quarterlyPlanNoteName("Work", "Q3 2026")).toBe("Q3 2026 Work Plan");
  });

  it("falls back to the legacy name when no domain is provided", () => {
    expect(quarterlyPlanNoteName(null, "Q3 2026")).toBe("Q3 2026 Plan");
    expect(legacyQuarterlyPlanNoteName("Q3 2026")).toBe("Q3 2026 Plan");
  });
});

describe("resolveQuarterlyPlanNote", () => {
  it("returns the domain-scoped note when it already exists", async () => {
    const domainNote = { name: "Q3 2026 Work Plan", uuid: "domain-plan" };
    const app = {
      filterNotes: jest.fn(async ({ query }) => query === "Q3 2026 Work Plan" ? [domainNote] : []),
      setNoteName: jest.fn(),
    };
    const result = await resolveQuarterlyPlanNote(app, true, "Work", "Q3 2026");
    expect(result).toEqual(domainNote);
    expect(app.setNoteName).not.toHaveBeenCalled();
  });

  it("renames a legacy plan onto the migration domain", async () => {
    const legacyNote = { name: "Q3 2026 Plan", uuid: "legacy-plan" };
    const app = {
      filterNotes: jest.fn(async ({ query }) => {
        if (query === "Q3 2026 Work Plan") return [];
        if (query === "Q3 2026 Plan") return [legacyNote];
        return [];
      }),
      setNoteName: jest.fn(async () => true),
    };
    const result = await resolveQuarterlyPlanNote(app, true, "Work", "Q3 2026");
    expect(app.setNoteName).toHaveBeenCalledWith(legacyNote, "Q3 2026 Work Plan");
    expect(result).toEqual({ name: "Q3 2026 Work Plan", uuid: "legacy-plan" });
  });

  it("does not claim a legacy plan for a non-migration domain", async () => {
    const legacyNote = { name: "Q3 2026 Plan", uuid: "legacy-plan" };
    const app = {
      filterNotes: jest.fn(async ({ query }) => {
        if (query === "Q3 2026 Personal Plan") return [];
        if (query === "Q3 2026 Plan") return [legacyNote];
        return [];
      }),
      setNoteName: jest.fn(),
    };
    const result = await resolveQuarterlyPlanNote(app, false, "Personal", "Q3 2026");
    expect(result).toBeNull();
    expect(app.setNoteName).not.toHaveBeenCalled();
  });
});
