// Verify the Jev stack-rank pipeline: task outlines are read from note markdown, the user terms dictionary is
// parsed and merged without touching user-written bullets, discovered terms must come from a project's wording,
// batches map Jev's zero-indexed scores onto the 1–10 scale, each project's minimum match score is chosen and kept
// per quarter, Plan Builder's pass re-ranks only stale projects, and — when JEV_ACCESS_TOKEN is set — a live Jev
// call rates a task that serves the project above one that does not.
import { jest } from "@jest/globals";
import dotenv from "dotenv";
import fetch from "isomorphic-fetch";
import { SETTING_KEYS } from "constants/settings";
import { relevantDictionaryTerms } from "plan-wizard/stack-rank/build-project-task-context";
import { acceptedDictionaryTerms } from "plan-wizard/stack-rank/dictionary-term-discovery";
import { acceptedRankedTasks, matchScoresWithProjectScore, persistPrunedMatchScores,
  storedMinimumMatchScore } from "plan-wizard/stack-rank/project-match-scores";
import { generativeScorePrompt, generativeScoreRequester } from "plan-wizard/stack-rank/generative-task-scores";
import { prospectiveTaskDetails, taskOutlineFromNoteContent } from "plan-wizard/stack-rank/prospective-task-details";
import { jevRequestForBatch, rankProspectiveTasks } from "plan-wizard/stack-rank/rank-prospective-tasks";
import { projectsDueForRanking, refreshStaleProjectRankings } from "plan-wizard/stack-rank/refresh-stale-project-rankings";
import { GENERATIVE_CANDIDATE_TASK_LIMIT, JEV_CANDIDATE_TASK_LIMIT, needsSecondSearchPage,
  prepareProjectTaskRanker } from "plan-wizard/stack-rank/stack-rank-project-tasks";
import { taskMatchScoresByProject, taskRatingKey } from "plan-wizard/stack-rank/task-rating-cache";
import { dictionaryEntriesFromContent, examinedProjectSummaries, mergedDictionaryContent,
  openUserTermsDictionary } from "plan-wizard/stack-rank/user-terms-dictionary";
import { pluginSettings, setPluginData } from "plugin-data";
import { storedProjectRecords } from "project-task-store";
import { initialProjectTaskStoreMarkdown, projectSectionHeadingText, projectSectionMarkdown } from "project-task-store-markdown";
import { AMPLE_AGENT_PRO_UUID } from "providers/ai-provider-settings";
import { jevRouteFromAccessToken, requestJevAnswers } from "providers/jev-client";
import { setLoggingEnabled } from "util/log";

dotenv.config();

const JEV_ACCESS_TOKEN = process.env.JEV_ACCESS_TOKEN;
const itIfJevToken = JEV_ACCESS_TOKEN ? it : it.skip;
const DIFF_DIGEST_PROJECT = { nextAction: "Draft the Diff Digest onboarding email", relatedTaskRecords: [
  { taskText: "Pick the Diff Digest send day", taskUuid: "related-1" }], summary: "Diff Digest launch", uuid: "project-1" };

// ----------------------------------------------------------------------------------------------
// @desc Build ranked tasks with the given ratings, highest first, as rankProspectiveTasks returns them.
// @param {Array<number>} ratings - One rating per task.
// @returns {Array<object>} Ranked tasks.
function rankedTasksFromRatings(ratings) {
  const rankedTasks = ratings.map((rating, index) => ({ confidence: 0.8, rating, taskText: `Task ${ index }`,
    taskUuid: `task-${ index }` }));
  return rankedTasks.sort((first, second) => second.rating - first.rating);
}

