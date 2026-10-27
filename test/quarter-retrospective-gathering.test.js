// Verify how a Quarter Retrospective gathers its quarter: footnote text and images resolved from a task or, failing
// that, its note; images other than http(s) pictures left out; tasks still open at quarter end counted per project
// from the tasks open now and those completed since; meeting time divided by title and attendee count; and the
// gatherer joining it all, reporting each step and recording the sections in the data note.
import { jest } from "@jest/globals";
import { gatherRetrospectiveQuarter } from "dashboard/quarter-retrospective/retrospective-data";
import { meetingMinutesByCategory } from "dashboard/quarter-retrospective/retrospective-calendar-categories";
import { generateRetrospective } from "dashboard/quarter-retrospective/retrospective-generation";
import { markdownImages, openAtQuarterEndByProject, taskFootnoteEvidence,
  taskNeedsNoteFootnotes } from "dashboard/quarter-retrospective/retrospective-task-evidence";
import { guideHeadingRanges } from "plan-wizard/vision-guide-markdown";
import { maintenanceApp } from "./project-maintenance-test-app";

const SCOPE = { domainName: "Work", domainUuid: "work-domain", quarter: 3, year: 2026 };
const QUARTER_END_MILLIS = new Date(2026, 9, 1).getTime();

// ----------------------------------------------------------------------------------------------
// @desc Unix seconds for a local date and hour.
// @param {number} month - 1 through 12.
// @param {number} day - Day of the month.
// @param {number} [hour] - Hour of the day.
// @returns {number} Seconds.
function seconds(month, day, hour = 12) {
  return Math.floor(new Date(2026, month - 1, day, hour).getTime() / 1000);
}

