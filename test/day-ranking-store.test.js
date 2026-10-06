// Verify the shared day ranking: its revision covers what the ranker reads but not how recently a candidate was shown,
// the store keeps a bounded set of rankings and never overwrites a note a newer version wrote, a prepared ranking is
// reused across Dream Task's and the agenda's requests without another provider request, preparing records nothing
// as shown, and the queued preparation stores a ranking that a later request reuses.
import { jest } from "@jest/globals";
import { SETTING_KEYS } from "constants/settings";
import DayRankingStore, { dayRankingNoteName } from "dashboard/day-ranking-store";
import QuarterProject from "dashboard/quarter-project";
import QuarterProjectRepository from "dashboard/quarter-project-repository";
import { agendaSuggestionsFromProjects, prepareDayRanking, recordShownTaskSuggestions } from "dashboard/ranked-task-suggestions";
import { dayRankingRevision, suggestionQuestions } from "dashboard/suggestion-task-rank";
import { createPrepareDayRankingHandler } from "dashboard/work-queue/jobs/prepare-day-ranking";
import { setPluginData } from "plugin-data";
import { jobContext, maintenanceApp, NOW, PROJECT_UUID, SCOPE_INPUT } from "./project-maintenance-test-app";

const DATE_KEY = "2026-09-19";
const DOMAIN = { domainName: SCOPE_INPUT.domainName, domainUuid: SCOPE_INPUT.domainUuid };
const STORE_SCOPE = { ...SCOPE_INPUT, quarterKey: "2026-Q3" };
const TASKS = [{ content: "Write the launch post", noteUUID: "task-note", uuid: "task-1" },
  { content: "Fix the date picker", noteUUID: "task-note", uuid: "task-2" }];

// ----------------------------------------------------------------------------------------------
// @desc A Jev stand-in rating each candidate by its position, first best.
// @returns {function} A requestAnswers mock.
function positionalAnswers() {
  return jest.fn(async ({ questions }) => {
    const names = Object.keys(questions);
    const answerEntries = names.map((name, index) => [name, { confidence: 0.5, score: 9 - index, type: "score" }]);
    return { answers: Object.fromEntries(answerEntries) };
  });
}

// ----------------------------------------------------------------------------------------------
// @desc Store the plan's project with a weekly pace, so it qualifies every day, and the given associated tasks.
// @param {object} app - From maintenanceApp.
// @param {Array<object>} [tasks=TASKS] - Native tasks to associate with the project.
// @returns {Promise<void>}
async function storeQualifyingProject(app, tasks = TASKS) {
  const relatedTaskRecords = tasks.map(task => ({ taskText: task.content, taskUuid: task.uuid }));
  const sourceProject = new QuarterProject({ blocksPerWeek: 2, relatedTaskRecords, summary: "Launch dashboard", uuid: PROJECT_UUID });
  await new QuarterProjectRepository({ app }).applyResult(STORE_SCOPE, { apply: project => project.setRelatedTaskRecords(relatedTaskRecords),
    sourceProject });
}

// ----------------------------------------------------------------------------------------------
// @desc A ranked candidate as rankDayTasks returns one, carrying what the store keeps.
// @param {string} candidateId - Candidate ID.
// @param {number} rankerRating - The ranker's rating.
// @returns {object} Ranked candidate.
function rankedCandidate(candidateId, rankerRating) {
  return { candidateId, rankerRating, rating: rankerRating };
}

describe("dayRankingRevision", () => {
  const group = (text, minutesSinceRecommended) => [{ projectUuid: PROJECT_UUID, rationale: "Twice per week.", summary: "Launch",
    taskCandidates: [{ candidateId: "task:task-1", isExisting: true, minutesSinceRecommended, score: 8, text, uuid: "task-1" }] }];
  const revision = (groups, scorerEm = "jev") => dayRankingRevision(suggestionQuestions(groups).state, scorerEm);

  // ----------------------------------------------------------------------------------------------
  // @desc Showing a candidate does not change the question asked, but its text, or the ranker answering, does.
  it("ignores recency and changes with the candidates or the ranker", () => {
    expect(revision(group("Write the launch post", null))).toBe(revision(group("Write the launch post", 15)));
    expect(revision(group("Write the launch post", null))).not.toBe(revision(group("Write the launch announcement", null)));
    expect(revision(group("Write the launch post", null), "generative")).not.toBe(revision(group("Write the launch post", null)));
  });
});

