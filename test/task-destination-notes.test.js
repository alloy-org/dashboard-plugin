// Verify the notes offered to the idea prompt as places to create a task: task-bearing notes updated within the recency
// window, newest first, leaving out the Dashboard's own notes and starter samples, and read with one filterNotes call.
import { jest } from "@jest/globals";
import { DASHBOARD_NOTE_TAG } from "constants/settings";
import { DESTINATION_NOTE_RECENCY_DAYS, recentTaskDestinationNotes } from "task-destination-notes";

const NOW = new Date("2026-10-05T12:00:00.000Z");
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

// ----------------------------------------------------------------------------------------------
// @desc An ISO timestamp the given number of days before NOW.
// @param {number} days - Days before NOW.
// @returns {string} ISO timestamp.
function daysAgo(days) {
  return new Date(NOW.getTime() - days * MILLISECONDS_PER_DAY).toISOString();
}

describe("recentTaskDestinationNotes", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Only recent, user-owned task notes are offered, newest first and capped, scoped to the Task Domain.
  it("offers recently updated task notes, newest first, without Dashboard or starter notes", async () => {
    const handles = [{ name: "Old project", tags: [], updated: daysAgo(DESTINATION_NOTE_RECENCY_DAYS + 1), uuid: "old" },
      { name: "Proposed Agenda", tags: [DASHBOARD_NOTE_TAG], updated: daysAgo(1), uuid: "agenda" },
      { name: "Sample", tags: ["starter-notes/tour"], updated: daysAgo(1), uuid: "starter" },
      { name: "Launch\n plan", tags: ["work"], updated: daysAgo(10), uuid: "launch" },
      { name: "Inbox", updated: daysAgo(2), uuid: "inbox" }, { name: "Third", updated: daysAgo(3), uuid: "third" }];
    const app = { filterNotes: jest.fn().mockResolvedValue(handles) };
    const notes = await recentTaskDestinationNotes(app, { domainUuid: "domain-1", maximumNoteCount: 2, now: NOW });
    expect(app.filterNotes).toHaveBeenCalledWith({ group: "taskLists", taskDomainUUID: "domain-1" }, "updated");
    expect(notes).toEqual([{ name: "Inbox", uuid: "inbox" }, { name: "Third", uuid: "third" }]);
    const uncapped = await recentTaskDestinationNotes(app, { now: NOW });
    expect(uncapped.map(note => note.uuid)).toEqual(["inbox", "third", "launch"]);
    expect(uncapped[2].name).toBe("Launch plan");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A failed read offers no notes rather than failing idea generation.
  it("offers no notes when the read fails", async () => {
    const app = { filterNotes: jest.fn().mockRejectedValue(new Error("offline")) };
    await expect(recentTaskDestinationNotes(app, { now: NOW })).resolves.toEqual([]);
  });
});