// ----------------------------------------------------------------------------------------------
// @desc Mock the app bridge over in-memory notes keyed by name, with whole-note and section-scoped writes.
// @param {object} notes - { [name]: { content, uuid } }, mutated by writes.
// @param {Array<object>} tasks - Tasks the domain returns.
// @returns {object} App mock.
function notesApp(notes, tasks) {
  const noteFromUuid = uuid => Object.values(notes).find(note => note.uuid === uuid);
  return {
    createNote: jest.fn(async name => { notes[name] = { content: "", uuid: `${ name }-uuid` }; return `${ name }-uuid`; }),
    findNote: jest.fn(async ({ name, uuid }) => (uuid ? { name: noteFromUuid(uuid)?.name || "GitClear", tags: ["work"], uuid }
      : notes[name] || null)),
    getNoteContent: jest.fn(async ({ uuid }) => noteFromUuid(uuid)?.content ?? ""),
    filterNotes: jest.fn(async () => []),
    getTaskDomainTasks: jest.fn().mockResolvedValue(tasks),
    replaceNoteContent: jest.fn(async ({ uuid }, body, options) => {
      const note = noteFromUuid(uuid);
      if (!options?.section) { note.content = body; return true; }
      const headingLine = `${ "#".repeat(options.section.heading.level) } ${ options.section.heading.text }\n`;
      const bodyStart = note.content.indexOf(headingLine) + headingLine.length;
      const nextHeading = note.content.slice(bodyStart).search(/^#{1,2} /m);
      const bodyEnd = nextHeading < 0 ? note.content.length : bodyStart + nextHeading;
      note.content = `${ note.content.slice(0, bodyStart) }${ body }${ note.content.slice(bodyEnd) }`;
      return true;
    }),
    setSetting: jest.fn().mockResolvedValue(true),
  };
}

// ----------------------------------------------------------------------------------------------
// @desc Render a project task store holding the given project records under Active projects.
// @param {Array<object>} projects - Project records.
// @returns {string} Store note markdown.
function storeContentFromProjects(projects) {
  const sections = projects.map(project => `## ${ projectSectionHeadingText(project) }\n\n${ projectSectionMarkdown(project) }`);
  return initialProjectTaskStoreMarkdown().replace("# Active projects\n", `# Active projects\n${ sections.join("\n") }\n`);
}

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
        task_2: { confidence: 0.8, score: 8.6, type: "score" } }, usage: { input_tokens: 300, output_tokens: 20 } })
      .mockRejectedValueOnce(new Error("Jev answered 429: slow down"));
    const taskDetails = [taskDetail({ taskText: "Buy dog food", taskUuid: "a" }),
      taskDetail({ taskText: "Diff Digest landing copy", taskUuid: "b" }), taskDetail({ taskUuid: "c" })];
    setLoggingEnabled(true);
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    const result = await rankProspectiveTasks({ accessToken: "token", batchSize: 2, dictionary: {},
      project: DIFF_DIGEST_PROJECT, requestAnswers, taskDetails });
    const projectLog = log.mock.calls.find(call => call[0] === "[rank-prospective-tasks] ranked project");
    log.mockRestore();
    setLoggingEnabled(false);
    expect(result.rankedTasks.map(task => [task.taskUuid, task.rating])).toEqual([["b", 9.6], ["a", 1.4]]);
    expect(result.failures).toEqual([{ reason: "Jev answered 429: slow down", taskUuids: ["c"] }]);
    expect(result.inputTokens).toBe(300);
    expect(projectLog[1]).toMatchObject({ inputTokens: 300, outputTokens: 20, ranInParallel: true });
    expect(projectLog[1].elapsedMilliseconds).toEqual(expect.any(Number));
  });
});

describe("acceptedRankedTasks", () => {
  it("accepts tasks rated 6 or higher", () => {
    const selection = acceptedRankedTasks(rankedTasksFromRatings([9.1, 6, 5.9, 1.2]));
    expect(selection.minimumMatchScore).toBe(6);
    expect(selection.acceptedTasks.map(task => task.rating)).toEqual([9.1, 6]);
  });

  it("raises a competitive project's minimum to 7 once more than 20 tasks clear 6", () => {
    const ratings = [...Array(17).fill(6.5), 7.5, 8, 9.2];
    expect(acceptedRankedTasks(rankedTasksFromRatings(ratings)).acceptedTasks).toHaveLength(20);
    const competitive = acceptedRankedTasks(rankedTasksFromRatings([...ratings, 6.2]));
    expect(competitive.minimumMatchScore).toBe(7);
    expect(competitive.acceptedTasks.map(task => task.rating)).toEqual([9.2, 8, 7.5]);
  });

  it("keeps the top 20 at 6 when a competitive project has nothing at 7", () => {
    const selection = acceptedRankedTasks(rankedTasksFromRatings(Array(25).fill(6.5)));
    expect(selection).toMatchObject({ minimumMatchScore: 6 });
    expect(selection.acceptedTasks).toHaveLength(20);
  });

  it("allows up to three leads rated from 3 when nothing reaches 6", () => {
    const selection = acceptedRankedTasks(rankedTasksFromRatings([5.8, 4.2, 3.9, 3.1, 2.9]));
    expect(selection.minimumMatchScore).toBe(3);
    expect(selection.acceptedTasks.map(task => task.rating)).toEqual([5.8, 4.2, 3.9]);
  });

  it("applies the stored minimum when some batches went unrated", () => {
    const selection = acceptedRankedTasks(rankedTasksFromRatings([7.4, 6.1]), { isComplete: false,
      storedMinimumMatchScore: 7 });
    expect(selection).toEqual({ acceptedTasks: [expect.objectContaining({ rating: 7.4 })], minimumMatchScore: 7 });
  });
});

describe("project match scores setting", () => {
  it("stores minimums by domain, quarter, and project, and drops ended quarters on load", async () => {
    const scores = matchScoresWithProjectScore({ "all-notes": { "Q2 2026": { old: 5 } } }, { domainUuid: "work-domain",
      minimumMatchScore: 7, projectUuid: "project-1", quarter: 4, year: 2026 });
    expect(storedMinimumMatchScore(scores, { domainUuid: "work-domain", projectUuid: "project-1", quarter: 4,
      year: 2026 })).toBe(7);
    const app = { setSetting: jest.fn().mockResolvedValue(true) };
    const pruned = await persistPrunedMatchScores(app, { now: new Date(2026, 9, 1), rawSetting: JSON.stringify(scores) });
    expect(JSON.parse(pruned)).toEqual({ "work-domain": { "Q4 2026": { "project-1": 7 } } });
    expect(app.setSetting).toHaveBeenCalledWith("dashboard_project_match_scores", pruned);
  });
});

