// [OpenAI GPT-5.5-authored file]
// Created: 2026-08-02 | Model: GPT-5.5
// Task: Unit tests for shared day recommendation context.
// Prompt summary: "Verify same-weekday completion counts, date-note exclusion, travel event classification, and
//   event-term research note matching."
import { jest } from "@jest/globals";
import { buildDayRecommendationContext, isDateNamedNoteTitle,
  researchNotesForEventTerms } from "recommendation-context/day-recommendation-context";
import { recommendationInstructionsFromContext } from "recommendation-context/recommendation-instructions";

const TARGET_DATE = new Date(2026, 7, 2, 0, 0, 0);
const ONE_WEEK_BACK = Math.floor(new Date(2026, 6, 26, 12, 0, 0).getTime() / 1000);
const TWO_WEEKS_BACK = Math.floor(new Date(2026, 6, 19, 12, 0, 0).getTime() / 1000);

// ----------------------------------------------------------------------------------------------
// @desc Build a context-test app stub with completed task windows, domain scoping, note lookup, and note search.
// @returns {object} Amplenote-app-shaped stub.
// [OpenAI GPT-5.5] Task: stub app surfaces for recommendation-context tests
function buildContextApp() {
  const notes = {
    "project-note": { content: "GitClear marketing launch checklist", name: "GitClear marketing", uuid: "project-note" },
    "daily-note": { content: "daily jot", name: "July 26, 2026", uuid: "daily-note" },
    "kyoto-note": { content: "Kyoto research: Nishiki Market, Fushimi Inari, and quiet mornings", name: "Kyoto food research",
      uuid: "kyoto-note" },
  };
  return {
    filterNotes: jest.fn(async ({ query } = {}) => {
      if (query && query.toLowerCase().includes("kyoto")) return [notes["kyoto-note"]];
      return Object.values(notes);
    }),
    findNote: jest.fn(async ({ uuid }) => notes[uuid] || null),
    getCompletedTasks: jest.fn(async (from) => {
      if (from <= ONE_WEEK_BACK && from + 86400 > ONE_WEEK_BACK) {
        return [
          { completedAt: ONE_WEEK_BACK, content: "Ship campaign", noteName: "GitClear marketing",
            noteUUID: "project-note", uuid: "done-1" },
          { completedAt: ONE_WEEK_BACK, content: "Daily cleanup", noteName: "July 26, 2026",
            noteUUID: "daily-note", uuid: "done-daily" },
        ];
      }
      if (from <= TWO_WEEKS_BACK && from + 86400 > TWO_WEEKS_BACK) {
        return [{ completedAt: TWO_WEEKS_BACK, content: "Draft landing page", noteName: "GitClear marketing",
          noteUUID: "project-note", uuid: "done-2" }];
      }
      return [];
    }),
    getNoteContent: jest.fn(async ({ uuid }) => notes[uuid]?.content || ""),
    getTaskDomainTasks: jest.fn(async () => [
      { noteUUID: "project-note", uuid: "done-1" },
      { noteUUID: "project-note", uuid: "done-2" },
      { noteUUID: "daily-note", uuid: "done-daily" },
    ]),
  };
}

// [OpenAI GPT-5.5] Generated tests for: shared day recommendation context
describe("day recommendation context", () => {
  it("counts completed tasks from the previous two matching weekdays and excludes date-named notes", async () => {
    const app = buildContextApp();
    const context = await buildDayRecommendationContext(app, { domainUuid: "dom-work", targetDate: TARGET_DATE });

    expect(context.completionPatterns).toEqual([
      { completedCount: 2, dates: ["2026-07-19", "2026-07-26"], noteName: "GitClear marketing",
        noteUuid: "project-note" },
    ]);
    expect(context.fingerprint).toContain("GitClear marketing");
    expect(isDateNamedNoteTitle("Sunday, July 26, 2026")).toBe(true);
    expect(isDateNamedNoteTitle("GitClear marketing")).toBe(false);
  });

  it("classifies travel all-day events, finds research notes, and emits overriding LLM instructions", async () => {
    const app = buildContextApp();
    const context = await buildDayRecommendationContext(app, {
      calendarEvents: [{ allDay: true, end: new Date(2026, 7, 3), start: TARGET_DATE,
        title: "Vacation in Kyoto" }],
      targetDate: TARGET_DATE,
    });

    expect(context.eventContext.isTravelLike).toBe(true);
    expect(context.researchNotes[0]).toMatchObject({ name: "Kyoto food research", uuid: "kyoto-note" });
    const instructions = recommendationInstructionsFromContext(context, { allowInventedTravelActivities: true,
      scheduleMode: true });
    expect(instructions).toContain("overrides ordinary weekday routines");
    expect(instructions).toContain("Kyoto food research");
  });

  it("finds event-term research notes from title matches and bounded content snippets", async () => {
    const app = buildContextApp();
    const notes = await researchNotesForEventTerms(app, ["Kyoto"]);
    expect(notes[0].snippet).toContain("Nishiki Market");
  });
});
