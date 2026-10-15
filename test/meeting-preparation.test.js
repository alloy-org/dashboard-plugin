// Verify that a day's meetings, calendar events with invitees, draw the tasks pertaining to who is being met into the
// day's ranking, that a meeting nothing pertains to is brainstormed once and its ideas reused, that a large pool is
// narrowed by Jev salience, and that the agenda places preparation in the hours before each meeting.
import { jest } from "@jest/globals";
import { meetingMatchTerms, meetingPreparationGroups, meetingsFromCalendarEvents } from "dashboard/proposed-agenda/meeting-preparation";
import QuarterProject from "dashboard/quarter-project";
import QuarterProjectRepository from "dashboard/quarter-project-repository";
import { prepareDayRanking } from "dashboard/suggestions/ranked-task-suggestions";
import { SALIENCE_POOL_LIMIT, salientCandidateGroups } from "dashboard/suggestions/suggestion-salience";
import { slotRankedTasks } from "dashboard/suggestions/suggestion-task-slots";
import { maintenanceApp, PROJECT_UUID, SCOPE_INPUT } from "./project-maintenance-test-app";

const DOMAIN = { domainName: SCOPE_INPUT.domainName, domainUuid: SCOPE_INPUT.domainUuid };
const STORE_SCOPE = { ...SCOPE_INPUT, quarterKey: "2026-Q3" };
const TARGET_DATE = new Date(2026, 8, 17);
const NORTHWIND_CALL = { allDay: false, attendees: [{ name: "Dana Whitfield", status: true }, { name: "ops@northwind.com", status: null }],
  end: new Date(2026, 8, 17, 15, 0), start: new Date(2026, 8, 17, 14, 0), title: "Northwind pricing call" };
const PROJECT_TASKS = [{ content: "Write the launch post", noteUUID: "task-note", uuid: "task-1" }];
const NORTHWIND_TASK = { content: "Send Northwind the revised pricing sheet", noteUUID: "crm-note", uuid: "task-northwind" };

// ----------------------------------------------------------------------------------------------
// @desc A Jev stand-in rating each candidate by its position, first best.
// @returns {function} A requestAnswers mock.
function positionalAnswers() {
  return jest.fn(async ({ questions }) => {
    const names = Object.keys(questions);
    const answerEntries = names.map((name, index) => [name, { confidence: 0.5, score: Math.max(0, 9 - index), type: "score" }]);
    return { answers: Object.fromEntries(answerEntries) };
  });
}

// ----------------------------------------------------------------------------------------------
// @desc Store a project with a weekly pace, so it qualifies every day, holding the launch task.
// @param {object} app - From maintenanceApp.
// @returns {Promise<void>}
async function storeQualifyingProject(app) {
  const relatedTaskRecords = PROJECT_TASKS.map(task => ({ taskText: task.content, taskUuid: task.uuid }));
  const sourceProject = new QuarterProject({ blocksPerWeek: 2, relatedTaskRecords, summary: "Launch dashboard", uuid: PROJECT_UUID });
  await new QuarterProjectRepository({ app }).applyResult(STORE_SCOPE, { apply: project => project.setRelatedTaskRecords(relatedTaskRecords),
    sourceProject });
}

