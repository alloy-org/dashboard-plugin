// Verify the completed task ledger: its quarter-scoped name, one section per day kept oldest first however days
// arrive, a day replaced in place, entries merged one per task, readable bullets beside the JSON the Dashboard reads,
// and a day whose JSON cannot be read reported rather than read as empty.
import { completedTaskLedgerNoteName, ledgerDateSectionMarkdown, ledgerEntriesFromContent, mergedLedgerEntries,
  openCompletedTaskLedger, readCompletedTaskLedger, writeLedgerDateSection } from "dashboard/projects/completed-task-project-ledger";
import { guideHeadingRanges } from "plan-wizard/vision-guide-markdown";
import { maintenanceApp, SCOPE_INPUT } from "./project-maintenance-test-app";

const SCOPE = { ...SCOPE_INPUT, quarterKey: "2026-Q3" };
const LEDGER_NAME = "Completed Tasks by Project Q3 2026 Work";

// ----------------------------------------------------------------------------------------------
// @desc A ledger entry.
// @param {string} taskUuid - The task's UUID.
// @param {object} [fields] - Fields to override.
// @returns {object} Entry.
function entry(taskUuid, fields = {}) {
  return { classifiedAt: "2026-09-19T12:00:00.000Z", classifiedBy: "link", completedAt: "2026-09-18T15:00:00.000Z",
    confidence: null, projectName: "Launch dashboard", projectUuid: "project-uuid", taskText: `Task ${ taskUuid }`, taskUuid, ...fields };
}

describe("completed task ledger", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc The ledger is named like the project task store, by quarter and domain.
  it("names the ledger by quarter and domain", () => {
    expect(completedTaskLedgerNoteName(SCOPE)).toBe(LEDGER_NAME);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Days are kept oldest first: a later day is appended, a day between two is inserted after the earlier one,
  //   a day before every other is written ahead of them, and a recorded day is replaced in place.
  it("keeps one section per day in date order", async () => {
    const app = maintenanceApp({ tasks: [] });
    let { content, noteHandle } = await openCompletedTaskLedger(app, SCOPE);
    for (const dateKey of ["2026-09-17", "2026-09-19", "2026-09-18", "2026-09-15"]) {
      content = await writeLedgerDateSection(app, { content, dateKey, entries: [entry(`task-${ dateKey }`)], noteHandle });
      expect(app.noteContent(LEDGER_NAME)).toBe(content);
    }
    content = await writeLedgerDateSection(app, { content, dateKey: "2026-09-18", entries: [entry("replaced", { projectUuid: null })],
      noteHandle });
    expect(app.noteContent(LEDGER_NAME)).toBe(content);
    const headingTexts = guideHeadingRanges(content).map(heading => heading.text);
    expect(headingTexts).toEqual(["2026-09-15", "2026-09-17", "2026-09-18", "2026-09-19"]);
    const { entriesByDate, unreadableDates } = await readCompletedTaskLedger(app, SCOPE);
    expect(unreadableDates).toEqual([]);
    expect(entriesByDate.get("2026-09-18").map(recorded => recorded.taskUuid)).toEqual(["replaced"]);
    expect(entriesByDate.get("2026-09-15").map(recorded => recorded.taskUuid)).toEqual(["task-2026-09-15"]);
    expect(content.startsWith("Written by the Dashboard.")).toBe(true);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A ledger that does not exist yet reads as empty and is not created by reading.
  it("reads a missing ledger as empty without creating it", async () => {
    const app = maintenanceApp({ tasks: [] });
    const ledger = await readCompletedTaskLedger(app, SCOPE);
    expect(ledger.entriesByDate.size).toBe(0);
    expect(app.noteContent(LEDGER_NAME)).toBeNull();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Each entry is a bullet naming its project, or None, with long text cut short; the JSON keeps every field.
  it("writes readable bullets beside the day's JSON", () => {
    const longText = `Draft ${ "very ".repeat(50) }long email`;
    const markdown = ledgerDateSectionMarkdown([entry("one"), entry("two", { projectUuid: null, taskText: longText })]);
    const lines = markdown.split("\n");
    expect(lines[0]).toBe("- Task one → **Launch dashboard**");
    expect(lines[1]).toMatch(/^- Draft very .*… → None$/);
    const { entriesByDate } = ledgerEntriesFromContent(`## 2026-09-18\n\n${ markdown }`);
    expect(entriesByDate.get("2026-09-18")[1].taskText).toBe(longText);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A day whose JSON was damaged is reported and its neighbors still read.
  it("reports a day whose JSON cannot be read", () => {
    const content = `Intro\n\n## 2026-09-17\n\n- Broken\n\n\`\`\`json\n{"entries":[\n\`\`\`\n`
      + `## 2026-09-18\n\n${ ledgerDateSectionMarkdown([entry("kept")]) }`;
    const { entriesByDate, unreadableDates } = ledgerEntriesFromContent(content);
    expect(unreadableDates).toEqual(["2026-09-17"]);
    expect([...entriesByDate.keys()]).toEqual(["2026-09-18"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Merging keeps one entry per task, the newer one winning, listed by completion time.
  it("merges a day's entries one per task in completion order", () => {
    const merged = mergedLedgerEntries([entry("late", { completedAt: "2026-09-18T20:00:00.000Z" }), entry("early")],
      [entry("late", { completedAt: "2026-09-18T20:00:00.000Z", projectUuid: null }), entry("middle",
        { completedAt: "2026-09-18T17:00:00.000Z" })]);
    expect(merged.map(merged => merged.taskUuid)).toEqual(["early", "middle", "late"]);
    expect(merged[2].projectUuid).toBeNull();
  });
});
