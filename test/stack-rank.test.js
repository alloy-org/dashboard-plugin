// Verify the Jev stack-rank pipeline: task outlines are read from note markdown, the user terms dictionary is
// parsed and merged without touching user-written bullets, discovered terms must come from a project's wording,
// batches map Jev's zero-indexed scores onto the 1–10 scale, and — when JEV_ACCESS_TOKEN is set — a live Jev call
// rates a task that serves the project above one that does not.
import { jest } from "@jest/globals";
import dotenv from "dotenv";
import fetch from "isomorphic-fetch";
import { relevantDictionaryTerms } from "plan-wizard/stack-rank/build-project-task-context";
import { acceptedDictionaryTerms } from "plan-wizard/stack-rank/dictionary-term-discovery";
import { prospectiveTaskDetails, taskOutlineFromNoteContent } from "plan-wizard/stack-rank/prospective-task-details";
import { jevRequestForBatch, rankProspectiveTasks } from "plan-wizard/stack-rank/rank-prospective-tasks";
import { dictionaryEntriesFromContent, examinedProjectSummaries, mergedDictionaryContent,
  openUserTermsDictionary } from "plan-wizard/stack-rank/user-terms-dictionary";
import { stackRankProjectTasks } from "plan-wizard/stack-rank/stack-rank-project-tasks";
import { initialProjectTaskStoreMarkdown, projectSectionHeadingText, projectSectionMarkdown } from "project-task-store-markdown";
import { jevRouteFromAccessToken, requestJevAnswers } from "providers/jev-client";

dotenv.config();

const JEV_ACCESS_TOKEN = process.env.JEV_ACCESS_TOKEN;
const itIfJevToken = JEV_ACCESS_TOKEN ? it : it.skip;
const DIFF_DIGEST_PROJECT = { nextAction: "Draft the Diff Digest onboarding email", relatedTaskRecords: [
  { taskText: "Pick the Diff Digest send day", taskUuid: "related-1" }], summary: "Diff Digest launch", uuid: "project-1" };

// ----------------------------------------------------------------------------------------------
// @desc Build a task detail shaped like prospectiveTaskDetails output.
// @param {object} overrides - Fields to replace.
// @returns {object} Task detail.
function taskDetail(overrides = {}) {
  return { childTasks: [], createdOn: "2026-09-20", deadlineOn: null, important: false, isParent: false,
    noteName: "Inbox", noteTags: [], noteUuid: "note-1", parentTask: null, taskText: "A task", taskUuid: "task-1",
    urgent: false, ...overrides };
}

describe("taskOutlineFromNoteContent", () => {
  it("links indented tasks to the task above them, through either whitespace or an indent field", () => {
    const content = [
      '- [ ] Ship onboarding<!-- {"uuid":"parent"} -->',
      '  - [ ] Write tooltip copy<!-- {"uuid":"child-a"} -->',
      '  - [ ] Record [demo](https://example.com)<!-- {"uuid":"child-b"} -->',
      '- [ ] Flat sibling<!-- {"uuid":"sibling"} -->',
      '- [ ] Indented by field<!-- {"uuid":"field-child","indent":1} -->',
    ].join("\n");
    const outline = taskOutlineFromNoteContent(content);
    expect(outline.get("parent").childTaskUuids).toEqual(["child-a", "child-b"]);
    expect(outline.get("child-b")).toEqual({ childTaskUuids: [], parentTaskUuid: "parent", taskText: "Record demo" });
    expect(outline.get("sibling").parentTaskUuid).toBeNull();
    expect(outline.get("field-child").parentTaskUuid).toBe("sibling");
  });

  it("does not adopt a task indented under a plain bullet, or across a heading", () => {
    const content = [
      '- [ ] First<!-- {"uuid":"first"} -->',
      '- Plain bullet',
      '  - [ ] Under the bullet<!-- {"uuid":"under-bullet"} -->',
      '- [ ] Before heading<!-- {"uuid":"before"} -->',
      '# Later',
      '  - [ ] After heading<!-- {"uuid":"after"} -->',
    ].join("\n");
    const outline = taskOutlineFromNoteContent(content);
    expect(outline.get("under-bullet").parentTaskUuid).toBeNull();
    expect(outline.get("after").parentTaskUuid).toBeNull();
  });
});

describe("prospectiveTaskDetails", () => {
  it("reads each note once and attaches its name, tags, and the task's parent", async () => {
    const app = {
      findNote: jest.fn(async ({ uuid }) => ({ name: "Diff Digest", tags: ["work/gitclear"], uuid })),
      getNoteContent: jest.fn(async () => '- [ ] Launch<!-- {"uuid":"parent"} -->\n  - [ ] Copy<!-- {"uuid":"child"} -->'),
    };
    const tasks = [{ content: "Launch", isParent: true, noteUUID: "note-1", uuid: "parent" },
      { content: "Copy", important: true, noteUUID: "note-1", uuid: "child" }];
    const details = await prospectiveTaskDetails(app, tasks);
    expect(app.getNoteContent).toHaveBeenCalledTimes(1);
    expect(details[0]).toMatchObject({ childTasks: [{ taskText: "Copy", taskUuid: "child" }], isParent: true });
    expect(details[1]).toMatchObject({ important: true, noteName: "Diff Digest", noteTags: ["work/gitclear"],
      parentTask: { taskText: "Launch", taskUuid: "parent" } });
  });
});

