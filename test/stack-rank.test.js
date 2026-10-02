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
import { GENERATIVE_CANDIDATE_TASK_LIMIT, prepareProjectTaskRanker } from "plan-wizard/stack-rank/stack-rank-project-tasks";
import { taskMatchScoresByProject, taskRatingKey } from "plan-wizard/stack-rank/task-rating-cache";
import { dictionaryEntriesFromContent, examinedProjectSummaries, mergedDictionaryContent,
  openUserTermsDictionary } from "plan-wizard/stack-rank/user-terms-dictionary";
import { pluginSettings, setPluginData } from "plugin-data";
import { storedProjectRecords } from "project-task-store";
import { initialProjectTaskStoreMarkdown, projectSectionHeadingText, projectSectionMarkdown } from "project-task-store-markdown";
import { jevRouteFromAccessToken, requestJevAnswers } from "providers/jev-client";

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

describe("acceptedRankedTasks", () => {
  it("accepts tasks rated 5 or higher", () => {
    const selection = acceptedRankedTasks(rankedTasksFromRatings([9.1, 5, 4.9, 1.2]));
    expect(selection.minimumMatchScore).toBe(5);
    expect(selection.acceptedTasks.map(task => task.rating)).toEqual([9.1, 5]);
  });

  it("raises a competitive project's minimum to 7 once more than 20 tasks clear 5", () => {
    const ratings = [...Array(17).fill(6), 7.5, 8, 9.2];
    expect(acceptedRankedTasks(rankedTasksFromRatings(ratings)).acceptedTasks).toHaveLength(20);
    const competitive = acceptedRankedTasks(rankedTasksFromRatings([...ratings, 5.5]));
    expect(competitive.minimumMatchScore).toBe(7);
    expect(competitive.acceptedTasks.map(task => task.rating)).toEqual([9.2, 8, 7.5]);
  });

  it("keeps the top 20 at 5 when a competitive project has nothing at 7", () => {
    const selection = acceptedRankedTasks(rankedTasksFromRatings(Array(25).fill(6)));
    expect(selection).toMatchObject({ minimumMatchScore: 5 });
    expect(selection.acceptedTasks).toHaveLength(20);
  });

  it("allows up to three leads rated from 3 when nothing reaches 5", () => {
    const selection = acceptedRankedTasks(rankedTasksFromRatings([4.8, 4.2, 3.9, 3.1, 2.9]));
    expect(selection.minimumMatchScore).toBe(3);
    expect(selection.acceptedTasks.map(task => task.rating)).toEqual([4.8, 4.2, 3.9]);
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
    const dogFoodKey = taskRatingKey("Diff Digest launch", { taskText: "Buy dog food", taskUuid: "open-2" });
    expect(ranking).toEqual({ acceptedTasks: [{ matchScore: 9, taskText: "Diff Digest landing copy", taskUuid: "open-1" }],
      failureReason: null, minimumMatchScore: 5, ratedCount: 2, taskRatings: { [dogFoodKey]: 1 } });
    expect(requestAnswers.mock.calls[0][0].state.userTermsDictionary).toEqual({
      "Diff Digest": "GitClear's weekly code-change email" });
    const savedScores = JSON.parse(pluginSettings().dashboard_project_match_scores);
    expect(savedScores).toEqual({ "work-domain": { "Q4 2026": { "project-1": 5 } } });
    expect(app.setSetting).toHaveBeenCalledWith("dashboard_project_match_scores", JSON.stringify(savedScores));
  });

  it("sends only tasks whose project and task text have no stored rating, and stores only those it did not keep", async () => {
    const tasks = [{ content: "Diff Digest landing copy", noteUUID: "note-1", updatedAt: 2, uuid: "open-1" },
      { content: "Buy dog food today", noteUUID: "note-1", updatedAt: 2, uuid: "open-2" },
      { content: "Renew passport", noteUUID: "note-1", updatedAt: 2, uuid: "open-3" }];
    const app = notesApp({}, tasks);
    const requestAnswers = jest.fn().mockResolvedValue({ answers: { task_1: { confidence: 0.9, score: 1, type: "score" },
      task_2: { confidence: 0.9, score: 0, type: "score" } } });
    const ranker = await prepareProjectTaskRanker(app, { accessToken: "token", domainName: "Work",
      domainUuid: "work-domain", now: new Date(2026, 9, 1), projects: [DIFF_DIGEST_PROJECT], refineDictionary: false,
      requestAnswers, tasks });
    const landingKey = taskRatingKey("Diff Digest launch", { taskText: "Diff Digest landing copy", taskUuid: "open-1" });
    const editedTaskKey = taskRatingKey("Diff Digest launch", { taskText: "Buy dog food", taskUuid: "open-2" });
    const renamedProjectKey = taskRatingKey("Diff Digest", { taskText: "Renew passport", taskUuid: "open-3" });
    const storedRatings = { [editedTaskKey]: 1, [landingKey]: 9, [renamedProjectKey]: 2 };
    const ranking = await ranker.rankProject(DIFF_DIGEST_PROJECT, [], { storedRatings });
    expect(requestAnswers).toHaveBeenCalledTimes(1);
    const sentTexts = Object.values(requestAnswers.mock.calls[0][0].state.prospectiveTasks).map(task => task.text);
    expect(sentTexts).toEqual(["Buy dog food today", "Renew passport"]);
    expect(ranking.acceptedTasks).toEqual([{ matchScore: 9, taskText: "Diff Digest landing copy", taskUuid: "open-1" }]);
    const dogFoodKey = taskRatingKey("Diff Digest launch", { taskText: "Buy dog food today", taskUuid: "open-2" });
    const passportKey = taskRatingKey("Diff Digest launch", { taskText: "Renew passport", taskUuid: "open-3" });
    expect(ranking.taskRatings).toEqual({ [dogFoodKey]: 2, [passportKey]: 1 });
    const repeatRanking = await ranker.rankProject(DIFF_DIGEST_PROJECT, [{ taskText: "Diff Digest landing copy",
      taskUuid: "open-1" }], { storedRatings: ranking.taskRatings });
    expect(requestAnswers).toHaveBeenCalledTimes(1);
    expect(repeatRanking.acceptedTasks).toEqual([]);
    expect(repeatRanking.taskRatings).toEqual(ranking.taskRatings);
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
  it("reads kept tasks' scores from their records and the rest from the sparse ratings", () => {
    const storedProjects = [{ jevRatings: { "a1b2c3d4:task-low": 2.2 }, relatedTaskRecords: [{ taskText: "By name",
      taskUuid: "task-named" }, { matchScore: 8.1, taskText: "Kept", taskUuid: "task-kept" }], uuid: "project-1" }];
    expect(taskMatchScoresByProject(storedProjects)).toEqual({ "project-1": { "task-kept": 8.1, "task-low": 2.2 } });
  });
});

describe("refreshStaleProjectRankings", () => {
  it("re-ranks only projects Jev has not ranked within three days, leaving the collection timestamp alone", async () => {
    const staleProject = { ...DIFF_DIGEST_PROJECT, jevRatings: { stale1234: 3 }, lastAttemptedAt: "2026-09-30T12:00:00.000Z",
      lastRankedAt: "2026-09-20T12:00:00.000Z", relatedTasks: ["related-1"] };
    const freshProject = { lastRankedAt: "2026-09-30T12:00:00.000Z", relatedTaskRecords: [], relatedTasks: [],
      summary: "Recently ranked", uuid: "project-2" };
    const notes = { "Project Tasks Q4 2026 Work": { content: storeContentFromProjects([staleProject, freshProject]),
      uuid: "store-note" } };
    const tasks = [{ content: "Pick the Diff Digest send day", uuid: "related-1" }, { content: "Landing copy", uuid: "open-1" }];
    const rankProject = jest.fn().mockResolvedValue({ acceptedTasks: [{ matchScore: 7.7, taskText: "Landing copy",
      taskUuid: "open-1" }], failureReason: null, minimumMatchScore: 5, taskRatings: { abc12345: 7.7 } });
    const rankerFactory = jest.fn().mockResolvedValue({ dictionaryChanges: {}, rankProject });
    const now = new Date("2026-10-01T12:00:00.000Z");
    const result = await refreshStaleProjectRankings(notesApp(notes, tasks), { accessToken: "token", domainName: "Work",
      domainUuid: "work-domain", now, rankerFactory, refineDictionary: false });
    expect(result).toEqual({ failures: 0, rankedCount: 1, skippedReason: null });
    expect(rankerFactory.mock.calls[0][1]).toMatchObject({ refineDictionary: false });
    expect(rankProject).toHaveBeenCalledTimes(1);
    expect(rankProject.mock.calls[0][2]).toEqual({ limitToRequiredTasks: false, requiredTaskRecords: [],
      storedRatings: { stale1234: 3 } });
    const stored = storedProjectRecords(notes["Project Tasks Q4 2026 Work"].content).recordsByUuid.get("project-1");
    expect(stored).toMatchObject({ jevRatings: { abc12345: 7.7 }, lastAttemptedAt: "2026-09-30T12:00:00.000Z",
      lastRankedAt: now.toISOString(),
      relatedTasks: ["related-1", "open-1"] });
    expect(stored.relatedTaskRecords.map(task => task.taskUuid)).toEqual(["related-1", "open-1"]);
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
    const freshProject = { ...DIFF_DIGEST_PROJECT, jevRatings: {}, lastRankedAt: "2026-09-30T12:00:00.000Z",
      relatedTasks: ["open-1"] };
    const notes = { "Project Tasks Q4 2026 Work": { content: storeContentFromProjects([freshProject]), uuid: "store-note" } };
    const prospect = { approvalStatusEm: "humanAffirmed", evidence: [{ noteUuid: "note-1", taskUuid: "open-1",
      text: "Landing copy" }], priorityEm: "quarterFocus", quarterKey: "2026-Q4", relatedTasks: ["open-1"],
      summary: "Diff Digest launch", uuid: "project-1" };
    const rankProject = jest.fn().mockResolvedValue({ acceptedTasks: [], failureReason: null, minimumMatchScore: null,
      ratedCount: 1, taskRatings: { "abcd1234:open-1": 4.2 } });
    const rankerFactory = jest.fn().mockResolvedValue({ dictionaryChanges: {}, rankProject, scorerEm: "jev" });
    const now = new Date("2026-10-01T12:00:00.000Z");
    const result = await refreshStaleProjectRankings(notesApp(notes, [{ content: "Landing copy", uuid: "open-1" }]),
      { accessToken: "token", domainName: "Work", domainUuid: "work-domain", now, prospects: [prospect], rankerFactory });
    expect(result).toEqual({ failures: 0, rankedCount: 1, skippedReason: null });
    expect(rankProject.mock.calls[0][2]).toMatchObject({ limitToRequiredTasks: true,
      requiredTaskRecords: [{ noteUuid: "note-1", taskText: "Landing copy", taskUuid: "open-1" }] });
    const stored = storedProjectRecords(notes["Project Tasks Q4 2026 Work"].content).recordsByUuid.get("project-1");
    expect(stored.jevRatings).toEqual({ "abcd1234:open-1": 4.2 });
  });
});

describe("projectsDueForRanking", () => {
  const now = new Date("2026-10-01T12:00:00.000Z");
  const prospect = { approvalStatusEm: "awaitingJudgement", evidence: [{ taskUuid: "task-1", text: "Ship the pager" }],
    priorityEm: "quarterFocus", quarterKey: "2026-Q4", summary: "Quarter pager", uuid: "project-1" };

  it("includes a fresh project only for cited tasks that have no score", () => {
    const storedProjects = [{ jevRatings: {}, lastRankedAt: "2026-09-30T12:00:00.000Z", summary: "Quarter pager",
      uuid: "project-1" }];
    const due = projectsDueForRanking({ now, prospects: [prospect], quarterKey: "2026-Q4", storedProjects, tasks: [] });
    expect(due).toEqual([{ includeCandidatePool: false, project: storedProjects[0],
      requiredTaskRecords: [{ noteUuid: null, taskText: "Ship the pager", taskUuid: "task-1" }] }]);
  });

  it("skips a fresh project once every cited task has a score", () => {
    const storedProjects = [{ jevRatings: { "abcd1234:task-1": 6 }, lastRankedAt: "2026-09-30T12:00:00.000Z",
      summary: "Quarter pager", uuid: "project-1" }];
    const due = projectsDueForRanking({ now, prospects: [prospect], quarterKey: "2026-Q4", storedProjects, tasks: [] });
    expect(due).toEqual([]);
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
