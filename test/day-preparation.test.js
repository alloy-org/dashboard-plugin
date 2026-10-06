// Verify how a day's shared ranking is prepared ahead of the widgets: the queued preparation asks each question a
// surface will ask of that day, the Dashboard prepares the day once a visit's project jobs have gone quiet, and a
// widget whose cache is cold has the queue prepare the day in the foreground, then finds the ranking stored.
import { jest } from "@jest/globals";
import { SETTING_KEYS } from "constants/settings";
import QuarterProject from "dashboard/quarter-project";
import QuarterProjectRepository from "dashboard/quarter-project-repository";
import { prepareDayRanking } from "dashboard/ranked-task-suggestions";
import DayPreparationTrigger, { dayPreparationDateKeys } from "dashboard/work-queue/day-preparation-trigger";
import { workHandlerRegistry } from "dashboard/work-queue/dashboard-work-handlers";
import DashboardWorkRepository from "dashboard/work-queue/dashboard-work-repository";
import { createDashboardWorkRuntime } from "dashboard/work-queue/dashboard-work-runtime";
import { createPrepareDayRankingHandler, dayRankingRequest, dayRankingSurfaces } from "dashboard/work-queue/jobs/prepare-day-ranking";
import { preparedDayRankingAwaiter } from "dashboard/work-queue/prepared-day-ranking";
import { setPluginData } from "plugin-data";
import { jobContext, maintenanceApp, PROJECT_UUID, SCOPE_INPUT } from "./project-maintenance-test-app";

const DOMAIN = { domainName: SCOPE_INPUT.domainName, domainUuid: SCOPE_INPUT.domainUuid };
// A Thursday morning and that Thursday's late afternoon, in local time, when the agenda plans Friday instead.
const THURSDAY_MORNING = new Date(2026, 8, 17, 10, 0);
const THURSDAY_EVENING = new Date(2026, 8, 17, 17, 0);
const SCOPE_KEY = "work-domain:Q3 2026";
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
// @desc Store the plan's project with a weekly pace, so it qualifies every day, and the fixture's tasks.
// @param {object} app - From maintenanceApp.
// @returns {Promise<void>}
async function storeQualifyingProject(app) {
  const relatedTaskRecords = TASKS.map(task => ({ taskText: task.content, taskUuid: task.uuid }));
  const sourceProject = new QuarterProject({ blocksPerWeek: 2, relatedTaskRecords, summary: "Launch dashboard", uuid: PROJECT_UUID });
  await new QuarterProjectRepository({ app }).applyResult(STORE_SCOPE, { apply: project => project.setRelatedTaskRecords(relatedTaskRecords),
    sourceProject });
}

// ----------------------------------------------------------------------------------------------
// @desc Timer functions a test fires by hand.
// @returns {object} { clearTimer, fire, pending, setTimer }: fire runs every pending callback.
function manualTimers() {
  const callbacks = new Map();
  let sequence = 0;
  return {
    clearTimer: timer => callbacks.delete(timer),
    fire: () => {
      const due = [...callbacks.values()];
      callbacks.clear();
      due.forEach(callback => callback());
    },
    pending: () => callbacks.size,
    setTimer: callback => {
      sequence += 1;
      callbacks.set(sequence, callback);
      return sequence;
    },
  };
}

