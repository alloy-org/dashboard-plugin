// Verify contextual duration choices, durable reuse, partial failures, and calendar placement through shared rankings.
import { jest } from "@jest/globals";
import { SETTING_KEYS } from "constants/settings";
import { createEstimateTaskDurationsHandler } from "dashboard/work-queue/jobs/estimate-task-durations";
import { taskDurationEstimatesRequest, taskDurationEstimatesRequestIfAvailable } from "dashboard/work-queue/jobs/project-job-requests";
import { guideSectionRange } from "plan-wizard/vision-guide-markdown";
import { setPluginData } from "plugin-data";
import { OPENAI_DECISIONS_ENDPOINT } from "providers/decisions-endpoint";
import { initialProjectTaskStoreMarkdown } from "dashboard/project-tasks/project-task-store-markdown";
import { projectTaskStoreNoteName, storedProjectRecords } from "dashboard/project-tasks/project-task-store";
import QuarterProject from "quarter-project";
import { prepareDayRanking } from "dashboard/suggestions/ranked-task-suggestions";
import { slotRankedTasks } from "dashboard/suggestions/suggestion-task-slots";
import { DURATION_BATCH_SIZE, DURATION_MINUTE_CHOICES, durationEstimatesFromContent, readDurationEstimates,
  writeDurationEstimates } from "dashboard/project-tasks/task-duration-estimates";
import { estimateCandidateDurations } from "dashboard/project-tasks/task-duration-service";

const SCOPE = { domainName: "Work", domainUuid: "work-domain", quarter: 4, quarterKey: "Q4 2026", year: 2026 };
const STORE_NAME = projectTaskStoreNoteName(SCOPE);

// ----------------------------------------------------------------------------------------------
// @desc Provide notes, native tasks, and actual section writes in memory, retaining unrelated markdown for assertions.
// @returns {object} { app, notes, tasks }.
function durationNotebook() {
  const notes = new Map([
    [STORE_NAME, { content: initialProjectTaskStoreMarkdown(), name: STORE_NAME, uuid: "store-note" }],
    ["User terms dictionary 2026", { content: "# Terms\n- **Jev**: A task rater[^1]\n\n[^1]: [Details]()\n\n    Handles notebook context.",
      name: "User terms dictionary 2026", uuid: "dictionary-note" }],
    ["Project note", { content: "", name: "Project note", tags: ["work/amplenote/dashboard", "clients/enterprise"], uuid: "project-note" }],
  ]);
  const tasks = new Map();
  const app = {
    context: { refreshNotesList: jest.fn(async () => true) },
    createNote: jest.fn(async name => { notes.set(name, { content: "", name, uuid: name }); return name; }),
    filterNotes: jest.fn(async () => []),
    findNote: jest.fn(async ({ name, uuid }) => name ? notes.get(name) || null : [...notes.values()].find(note => note.uuid === uuid) || null),
    getNoteContent: jest.fn(async ({ uuid }) => [...notes.values()].find(note => note.uuid === uuid)?.content || ""),
    getTask: jest.fn(async uuid => tasks.get(uuid) || null),
    getTaskDomainTasks: jest.fn(async () => [...tasks.values()]),
    insertNoteContent: jest.fn(async ({ uuid }, content) => { [...notes.values()].find(note => note.uuid === uuid).content += content; }),
    replaceNoteContent: jest.fn(async ({ uuid }, content, options) => {
      const note = [...notes.values()].find(record => record.uuid === uuid);
      const section = options?.section?.heading ? guideSectionRange(note.content, options.section.heading.text) : null;
      note.content = section ? `${ note.content.slice(0, section.bodyStart) }${ content }${ note.content.slice(section.end) }` : content;
      return true;
    }),
  };
  return { app, notes, tasks };
}

// ----------------------------------------------------------------------------------------------
// @desc A task or idea candidate in the recommendation flow's shape, with an existing half-hour default.
// @param {object} [overrides] - Candidate fields to replace.
// @returns {object} Candidate.
function durationCandidate(overrides = {}) {
  return { candidateId: "task:task-1", durationMinutes: 30, isExisting: true, noteUuid: "project-note",
    text: "Build duration pass", uuid: "task-1", ...overrides };
}

