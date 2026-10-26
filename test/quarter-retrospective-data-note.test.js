// Verify the Quarter Retrospective's data note: its per-style name, payloads that round-trip through continued
// sections, backticks that can't close a fence, sections appended in order and replaced in place when they fit one
// write, a generation started over for its style, saved retrospectives found newest first, and generation that still
// plays its story when the note can't be written.
import { jest } from "@jest/globals";
import { readRetrospectiveDataNote, RETROSPECTIVE_SECTIONS, retrospectiveDataNoteName, retrospectiveSectionChunks,
  retrospectiveSectionsFromContent, startRetrospectiveDataNote,
  writeRetrospectiveDataSection } from "dashboard/quarter-retrospective/retrospective-data-note";
import { generateRetrospective, quarterDateKeyRange,
  savedRetrospectives } from "dashboard/quarter-retrospective/retrospective-generation";
import { guideHeadingRanges } from "plan-wizard/vision-guide-markdown";
import { createPlanWizardApp } from "./fixtures/plan-wizard-app.js";
import { maintenanceApp } from "./project-maintenance-test-app";

const REQUEST = { domainName: "Work", domainUuid: "work-domain", options: { includeCalendar: false }, quarter: 3, style: "data", year: 2026 };
const DATA_NOTE_NAME = "Work Q3 2026 Data Retrospective Data";

// ----------------------------------------------------------------------------------------------
// @desc An app holding notes by name, which can also read a quarter's completed tasks.
// @param {Array<object>} [completedTasks] - What getCompletedTasks returns.
// @returns {object} App mock.
function retrospectiveApp(completedTasks = []) {
  const app = maintenanceApp({ tasks: [] });
  app.getCompletedTasks = jest.fn(async () => completedTasks);
  return app;
}