describe("prepareProjectTaskRanker", () => {
  beforeEach(() => setPluginData({ settings: {} }));

  it("returns no ranker when neither Jev nor a generative provider can rate", async () => {
    expect(await prepareProjectTaskRanker({}, { domainName: "Work", domainUuid: "work-domain", tasks: [] })).toBeNull();
  });

  it("rates the 150 most recent tasks with the fast model, 25 to a prompt, when no Jev key is set", async () => {
    setPluginData({ settings: { [SETTING_KEYS.LLM_API_KEY_OPENAI]: "an-openai-key" } });
    const tasks = Array.from({ length: 200 }, (_value, index) => ({ content: `Task number ${ index }`, noteUUID: "note-1",
      updatedAt: index, uuid: `open-${ index }` }));
    const promptRunner = jest.fn(async (_app, prompt) => {
      const questionNames = [...prompt.matchAll(/^- (task_\d+):/gm)].map(match => match[1]);
      const ratings = Object.fromEntries(questionNames.map(questionName => [questionName, 2]));
      if (prompt.includes("Task number 199")) ratings.task_1 = 8;
      return { ratings };
    });
    const ranker = await prepareProjectTaskRanker(notesApp({}, tasks), { domainName: "Work", domainUuid: "work-domain",
      now: new Date(2026, 9, 1), projects: [DIFF_DIGEST_PROJECT], promptRunner, refineDictionary: false, tasks });
    expect(ranker.scorerEm).toBe("generative");
    const ranking = await ranker.rankProject(DIFF_DIGEST_PROJECT, []);
    expect(promptRunner).toHaveBeenCalledTimes(GENERATIVE_CANDIDATE_TASK_LIMIT / 25);
    expect(ranking.ratedCount).toBe(GENERATIVE_CANDIDATE_TASK_LIMIT);
    expect(ranking.acceptedTasks).toEqual([{ matchScore: 8, taskText: "Task number 199", taskUuid: "open-199" }]);
    const ratedTexts = promptRunner.mock.calls.map(([, prompt]) => prompt).join("\n");
    expect(ratedTexts).not.toContain("Task number 49\"");
  });

  it("asks Ample Agent Pro to call Jev when no Jev key is set", async () => {
    const tasks = [{ content: "Diff Digest landing copy", noteUUID: "note-1", updatedAt: 2, uuid: "open-1" }];
    const notes = { "Ample Agent Pro": { content: "", uuid: "agent-pro" },
      GitClear: { content: "- [ ] Diff Digest landing copy\n", uuid: "note-1" } };
    const callPlugin = jest.fn(async () => ({ model: "jev-latest", scores: { task_1: 9, task_2: 20 } }));
    const app = { ...notesApp(notes, tasks), callPlugin };
    const ranker = await prepareProjectTaskRanker(app, { domainName: "Work", domainUuid: "work-domain",
      now: new Date(2026, 9, 1), projects: [DIFF_DIGEST_PROJECT], refineDictionary: false, tasks });
    expect(ranker.scorerEm).toBe("jev");
    const ranking = await ranker.rankProject(DIFF_DIGEST_PROJECT, []);
    expect(ranking.failureReason).toBeNull();
    expect(ranking.acceptedTasks).toEqual([{ matchScore: 9, taskText: "Diff Digest landing copy", taskUuid: "open-1" }]);
    const [noteHandle, instructions, prompt, model, endpoint] = callPlugin.mock.calls[0];
    expect(noteHandle).toEqual({ source: AMPLE_AGENT_PRO_UUID });
    expect(instructions).toBe("");
    expect(JSON.parse(prompt).model).toBe("jev-latest");
    expect(model).toBe("jev-latest");
    expect(endpoint).toBe("https://api.typesafe.ai/v1/systemone");
  });

  it("grows the dictionary, rates the unassociated pool, and saves the project's minimum match score", async () => {
    const notes = { "Project Tasks Q4 2026 Work": { content: storeContentFromProjects([DIFF_DIGEST_PROJECT]),
      uuid: "store-note" } };
    const tasks = [{ content: "Pick the Diff Digest send day", noteUUID: "note-1", updatedAt: 3, uuid: "related-1" },
      { content: "Diff Digest landing copy", noteUUID: "note-1", updatedAt: 2, uuid: "open-1" },
      { content: "Buy dog food", noteUUID: "note-1", updatedAt: 2, uuid: "open-2" },
      { completedAt: 1790000000, content: "Done already", noteUUID: "note-1", updatedAt: 1, uuid: "done-1" }];
    const app = notesApp(notes, tasks);
    const promptRunner = jest.fn().mockResolvedValue({ terms: [{ definition: "GitClear's weekly code-change email",
      term: "Diff Digest" }] });
    const requestAnswers = jest.fn().mockResolvedValue({ answers: { task_1: { confidence: 0.9, score: 8, type: "score" },
      task_2: { confidence: 0.9, score: 0, type: "score" } } });
    const ranker = await prepareProjectTaskRanker(app, { accessToken: "token", domainName: "Work",
      domainUuid: "work-domain", now: new Date(2026, 9, 1), promptRunner, requestAnswers, tasks });
    expect(ranker.dictionaryChanges.addedTerms).toEqual(["Diff Digest"]);
    expect(notes["User terms dictionary 2026"].content).toContain("- Diff Digest launch (examined 2026-10-01)");
    const ranking = await ranker.rankProject(DIFF_DIGEST_PROJECT, DIFF_DIGEST_PROJECT.relatedTaskRecords);
    const similarKey = taskRatingKey("Diff Digest launch", { taskText: "Diff Digest landing copy", taskUuid: "open-1" });
    expect(ranking).toEqual({ acceptedTasks: [{ matchScore: 9, taskText: "Diff Digest landing copy", taskUuid: "open-1" }],
      failureReason: null, minimumMatchScore: 6, rankingIncomplete: false, ratedCount: 2,
      searchProgress: { similaritySearchPageCount: 1, similaritySearchedTaskCount: 2 },
      taskSimilarityScores: { [similarKey]: 9 } });
    expect(requestAnswers.mock.calls[0][0].state.userTermsDictionary).toEqual({
      "Diff Digest": "GitClear's weekly code-change email" });
    const savedScores = JSON.parse(pluginSettings().dashboard_project_match_scores);
    expect(savedScores).toEqual({ "work-domain": { "Q4 2026": { "project-1": 6 } } });
    expect(app.setSetting).toHaveBeenCalledWith("dashboard_project_match_scores", JSON.stringify(savedScores));
  });

  it("submits only tasks created after the previous ranking, and stores a low rating only for a cited task", async () => {
    const rankedAt = "2026-10-01T00:00:00.000Z";
    const project = { ...DIFF_DIGEST_PROJECT, lastRankedAt: rankedAt, similaritySearchPageCount: 1,
      similaritySearchedTaskCount: 3 };
    const tasks = [
      { content: "Old errand", createdAt: "2026-09-01T00:00:00.000Z", noteUUID: "note-1", updatedAt: 3, uuid: "old-1" },
      { content: "New errand", createdAt: "2026-10-02T00:00:00.000Z", noteUUID: "note-1", updatedAt: 2, uuid: "new-1" },
      { content: "Cited old task", createdAt: "2026-09-01T00:00:00.000Z", noteUUID: "note-1", updatedAt: 1, uuid: "cited-1" }];
    const app = notesApp({}, tasks);
    const requestAnswers = jest.fn().mockResolvedValue({ answers: { task_1: { confidence: 0.9, score: 1, type: "score" },
      task_2: { confidence: 0.9, score: 0, type: "score" } } });
    const ranker = await prepareProjectTaskRanker(app, { accessToken: "token", domainName: "Work",
      domainUuid: "work-domain", now: new Date(2026, 9, 2), projects: [project], refineDictionary: false,
      requestAnswers, tasks });
    setLoggingEnabled(true);
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    const ranking = await ranker.rankProject(project, [], { requiredTaskRecords: [{ taskText: "Cited old task",
      taskUuid: "cited-1" }] });
    const projectLog = log.mock.calls.find(call => call[0] === "[stack-rank-project-tasks] ranked project");
    log.mockRestore();
    setLoggingEnabled(false);
    expect(requestAnswers).toHaveBeenCalledTimes(1);
    expect(projectLog[1]).toMatchObject({ candidateCount: 1, createdAfter: rankedAt, excludedBeforeCreatedAfter: 2,
      excludedWithoutCreatedAt: 0, limitToRequiredTasks: false, requiredCount: 1, sentCount: 2 });
    const sentTexts = Object.values(requestAnswers.mock.calls[0][0].state.prospectiveTasks).map(task => task.text);
    expect(sentTexts).toEqual(["New errand", "Cited old task"]);
    const citedKey = taskRatingKey("Diff Digest launch", { taskText: "Cited old task", taskUuid: "cited-1" });
    expect(ranking.taskSimilarityScores).toEqual({ [citedKey]: 1 });
    expect(ranking.searchProgress).toBeNull();
    expect(ranking.rankingIncomplete).toBe(false);
  });

  it("logs a createdAfter cutoff that leaves Jev nothing to rate", async () => {
    const rankedAt = "2026-10-01T00:00:00.000Z";
    const project = { ...DIFF_DIGEST_PROJECT, lastRankedAt: rankedAt, similaritySearchPageCount: 2 };
    const tasks = [
      { content: "Older errand", createdAt: "2026-09-01T00:00:00.000Z", noteUUID: "note-1", uuid: "old-1" },
      { content: "Undated errand", noteUUID: "note-1", uuid: "undated-1" },
      { content: "Already associated", createdAt: "2026-09-01T00:00:00.000Z", noteUUID: "note-1", uuid: "related-1" }];
    const requestAnswers = jest.fn();
    const ranker = await prepareProjectTaskRanker(notesApp({}, tasks), { accessToken: "token", domainName: "Work",
      domainUuid: "work-domain", now: new Date(2026, 9, 2), projects: [project], refineDictionary: false,
      requestAnswers, tasks });
    setLoggingEnabled(true);
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    const ranking = await ranker.rankProject(project, [{ taskText: "Already associated", taskUuid: "related-1" }]);
    const projectLog = log.mock.calls.find(call => call[0] === "[stack-rank-project-tasks] ranked project");
    log.mockRestore();
    setLoggingEnabled(false);
    expect(requestAnswers).not.toHaveBeenCalled();
    expect(ranking).toMatchObject({ acceptedTasks: [], minimumMatchScore: null, rankingIncomplete: false, ratedCount: 0 });
    expect(projectLog[1]).toEqual({ acceptedCount: 0, cachedCount: 0, candidateCount: 0, createdAfter: rankedAt,
      excludedBeforeCreatedAfter: 1, excludedWithoutCreatedAt: 1, limitToRequiredTasks: false, minimumMatchScore: null,
      project: "Diff Digest launch", rankingIncomplete: false, recheckedCount: 0, requiredCount: 0, scorerEm: "jev",
      searchProgress: null, sentCount: 0 });
  });

  it("re-checks a similar task by checksum, reusing its score until its text changes", async () => {
    const project = { ...DIFF_DIGEST_PROJECT, lastRankedAt: "2026-10-01T00:00:00.000Z", similaritySearchPageCount: 2 };
    const unchangedKey = taskRatingKey(project.summary, { taskText: "Diff Digest landing copy", taskUuid: "similar-1" });
    const editedKey = taskRatingKey(project.summary, { taskText: "Diff Digest pricing", taskUuid: "similar-2" });
    const tasks = [{ content: "Diff Digest landing copy", createdAt: "2026-09-01T00:00:00.000Z", uuid: "similar-1" },
      { content: "Buy dog food", createdAt: "2026-09-01T00:00:00.000Z", uuid: "similar-2" }];
    const requestAnswers = jest.fn().mockResolvedValue({ answers: { task_1: { confidence: 0.9, score: 0, type: "score" } } });
    const ranker = await prepareProjectTaskRanker(notesApp({}, tasks), { accessToken: "token", domainName: "Work",
      domainUuid: "work-domain", now: new Date(2026, 9, 2), projects: [project], refineDictionary: false,
      requestAnswers, tasks });
    const ranking = await ranker.rankProject(project, [], { storedRatings: { [editedKey]: 7, [unchangedKey]: 8.4 } });
    const sentTexts = Object.values(requestAnswers.mock.calls[0][0].state.prospectiveTasks).map(task => task.text);
    expect(sentTexts).toEqual(["Buy dog food"]);
    expect(ranking.acceptedTasks).toEqual([{ matchScore: 8.4, taskText: "Diff Digest landing copy", taskUuid: "similar-1" }]);
    expect(ranking.taskSimilarityScores).toEqual({ [unchangedKey]: 8.4 });
  });

  it("searches the second page once when the first turned up nothing similar", async () => {
    const tasks = Array.from({ length: 700 }, (_value, index) => ({ content: `Task number ${ index }`,
      createdAt: "2026-09-01T00:00:00.000Z", updatedAt: index, uuid: `open-${ index }` }));
    const project = { ...DIFF_DIGEST_PROJECT, lastRankedAt: "2026-10-01T00:00:00.000Z", similaritySearchPageCount: 1,
      similaritySearchedTaskCount: JEV_CANDIDATE_TASK_LIMIT };
    const requestAnswers = jest.fn(async ({ questions }) => ({ answers: Object.fromEntries(Object.keys(questions)
      .map(questionName => [questionName, { confidence: 0.9, score: 0, type: "score" }])) }));
    const ranker = await prepareProjectTaskRanker(notesApp({}, tasks), { accessToken: "token", domainName: "Work",
      domainUuid: "work-domain", now: new Date(2026, 9, 2), projects: [project], refineDictionary: false,
      requestAnswers, tasks });
    const ranking = await ranker.rankProject(project, []);
    const sentTexts = requestAnswers.mock.calls.flatMap(([{ state }]) => Object.values(state.prospectiveTasks)
      .map(task => task.text));
    expect(sentTexts).toHaveLength(200);
    expect(sentTexts).toContain("Task number 199");
    expect(sentTexts).not.toContain("Task number 200");
    expect(ranking.searchProgress).toEqual({ similaritySearchPageCount: 2, similaritySearchedTaskCount: 700 });
    const searchedProject = { ...project, ...ranking.searchProgress };
    expect(needsSecondSearchPage(searchedProject, { scorerEm: "jev" })).toBe(false);
  });
});