describe("retrospective task evidence", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A footnote the task defines is resolved from the task; one only its note defines needs the note.
  it("resolves footnote text and images from the task, then its note", () => {
    const taskContent = "Shipped [the launch][^1] and [demo][^2]\n\n[^1]: [Launch]()\n    ![Launch screen](https://images.example.com/launch.png)\n    Went live Monday.";
    expect(taskNeedsNoteFootnotes(taskContent)).toBe(true);
    const fromTask = taskFootnoteEvidence(taskContent);
    expect(fromTask.missingIdentifiers).toEqual(["2"]);
    expect(fromTask.images).toEqual([{ alt: "Launch screen", url: "https://images.example.com/launch.png" }]);
    expect(fromTask.footnoteText).toContain("Went live Monday.");

    const noteContent = "# Notes\n\n[^2]: [Demo]()\n    ![](https://images.example.com/demo.jpg)\n    Recorded for the board.";
    const withNote = taskFootnoteEvidence(taskContent, noteContent);
    expect(withNote.missingIdentifiers).toEqual([]);
    expect(withNote.images.map(image => image.url)).toEqual(["https://images.example.com/launch.png", "https://images.example.com/demo.jpg"]);
    expect(withNote.footnoteText).toContain("Recorded for the board.");
    expect(taskNeedsNoteFootnotes("No footnotes here")).toBe(false);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Videos, relative paths, and repeats are left out of the images.
  it("keeps only http(s) pictures, each once", () => {
    const markdown = "![a](https://x.com/a.png) ![b](https://x.com/clip.mp4) ![c](/local.png) ![d](https://x.com/a.png)";
    expect(markdownImages(markdown)).toEqual([{ alt: "a", url: "https://x.com/a.png" }]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A project's task is open at quarter end when it's open now or was completed since, and was created before
  //   the quarter ended.
  it("counts each project's tasks still open when the quarter ended", () => {
    const projects = [{ relatedTaskRecords: [{ taskUuid: "open-old" }, { taskUuid: "open-new" }], relatedTasks: ["finished-late", "finished-early"],
      summary: "Launch", uuid: "project-launch" }, { relatedTaskRecords: [], relatedTasks: [], summary: "Idle", uuid: "project-idle" }];
    const openTasks = [{ createdAt: seconds(8, 1), uuid: "open-old" }, { createdAt: seconds(10, 5), uuid: "open-new" }];
    const laterCompletedTasks = [{ completedAt: seconds(10, 3), createdAt: seconds(9, 1), uuid: "finished-late" }];
    const counts = openAtQuarterEndByProject({ laterCompletedTasks, openTasks, projects, quarterEndMillis: QUARTER_END_MILLIS });
    expect(counts).toEqual(new Map([["project-launch", 2], ["project-idle", 0]]));
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Titles mark personal and external events; the rest divide by attendee count, a title seen on three days
  //   counts as recurring, and all-day events don't count.
  it("divides meeting time by kind of meeting", () => {
    const event = (dateKey, attendeeCount, title, startHour, endHour, allDay = false) => ({ allDay, attendeeCount, title,
      end: `${ dateKey }T${ endHour }:00:00.000Z`, start: `${ dateKey }T${ startHour }:00:00.000Z` });
    const days = new Map([
      ["2026-07-28", { events: [event("2026-07-28", 1, "Weekly sync", "12", "13")] }],
      ["2026-07-29", { events: [event("2026-07-29", 1, "Weekly sync", "12", "13"), event("2026-07-29", 0, "Dentist", "15", "16")] }],
      ["2026-07-30", { events: [event("2026-07-30", 0, "Deep work", "09", "11"), event("2026-07-30", 1, "weekly  sync", "12", "13"),
        event("2026-07-30", 3, "Customer demo", "14", "15"), event("2026-07-30", 4, "Planning", "16", "17"), event("2026-07-30", 2, "Offsite", "00", "23", true)] }]]);
    expect(meetingMinutesByCategory(days)).toEqual([
      { category: "1:1s", eventCount: 3, minutes: 180, recurringEventCount: 3, sampleTitles: ["Weekly sync"] },
      { category: "Focus blocks", eventCount: 1, minutes: 120, recurringEventCount: 0, sampleTitles: ["Deep work"] },
      { category: "Personal", eventCount: 1, minutes: 60, recurringEventCount: 0, sampleTitles: ["Dentist"] },
      { category: "External meetings", eventCount: 1, minutes: 60, recurringEventCount: 0, sampleTitles: ["Customer demo"] },
      { category: "Team meetings", eventCount: 1, minutes: 60, recurringEventCount: 0, sampleTitles: ["Planning"] }]);
  });
});

describe("gatherRetrospectiveQuarter", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc An app holding a quarter's two completions in one note, a note whose content defines a task's footnote,
  //   the project task store's Launch project with one task still open, and the calendar journal.
  // @returns {object} App mock.
  function gatheringApp() {
    const app = maintenanceApp({ tasks: [] });
    const completedInQuarter = [{ completedAt: seconds(7, 10), content: "Write the launch post [draft][^1]", noteUUID: "launch-note",
      uuid: "task-post" }, { completedAt: seconds(7, 11), content: "Send the newsletter", noteUUID: "launch-note", uuid: "task-newsletter" }];
    app.getCompletedTasks = jest.fn(async fromSeconds => (fromSeconds < seconds(10, 1, 0) ? completedInQuarter : []));
    app.getTaskDomainTasks = jest.fn(async () => [{ createdAt: seconds(9, 1), uuid: "task-pricing" }]);
    const findByName = app.findNote;
    app.findNote = jest.fn(async ({ name, uuid }) => {
      if (uuid === "launch-note") return { name: "Launch plan", tags: ["work/launch"], uuid };
      return findByName({ name, uuid });
    });
    const readContent = app.getNoteContent;
    app.getNoteContent = jest.fn(async ({ uuid }) => (uuid === "launch-note"
      ? "Plan\n\n[^1]: [Draft]()\n    ![Cover](https://images.example.com/cover.png)\n    The first draft." : readContent({ uuid })));
    return app;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Completions carry their note's name, tags, and footnotes; each note is read once; open project tasks are
  //   counted; and the progress steps are reported.
  it("joins tasks, notes, footnotes, and open project tasks", async () => {
    const app = gatheringApp();
    const store = "Maintained by the Dashboard.\n\n# Active projects\n\n## Launch\n\n```json\n"
      + `${ JSON.stringify({ relatedTaskRecords: [{ taskText: "Set pricing", taskUuid: "task-pricing" }], summary: "Launch", uuid: "project-launch" }) }\n\`\`\`\n`
      + "\n# Past projects\n";
    const storeUuid = await app.createNote("Project Tasks Q3 2026 Work", []);
    await app.replaceNoteContent({ uuid: storeUuid }, store);
    const progress = [];
    const gathered = await gatherRetrospectiveQuarter(app, SCOPE, { onProgress: message => progress.push(message) });

    const post = gathered.completions.find(completion => completion.taskUuid === "task-post");
    expect(post).toMatchObject({ footnoteText: expect.stringContaining("The first draft."), noteName: "Launch plan", noteTags: ["work/launch"] });
    expect(gathered.media).toEqual([{ alt: "Cover", footnoteText: expect.stringContaining("The first draft."), taskText: "Write the launch post draft",
      taskUuid: "task-post", url: "https://images.example.com/cover.png" }]);
    expect(app.getNoteContent.mock.calls.filter(([handle]) => handle.uuid === "launch-note")).toHaveLength(1);
    expect(gathered.projects).toEqual([{ derivedFrom: "plan", name: "Launch", uuid: "project-launch" }]);
    expect(gathered.statistics.doneAndOpenByProject).toEqual([{ doneCount: 0, name: "Launch", openCount: 1, projectUuid: "project-launch" }]);
    expect(gathered.statistics.defaultedDurationCount).toBe(2);
    expect(gathered.calendar).toBeNull();
    expect(progress[0]).toBe("Reading Q3 2026's completed tasks…");
    expect(progress).toContain("Reading the notes behind 2 completed tasks…");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Generation records every gathered section, with the calendar when asked for.
  it("records the gathered sections in the data note", async () => {
    const app = gatheringApp();
    const request = { ...SCOPE, options: { includeCalendar: true }, style: "data" };
    await generateRetrospective(app, request);
    const headingTexts = guideHeadingRanges(app.noteContent("Work Q3 2026 Data Retrospective Data")).map(heading => heading.text);
    expect(headingTexts).toEqual(["Request", "Statistics", "Projects", "Month 1", "Month 2", "Month 3", "Calendar", "Media", "Story"]);
  });
});
