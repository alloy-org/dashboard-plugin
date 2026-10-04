// Verify rated ideas end to end: the rating questions and their 1–10 reading, which ideas await a rating and when a
// text change invalidates one, the queued rating job writing ratings without restamping generation, ideas competing as
// `idea:` candidates beside existing tasks in ranking and slotting, and the user's decisions on a shown idea, including
// an acceptance retried from another surface that reuses the task the idea already became.
import { jest } from "@jest/globals";
import { handleTaskClick } from "dashboard/dream-task-internals";
import { decidedIdeaRecords, IDEA_STATUSES, ideaIdFor, normalizedIdeaRecords } from "dashboard/project-idea-records";
import { minutesSinceIdeaRecommended } from "dashboard/project-suggestion-log";
import { readCollectedProjectTasks } from "dashboard/project-task-store";
import { ideaRatingPrompt, ideaRecommendable, ideasAwaitingRating, rateProjectIdeas,
  ratedIdeaRecords } from "dashboard/project-task-idea-ratings";
import { scheduleProposedActivity } from "dashboard/proposed-agenda-service";
import QuarterProject from "dashboard/quarter-project";
import QuarterProjectRepository from "dashboard/quarter-project-repository";
import { existingTaskForAcceptedIdea, recordSuggestedIdeaDecisions } from "dashboard/ranked-task-suggestions";
import { rankedTasksFromAnswers, suggestionQuestions } from "dashboard/suggestion-task-rank";
import { slotRankedTasks } from "dashboard/suggestion-task-slots";
import { createRateProjectIdeasHandler } from "dashboard/work-queue/jobs/rate-project-ideas";
import { generativeScoreRequester } from "plan-wizard/stack-rank/generative-task-scores";
import { setPluginData } from "plugin-data";
import { jobContext, maintenanceApp, NOW, PROJECT_UUID, SCOPE_INPUT, storedProjectUuid } from "./project-maintenance-test-app";

const HOUR = 60 * 60 * 1000;
const STORE_SCOPE = { ...SCOPE_INPUT, quarterKey: "2026-Q3" };

// ----------------------------------------------------------------------------------------------
// @desc A Jev answer on the 1–10 scale, as Jev's zero-indexed score.
// @param {number} rating - Rating from 1 to 10.
// @returns {object} Score answer.
function answer(rating) {
  return { confidence: 0.5, score: rating - 1, type: "score" };
}

// ----------------------------------------------------------------------------------------------
// @desc An open idea rated for its current text.
// @param {string} taskText - The idea's text.
// @param {object} [rating] - { actionability = 8, ratedAt, relevance = 8 }.
// @returns {object} Idea record.
function ratedIdea(taskText, { actionability = 8, ratedAt = NOW.toISOString(), relevance = 8 } = {}) {
  const [idea] = normalizedIdeaRecords([{ taskText }], { projectUuid: PROJECT_UUID });
  return ratedIdeaRecords([idea], new Map([[idea.ideaId, { actionability, relevance }]]), { ratedAt, ratedIdeas: [idea],
    raterEm: "jev" })[0];
}

// ----------------------------------------------------------------------------------------------
// @desc Store ideas on the maintenance app's project.
// @param {object} app - From maintenanceApp.
// @param {Array<object>} ideas - Idea records or text-only ideas.
// @returns {Promise<void>}
async function storeIdeas(app, ideas) {
  await storedProjectUuid(app);
  await new QuarterProjectRepository({ app }).applyResult(STORE_SCOPE, { apply: project => project.setSuggestedTasks(ideas,
    { generatedAt: "2026-09-18T12:00:00.000Z" }), projectUuid: PROJECT_UUID });
}

// ----------------------------------------------------------------------------------------------
// @desc The maintenance app's project as the store holds it.
// @param {object} app - From maintenanceApp.
// @returns {Promise<QuarterProject>} The stored project.
async function storedProject(app) {
  const [project] = await readCollectedProjectTasks(app, STORE_SCOPE);
  return project;
}