describe("retrospective data note", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Each style of a domain's quarter has its own note.
  it("names the note by domain, quarter, and style", () => {
    expect(retrospectiveDataNoteName(REQUEST)).toBe(DATA_NOTE_NAME);
    expect(retrospectiveDataNoteName({ ...REQUEST, style: "roast" })).toBe("Work Q3 2026 Roast Retrospective Data");
    expect(quarterDateKeyRange({ quarter: 3, year: 2026 })).toEqual({ endDateKey: "2026-09-30", startDateKey: "2026-07-01" });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A payload larger than one part continues in numbered sections and reads back whole, and a backtick in the
  //   text never appears raw inside the fence.
  it("splits a large payload into continued sections that read back whole", () => {
    const payload = { tasks: Array.from({ length: 40 }, (unused, index) => ({ text: `Task ${ index } with \`\`\` inside` })) };
    const chunks = retrospectiveSectionChunks("Month 1", payload, { chunkCharacters: 200 });
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks[1].heading).toBe("Month 1 (continued 2)");
    expect(chunks.every(chunk => !chunk.body.slice(8, -4).includes("`"))).toBe(true);
    const content = chunks.map(chunk => `## ${ chunk.heading }\n\n${ chunk.body }`).join("\n");
    const { payloads, unreadableHeadings } = retrospectiveSectionsFromContent(content);
    expect(unreadableHeadings).toEqual([]);
    expect(payloads.get("Month 1")).toEqual(payload);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A section missing one of its parts is reported unreadable rather than read short.
  it("reports a section missing a part", () => {
    const chunks = retrospectiveSectionChunks("Month 1", { text: "x".repeat(500) }, { chunkCharacters: 100 });
    const withoutSecond = chunks.filter((chunk, index) => index !== 1);
    const content = withoutSecond.map(chunk => `## ${ chunk.heading }\n\n${ chunk.body }`).join("\n");
    expect(retrospectiveSectionsFromContent(content).unreadableHeadings).toEqual(["Month 1"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A generation starts with its request, appends sections in order, and replaces a single-part section in
  //   place; a multi-part section can't be replaced, and starting over empties the note.
  it("appends sections in order and replaces one that fits a single write", async () => {
    const app = retrospectiveApp();
    const started = await startRetrospectiveDataNote(app, REQUEST);
    let content = started.content;
    content = await writeRetrospectiveDataSection(app, { chunkCharacters: 120, content, heading: "Month 1", noteHandle: started.noteHandle,
      payload: { summary: "y".repeat(300) } });
    content = await writeRetrospectiveDataSection(app, { content, heading: RETROSPECTIVE_SECTIONS.takeaways, noteHandle: started.noteHandle,
      payload: { noteUuid: null } });
    content = await writeRetrospectiveDataSection(app, { content, heading: RETROSPECTIVE_SECTIONS.takeaways, noteHandle: started.noteHandle,
      payload: { noteUuid: "takeaways-uuid" } });
    expect(app.noteContent(DATA_NOTE_NAME)).toBe(content);
    const headingTexts = guideHeadingRanges(content).map(heading => heading.text);
    expect(headingTexts).toEqual(["Request", "Month 1", "Month 1 (continued 2)", "Month 1 (continued 3)", "Takeaways"]);
    const { payloads } = await readRetrospectiveDataNote(app, started.noteHandle.uuid);
    expect(payloads.get("Takeaways")).toEqual({ noteUuid: "takeaways-uuid" });
    expect(payloads.get("Month 1").summary).toHaveLength(300);
    expect(payloads.get("Request")).toMatchObject({ domainName: "Work", quarter: 3, style: "data", version: 1 });

    await expect(writeRetrospectiveDataSection(app, { content, heading: "Month 1", noteHandle: started.noteHandle,
      payload: { summary: "short" } })).rejects.toThrow("can only be replaced");
    const restarted = await startRetrospectiveDataNote(app, REQUEST);
    expect(restarted.noteHandle.uuid).toBe(started.noteHandle.uuid);
    expect(guideHeadingRanges(app.noteContent(DATA_NOTE_NAME)).map(heading => heading.text)).toEqual(["Request"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A new note is written through the identifier the host resolves, not the local one createNote returned.
  it("writes a newly created note through its resolved identifier", async () => {
    const app = createPlanWizardApp();
    const started = await startRetrospectiveDataNote(app, REQUEST);
    expect(started.noteHandle.uuid).toBe("note-1");
    expect(app.notes[0].content).toContain("## Request");
    expect(app.notes[0].archived).toBe(true);
  });
});

describe("retrospective generation", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Generating the Data style records its statistics, projects, media, and story, and saved retrospectives list it
  //   with its slides.
  it("records a generated Data retrospective and finds it again", async () => {
    const completedAt = Math.floor(new Date(2026, 7, 12, 15).getTime() / 1000);
    const app = retrospectiveApp([{ completedAt, content: "Ship the dashboard", uuid: "task-1", victoryValue: 5 }]);
    const generated = await generateRetrospective(app, REQUEST);
    expect(generated.noteUuid).toBeTruthy();
    expect(generated.slides.length).toBeGreaterThan(0);
    const headingTexts = guideHeadingRanges(app.noteContent(DATA_NOTE_NAME)).map(heading => heading.text);
    expect(headingTexts).toEqual(["Request", "Statistics", "Projects", "Media", "Story"]);

    const saved = await savedRetrospectives(app, REQUEST);
    expect(saved.map(retrospective => retrospective.style)).toEqual(["data"]);
    expect(saved[0].slides).toEqual(generated.slides);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A note that can't be written still yields the story, and a style not built yet is refused.
  it("plays the story when recording fails, and refuses styles not built yet", async () => {
    const app = retrospectiveApp([]);
    app.createNote = async () => { throw new Error("offline"); };
    const generated = await generateRetrospective(app, REQUEST);
    expect(generated.noteUuid).toBeNull();
    expect(generated.slides[0].id).toBe("empty");
    await expect(generateRetrospective(app, { ...REQUEST, style: "roast" })).rejects.toThrow("isn't available yet");
  });
});