describe("user terms dictionary", () => {
  const content = "Intro prose.\n\n# Terms\n- **Amplenote**: Notes app [builder]\n- **GitClear**: My company\n\n"
    + "# Examined projects\n- Old project (examined 2026-09-01)\n";

  it("parses terms with their ownership and the examined projects", () => {
    const entries = dictionaryEntriesFromContent(content);
    expect(entries.map(entry => [entry.term, entry.definition, entry.isBuilderOwned])).toEqual([
      ["Amplenote", "Notes app", true], ["GitClear", "My company", false]]);
    expect([...examinedProjectSummaries(content)]).toEqual(["old project"]);
  });

  it("refines plugin-owned terms in place, never rewrites the user's, and appends new ones", () => {
    const merged = mergedDictionaryContent(content, { examinedOn: "2026-10-01", examinedSummaries: ["Diff Digest launch"],
      incomingEntries: [{ definition: "Extensible notes, tasks, and calendar app", term: "amplenote" },
        { definition: "Rewritten", term: "GitClear" }, { definition: "GitClear's weekly code-change email", term: "Diff Digest" }] });
    expect(merged.refinedTerms).toEqual(["Amplenote"]);
    expect(merged.addedTerms).toEqual(["Diff Digest"]);
    expect(merged.content).toBe("Intro prose.\n\n# Terms\n- **Amplenote**: Extensible notes, tasks, and calendar app [builder]\n"
      + "- **GitClear**: My company\n- **Diff Digest**: GitClear's weekly code-change email [builder]\n\n"
      + "# Examined projects\n- Old project (examined 2026-09-01)\n- Diff Digest launch (examined 2026-10-01)\n");
  });

  it("creates an archived, seeded note when none exists", async () => {
    let written = null;
    const app = { createNote: jest.fn().mockResolvedValue("dictionary-note"), findNote: jest.fn().mockResolvedValue(null),
      replaceNoteContent: jest.fn(async (_handle, body) => { written = body; return true; }) };
    const { content: seeded, noteHandle } = await openUserTermsDictionary(app, 2026);
    expect(app.createNote).toHaveBeenCalledWith("User terms dictionary 2026", ["plugins/dashboard"], { archive: true });
    expect(noteHandle).toEqual({ uuid: "dictionary-note" });
    expect(written).toBe(seeded);
    expect(dictionaryEntriesFromContent(seeded).map(entry => entry.term)).toEqual(["Amplenote", "Dashboard"]);
  });
});

describe("acceptedDictionaryTerms", () => {
  it("keeps only terms drawn from project wording that do not overwrite the user's definitions", () => {
    const dictionaryEntries = [{ definition: "My company", isBuilderOwned: false, term: "GitClear" }];
    const response = { terms: [{ definition: "GitClear's weekly email summarizing code changes", term: "Diff Digest" },
      { definition: "A large language model used for many things", term: "Transformer" },
      { definition: "A software analytics company and product", term: "GitClear" }] };
    const projects = [{ ...DIFF_DIGEST_PROJECT, summary: "Diff Digest launch for GitClear" }];
    expect(acceptedDictionaryTerms(response, { dictionaryEntries, projects })).toEqual([
      { definition: "GitClear's weekly email summarizing code changes", term: "Diff Digest" }]);
  });
});

describe("rankProspectiveTasks", () => {
  it("sends only the dictionary terms a batch mentions, with positional question names", () => {
    const dictionary = { Amplenote: "Notes app", "Diff Digest": "Code-change email", Unused: "Never mentioned" };
    const { questionNames, questions, state } = jevRequestForBatch(DIFF_DIGEST_PROJECT,
      [taskDetail({ noteName: "Amplenote plugin ideas" })], dictionary);
    expect(questionNames).toEqual(["task_1"]);
    expect(questions.task_1.criteria).toHaveLength(10);
    expect(Object.keys(state.userTermsDictionary).sort()).toEqual(["Amplenote", "Diff Digest"]);
  });

  it("shifts scores onto the 1–10 scale, orders by rating, and records a failed batch", async () => {
    const requestAnswers = jest.fn()
      .mockResolvedValueOnce({ answers: { task_1: { confidence: 0.9, score: 0.4, type: "score" },
        task_2: { confidence: 0.8, score: 8.6, type: "score" } }, usage: { input_tokens: 300 } })
      .mockRejectedValueOnce(new Error("Jev answered 429: slow down"));
    const taskDetails = [taskDetail({ taskText: "Buy dog food", taskUuid: "a" }),
      taskDetail({ taskText: "Diff Digest landing copy", taskUuid: "b" }), taskDetail({ taskUuid: "c" })];
    const result = await rankProspectiveTasks({ accessToken: "token", batchSize: 2, dictionary: {},
      project: DIFF_DIGEST_PROJECT, requestAnswers, taskDetails });
    expect(result.rankedTasks.map(task => [task.taskUuid, task.rating])).toEqual([["b", 9.6], ["a", 1.4]]);
    expect(result.failures).toEqual([{ reason: "Jev answered 429: slow down", taskUuids: ["c"] }]);
    expect(result.inputTokens).toBe(300);
  });
});