describe("meetingsFromCalendarEvents", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Only timed events of the day with an attendee who has not declined are meetings.
  it("keeps timed events of the day with invitees who have not declined", () => {
    const events = [NORTHWIND_CALL, { ...NORTHWIND_CALL, attendees: [], title: "Focus block" },
      { ...NORTHWIND_CALL, attendees: [{ name: "Sam Ortiz", status: false }], title: "Declined lunch" },
      { ...NORTHWIND_CALL, allDay: true, title: "Offsite" },
      { ...NORTHWIND_CALL, start: new Date(2026, 8, 18, 10, 0), title: "Tomorrow's call" }];
    const meetings = meetingsFromCalendarEvents(events, TARGET_DATE);
    expect(meetings.map(meeting => meeting.title)).toEqual(["Northwind pricing call"]);
    expect(meetings[0]).toMatchObject({ attendeeNames: ["Dana Whitfield", "ops@northwind.com"], durationMinutes: 60, startMinutes: 840 });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Names, an email's company, and distinctive title words are terms; generic words and mail providers are not.
  it("derives terms from names, company email domains, and title words", () => {
    const terms = meetingMatchTerms({ attendeeNames: ["Dana Whitfield", "pat@gmail.com", "ops@northwind.com"],
      title: "Intro call with Northwind" });
    expect(terms).toEqual(expect.arrayContaining(["dana whitfield", "whitfield", "pat", "northwind"]));
    expect(terms).not.toEqual(expect.arrayContaining(["gmail", "intro", "call", "with"]));
  });
});

describe("meetingPreparationGroups", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A task naming the company is gathered under the meeting, from native and compact task shapes alike, while
  //   a task already scheduled that day and a term common to most tasks are left out.
  it("gathers tasks mentioning who is being met", () => {
    const meetings = meetingsFromCalendarEvents([NORTHWIND_CALL], TARGET_DATE);
    const commonTasks = Array.from({ length: 8 }, (_, index) => ({ content: `Pricing review ${ index }`, uuid: `common-${ index }` }));
    const scheduledTask = { content: "Confirm Northwind attendees", startAt: new Date(2026, 8, 17, 9).getTime() / 1000, uuid: "scheduled" };
    const compactTask = { noteUuid: "crm-note", taskText: "Look up Dana Whitfield on LinkedIn", taskUuid: "compact-1" };
    const groups = meetingPreparationGroups({ meetings, openTasks: [NORTHWIND_TASK, scheduledTask, compactTask, ...commonTasks],
      targetDate: TARGET_DATE });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ meetingStartMinutes: 840, projectUuid: null });
    expect(groups[0].rationale).toContain("Dana Whitfield");
    expect(groups[0].taskCandidates.map(candidate => candidate.candidateId)).toEqual(["task:task-northwind", "task:compact-1"]);
  });
});

describe("slotRankedTasks with meetings", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A preparation task outranked by others is still placed, within the three hours before its meeting.
  it("places preparation in the hours before the meeting", () => {
    const otherTasks = Array.from({ length: 4 }, (_, index) => ({ candidateId: `task:other-${ index }`, rating: 9, taskText: `Other ${ index }`,
      taskUuid: `other-${ index }` }));
    const preparation = { candidateId: "task:task-northwind", meetingStartMinutes: 840, rating: 4, taskText: NORTHWIND_TASK.content,
      taskUuid: "task-northwind" };
    const obligations = [{ durationMinutes: 60, source: "event", startMinutes: 840, title: NORTHWIND_CALL.title }];
    const { activities } = slotRankedTasks([...otherTasks, preparation], { obligations });
    const placed = activities.find(activity => activity.candidateId === "task:task-northwind");
    expect(placed.startMinutes).toBeGreaterThanOrEqual(840 - 180);
    expect(placed.startMinutes + placed.durationMinutes).toBeLessThanOrEqual(840 - 30);
    expect(activities.map(activity => activity.startMinutes)).toEqual([...activities.map(activity => activity.startMinutes)].sort((a, b) => a - b));
  });
});