describe("dayRankingSurfaces", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Dream Task plans only today; the agenda plans later days, and today until it moves on in the afternoon.
  it("names the surfaces that will plan each day", () => {
    expect(dayRankingSurfaces("2026-09-17", THURSDAY_MORNING)).toEqual(["dreamTask", "agenda"]);
    expect(dayRankingSurfaces("2026-09-18", THURSDAY_MORNING)).toEqual(["agenda"]);
    expect(dayRankingSurfaces("2026-09-16", THURSDAY_MORNING)).toEqual([]);
    expect(dayRankingSurfaces("2026-09-17", THURSDAY_EVENING)).toEqual(["dreamTask"]);
    expect(dayPreparationDateKeys(THURSDAY_MORNING)).toEqual(["2026-09-17"]);
    expect(dayPreparationDateKeys(THURSDAY_EVENING)).toEqual(["2026-09-17", "2026-09-18"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc One key per domain and day, so a widget's request coalesces with a background one for that day.
  it("keys a request by domain and day", () => {
    const request = dayRankingRequest({ dateKey: "2026-09-17", ...DOMAIN }, { category: "foregroundData", requestedAt: 5 });
    expect(request).toEqual({ category: "foregroundData", desiredRevision: "5", entityId: "2026-09-17",
      input: { dateKey: "2026-09-17", ...DOMAIN }, key: "prepareDayRanking:work-domain:2026-09-17", type: "prepareDayRanking" });
    expect(dayRankingRequest({ dateKey: "2026-09-17", domainName: null, domainUuid: null }, { requestedAt: 5 }).key)
      .toBe("prepareDayRanking:all:2026-09-17");
  });
});

describe("prepareDayRanking job surfaces", () => {
  beforeEach(() => setPluginData({ settings: { [SETTING_KEYS.JEV_ACCESS_TOKEN]: "jev-token" } }));
  afterEach(() => setPluginData({ settings: {} }));
  const job = dateKey => ({ attempt: 1, category: "maintenance", input: { dateKey, ...DOMAIN }, type: "prepareDayRanking" });
  const context = (app, now) => ({ ...jobContext(app), clock: () => now.getTime() });

  // ----------------------------------------------------------------------------------------------
  // @desc Today's preparation asks Dream Task's question, from the quarter's guide, and the agenda's, from its progress
  //   projects. They name the same project with the same candidates, so the ranker is asked once.
  it("prepares each planning surface's question, asking the ranker once when they agree", async () => {
    const app = { ...maintenanceApp({ tasks: TASKS }), getCompletedTasks: async () => [] };
    await storeQualifyingProject(app);
    const requestAnswers = positionalAnswers();
    const handler = createPrepareDayRankingHandler({ requestAnswers });
    const result = await handler.run({ context: context(app, THURSDAY_MORNING), job: job("2026-09-17"), signal: null });
    expect(result.outcomes).toEqual({ agenda: "stored", dreamTask: "ranked" });
    const [dreamTaskRevision, agendaRevision] = result.revision.split(" ");
    expect(dreamTaskRevision).toMatch(/^dreamTask=jev:/);
    expect(agendaRevision).toBe(dreamTaskRevision.replace("dreamTask=", "agenda="));
    expect(requestAnswers).toHaveBeenCalledTimes(1);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A later day is the agenda's alone, and a past day retires the job.
  it("prepares only the agenda's question for a later day and nothing for a past one", async () => {
    const app = maintenanceApp({ tasks: TASKS });
    await storeQualifyingProject(app);
    const rankingPreparer = jest.fn(async () => ({ outcome: "ranked", ranking: { revision: "jev:friday" } }));
    const handler = createPrepareDayRankingHandler({ agendaProjectsReader: async () => [], rankingPreparer });
    const friday = await handler.run({ context: context(app, THURSDAY_EVENING), job: job("2026-09-18"), signal: null });
    expect(friday).toEqual({ outcomes: { agenda: "ranked" }, revision: "agenda=jev:friday" });
    expect(rankingPreparer).toHaveBeenCalledTimes(1);
    expect(rankingPreparer.mock.calls[0][1]).toMatchObject({ projects: [], targetDate: new Date(2026, 8, 18) });
    const past = await handler.run({ context: context(app, THURSDAY_EVENING), job: job("2026-09-16"), signal: null });
    expect(past).toEqual({ status: "superseded" });
  });
});

describe("DayPreparationTrigger", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A burst of project jobs leads to one preparation once the last finishes and the quiet period passes.
  it("waits for the visit's project jobs, then prepares the day once", () => {
    const timers = manualTimers();
    let inFlight = 2;
    const submit = jest.fn();
    const trigger = new DayPreparationTrigger({ ...timers, clock: () => THURSDAY_MORNING.getTime(), inFlight: () => inFlight, submit });
    trigger.observeOutcome({ jobType: "reconcileProjects", status: "completed" });
    inFlight = 1;
    trigger.observeOutcome({ jobType: "rankProjectTasks", status: "completed" });
    expect(timers.pending()).toBe(0);
    inFlight = 0;
    trigger.observeOutcome({ jobType: "rateProjectIdeas", status: "failed" });
    trigger.observeOutcome({ jobType: "collectTermEvidence", status: "completed" });
    expect(timers.pending()).toBe(1);
    timers.fire();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(["2026-09-17"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A reconciliation that changed nothing prepares nothing more, unless the agenda's day has moved on since.
  it("prepares again only after candidates change or the days do", () => {
    const timers = manualTimers();
    let now = THURSDAY_MORNING;
    const submit = jest.fn();
    const trigger = new DayPreparationTrigger({ ...timers, clock: () => now.getTime(), inFlight: () => 0, submit });
    trigger.observeOutcome({ jobType: "reconcileProjects", status: "completed" });
    timers.fire();
    trigger.observeOutcome({ jobType: "reconcileProjects", status: "completed" });
    expect(timers.pending()).toBe(0);
    trigger.observeOutcome({ jobType: "generateProjectIdeas", status: "completed" });
    timers.fire();
    now = THURSDAY_EVENING;
    trigger.observeOutcome({ jobType: "reconcileProjects", status: "completed" });
    timers.fire();
    expect(submit.mock.calls).toEqual([[["2026-09-17"]], [["2026-09-17"]], [["2026-09-17", "2026-09-18"]]]);
    trigger.dispose();
    trigger.observeOutcome({ jobType: "rankProjectTasks", status: "completed" });
    expect(timers.pending()).toBe(0);
  });
});

describe("preparedDayRankingAwaiter", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A durable runner stand-in whose scheduler holds what the test says.
  // @param {object} [options] - { held = true, submit }.
  // @returns {object} { durable, emit }: emit reports an outcome to the subscribed listeners.
  function fakeDurable({ held = true, submit = jest.fn(async request => request) } = {}) {
    const listeners = new Set();
    const durable = { scheduler: { holds: jest.fn(() => held), scopeKey: SCOPE_KEY, subscribe: jest.fn(() => () => {}) },
      schedulerKey: (key, scopeKey) => JSON.stringify([scopeKey, key]), submit,
      subscribeOutcomes: listener => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      } };
    return { durable, emit: outcome => listeners.forEach(listener => listener(outcome)), listeners };
  }

  // ----------------------------------------------------------------------------------------------
  // @desc The widget's request goes in as foreground data and resolves with its own job's outcome only.
  it("submits the day as foreground data and waits for that job's outcome", async () => {
    const { durable, emit, listeners } = fakeDurable();
    const awaitPreparation = preparedDayRankingAwaiter(durable, { clock: () => 7, setTimer: () => 0 });
    const waiting = awaitPreparation({ ...DOMAIN, targetDate: THURSDAY_MORNING });
    await Promise.resolve();
    expect(durable.submit).toHaveBeenCalledWith(expect.objectContaining({ category: "foregroundData", desiredRevision: "7",
      key: "prepareDayRanking:work-domain:2026-09-17" }));
    emit({ jobKey: "prepareDayRanking:work-domain:2026-09-18", status: "completed" });
    emit({ jobKey: "prepareDayRanking:work-domain:2026-09-17", scopeKey: "another-scope", status: "completed" });
    expect(listeners.size).toBe(1);
    emit({ jobKey: "prepareDayRanking:work-domain:2026-09-17", scopeKey: SCOPE_KEY, status: "retryWaiting" });
    await expect(waiting).resolves.toEqual({ status: "retryWaiting" });
    expect(listeners.size).toBe(0);
    expect(preparedDayRankingAwaiter(null)).toBeNull();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A preparation the queue leaves unrun, cannot accept, or takes too long on never holds the widget up.
  it("stops waiting when the job is not queued, cannot be submitted, or takes too long", async () => {
    const notQueued = preparedDayRankingAwaiter(fakeDurable({ held: false }).durable, { setTimer: () => 0 });
    await expect(notQueued({ ...DOMAIN, targetDate: THURSDAY_MORNING })).resolves.toEqual({ status: "notQueued" });
    const rejecting = fakeDurable({ submit: jest.fn(async () => { throw new Error("queue note unreadable"); }) });
    const unavailable = preparedDayRankingAwaiter(rejecting.durable, { setTimer: () => 0 });
    await expect(unavailable({ ...DOMAIN, targetDate: THURSDAY_MORNING })).resolves.toEqual({ status: "unavailable" });
    const timers = manualTimers();
    const slow = preparedDayRankingAwaiter(fakeDurable().durable, timers);
    const waiting = slow({ ...DOMAIN, targetDate: THURSDAY_MORNING });
    timers.fire();
    await expect(waiting).resolves.toEqual({ status: "timedOut" });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Before the Dashboard's load has settled, a cold widget's preparation runs through the queue, and the
  //   widget's own ranking then reads it from the store without a second request.
  it("prepares the day through the queue before the load settles, and the widget reuses it", async () => {
    setPluginData({ settings: { [SETTING_KEYS.JEV_ACCESS_TOKEN]: "jev-token" } });
    try {
      const app = maintenanceApp({ tasks: TASKS });
      await storeQualifyingProject(app);
      const requestAnswers = positionalAnswers();
      const now = THURSDAY_MORNING;
      const clock = () => now.getTime();
      const handlers = workHandlerRegistry([createPrepareDayRankingHandler({ agendaProjectsReader: async () => null, requestAnswers })]);
      const runtime = createDashboardWorkRuntime({ app, clearTimer: () => {}, clock, handlers,
        repository: new DashboardWorkRepository({ app, clock }), setTimer: () => 0 });
      runtime.scheduler.setScope(SCOPE_KEY);
      const awaitPreparation = preparedDayRankingAwaiter(runtime.durable);
      const outcome = await awaitPreparation({ ...DOMAIN, targetDate: now });
      expect(outcome).toEqual({ status: "completed" });
      expect(runtime.scheduler.conditions.loadSettled).toBe(false);
      const widgetRanking = await prepareDayRanking(app, { ...DOMAIN, openTasks: TASKS, requestAnswers, targetDate: now });
      expect(widgetRanking.outcome).toBe("stored");
      expect(requestAnswers).toHaveBeenCalledTimes(1);
      runtime.dispose();
    } finally {
      setPluginData({ settings: {} });
    }
  });
});