describe("generative task scores", () => {
  it("asks for one rating per Jev question and converts the reply to Jev's zero-indexed score answers", async () => {
    const { questions, state } = jevRequestForBatch(DIFF_DIGEST_PROJECT, [taskDetail({ taskText: "Diff Digest landing copy" }),
      taskDetail({ taskText: "Buy dog food", taskUuid: "task-2" }), taskDetail({ taskText: "Renew passport", taskUuid: "task-3" })], {});
    const prompt = generativeScorePrompt(questions, state);
    expect(prompt).toContain("10: directly advances the project's outcome or its stated next action");
    expect(prompt).toContain('"Diff Digest landing copy"');
    expect(prompt).toContain('{"ratings":{"task_1":1,"task_2":1,"task_3":1}}');
    const promptRunner = jest.fn().mockResolvedValue({ ratings: { task_1: 9, task_2: "1.5", task_3: 14 } });
    const { answers } = await generativeScoreRequester({}, { promptRunner })({ questions, state });
    expect(answers).toEqual({ task_1: { confidence: 0, score: 8, type: "score" }, task_2: { confidence: 0, score: 0.5, type: "score" } });
    await expect(generativeScoreRequester({}, { promptRunner: jest.fn().mockResolvedValue({}) })({ questions, state }))
      .rejects.toThrow("The fast model returned no ratings");
  });
});