describe("stackRankProjectTasks", () => {
  it("ranks each stored project's unassociated open tasks and grows the dictionary from new projects", async () => {
    const storeContent = initialProjectTaskStoreMarkdown().replace("# Active projects\n",
      `# Active projects\n## ${ projectSectionHeadingText(DIFF_DIGEST_PROJECT) }\n\n${ projectSectionMarkdown(DIFF_DIGEST_PROJECT) }\n`);
    const notes = { "Project Tasks Q4 2026 Work": { content: storeContent, uuid: "store-note" } };
    const tasks = [{ content: "Pick the Diff Digest send day", noteUUID: "note-1", updatedAt: 3, uuid: "related-1" },
      { content: "Diff Digest landing copy", noteUUID: "note-1", updatedAt: 2, uuid: "open-1" },
      { completedAt: 1790000000, content: "Done already", noteUUID: "note-1", updatedAt: 1, uuid: "done-1" }];
    const app = {
      createNote: jest.fn(async name => { notes[name] = { content: "", uuid: "dictionary-note" }; return "dictionary-note"; }),
      findNote: jest.fn(async ({ name, uuid }) => (uuid ? { name: "GitClear", tags: ["work"], uuid } : notes[name] || null)),
      getNoteContent: jest.fn(async ({ uuid }) => Object.values(notes).find(note => note.uuid === uuid)?.content ?? ""),
      getTaskDomainTasks: jest.fn().mockResolvedValue(tasks),
      replaceNoteContent: jest.fn(async ({ uuid }, body) => {
        Object.values(notes).find(note => note.uuid === uuid).content = body;
        return true;
      }),
    };
    const promptRunner = jest.fn().mockResolvedValue({ terms: [{ definition: "GitClear's weekly code-change email",
      term: "Diff Digest" }] });
    const requestAnswers = jest.fn().mockResolvedValue({ answers: { task_1: { confidence: 0.9, score: 8, type: "score" } } });
    const result = await stackRankProjectTasks(app, { accessToken: "token", domainName: "Work", domainUuid: "work-domain",
      now: new Date(2026, 9, 1), promptRunner, requestAnswers });
    expect(result.dictionaryChanges.addedTerms).toEqual(["Diff Digest"]);
    expect(notes["User terms dictionary 2026"].content).toContain("- Diff Digest launch (examined 2026-10-01)");
    expect(result.projectRankings).toEqual([{ failures: [], inputTokens: 0, projectSummary: "Diff Digest launch",
      projectUuid: "project-1", rankedTasks: [{ confidence: 0.9, noteName: "GitClear", rating: 9,
        taskText: "Diff Digest landing copy", taskUuid: "open-1" }] }]);
    expect(requestAnswers.mock.calls[0][0].state.userTermsDictionary).toEqual({
      "Diff Digest": "GitClear's weekly code-change email" });
  });
});

describe("Jev client", () => {
  it("routes OpenRouter keys through OpenRouter, which accepts browser origins", () => {
    expect(jevRouteFromAccessToken("sk-or-v1-abc").routeEm).toBe("openrouter");
    expect(jevRouteFromAccessToken("ts-abc").routeEm).toBe("typesafe");
  });

  itIfJevToken("rates a task serving the project above an unrelated one (live Jev call)", async () => {
    const requestAnswers = options => requestJevAnswers({ ...options, fetchImplementation: fetch });
    const dictionary = relevantDictionaryTerms({ "Diff Digest": "GitClear's weekly email that summarizes the code "
      + "changes a team made" }, [DIFF_DIGEST_PROJECT.summary]);
    const taskDetails = [taskDetail({ noteName: "Errands", taskText: "Buy dog food", taskUuid: "unrelated" }),
      taskDetail({ noteName: "GitClear marketing", noteTags: ["work/gitclear"],
        taskText: "Write landing page copy for the weekly code-change email", taskUuid: "related" })];
    const result = await rankProspectiveTasks({ accessToken: JEV_ACCESS_TOKEN, dictionary, project: DIFF_DIGEST_PROJECT,
      requestAnswers, taskDetails });
    expect(result.failures).toEqual([]);
    expect(result.rankedTasks.map(task => task.taskUuid)).toEqual(["related", "unrelated"]);
    expect(result.rankedTasks[0].rating).toBeGreaterThan(6);
    expect(result.rankedTasks[1].rating).toBeLessThan(4);
  }, 45000);
});
