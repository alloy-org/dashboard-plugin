// Verify the evidence collected for a dictionary term: passages are cut where the term appears as a whole word, carry
// their heading and the full Rich Footnotes they cite, and an uncited footnote naming the term gives its own passage;
// collection skips notes the plugin maintains, keeps a copied passage once, spreads passages across notes, bounds the
// notes it reads, and falls back to an unquoted search; the job saves the record or retires when the term is gone; and
// the store gives up the oldest records' passages first when they outgrow the note.
import { jest } from "@jest/globals";
import { createCollectTermEvidenceHandler } from "dashboard/work-queue/jobs/collect-term-evidence";
import { termEvidenceRequest } from "dashboard/work-queue/jobs/project-job-requests";
import DashboardNoteWriter from "dashboard/work-queue/dashboard-note-writer";
import { collectTermEvidence, EVIDENCE_OUTCOMES, MAXIMUM_EVIDENCE_NOTES_READ, MAXIMUM_PASSAGE_CHARACTERS,
  termPassagesFromContent } from "plan-wizard/stack-rank/dictionary-term-evidence";
import { MAXIMUM_STORED_PASSAGE_CHARACTERS, savedTermEvidence,
  storedTermEvidence } from "plan-wizard/stack-rank/dictionary-term-evidence-store";
import { jobContext, NOW } from "./project-maintenance-test-app";

const YEAR = 2026;

// ----------------------------------------------------------------------------------------------
// @desc An in-memory notebook whose full search matches a quoted query as a phrase and an unquoted one by its words,
//   best matches being the notes listed first.
// @param {Array<object>} seedNotes - { content, name, tags }.
// @returns {object} App mock carrying `noteContent(name)` and the `searchNotes` mock for assertions.
function notebookApp(seedNotes) {
  const notes = new Map(seedNotes.map((note, index) => [`seed-${ index + 1 }`, { tags: [], ...note }]));
  let sequence = 0;
  const entryNamed = name => [...notes.entries()].find(([, note]) => note.name === name) || null;
  const matchesQuery = (content, query) => {
    const lowered = content.toLowerCase();
    if (query.startsWith("\"")) return lowered.includes(query.slice(1, -1).toLowerCase());
    return query.toLowerCase().split(/\s+/).every(word => lowered.includes(word));
  };
  const app = {
    createNote: async (name, tags = []) => {
      sequence += 1;
      notes.set(`created-${ sequence }`, { content: "", name, tags });
      return `created-${ sequence }`;
    },
    findNote: async ({ name, uuid }) => {
      if (uuid) return notes.has(uuid) ? { name: notes.get(uuid).name, uuid } : null;
      const entry = entryNamed(name);
      return entry ? { name, uuid: entry[0] } : null;
    },
    getNoteContent: jest.fn(async ({ uuid }) => notes.get(uuid)?.content ?? ""),
    noteContent: name => entryNamed(name)?.[1].content ?? null,
    replaceNoteContent: async ({ uuid }, content) => {
      notes.get(uuid).content = content;
      return true;
    },
    searchNotes: jest.fn(async query => {
      const matching = [...notes.entries()].filter(([, note]) => matchesQuery(note.content, query));
      return matching.map(([uuid, note]) => ({ name: note.name, tags: note.tags, uuid }));
    }),
  };
  return app;
}

// ----------------------------------------------------------------------------------------------
// @desc An evidence record carrying one passage of a given length, for exercising the store's passage budget.
// @param {string} term - The term.
// @param {string} collectedAt - ISO time.
// @param {number} length - Characters in its one passage.
// @returns {object} An evidence record.
function evidenceRecord(term, collectedAt, length) {
  return { collectedAt, notesRead: 1, outcome: EVIDENCE_OUTCOMES.found, passages: [{ noteUuid: "source", text: "x".repeat(length) }],
    query: { text: `"${ term }"`, unquotedFallback: false }, sourceDigest: "00000000",
    sources: [{ contentDigest: "00000000", noteName: "Source", noteUuid: "source", passageCount: 1 }], term };
}