describe("taskMatchScoresByProject", () => {
  it("reads scores from the similarity hash, and from records written before it", () => {
    const storedProjects = [{ taskSimilarityScores: { "a1b2c3d4:task-low": 2.2 }, relatedTaskRecords: [{ taskText: "By name",
      taskUuid: "task-named" }, { matchScore: 8.1, taskText: "Kept", taskUuid: "task-kept" }], uuid: "project-1" }];
    expect(taskMatchScoresByProject(storedProjects)).toEqual({ "project-1": { "task-kept": 8.1, "task-low": 2.2 } });
  });
});

describe("refreshStaleProjectRankings", () => {
  it("re-ranks only projects Jev has not ranked within three days, leaving the collection timestamp alone", async () => {
    const staleProject = { ...DIFF_DIGEST_PROJECT, lastAttemptedAt: "2026-09-30T12:00:00.000Z",
      lastRankedAt: "2026-09-20T12:00:00.000Z", relatedTasks: ["related-1"], taskSimilarityScores: { "stale123:old-1": 3 } };
    const freshProject = { lastRankedAt: "2026-09-30T12:00:00.000Z", relatedTaskRecords: [], relatedTasks: [],
      similaritySearchPageCount: 2, summary: "Recently ranked", uuid: "project-2" };
    const notes = { "Project Tasks Q4 2026 Work": { content: storeContentFromProjects([staleProject, freshProject]),
      uuid: "store-note" } };
    const tasks = [{ content: "Pick the Diff Digest send day", uuid: "related-1" }, { content: "Landing copy", uuid: "open-1" }];
    const rankProject = jest.fn().mockResolvedValue({ acceptedTasks: [{ matchScore: 7.7, taskText: "Landing copy",
      taskUuid: "open-1" }], failureReason: null, minimumMatchScore: 6, taskSimilarityScores: { "abc12345:open-1": 7.7 } });
    const rankerFactory = jest.fn().mockResolvedValue({ dictionaryChanges: {}, rankProject });
    const now = new Date("2026-10-01T12:00:00.000Z");
    const result = await refreshStaleProjectRankings(notesApp(notes, tasks), { accessToken: "token", domainName: "Work",
      domainUuid: "work-domain", now, rankerFactory, refineDictionary: false });
    expect(result).toEqual({ failures: 0, rankedCount: 1, skippedReason: null });
    expect(rankerFactory.mock.calls[0][1]).toMatchObject({ refineDictionary: false });
    expect(rankProject).toHaveBeenCalledTimes(1);
    expect(rankProject.mock.calls[0][2]).toEqual({ limitToRequiredTasks: false, requiredTaskRecords: [],
      storedRatings: {} });
    const stored = storedProjectRecords(notes["Project Tasks Q4 2026 Work"].content).recordsByUuid.get("project-1");
    expect(stored).toMatchObject({ lastAttemptedAt: "2026-09-30T12:00:00.000Z", lastRankedAt: now.toISOString(),
      relatedTasks: ["related-1"], taskSimilarityScores: { "abc12345:open-1": 7.7 } });
    expect(stored.relatedTaskRecords).toEqual([{ taskText: "Pick the Diff Digest send day", taskUuid: "related-1" },
      { matchScore: 7.7, taskText: "Landing copy", taskUuid: "open-1" }]);
  });

  it("stops a fast-model pass while the builder waits on the provider", async () => {
    const staleProject = { ...DIFF_DIGEST_PROJECT, lastRankedAt: "2026-09-20T12:00:00.000Z", relatedTasks: [] };
    const notes = { "Project Tasks Q4 2026 Work": { content: storeContentFromProjects([staleProject]), uuid: "store-note" } };
    const rankProject = jest.fn();
    const rankerFactory = jest.fn().mockResolvedValue({ dictionaryChanges: {}, rankProject, scorerEm: "generative" });
    const result = await refreshStaleProjectRankings(notesApp(notes, []), { accessToken: "token", domainName: "Work",
      domainUuid: "work-domain", isProviderBusy: () => true, now: new Date("2026-10-01T12:00:00.000Z"), rankerFactory });
    expect(result).toEqual({ failures: 0, rankedCount: 0, skippedReason: null });
    expect(rankProject).not.toHaveBeenCalled();
  });

  it("skips the pass when neither Jev nor a generative provider can rate", async () => {
    setPluginData({ settings: {} });
    const result = await refreshStaleProjectRankings({}, { domainName: "Work", domainUuid: "work-domain" });
    expect(result).toEqual({ failures: 0, rankedCount: 0, skippedReason: "noScorer" });
  });

  it("rates a recently ranked project's cited tasks that still have no similarity score", async () => {
    const freshProject = { ...DIFF_DIGEST_PROJECT, lastRankedAt: "2026-09-30T12:00:00.000Z", relatedTasks: ["open-1"],
      similaritySearchPageCount: 2 };
    const notes = { "Project Tasks Q4 2026 Work": { content: storeContentFromProjects([freshProject]), uuid: "store-note" } };
    const prospect = { approvalStatusEm: "humanAffirmed", evidence: [{ noteUuid: "note-1", taskUuid: "open-1",
      text: "Landing copy" }], priorityEm: "quarterFocus", quarterKey: "2026-Q4", relatedTasks: ["open-1"],
      summary: "Diff Digest launch", uuid: "project-1" };
    const rankProject = jest.fn().mockResolvedValue({ acceptedTasks: [], failureReason: null, minimumMatchScore: null,
      ratedCount: 1, taskSimilarityScores: { "abcd1234:open-1": 4.2 } });
    const rankerFactory = jest.fn().mockResolvedValue({ dictionaryChanges: {}, rankProject, scorerEm: "jev" });
    const now = new Date("2026-10-01T12:00:00.000Z");
    const result = await refreshStaleProjectRankings(notesApp(notes, [{ content: "Landing copy", uuid: "open-1" }]),
      { accessToken: "token", domainName: "Work", domainUuid: "work-domain", now, prospects: [prospect], rankerFactory });
    expect(result).toEqual({ failures: 0, rankedCount: 1, skippedReason: null });
    expect(rankProject.mock.calls[0][2]).toMatchObject({ limitToRequiredTasks: true,
      requiredTaskRecords: [{ noteUuid: "note-1", taskText: "Landing copy", taskUuid: "open-1" }] });
    const stored = storedProjectRecords(notes["Project Tasks Q4 2026 Work"].content).recordsByUuid.get("project-1");
    expect(stored.taskSimilarityScores).toEqual({ "abcd1234:open-1": 4.2 });
  });

  it("drops ratings for tasks the sources page does not cite, without ranking again", async () => {
    const rankedProject = { ...DIFF_DIGEST_PROJECT, lastRankedAt: "2026-09-30T12:00:00.000Z", relatedTasks: [],
      taskSimilarityScores: { "aaaa1111:cited-1": 6, "bbbb2222:pool-1": 1.2 } };
    const notes = { "Project Tasks Q4 2026 Work": { content: storeContentFromProjects([rankedProject]), uuid: "store-note" } };
    const prospect = { evidence: [{ taskUuid: "cited-1", text: "Ship the pager" }], quarterKey: "2026-Q4",
      summary: "Diff Digest launch", uuid: "project-1" };
    const rankerFactory = jest.fn();
    const now = new Date("2026-10-01T12:00:00.000Z");
    const result = await refreshStaleProjectRankings(notesApp(notes, []), { accessToken: "token", domainName: "Work",
      domainUuid: "work-domain", now, prospects: [prospect], rankerFactory });
    expect(result).toEqual({ failures: 0, rankedCount: 0, skippedReason: "current" });
    expect(rankerFactory).not.toHaveBeenCalled();
    const stored = storedProjectRecords(notes["Project Tasks Q4 2026 Work"].content).recordsByUuid.get("project-1");
    expect(stored.taskSimilarityScores).toEqual({ "aaaa1111:cited-1": 6 });
    expect(stored.lastRankedAt).toBe(rankedProject.lastRankedAt);
  });
});