describe("idea ratings", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Each idea gets an actionability and a relevance question, and every answer is read onto 1–10 by one adapter;
  //   a question left unanswered rates nothing.
  it("asks two questions per idea and reads the answers onto the 1–10 scale", async () => {
    const project = new QuarterProject({ summary: "Launch dashboard", uuid: PROJECT_UUID });
    const ideas = normalizedIdeaRecords([{ taskText: "Benchmark the picker" }, { taskText: "Rewrite everything" }],
      { projectUuid: PROJECT_UUID });
    const requestAnswers = jest.fn().mockResolvedValue({ answers: { idea_1_actionability: answer(8),
      idea_1_relevance: { score: 2.4, type: "score" }, idea_2_actionability: answer(3) } });
    const { ratingsById } = await rateProjectIdeas({ ideas, intentTexts: ["Grow paying users"], project, requestAnswers });
    const { questions, state } = requestAnswers.mock.calls[0][0];
    expect(Object.keys(questions)).toEqual(["idea_1_actionability", "idea_1_relevance", "idea_2_actionability", "idea_2_relevance"]);
    expect(state.project).toMatchObject({ intents: ["Grow paying users"], summary: "Launch dashboard" });
    expect(ratingsById.get(ideas[0].ideaId)).toEqual({ actionability: 8, relevance: 3.4 });
    expect(ratingsById.get(ideas[1].ideaId)).toEqual({ actionability: 3, relevance: null });
    const failed = await rateProjectIdeas({ ideas, project, requestAnswers: jest.fn().mockRejectedValue(new Error("Jev down")) });
    expect(failed).toEqual({ failureReason: "Jev down", ratingsById: null });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The generative stand-in asks with the idea rubric and returns Jev's shape, so its 1–10 ratings read back
  //   unchanged.
  it("rates through the generative fast model with the idea rubric", async () => {
    const promptRunner = jest.fn().mockResolvedValue({ ratings: { idea_1_actionability: 9, idea_1_relevance: 7 } });
    const requestAnswers = generativeScoreRequester({}, { promptBuilder: ideaRatingPrompt, promptRunner });
    const project = new QuarterProject({ summary: "Launch dashboard", uuid: PROJECT_UUID });
    const ideas = normalizedIdeaRecords([{ taskText: "Benchmark the picker" }], { projectUuid: PROJECT_UUID });
    const { ratingsById } = await rateProjectIdeas({ ideas, project, requestAnswers });
    expect(promptRunner.mock.calls[0][1]).toContain("Actionability rubric");
    expect(ratingsById.get(ideas[0].ideaId)).toEqual({ actionability: 9, relevance: 7 });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc An idea awaits a rating until it is rated for its current text; an unanswered rating is asked again after
  //   three days; a decided idea never awaits one. Only an open idea rated past both minimums is recommendable.
  it("decides which ideas await a rating and which may be recommended", () => {
    const rated = ratedIdea("Benchmark the picker");
    const reworded = { ...ratedIdea("Benchmark the date picker"), taskText: "Benchmark the date picker today" };
    const unanswered = ratedIdea("Sketch the empty state", { actionability: null, relevance: null });
    const staleUnanswered = ratedIdea("Cap the cache", { actionability: null, ratedAt: new Date(NOW.getTime() - 80 * HOUR)
      .toISOString(), relevance: null });
    const [fresh, dismissed] = normalizedIdeaRecords([{ taskText: "Profile the widget grid" },
      { decidedAt: NOW.toISOString(), status: IDEA_STATUSES.dismissed, taskText: "Rewrite everything" }], { projectUuid: PROJECT_UUID });
    const awaiting = ideasAwaitingRating([rated, reworded, unanswered, staleUnanswered, fresh, dismissed], NOW);
    expect(awaiting.map(idea => idea.taskText)).toEqual(["Benchmark the date picker today", "Cap the cache", "Profile the widget grid"]);
    expect(ideaRecommendable(rated)).toBe(true);
    expect(ideaRecommendable(reworded)).toBe(false);
    expect(ideaRecommendable(ratedIdea("Vague", { actionability: 6 }))).toBe(false);
    expect(ideaRecommendable(ratedIdea("Off topic", { relevance: 5 }))).toBe(false);
    expect(ideaRecommendable({ ...rated, status: IDEA_STATUSES.accepted })).toBe(false);
  });
});

describe("rateProjectIdeas job", () => {
  beforeEach(() => setPluginData({ settings: {} }));

  // ----------------------------------------------------------------------------------------------
  // @desc The job rates only the ideas awaiting a rating, leaves when ideas were generated as it was, and records the
  //   revision it rated, which its applied revision then reports; with nothing left to rate it retires.
  it("rates awaiting ideas without restamping their generation", async () => {
    const app = maintenanceApp({ tasks: [] });
    await storeIdeas(app, [ratedIdea("Benchmark the picker"), { taskText: "Profile the widget grid" }]);
    const requestAnswers = jest.fn().mockResolvedValue({ answers: { idea_1_actionability: answer(9), idea_1_relevance: answer(7) } });
    const handler = createRateProjectIdeasHandler({ requestAnswers, taskScorer: async () => "jev" });
    const job = { attempt: 1, category: "maintenance", desiredRevision: "pending", input: { ...SCOPE_INPUT, projectUuid: PROJECT_UUID } };
    const result = await handler.run({ context: jobContext(app), job, signal: null });
    expect(Object.keys(requestAnswers.mock.calls[0][0].questions)).toEqual(["idea_1_actionability", "idea_1_relevance"]);
    const project = await storedProject(app);
    expect(project.lastSuggestedAt).toBe("2026-09-18T12:00:00.000Z");
    expect(project.suggestedTasks[1].rating).toMatchObject({ actionability: 9, raterEm: "jev", relevance: 7 });
    expect(project.refreshState.ideaRatings.inputRevision).toBe(result.revision);
    expect(await handler.appliedRevision({ context: jobContext(app), job })).toBe(result.revision);
    expect(await handler.run({ context: jobContext(app), job, signal: null })).toEqual({ status: "superseded" });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc With nothing able to rate, the attempt waits for configuration; a failed request fails the attempt and
  //   writes nothing.
  it("waits for a rater, and fails an attempt whose request failed", async () => {
    const app = maintenanceApp({ tasks: [] });
    await storeIdeas(app, [{ taskText: "Profile the widget grid" }]);
    const job = { attempt: 1, category: "maintenance", desiredRevision: null, input: { ...SCOPE_INPUT, projectUuid: PROJECT_UUID } };
    const unconfigured = createRateProjectIdeasHandler({ taskScorer: async () => null });
    await expect(unconfigured.run({ context: jobContext(app), job, signal: null })).rejects.toMatchObject({ workFailure: "configuration" });
    const failing = createRateProjectIdeasHandler({ requestAnswers: jest.fn().mockRejectedValue(new Error("Jev down")),
      taskScorer: async () => "jev" });
    await expect(failing.run({ context: jobContext(app), job, signal: null })).rejects.toThrow("Jev down");
    expect((await storedProject(app)).suggestedTasks[0].rating).toBeUndefined();
  });
});

describe("ideas as recommendation candidates", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A project offers its open tasks and its recommendable ideas, each with a candidate ID; an idea that is
  //   unrated, too vague, restates an open task, or was excluded is left out, and an idea's exposure is its own.
  it("offers recommendable ideas beside open tasks, identified as ideas", () => {
    const shownAt = new Date(NOW.getTime() - 2 * HOUR).toISOString();
    const recommendable = ratedIdea("Benchmark the picker");
    const excluded = ratedIdea("Profile the widget grid");
    const project = new QuarterProject({ relatedTaskRecords: [{ matchScore: 8, taskText: "Ship the picker", taskUuid: "task-1" }],
      suggestedTasks: [recommendable, excluded, ratedIdea("Ship the picker."), ratedIdea("Vague", { actionability: 5 }),
        { taskText: "Unrated idea" }], summary: "Launch dashboard",
      taskSuggestions: [{ ideaId: recommendable.ideaId, suggestedAt: shownAt }], uuid: PROJECT_UUID });
    const candidates = project.taskCandidates({ excludeIds: new Set([`idea:${ excluded.ideaId }`]), now: NOW });
    expect(candidates.map(candidate => candidate.candidateId)).toEqual(["task:task-1", `idea:${ recommendable.ideaId }`]);
    expect(candidates[1]).toMatchObject({ actionability: 8, ideaId: recommendable.ideaId, isExisting: false,
      minutesSinceRecommended: 120, score: 8, uuid: null });
    expect(minutesSinceIdeaRecommended(project.taskSuggestions, "task-1", NOW)).toBeNull();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The ranker is told an idea is a new idea; with equal answers the existing task ranks first, and the ranked
  //   idea names its idea, carries no task UUID, and explains why a new action is offered.
  it("ranks an idea below a comparable existing task and keeps its identity", () => {
    const idea = ratedIdea("Benchmark the picker");
    const project = new QuarterProject({ relatedTaskRecords: [{ matchScore: 8, taskText: "Ship the picker", taskUuid: "task-1" }],
      suggestedTasks: [idea], summary: "Launch dashboard", uuid: PROJECT_UUID });
    const groups = [{ projectUuid: PROJECT_UUID, rationale: "Today is a focus day.", summary: project.summary,
      taskCandidates: project.taskCandidates({ now: NOW }) }];
    const { listed, questions, state } = suggestionQuestions(groups);
    expect(state.projects["Launch dashboard"].taskCandidates[1]).toMatchObject({ actionability: 8, kind: "new idea" });
    expect(questions.task_2.instructions).toContain("a new next action that is not yet a task");
    const ranked = rankedTasksFromAnswers(listed, { task_1: answer(9), task_2: answer(9) });
    expect(ranked.map(task => task.candidateId)).toEqual(["task:task-1", `idea:${ idea.ideaId }`]);
    expect(ranked[1]).toMatchObject({ ideaId: idea.ideaId, isExisting: false, rating: 8.5, taskUuid: null });
    expect(ranked[1].rationale).toContain("new next action generated for the project");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Placed ideas become non-existing activities naming their ideas, and an unplaced idea stays in reserve rather
  //   than being taken for a placed one that also has no task UUID.
  it("slots ideas as activities and keeps unplaced ideas in reserve", () => {
    const first = { candidateId: "idea:idea-1", ideaId: "idea-1", isExisting: false, rationale: "Why", taskText: "First idea",
      taskUuid: null };
    const second = { ...first, candidateId: "idea:idea-2", ideaId: "idea-2", taskText: "Second idea" };
    const task = { candidateId: "task:task-1", rationale: "Why", taskText: "Existing", taskUuid: "task-1" };
    const { activities, reserveTasks } = slotRankedTasks([first, second, task], { nowMinutes: 17 * 60 });
    expect(activities).toEqual([expect.objectContaining({ candidateId: "idea:idea-1", ideaId: "idea-1", isExisting: false,
      taskUuid: null, title: "First idea" })]);
    expect(reserveTasks.map(reserve => reserve.candidateId)).toEqual(["idea:idea-2", "task:task-1"]);
  });
});

describe("decisions on shown ideas", () => {
  beforeEach(() => setPluginData({ settings: {} }));
  afterEach(() => jest.useRealTimers());

  // ----------------------------------------------------------------------------------------------
  // @desc Accepting records the task an idea became, and a retried acceptance keeps the first task; turning down an
  //   open idea dismisses it, while an accepted idea stays accepted. An idea done on the spot is accepted without a
  //   task and takes the first one a later acceptance names.
  it("applies acceptance and dismissal idempotently", () => {
    const ideas = normalizedIdeaRecords([{ taskText: "Benchmark the picker" }, { taskText: "Profile the widget grid" }],
      { projectUuid: PROJECT_UUID });
    const [accepted, dismissed] = ideas.map(idea => idea.ideaId);
    const first = decidedIdeaRecords(ideas, [{ acceptedTaskUuid: "task-9", ideaId: accepted, status: IDEA_STATUSES.accepted },
      { ideaId: dismissed, status: IDEA_STATUSES.dismissed }], { decidedAt: NOW.toISOString() });
    expect(first.changedCount).toBe(2);
    const retried = decidedIdeaRecords(first.ideas, [{ acceptedTaskUuid: "task-10", ideaId: accepted, status: IDEA_STATUSES.accepted },
      { ideaId: accepted, status: IDEA_STATUSES.dismissed }], { decidedAt: NOW.toISOString() });
    expect(retried.changedCount).toBe(0);
    expect(retried.ideas.map(idea => [idea.status, idea.acceptedTaskUuid])).toEqual([["accepted", "task-9"], ["dismissed", null]]);
    const doneOnTheSpot = decidedIdeaRecords(ideas, [{ acceptedTaskUuid: null, ideaId: accepted, status: IDEA_STATUSES.accepted }],
      { decidedAt: NOW.toISOString() });
    expect(doneOnTheSpot.ideas[0]).toMatchObject({ acceptedTaskUuid: null, status: IDEA_STATUSES.accepted });
    const linkedLater = decidedIdeaRecords(doneOnTheSpot.ideas, [{ acceptedTaskUuid: "task-11", ideaId: accepted,
      status: IDEA_STATUSES.accepted }], { decidedAt: "2026-09-20T12:00:00.000Z" });
    expect(linkedLater.ideas[0]).toMatchObject({ acceptedTaskUuid: "task-11", decidedAt: NOW.toISOString() });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Showing an idea logs it by idea ID without advancing the project's output revision; deciding it does.
  it("records shown ideas and decisions on the stored project", async () => {
    const app = maintenanceApp({ tasks: [] });
    const idea = ratedIdea("Benchmark the picker");
    await storeIdeas(app, [idea]);
    const repository = new QuarterProjectRepository({ app });
    const revisionBefore = (await storedProject(app)).projectRevision;
    await repository.recordShownTasks(STORE_SCOPE, { shownAt: NOW.toISOString(), suggestions: [{ ideaId: idea.ideaId,
      projectUuid: PROJECT_UUID }] });
    const shown = await storedProject(app);
    expect(shown.taskSuggestions).toEqual([{ ideaId: idea.ideaId, suggestedAt: NOW.toISOString() }]);
    expect(shown.projectRevision).toBe(revisionBefore);
    const changed = await recordSuggestedIdeaDecisions(app, { decisions: [{ ideaId: idea.ideaId, projectUuid: PROJECT_UUID,
      status: IDEA_STATUSES.dismissed }, { ideaId: "idea-gone", projectUuid: "project-gone", status: IDEA_STATUSES.dismissed }],
    domainName: "Work", domainUuid: "work-domain", targetDate: NOW });
    expect(changed).toBe(1);
    expect((await storedProject(app)).suggestedTasks[0].status).toBe(IDEA_STATUSES.dismissed);
    expect((await storedProject(app)).projectRevision).toBe(revisionBefore + 1);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Clicking an open idea card inserts its task and accepts the idea; clicking a card for that idea again, as a
  //   cached card or another surface would, opens the accepted task instead of inserting a second one.
  it("accepts an idea once from Dream Task and reuses its task on a retry", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask", "setImmediate", "setInterval", "setTimeout"], now: NOW });
    const app = maintenanceApp({ tasks: [] });
    const idea = ratedIdea("Benchmark the picker");
    await storeIdeas(app, [idea]);
    Object.assign(app, { getTask: jest.fn(async uuid => ({ noteUUID: "inbox-note", uuid })), insertTask: jest.fn(async () => "task-new"),
      navigate: jest.fn(async () => true) });
    const card = { ideaId: idea.ideaId, isExisting: false, projectUuid: PROJECT_UUID, title: idea.taskText, uuid: null };
    const domain = { domainName: "Work", domainUuid: "work-domain" };
    expect(await handleTaskClick(app, card, "inbox-note", domain)).toEqual({ noteUUID: "inbox-note", taskUuid: "task-new" });
    expect((await storedProject(app)).suggestedTasks[0]).toMatchObject({ acceptedTaskUuid: "task-new", status: "accepted" });
    expect(await handleTaskClick(app, card, "inbox-note", domain)).toEqual({ noteUUID: "inbox-note", taskUuid: "task-new" });
    expect(app.insertTask).toHaveBeenCalledTimes(1);
    expect(app.navigate).toHaveBeenLastCalledWith("https://www.amplenote.com/notes/inbox-note?highlightTaskUUID=task-new");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Scheduling an agenda idea already accepted elsewhere reschedules its task; an open one becomes a dated
  //   project step and is accepted with that step's task.
  it("schedules an agenda idea through the task it already became, or accepts it as a new step", async () => {
    const app = maintenanceApp({ tasks: [] });
    const [acceptedIdea, openIdea] = [ratedIdea("Benchmark the picker"), ratedIdea("Profile the widget grid")];
    await storeIdeas(app, [acceptedIdea, openIdea]);
    await recordSuggestedIdeaDecisions(app, { decisions: [{ acceptedTaskUuid: "task-9", ideaId: acceptedIdea.ideaId,
      projectUuid: PROJECT_UUID, status: IDEA_STATUSES.accepted }], domainName: "Work", domainUuid: "work-domain", targetDate: NOW });
    Object.assign(app, { addTaskDomainNote: async () => true, getNoteTasks: async () => [],
      getTask: async uuid => ({ noteUUID: "task-note", uuid }), getTaskDomains: async () => [{ name: "Work", uuid: "work-domain" }],
      insertTask: jest.fn(async () => "step-task"), updateTask: jest.fn(async () => true) });
    const activity = { ideaId: acceptedIdea.ideaId, isExisting: false, projectUuid: PROJECT_UUID, startMinutes: 9 * 60,
      targetMidnightSeconds: Math.floor(NOW.getTime() / 1000), taskUuid: null, title: acceptedIdea.taskText };
    expect(await existingTaskForAcceptedIdea(app, { domainName: "Work", domainUuid: "work-domain", ideaId: acceptedIdea.ideaId,
      projectUuid: PROJECT_UUID, targetDate: NOW })).toEqual({ noteUuid: "task-note", taskUuid: "task-9" });
    expect(await scheduleProposedActivity(app, activity, null)).toMatchObject({ taskUuid: "task-9" });
    expect(app.insertTask).not.toHaveBeenCalled();
    const scheduled = await scheduleProposedActivity(app, { ...activity, ideaId: openIdea.ideaId, title: openIdea.taskText }, null);
    expect(scheduled).toMatchObject({ taskUuid: "step-task" });
    const stored = (await storedProject(app)).suggestedTasks;
    expect(stored.find(idea => idea.ideaId === openIdea.ideaId)).toMatchObject({ acceptedTaskUuid: "step-task", status: "accepted" });
    expect(ideaIdFor(PROJECT_UUID, "Profile the widget grid")).toBe(openIdea.ideaId);
  });
});