// ----------------------------------------------------------------------------------------------
// @desc Answer each duration question categorically, as Jev does, with a fixed allowed minute choice.
// @param {number} [minutes] - Allowed choice, defaulting to 120.
// @returns {function} Mock requester.
function durationRequester(minutes = 120) {
  return jest.fn(async ({ questions }) => ({ answers: Object.fromEntries(Object.keys(questions).map(name =>
    [name, { choice: String(minutes), type: "choice" }])) }));
}

afterEach(() => setPluginData({ context: {}, settings: {} }));

describe("conservative duration pass", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc An OpenAI-only account schedules and answers categorical durations through the configured DecisionsEndpoint.
  it("schedules and estimates through OpenAI Decisions without a Jev key", async () => {
    const { app } = durationNotebook();
    setPluginData({ settings: { [SETTING_KEYS.LLM_API_KEY_OPENAI]: "openai-test-key" } });
    const request = await taskDurationEstimatesRequestIfAvailable(app, SCOPE, { requestedAt: 123 });
    expect(request).toMatchObject({ desiredRevision: "123", type: "estimateTaskDurations" });
    const originalFetch = globalThis.fetch;
    const fetchImplementation = jest.fn(async () => ({ ok: true, text: async () => JSON.stringify({
      answers: [{ choice: "90", name: "duration_1", type: "choice" }] }) }));
    globalThis.fetch = fetchImplementation;
    try {
      const candidate = durationCandidate();
      await estimateCandidateDurations(app, { groups: [{ taskCandidates: [candidate] }], scope: SCOPE });
      expect(candidate.durationMinutes).toBe(90);
      expect((await readDurationEstimates(app, SCOPE))["task-1"].durationMinutes).toBe(90);
      expect(fetchImplementation).toHaveBeenCalledTimes(1);
      const [endpointUrl, options] = fetchImplementation.mock.calls[0];
      expect(endpointUrl).toBe(OPENAI_DECISIONS_ENDPOINT);
      expect(options.headers.Authorization).toBe("Bearer openai-test-key");
      expect(JSON.parse(options.body).questions[0]).toMatchObject({ name: "duration_1", type: "choice" });
    } finally { globalThis.fetch = originalFetch; }
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Missing decision-provider configuration leaves duration maintenance unscheduled.
  it("does not schedule a duration pass without any available decision provider", async () => {
    const { app } = durationNotebook();
    setPluginData({ settings: {} });
    await expect(taskDurationEstimatesRequestIfAvailable(app, SCOPE, { requestedAt: 123 })).resolves.toBeNull();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Share task context and resolved dictionary definitions, resolve direct parents, and offer exactly seven choices.
  it("sends note name, hierarchical tags, parent text, task text, and the user's dictionary", async () => {
    const { app, notes, tasks } = durationNotebook();
    tasks.set("task-1", { content: "Build duration pass", noteUUID: "project-note", parentUUID: "parent", uuid: "task-1" });
    tasks.set("parent", { content: "Ship better calendar recommendations", noteUUID: "project-note", uuid: "parent" });
    const requestAnswers = durationRequester(90);
    const candidate = durationCandidate();
    await estimateCandidateDurations(app, { groups: [{ taskCandidates: [candidate, { ...candidate }] }], requestAnswers, scope: SCOPE });
    const { questions, state } = requestAnswers.mock.calls[0][0];
    expect(Object.keys(questions)).toEqual(["duration_1"]);
    expect(Object.keys(questions.duration_1.criteria).map(Number)).toEqual(DURATION_MINUTE_CHOICES);
    expect(questions.duration_1.type).toBe("choice");
    expect(state.tasks.duration_1).toMatchObject({ hierarchicalTags: ["clients/enterprise", "work/amplenote/dashboard"],
      noteName: "Project note", parentTaskText: "Ship better calendar recommendations", taskText: "Build duration pass" });
    expect(state.userTermsDictionary.Jev).toContain("Handles notebook context.");
    expect(candidate.durationMinutes).toBe(90);
    expect(durationEstimatesFromContent(notes.get(STORE_NAME).content)["task-1"].durationMinutes).toBe(90);
    expect(app.getTask).toHaveBeenCalledWith("parent");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Older task APIs infer outline parents, and an unavailable parentUUID gives null rather than failing estimation.
  it("uses outline parents and tolerates a missing direct parent", async () => {
    const { app, notes, tasks } = durationNotebook();
    notes.get("Project note").content = '- [ ] Release <!-- {"uuid":"parent"} -->\n  - [ ] Build duration pass <!-- {"uuid":"task-1"} -->';
    const requestAnswers = durationRequester();
    await estimateCandidateDurations(app, { groups: [{ taskCandidates: [durationCandidate()] }], requestAnswers, scope: SCOPE });
    expect(requestAnswers.mock.calls[0][0].state.tasks.duration_1.parentTaskText).toBe("Release");
    tasks.set("task-1", { content: "Build duration pass", noteUUID: "project-note", parentUUID: "deleted", uuid: "task-1" });
    await estimateCandidateDurations(app, { groups: [{ taskCandidates: [durationCandidate()] }], requestAnswers, scope: SCOPE });
    expect(requestAnswers.mock.calls[1][0].state.tasks.duration_1.parentTaskText).toBeNull();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Repeating an identical pass asks nothing, while edited context invalidates only that candidate's estimate.
  it.each(["dictionary", "noteName", "tags", "parent", "task"])("reuses estimates until %s changes", async changedField => {
    const { app, notes, tasks } = durationNotebook();
    tasks.set("task-1", { content: "Build duration pass", noteUUID: "project-note", parentUUID: "parent", uuid: "task-1" });
    tasks.set("parent", { content: "Release", uuid: "parent" });
    const requestAnswers = durationRequester();
    const options = { groups: [{ taskCandidates: [durationCandidate()] }], requestAnswers, scope: SCOPE };
    await estimateCandidateDurations(app, options);
    const reused = await estimateCandidateDurations(app, options);
    expect(reused.reusedCount).toBe(1);
    expect(requestAnswers).toHaveBeenCalledTimes(1);
    if (changedField === "dictionary") {
      const dictionary = notes.get("User terms dictionary 2026");
      dictionary.content = dictionary.content.replace("A task rater", "Updated task rater");
    }
    if (changedField === "noteName") notes.get("Project note").name = "New name";
    if (changedField === "tags") notes.get("Project note").tags.push("work/new-scope");
    if (changedField === "parent") tasks.get("parent").content = "Different release";
    if (changedField === "task") tasks.get("task-1").content = "Build and test duration pass";
    await estimateCandidateDurations(app, options);
    expect(requestAnswers).toHaveBeenCalledTimes(2);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Ideas share the same estimate pipeline, and explicit task seconds override an old estimate on every read path.
  it("estimates ideas and preserves explicit task durations, including stored-only reads", async () => {
    const { app, tasks } = durationNotebook();
    const idea = durationCandidate({ candidateId: "idea:idea-1", isExisting: false, uuid: null });
    const candidate = durationCandidate();
    const groups = [{ taskCandidates: [candidate, idea] }];
    const requestAnswers = durationRequester(180);
    await estimateCandidateDurations(app, { groups, requestAnswers, scope: SCOPE });
    expect(idea.durationMinutes).toBe(180);
    expect((await readDurationEstimates(app, SCOPE))["idea:idea-1"].durationMinutes).toBe(180);
    const task = { content: candidate.text, duration: 2700, noteUUID: "project-note", uuid: "task-1" };
    tasks.set(task.uuid, task);
    await estimateCandidateDurations(app, { groups, openTasks: [task], requestAnswers, scope: SCOPE });
    expect(candidate.durationMinutes).toBe(45);
    candidate.durationMinutes = 30;
    await estimateCandidateDurations(app, { groups, openTasks: [task], requestAnswers, scope: SCOPE, storedOnly: true });
    expect(candidate.durationMinutes).toBe(45);
    expect(requestAnswers).toHaveBeenCalledTimes(1);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Preserve successful batches when the next batch fails; a retry asks only for the remaining UUIDs.
  it("persists successful batches before a later request fails", async () => {
    const { app } = durationNotebook();
    const taskCandidates = Array.from({ length: DURATION_BATCH_SIZE + 1 }, (_, index) => durationCandidate({
      candidateId: `task:task-${ index }`, uuid: `task-${ index }` }));
    const requestAnswers = durationRequester(240);
    requestAnswers.mockImplementationOnce(durationRequester(240)).mockRejectedValueOnce(new Error("offline"));
    const options = { groups: [{ taskCandidates }], requestAnswers, scope: SCOPE };
    await expect(estimateCandidateDurations(app, options)).rejects.toThrow("offline");
    expect(Object.keys(await readDurationEstimates(app, SCOPE))).toHaveLength(DURATION_BATCH_SIZE);
    await estimateCandidateDurations(app, options);
    expect(Object.keys(requestAnswers.mock.calls[2][0].questions)).toHaveLength(1);
    expect(taskCandidates.every(candidate => candidate.durationMinutes === 240)).toBe(true);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Refused, missing, fractional, or unsupported answers cannot become estimates or silently normalize to a bucket.
  it.each([null, { type: "refusal" }, { choice: "45", type: "choice" }, { choice: "60.5", type: "choice" },
    { score: 1, type: "score" }])("rejects unusable answer %j", async answer => {
    const { app } = durationNotebook();
    const candidate = durationCandidate();
    const requestAnswers = jest.fn(async () => ({ answers: { duration_1: answer } }));
    const result = await estimateCandidateDurations(app, { groups: [{ taskCandidates: [candidate] }], requestAnswers, scope: SCOPE });
    expect(result.waitingCount).toBe(1);
    expect(candidate.durationMinutes).toBe(30);
    expect(await readDurationEstimates(app, SCOPE)).toEqual({});
  });
});

describe("duration persistence and consumers", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Concurrent index writes merge under the project note's writer without changing project sections or footnotes.
  it("merges overlapping writes while preserving project markdown and rejecting unsupported schemas", async () => {
    const { app, notes } = durationNotebook();
    const project = new QuarterProject({ summary: "Dashboard", uuid: "project-1" });
    notes.get(STORE_NAME).content = initialProjectTaskStoreMarkdown().replace("# Past projects",
      `## Dashboard (project:project-1)\n${ project.toStoreSection() }\n# Past projects\nUser prose[^7]\n\n[^7]: [Keep]()\n\n    Preserve this.\n`);
    const before = notes.get(STORE_NAME).content;
    await Promise.all([writeDurationEstimates(app, SCOPE, { first: { durationMinutes: 60, inputRevision: "a" } }),
      writeDurationEstimates(app, SCOPE, { second: { durationMinutes: 300, inputRevision: "b" } })]);
    expect(notes.get(STORE_NAME).content.startsWith(before)).toBe(true);
    expect(Object.keys(await readDurationEstimates(app, SCOPE))).toEqual(["first", "second"]);
    expect(storedProjectRecords(notes.get(STORE_NAME).content).recordsByUuid.get("project-1").summary).toBe("Dashboard");
    notes.get(STORE_NAME).content = notes.get(STORE_NAME).content.replace('"schemaVersion": 1', '"schemaVersion": 999');
    await expect(writeDurationEstimates(app, SCOPE, { third: { durationMinutes: 60, inputRevision: "c" } })).rejects.toThrow("Invalid");
    expect(app.insertNoteContent).toHaveBeenCalledTimes(1);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A prepared and a reused ranking both slot the estimated duration, and the stored-only path asks no provider.
  it("uses estimated minutes in calendar blocks and when reusing a day's ranking", async () => {
    const { app } = durationNotebook();
    const project = new QuarterProject({ primaryNoteUuid: "project-note", priorityEm: "quarterFocus", summary: "Dashboard", uuid: "project-1" });
    const openTasks = [{ content: "Build duration pass", noteUUID: "project-note", uuid: "task-1" }];
    const requestAnswers = jest.fn(async () => ({ answers: { task_1: { score: 8, type: "score" } } }));
    const requestDurations = durationRequester(120);
    const options = { calendarEvents: [], ...SCOPE, openTasks, projects: [project], requestAnswers, requestDurations,
      targetDate: new Date(2026, 9, 14) };
    const first = await prepareDayRanking(app, options);
    expect(first.ranking.rankedTasks[0].durationMinutes).toBe(120);
    const [activity] = slotRankedTasks(first.ranking.rankedTasks).activities;
    expect(activity.durationMinutes).toBe(120);
    const reused = await prepareDayRanking(app, options);
    expect(reused.outcome).toBe("stored");
    expect(reused.ranking.rankedTasks[0].durationMinutes).toBe(120);
    await prepareDayRanking(app, { ...options, storedOnly: true });
    expect(requestAnswers).toHaveBeenCalledTimes(1);
    expect(requestDurations).toHaveBeenCalledTimes(1);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A slow duration answer delays the ranking by at most 5000ms; the estimate is still saved once it arrives,
  //   so the next stored-only read slots it.
  it("ranks without waiting more than 5000ms for duration estimates, then saves the late answer", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
    const { app } = durationNotebook();
    const project = new QuarterProject({ primaryNoteUuid: "project-note", priorityEm: "quarterFocus", summary: "Dashboard", uuid: "project-1" });
    const openTasks = [{ content: "Build duration pass", noteUUID: "project-note", uuid: "task-1" }];
    const requestAnswers = jest.fn(async () => ({ answers: { task_1: { score: 8, type: "score" } } }));
    let releaseDurations = null;
    const answeredDurations = durationRequester(120);
    const requestDurations = jest.fn(request => new Promise(resolve => { releaseDurations = () => resolve(answeredDurations(request)); }));
    const options = { calendarEvents: [], ...SCOPE, openTasks, projects: [project], requestAnswers, requestDurations,
      targetDate: new Date(2026, 9, 14) };
    let settled = false;
    const preparing = prepareDayRanking(app, options).then(result => { settled = true; return result; });
    await jest.advanceTimersByTimeAsync(4999);
    expect(requestDurations).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    const first = await preparing;
    expect(first.ranking.rankedTasks[0].durationMinutes).not.toBe(120);
    jest.useRealTimers();
    releaseDurations();
    await new Promise(resolve => setTimeout(resolve, 0));
    const stored = await prepareDayRanking(app, { ...options, storedOnly: true });
    expect(stored.ranking.rankedTasks[0].durationMinutes).toBe(120);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Maintenance estimates current candidates even on a weekday they are not recommended and retries unanswered work.
  it("runs the registered quarter maintenance pass with fresh tasks and retryable failures", async () => {
    const { app, tasks } = durationNotebook();
    const project = new QuarterProject({ preferredWeekdays: ["sunday"], primaryNoteUuid: "project-note",
      priorityEm: "quarterFocus", summary: "Dashboard", uuid: "project-1" });
    tasks.set("task-1", { content: "Build duration pass", noteUUID: "project-note", uuid: "task-1" });
    const estimator = jest.fn(async () => ({ estimatedCount: 1, reusedCount: 0, waitingCount: 0 }));
    const handler = createEstimateTaskDurationsHandler({ estimator, quarterlyContentReader: async () => "",
      repositoryFactory: () => ({ readMany: async () => ({ projects: [project], storedProjects: [] }) }) });
    const job = { ...taskDurationEstimatesRequest(SCOPE, { requestedAt: 123 }), category: "maintenance" };
    const context = { app, clock: () => new Date(2026, 9, 14).getTime() };
    await expect(handler.run({ context, job })).resolves.toMatchObject({ estimatedCount: 1, revision: "123" });
    expect(estimator.mock.calls[0][1].groups[0].taskCandidates[0].uuid).toBe("task-1");
    estimator.mockResolvedValueOnce({ estimatedCount: 0, reusedCount: 0, waitingCount: 1 });
    await expect(handler.run({ context, job })).rejects.toThrow("1 task durations await");
  });
});