describe("DayRankingStore", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A saved ranking is found by day and revision; past days and a day's oldest rankings beyond three are dropped.
  it("reads rankings by day and revision and keeps a bounded set", async () => {
    const app = maintenanceApp({ tasks: [] });
    const store = new DayRankingStore({ app, clock: () => NOW.getTime() });
    await store.save("work-domain", { dateKey: "2026-09-18", rankedTasks: [rankedCandidate("task:old", 5)], rankerEm: "jev",
      revision: "jev:past" });
    for (const revision of ["jev:a", "jev:b", "jev:c", "jev:d"]) {
      await store.save("work-domain", { dateKey: DATE_KEY, rankedTasks: [rankedCandidate("task:task-1", 9),
        rankedCandidate("idea:idea-1", 7)], rankerEm: "jev", revision });
    }
    const saved = await store.read("work-domain", { dateKey: DATE_KEY, revision: "jev:d" });
    expect(saved).toMatchObject({ dateKey: DATE_KEY, rankerEm: "jev", ratings: [["task:task-1", 9], ["idea:idea-1", 7]] });
    expect(await store.read("work-domain", { dateKey: DATE_KEY, revision: "jev:a" })).toBeNull();
    expect(await store.read("work-domain", { dateKey: "2026-09-18", revision: "jev:past" })).toBeNull();
    expect(await store.read("other-domain", { dateKey: DATE_KEY, revision: "jev:d" })).toBeNull();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A note written by a newer version reads as empty and is never overwritten.
  it("leaves a note from a newer version untouched", async () => {
    const app = maintenanceApp({ tasks: [] });
    const name = dayRankingNoteName(null);
    const uuid = await app.createNote(name, []);
    const content = "# Dashboard day ranking\n\n```json\n{\"rankings\":[],\"schemaVersion\":9}\n```\n";
    await app.replaceNoteContent({ uuid }, content);
    const store = new DayRankingStore({ app, clock: () => NOW.getTime() });
    expect(await store.read(null, { dateKey: DATE_KEY, revision: "jev:a" })).toBeNull();
    await expect(store.save(null, { dateKey: DATE_KEY, rankedTasks: [], rankerEm: "jev", revision: "jev:a" })).rejects.toThrow("newer");
    expect(app.noteContent(name)).toBe(content);
  });
});

describe("prepareDayRanking", () => {
  beforeEach(() => setPluginData({ settings: { [SETTING_KEYS.JEV_ACCESS_TOKEN]: "jev-token" } }));
  afterEach(() => setPluginData({ settings: {} }));

  // ----------------------------------------------------------------------------------------------
  // @desc A second request asking the same question, at another hour of the day, reuses the stored ranking.
  it("reuses a stored ranking without asking the ranker again, and records nothing as shown", async () => {
    const app = maintenanceApp({ tasks: TASKS });
    await storeQualifyingProject(app);
    const requestAnswers = positionalAnswers();
    const first = await prepareDayRanking(app, { ...DOMAIN, openTasks: TASKS, requestAnswers, targetDate: NOW });
    const midnight = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate());
    const second = await prepareDayRanking(app, { ...DOMAIN, openTasks: TASKS, requestAnswers, targetDate: midnight });
    expect(first.outcome).toBe("ranked");
    expect(second.outcome).toBe("stored");
    expect(requestAnswers).toHaveBeenCalledTimes(1);
    expect(second.ranking.rankedTasks.map(task => task.candidateId)).toEqual(first.ranking.rankedTasks.map(task => task.candidateId));
    expect(second.ranking.rankedTasks[0]).toMatchObject({ noteUuid: "task-note", projectUuid: PROJECT_UUID, taskUuid: "task-1" });
    const stored = await new QuarterProjectRepository({ app }).readOne(STORE_SCOPE, PROJECT_UUID);
    expect(stored.taskSuggestions).toEqual([]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Showing a suggestion keeps the ranking usable, and its recency is read afresh; a new candidate asks again.
  it("stays valid after a suggestion is shown and is replaced when the candidates change", async () => {
    const app = maintenanceApp({ tasks: TASKS });
    await storeQualifyingProject(app);
    const requestAnswers = positionalAnswers();
    await prepareDayRanking(app, { ...DOMAIN, openTasks: TASKS, requestAnswers, targetDate: NOW });
    await recordShownTaskSuggestions(app, { ...DOMAIN, suggestions: [{ projectUuid: PROJECT_UUID, taskUuid: "task-1" }],
      targetDate: NOW });
    const afterShown = await prepareDayRanking(app, { ...DOMAIN, openTasks: TASKS, requestAnswers, targetDate: NOW });
    expect(afterShown.outcome).toBe("stored");
    expect(afterShown.ranking.rankedTasks.find(task => task.taskUuid === "task-1").minutesSinceRecommended).toBe(0);
    const grownTasks = [...TASKS, { content: "Record the demo", noteUUID: "task-note", uuid: "task-3" }];
    await storeQualifyingProject(app, grownTasks);
    const afterChange = await prepareDayRanking(app, { ...DOMAIN, openTasks: grownTasks, requestAnswers, targetDate: NOW });
    expect(afterChange.outcome).toBe("ranked");
    expect(requestAnswers).toHaveBeenCalledTimes(2);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The agenda slots a ranking Dream Task's request prepared, with no provider request and no exposure recorded.
  it("lets the agenda reuse a prepared ranking without recording exposure", async () => {
    const app = maintenanceApp({ tasks: TASKS });
    await storeQualifyingProject(app);
    await prepareDayRanking(app, { ...DOMAIN, openTasks: TASKS, requestAnswers: positionalAnswers(), targetDate: NOW });
    const replaceNoteContent = jest.spyOn(app, "replaceNoteContent");
    const midnight = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate());
    const agenda = await agendaSuggestionsFromProjects(app, { ...DOMAIN, openTasks: TASKS, projects: [], targetDate: midnight });
    expect(agenda.activities.map(activity => activity.taskUuid)).toEqual(["task-1", "task-2"]);
    expect(replaceNoteContent).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A candidate an earlier day of the range claimed is left out after ranking, so the stored ranking is still
  //   reused and the next candidate takes the day.
  it("leaves out candidates an earlier day already claimed while reusing the ranking", async () => {
    const app = maintenanceApp({ tasks: TASKS });
    await storeQualifyingProject(app);
    const requestAnswers = positionalAnswers();
    await prepareDayRanking(app, { ...DOMAIN, openTasks: TASKS, requestAnswers, targetDate: NOW });
    const midnight = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate());
    const agenda = await agendaSuggestionsFromProjects(app, { ...DOMAIN, excludedSuggestionKeys: new Set(["task:task-1"]),
      openTasks: TASKS, projects: [], targetDate: midnight });
    expect(agenda.activities.map(activity => activity.taskUuid)).toEqual(["task-2"]);
    expect(agenda.reserveTasks.map(task => task.taskUuid)).not.toContain("task-1");
    expect(requestAnswers).toHaveBeenCalledTimes(1);
  });
});

describe("prepareDayRanking job", () => {
  beforeEach(() => setPluginData({ settings: { [SETTING_KEYS.JEV_ACCESS_TOKEN]: "jev-token" } }));
  afterEach(() => setPluginData({ settings: {} }));
  const job = { attempt: 1, category: "maintenance", input: { dateKey: DATE_KEY, ...DOMAIN }, type: "prepareDayRanking" };

  // ----------------------------------------------------------------------------------------------
  // @desc A queued preparation stores the ranking, and running it again finds it current without a request.
  it("prepares the day's ranking through a provider permit and completes from the store when current", async () => {
    const app = maintenanceApp({ tasks: TASKS });
    await storeQualifyingProject(app);
    const requestAnswers = positionalAnswers();
    const handler = createPrepareDayRankingHandler({ requestAnswers });
    const first = await handler.run({ context: jobContext(app), job, signal: null });
    const second = await handler.run({ context: jobContext(app), job, signal: null });
    expect(first).toMatchObject({ outcomes: { dreamTask: "ranked" }, revision: expect.stringMatching(/^dreamTask=jev:/) });
    expect(second).toEqual({ outcomes: { dreamTask: "stored" }, revision: first.revision });
    expect(requestAnswers).toHaveBeenCalledTimes(1);
    expect(() => handler.validateInput({ ...job.input, dateKey: "tomorrow" })).toThrow("dateKey");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A day without candidates retires the job; nothing able to rank waits for configuration.
  it("retires without candidates and waits for a ranker", async () => {
    const app = maintenanceApp({ tasks: TASKS });
    const handler = createPrepareDayRankingHandler({ requestAnswers: positionalAnswers() });
    expect(await handler.run({ context: jobContext(app), job, signal: null })).toEqual({ status: "superseded" });
    await storeQualifyingProject(app);
    setPluginData({ settings: {} });
    const unconfigured = createPrepareDayRankingHandler();
    await expect(unconfigured.run({ context: jobContext(app), job, signal: null })).rejects.toMatchObject({
      workFailure: "configuration" });
  });
});