describe("projectsDueForRanking", () => {
  const now = new Date("2026-10-01T12:00:00.000Z");
  const prospect = { approvalStatusEm: "awaitingJudgement", evidence: [{ taskUuid: "task-1", text: "Ship the pager" }],
    priorityEm: "quarterFocus", quarterKey: "2026-Q4", summary: "Quarter pager", uuid: "project-1" };

  it("includes a fresh project only for cited tasks that have no score", () => {
    const storedProjects = [{ lastRankedAt: "2026-09-30T12:00:00.000Z", summary: "Quarter pager", taskSimilarityScores: {},
      uuid: "project-1" }];
    const due = projectsDueForRanking({ now, prospects: [prospect], quarterKey: "2026-Q4", storedProjects, tasks: [] });
    expect(due).toEqual([{ includeCandidatePool: false, project: storedProjects[0],
      requiredTaskRecords: [{ noteUuid: null, taskText: "Ship the pager", taskUuid: "task-1" }] }]);
  });

  it("skips a fresh project once every cited task has a score", () => {
    const storedProjects = [{ lastRankedAt: "2026-09-30T12:00:00.000Z", summary: "Quarter pager",
      taskSimilarityScores: { "abcd1234:task-1": 6 }, uuid: "project-1" }];
    const due = projectsDueForRanking({ now, prospects: [prospect], quarterKey: "2026-Q4", scorerEm: "jev",
      storedProjects, tasks: [] });
    expect(due).toEqual([]);
  });

  it("ranks a guide project the store has never held over its whole pool", () => {
    const due = projectsDueForRanking({ now, prospects: [{ ...prospect, evidence: [] }], quarterKey: "2026-Q4",
      scorerEm: "jev", storedProjects: [], tasks: [] });
    expect(due).toEqual([{ includeCandidatePool: true, project: expect.objectContaining({ lastRankedAt: null,
      uuid: "project-1" }), requiredTaskRecords: [] }]);
  });

  it("ranks a fresh project whose first page found nothing similar, until its second page is searched", () => {
    const searchedProject = { lastRankedAt: "2026-09-30T12:00:00.000Z", similaritySearchPageCount: 1,
      similaritySearchedTaskCount: 500, summary: "Quarter pager", taskSimilarityScores: { "abcd1234:task-1": 2 },
      uuid: "project-1" };
    const dueOptions = { now, prospects: [prospect], quarterKey: "2026-Q4", scorerEm: "jev", tasks: [] };
    const due = projectsDueForRanking({ ...dueOptions, storedProjects: [searchedProject] });
    expect(due).toEqual([{ includeCandidatePool: true, project: searchedProject, requiredTaskRecords: [] }]);
    const deeperProject = { ...searchedProject, similaritySearchPageCount: 2, similaritySearchedTaskCount: 1000 };
    expect(projectsDueForRanking({ ...dueOptions, storedProjects: [deeperProject] })).toEqual([]);
    const shallowProject = { ...searchedProject, similaritySearchedTaskCount: 234 };
    expect(projectsDueForRanking({ ...dueOptions, storedProjects: [shallowProject] })).toEqual([]);
  });

  it("sends a fast-model project to its second page only while new tasks would not fill a page", () => {
    const searchedProject = { lastRankedAt: "2026-09-30T12:00:00.000Z", similaritySearchPageCount: 1,
      similaritySearchedTaskCount: 150, summary: "Quarter pager", taskSimilarityScores: { "a:one": 7, "b:two": 6.5 },
      uuid: "project-1" };
    expect(needsSecondSearchPage(searchedProject, { recentTaskCount: 20, scorerEm: "generative" })).toBe(true);
    expect(needsSecondSearchPage(searchedProject, { recentTaskCount: 150, scorerEm: "generative" })).toBe(false);
    expect(needsSecondSearchPage(searchedProject, { recentTaskCount: 0, scorerEm: "jev" })).toBe(false);
  });
});