describe("dictionary term evidence", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A block naming the term keeps its heading and every line of the footnote it cites, code included; an uncited
  //   footnote naming the term is its own passage; a block naming it only inside another word gives none.
  it("cuts passages with their headings and full footnotes", () => {
    const content = [
      "# Release plan",
      "The Widget grid ships with [layout rules][^1].",
      "",
      "Rewidgetize nothing else.",
      "",
      "[^1]: [Layout rules]()",
      "    Each card spans one column.",
      "",
      "    ```",
      "    { columns: 3 }",
      "    ```",
      "[^2]: [Sizing]()",
      "    A widget is never taller than the viewport.",
    ].join("\n");
    const passages = termPassagesFromContent(content, "widget");
    expect(passages).toHaveLength(2);
    expect(passages[0]).toContain("# Release plan\nThe Widget grid ships with [layout rules][^1].");
    expect(passages[0]).toContain("Each card spans one column.\n\n```\n{ columns: 3 }\n```");
    expect(passages[1]).toBe("Footnote 2: Sizing\nA widget is never taller than the viewport.");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A block too long to keep whole is narrowed to the lines nearest the mention.
  it("narrows a long block to the lines around the mention", () => {
    const filler = Array.from({ length: 40 }, (_, index) => `- Item ${ index } ${ "padding ".repeat(6) }`);
    filler.splice(30, 0, "- The widget belongs here");
    const [passage] = termPassagesFromContent(filler.join("\n"), "widget");
    expect(passage.length).toBeLessThanOrEqual(MAXIMUM_PASSAGE_CHARACTERS);
    expect(passage).toContain("- The widget belongs here");
    expect(passage).toContain("- Item 29");
    expect(passage).not.toContain("- Item 0 ");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The plugin's own notes are never read, a copied passage is kept once, and each note gives its first passage
  //   before any gives a second, up to three apiece.
  it("selects passages across notes, skipping plugin notes and copies", async () => {
    const app = notebookApp([
      { content: "- **Widget**: A card. [builder]", name: "User terms dictionary 2026", tags: ["plugins/dashboard"] },
      { content: "Widget one.\n\nWidget two.\n\nWidget three.\n\nWidget four.", name: "Planning" },
      { content: "Widget  ONE.\n\nWidget five.", name: "Copy" },
    ]);
    const evidence = await collectTermEvidence(app, { now: NOW, term: "Widget" });
    expect(evidence.passages.map(passage => passage.text)).toEqual(["Widget one.", "Widget five.", "Widget two.", "Widget three."]);
    expect(evidence.sources.map(source => [source.noteName, source.passageCount])).toEqual([["Planning", 3], ["Copy", 1]]);
    expect(evidence).toMatchObject({ collectedAt: NOW.toISOString(), notesRead: 2, outcome: EVIDENCE_OUTCOMES.found,
      query: { text: "\"Widget\"", unquotedFallback: false } });
    expect(evidence.sourceDigest).toMatch(/^[0-9a-f]{8}$/);
    expect(app.getNoteContent).not.toHaveBeenCalledWith({ uuid: "seed-1" });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc No more than MAXIMUM_EVIDENCE_NOTES_READ notes are read, however many match.
  it("reads a bounded number of matching notes", async () => {
    const app = notebookApp(Array.from({ length: 12 }, (_, index) => ({ content: `Widget note ${ index }.`, name: `Note ${ index }` })));
    const evidence = await collectTermEvidence(app, { now: NOW, term: "widget" });
    expect(evidence.notesRead).toBe(MAXIMUM_EVIDENCE_NOTES_READ);
    expect(app.getNoteContent).toHaveBeenCalledTimes(MAXIMUM_EVIDENCE_NOTES_READ);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A quoted search that yields no passage falls back to the unquoted term; notes matching only its separate
  //   words give none, and a notebook without a match says so.
  it("falls back to an unquoted search and names an empty result", async () => {
    const app = notebookApp([{ content: "The diff was long. A digest followed.", name: "Words apart" }]);
    const scattered = await collectTermEvidence(app, { now: NOW, term: "Diff Digest" });
    expect(app.searchNotes.mock.calls.map(([query]) => query)).toEqual(["\"Diff Digest\"", "Diff Digest"]);
    expect(scattered).toMatchObject({ outcome: EVIDENCE_OUTCOMES.noPassages, passages: [], sourceDigest: null,
      query: { text: "Diff Digest", unquotedFallback: true } });
    const absent = await collectTermEvidence(app, { now: NOW, term: "Gadget" });
    expect(absent.outcome).toBe(EVIDENCE_OUTCOMES.noMatchingNotes);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The job saves the term's evidence to the year's evidence note, and retires once the dictionary drops the term.
  it("saves a defined term's evidence and retires for a removed term", async () => {
    const app = notebookApp([
      { content: "# Terms\n- **Widget**: A card. [builder]\n", name: "User terms dictionary 2026", tags: ["plugins/dashboard"] },
      { content: "The widget grid ships Friday.", name: "Planning" },
    ]);
    const handler = createCollectTermEvidenceHandler();
    const request = termEvidenceRequest({ term: " Widget ", year: YEAR });
    expect(request).toMatchObject({ entityId: "widget", input: { term: "Widget", year: YEAR }, key: "collectTermEvidence:2026:widget" });
    const job = { attempt: 1, category: "maintenance", cursor: null, desiredRevision: null, entityId: request.entityId,
      input: request.input, key: request.key, scopeKey: "work-domain:Q3 2026", type: handler.type };
    const result = await handler.run({ context: jobContext(app), job, signal: null });
    expect(result).toEqual({ outcome: EVIDENCE_OUTCOMES.found, passageCount: 1, sourceCount: 1, term: "Widget" });
    const stored = await storedTermEvidence(app, { year: YEAR });
    expect(stored.widget.passages).toEqual([{ noteUuid: "seed-2", text: "The widget grid ships Friday." }]);
    const gadgetJob = { ...job, input: { term: "Gadget", year: YEAR }, key: "collectTermEvidence:2026:gadget" };
    expect(await handler.run({ context: jobContext(app), job: gadgetJob, signal: null })).toEqual({ status: "superseded" });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Once passages outgrow the note's budget, the oldest record gives its passages up and keeps its sources.
  it("drops the oldest records' passages when the note outgrows its budget", async () => {
    const app = notebookApp([]);
    const noteWriter = new DashboardNoteWriter();
    const third = Math.floor(MAXIMUM_STORED_PASSAGE_CHARACTERS / 2.5);
    await savedTermEvidence(app, { evidence: evidenceRecord("Alpha", "2026-09-01T00:00:00.000Z", third), noteWriter, year: YEAR });
    await savedTermEvidence(app, { evidence: evidenceRecord("Beta", "2026-09-02T00:00:00.000Z", third), noteWriter, year: YEAR });
    const saved = await savedTermEvidence(app, { evidence: evidenceRecord("Gamma", "2026-09-03T00:00:00.000Z", third), noteWriter,
      year: YEAR });
    expect(saved.passages).toHaveLength(1);
    const stored = await storedTermEvidence(app, { year: YEAR });
    expect(stored.alpha).toMatchObject({ passages: [], passagesDropped: true, sourceDigest: "00000000" });
    expect(stored.beta.passages).toHaveLength(1);
  });
});