describe("salientCandidateGroups", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A pool over the limit keeps the most salient candidates, and a meeting candidate Jev finds not salient is dropped.
  it("narrows a large pool by salience", async () => {
    const candidates = Array.from({ length: SALIENCE_POOL_LIMIT + 5 }, (_, index) => ({ candidateId: `task:t-${ index }`,
      text: `Task ${ index }` }));
    const meetingGroup = { meetingStartMinutes: 840, rationale: "Meeting.", summary: "Prepare for 14:00",
      taskCandidates: [{ candidateId: "task:false-match", text: "Water the northwind fern" }] };
    const projectGroup = { emphasizedWeekday: null, rationale: "Weekly.", summary: "Launch", taskCandidates: candidates };
    const requestSalience = jest.fn(async ({ questions }) => {
      const names = Object.keys(questions);
      const answerEntries = names.map((name, index) => [name, { confidence: 0.5, score: index === 0 ? 1 : 9 - (index % 10), type: "score" }]);
      return { answers: Object.fromEntries(answerEntries) };
    });
    const narrowed = await salientCandidateGroups({}, [meetingGroup, projectGroup], { meetings: [], requestSalience, targetDate: TARGET_DATE });
    const keptIds = narrowed.flatMap(group => group.taskCandidates.map(candidate => candidate.candidateId));
    expect(requestSalience).toHaveBeenCalledTimes(1);
    expect(keptIds).toHaveLength(SALIENCE_POOL_LIMIT);
    expect(keptIds).not.toContain("task:false-match");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A pool within the limit is ranked whole without a salience request.
  it("passes a small pool through", async () => {
    const requestSalience = jest.fn();
    const groups = [{ rationale: "Weekly.", summary: "Launch", taskCandidates: [{ candidateId: "task:t-1", text: "Task" }] }];
    expect(await salientCandidateGroups({}, groups, { requestSalience, targetDate: TARGET_DATE })).toBe(groups);
    expect(requestSalience).not.toHaveBeenCalled();
  });
});

describe("prepareDayRanking with meetings", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A task outside every qualifying project is ranked under the meeting it pertains to, carrying its start.
  it("ranks a task pertaining to a meeting with the meeting's start", async () => {
    const app = maintenanceApp({ tasks: [...PROJECT_TASKS, NORTHWIND_TASK] });
    await storeQualifyingProject(app);
    const { outcome, ranking } = await prepareDayRanking(app, { ...DOMAIN, calendarEvents: [NORTHWIND_CALL],
      openTasks: [...PROJECT_TASKS, NORTHWIND_TASK], requestAnswers: positionalAnswers(), targetDate: TARGET_DATE });
    expect(outcome).toBe("ranked");
    const northwind = ranking.rankedTasks.find(task => task.candidateId === "task:task-northwind");
    expect(northwind).toMatchObject({ meetingStartMinutes: 840, projectSummary: 'Prepare for 14:00 "Northwind pricing call"' });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A meeting nothing pertains to is brainstormed once; the stored ideas answer the next preparation.
  it("brainstorms preparation ideas once and reuses them", async () => {
    const app = maintenanceApp({ tasks: PROJECT_TASKS });
    await storeQualifyingProject(app);
    const requestIdeas = jest.fn(async prompt => {
      const meetingKey = prompt.match(/"meetingKey": "([^"]+)"/)[1];
      return { meetings: [{ meetingKey, tasks: ["Research Northwind's recent funding news", "Draft questions for Dana Whitfield"] }] };
    });
    const options = { ...DOMAIN, calendarEvents: [NORTHWIND_CALL], openTasks: PROJECT_TASKS, requestIdeas, targetDate: TARGET_DATE };
    const first = await prepareDayRanking(app, { ...options, requestAnswers: positionalAnswers() });
    const ideaTasks = first.ranking.rankedTasks.filter(task => task.ideaId?.startsWith("meeting-"));
    expect(ideaTasks.map(task => task.taskText)).toEqual(expect.arrayContaining(["Research Northwind's recent funding news"]));
    expect(ideaTasks.every(task => task.meetingStartMinutes === 840)).toBe(true);
    const second = await prepareDayRanking(app, { ...options, requestAnswers: positionalAnswers() });
    expect(second.outcome).toBe("stored");
    expect(requestIdeas).toHaveBeenCalledTimes(1);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The same candidates on a day with a meeting ask a different question than on a day without one.
  it("revises the ranking when a meeting is added", async () => {
    const app = maintenanceApp({ tasks: PROJECT_TASKS });
    await storeQualifyingProject(app);
    const quietCall = { ...NORTHWIND_CALL, attendees: [{ name: "Zed Quill", status: true }], title: "Catch up" };
    const requestIdeas = jest.fn(async () => ({ meetings: [] }));
    const base = { ...DOMAIN, openTasks: PROJECT_TASKS, requestIdeas, targetDate: TARGET_DATE };
    const quiet = await prepareDayRanking(app, { ...base, calendarEvents: [], requestAnswers: positionalAnswers() });
    const withMeeting = await prepareDayRanking(app, { ...base, calendarEvents: [quietCall], requestAnswers: positionalAnswers() });
    expect(withMeeting.ranking.revision).not.toBe(quiet.ranking.revision);
  });
});