describe("refreshStaleProjectRankings in parallel", () => {
  it("ranks Jev projects concurrently and writes every section", async () => {
    const projects = ["Alpha", "Bravo", "Charlie"].map((summary, index) => ({ lastRankedAt: null, relatedTaskRecords: [],
      relatedTasks: [], summary, uuid: `project-${ index }` }));
    const notes = { "Project Tasks Q4 2026 Work": { content: storeContentFromProjects(projects), uuid: "store-note" } };
    let inFlight = 0;
    let maximumInFlight = 0;
    const rankProject = jest.fn(async () => {
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      await new Promise(resolve => setTimeout(resolve, 5));
      inFlight -= 1;
      return { acceptedTasks: [], failureReason: null, minimumMatchScore: null, taskSimilarityScores: {} };
    });
    const rankerFactory = jest.fn().mockResolvedValue({ dictionaryChanges: {}, rankProject, scorerEm: "jev" });
    const now = new Date("2026-10-01T12:00:00.000Z");
    const result = await refreshStaleProjectRankings(notesApp(notes, []), { accessToken: "token", domainName: "Work",
      domainUuid: "work-domain", now, prospects: [], rankerFactory, refineDictionary: false });
    expect(result).toEqual({ failures: 0, rankedCount: 3, skippedReason: null });
    expect(maximumInFlight).toBe(3);
    const { recordsByUuid } = storedProjectRecords(notes["Project Tasks Q4 2026 Work"].content);
    expect([...recordsByUuid.values()].map(record => record.lastRankedAt)).toEqual(Array(3).fill(now.toISOString()));
  });
});

describe("Jev client", () => {
  it("routes OpenRouter keys to OpenRouter, and a browser's TypeSafe keys through the CORS proxy", () => {
    expect(jevRouteFromAccessToken("sk-or-v1-abc").routeEm).toBe("openrouter");
    expect(jevRouteFromAccessToken("ts-abc").endpoint).toBe(
      "https://aged-sunset-proxy.amplenote.workers.dev?apiurl=https%3A%2F%2Fapi.typesafe.ai%2Fv1%2Fsystemone");
    expect(jevRouteFromAccessToken("ts-abc", { useProxy: false })).toMatchObject({ endpoint: "https://api.typesafe.ai/v1/systemone",
      routeEm: "typesafe" });
  });

  itIfJevToken("rates a task serving the project above an unrelated one (live Jev call)", async () => {
    const requestAnswers = options => requestJevAnswers({ ...options, fetchImplementation: fetch, useProxy: false });
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
