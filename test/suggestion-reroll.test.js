// Re-rolling calendar suggestions: when a Suggest click counts as a re-roll, how the prompt reads the user's choice,
// how chosen projects and the focus reach the ranker, which suggestions a re-roll leaves out, and how re-rolled days
// are remembered until their day is over.
import { jest } from "@jest/globals";
import { SETTING_KEYS } from "constants/settings";
import { calendarGenerationReportMarkdown, calendarGenerationReportName } from "dashboard/suggestions/calendar-generation-report";
import { priorityProjectGroups } from "dashboard/suggestions/day-project-candidates";
import { promptedRerollChoice } from "dashboard/suggestions/suggestion-reroll-prompt";
import { discardedKeysByDay, markFreshlyPlannedDays, readRerolledDays, recordRerolledDays, REROLL_WINDOW_SECONDS,
  rerollablePreviousPass } from "dashboard/suggestions/suggestion-reroll-store";
import { generativeRankPrompt, suggestionQuestions } from "dashboard/suggestions/suggestion-task-rank";
import QuarterProject from "quarter-project";
import { buildSuggestionRerollHTML, SUGGESTION_REROLL_VIEW, suggestionRerollValue } from "suggestion-reroll-embed";

const TUESDAY = new Date(2026, 9, 6, 15, 0, 0);
const WEDNESDAY = new Date(2026, 9, 7);
const NOW_SECONDS = 1_790_000_000;
const DAY_KEYS = [TUESDAY.toDateString(), WEDNESDAY.toDateString()];

// ----------------------------------------------------------------------------------------------
// @desc An app whose settings hold a previous calendar pass's record.
// @param {object} generation - Fields of the stored record.
// @returns {object} App stub.
function appWithGeneration(generation) {
  const record = { dayKeys: DAY_KEYS, generatedAtSeconds: NOW_SECONDS - 100, ...generation };
  return { settings: { [SETTING_KEYS.CALENDAR_SUGGESTIONS_GENERATED]: JSON.stringify(record) } };
}

// ----------------------------------------------------------------------------------------------
// @desc An app whose notes live in memory, enough for the JSON note helpers.
// @returns {object} App stub with a notes map.
function appWithNotes() {
  const notes = new Map();
  return {
    createNote: jest.fn(async name => { notes.set("note-1", { content: "", name }); return "note-1"; }),
    findNote: jest.fn(async ({ name }) => ([...notes.entries()].find(([, note]) => note.name === name) ? { uuid: "note-1" } : null)),
    getNoteContent: jest.fn(async ({ uuid }) => notes.get(uuid)?.content ?? null),
    notes,
    replaceNoteContent: jest.fn(async ({ uuid }, content) => { notes.get(uuid).content = content; return true; }),
  };
}

describe("rerollablePreviousPass", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A pass that finished moments ago, offered suggestions, and covered the requested days invites a re-roll.
  it("offers a re-roll only within the window after a pass that offered suggestions", () => {
    const recent = appWithGeneration({ finishedAtSeconds: NOW_SECONDS - 60, suggestionCount: 4 });
    expect(rerollablePreviousPass(recent, { dayKeys: DAY_KEYS, nowSeconds: NOW_SECONDS })).not.toBeNull();
    const stale = appWithGeneration({ finishedAtSeconds: NOW_SECONDS - REROLL_WINDOW_SECONDS - 1, suggestionCount: 4 });
    expect(rerollablePreviousPass(stale, { dayKeys: DAY_KEYS, nowSeconds: NOW_SECONDS })).toBeNull();
    const empty = appWithGeneration({ finishedAtSeconds: NOW_SECONDS - 60, suggestionCount: 0 });
    expect(rerollablePreviousPass(empty, { dayKeys: DAY_KEYS, nowSeconds: NOW_SECONDS })).toBeNull();
    expect(rerollablePreviousPass(recent, { dayKeys: ["Thu Oct 08 2026"], nowSeconds: NOW_SECONDS })).toBeNull();
    expect(rerollablePreviousPass({ settings: {} }, { dayKeys: DAY_KEYS, nowSeconds: NOW_SECONDS })).toBeNull();
  });
});

describe("promptedRerollChoice", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc The prompt resolves with the embed's stored arguments; an unoffered project and the fourth boost are dropped.
  it("reads the focus and boosted projects the embed stored", async () => {
    const projectUuids = ["project-a", "unknown", "project-b"];
    const app = { prompt: jest.fn(async () => [{ focusKey: "layups", projectUuids, view: SUGGESTION_REROLL_VIEW }, -1]),
      settings: {} };
    const choice = await promptedRerollChoice(app, { days: [TUESDAY], domainName: "Work", domainUuid: "domain-1" });
    const [, promptOptions] = app.prompt.mock.calls[0];
    expect(promptOptions.inputs[0]).toMatchObject({ type: "embed", value: { focusKey: "quarterPlan", view: SUGGESTION_REROLL_VIEW } });
    expect(choice.focus.key).toBe("layups");
    expect(choice.projectUuids).toEqual([]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Keeping the current suggestions, or closing the prompt, is no re-roll.
  it("returns null when the user keeps the current suggestions", async () => {
    const keepApp = { prompt: jest.fn(async () => [{ focusKey: "layups", view: SUGGESTION_REROLL_VIEW }, "keepCurrent"]), settings: {} };
    expect(await promptedRerollChoice(keepApp, { days: [TUESDAY], domainName: null, domainUuid: null })).toBeNull();
    const closedApp = { prompt: jest.fn(async () => null), settings: {} };
    expect(await promptedRerollChoice(closedApp, { days: [TUESDAY], domainName: null, domainUuid: null })).toBeNull();
  });
});

describe("suggestion re-roll embed", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Project names reach the page as JSON data that cannot close its script element.
  it("embeds the choices as data and reads a choice back from the arguments", () => {
    const value = { focusKey: "moonshots", projectUuids: [], projects: [{ name: "</script><b>Launch", uuid: "project-a" }],
      view: SUGGESTION_REROLL_VIEW };
    const html = buildSuggestionRerollHTML({ value });
    expect(html).not.toContain("</script><b>");
    expect(html).toContain("Moonshots");
    expect(suggestionRerollValue([JSON.stringify(value)])).toEqual(value);
    expect(suggestionRerollValue([{ view: "ideaRunProgress" }])).toBeNull();
  });
});

describe("re-roll ranking inputs", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A chosen project offers its candidates even on a day its own cadence leaves it out.
  it("groups a chosen project that does not qualify today", () => {
    const live = new QuarterProject({ preferredWeekdays: ["friday"], priorityEm: "quarterFocus", summary: "Launch", uuid: "project-a" });
    const stored = new QuarterProject({ relatedTaskRecords: [{ matchScore: 7, taskText: "Draft the post", taskUuid: "task-1" }],
      summary: "Launch", uuid: "project-a" });
    const [group] = priorityProjectGroups({ now: TUESDAY, projects: [live], projectUuids: ["project-a"], storedRecords: [stored] });
    expect(group.rationale).toContain("chose to prioritize right now");
    expect(group.taskCandidates[0]).toMatchObject({ uuid: "task-1" });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The focus is shown to Jev in every question and to the generative ranker in its prompt.
  it("asks every question with the chosen focus", () => {
    const group = { projectUuid: "project-a", rationale: "Chosen.", summary: "Launch",
      taskCandidates: [{ candidateId: "task:task-1", text: "Draft the post", uuid: "task-1" }] };
    const { questions, state } = suggestionQuestions([group], { focusInstruction: "prioritize easy tasks." });
    expect(state.focus).toBe("prioritize easy tasks.");
    expect(JSON.stringify(questions.task_1)).toContain("prioritize easy tasks.");
    expect(generativeRankPrompt(state)).toContain("prioritize easy tasks.");
    expect(suggestionQuestions([group]).state.focus).toBeUndefined();
  });
});

describe("re-rolled day records", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A re-roll leaves out what the previous pass offered and what an earlier re-roll already set aside.
  it("discards the previous pass's suggestions and earlier re-rolls", () => {
    const previousPass = { offeredKeysByDay: { [DAY_KEYS[0]]: ["task:task-1"] } };
    const rerolledDays = new Map([[DAY_KEYS[0], { excludedKeys: new Set(["idea:idea-1", "task:task-1"]) }]]);
    const discarded = discardedKeysByDay([TUESDAY, WEDNESDAY], { previousPass, rerolledDays });
    expect(discarded[DAY_KEYS[0]].sort()).toEqual(["idea:idea-1", "task:task-1"]);
    expect(discarded[DAY_KEYS[1]]).toEqual([]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A recorded day is planned afresh by the next ordinary pass, then keeps its exclusions until the day ends.
  it("records a re-rolled day, marks it planned, and pares it once its day has passed", async () => {
    const app = appWithNotes();
    await recordRerolledDays(app, { days: [{ day: TUESDAY, excludedKeys: new Set(["task:task-1"]) }], domainUuid: "domain-1",
      focusKey: "layups", now: TUESDAY, projectUuids: [] });
    let rerolledDays = await readRerolledDays(app, { domainUuid: "domain-1", now: TUESDAY });
    expect(rerolledDays.get(DAY_KEYS[0])).toMatchObject({ forceRegenerate: true, focusKey: "layups" });
    expect([...rerolledDays.get(DAY_KEYS[0]).excludedKeys]).toEqual(["task:task-1"]);
    expect((await readRerolledDays(app, { domainUuid: "domain-2", now: TUESDAY })).size).toBe(0);
    await markFreshlyPlannedDays(app, { domainUuid: "domain-1", now: TUESDAY, plannedDayKeys: [DAY_KEYS[0]], rerolledDays });
    rerolledDays = await readRerolledDays(app, { domainUuid: "domain-1", now: TUESDAY });
    expect(rerolledDays.get(DAY_KEYS[0])).toMatchObject({ forceRegenerate: false });
    expect((await readRerolledDays(app, { domainUuid: "domain-1", now: WEDNESDAY })).size).toBe(0);
  });
});

describe("re-roll generation report", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc The report of a re-roll is named as one and opens with what the user chose.
  it("names the re-roll and records the user's choice", () => {
    expect(calendarGenerationReportName({ dayCount: 1, domainName: "Work", isReroll: true, startedAt: TUESDAY }))
      .toBe("Calendar Work Re-roll: 1 day at 15:00");
    const dayResult = { activities: [], day: TUESDAY, obligations: [], selectionTrace: { discardedCount: 3, generator: "ranking",
      rankerEm: "jev", source: "reroll" } };
    const markdown = calendarGenerationReportMarkdown([{ dayOutcome: null, dayResult }],
      { reroll: { focusLabel: "Layups", projectNames: ["Launch"] } });
    expect(markdown).toContain("# Re-roll requested");
    expect(markdown).toContain("- Focus: Layups");
    expect(markdown).toContain("- Boosted projects: Launch");
    expect(markdown).toContain("Source: re-roll ranked by jev; 3 earlier suggestions left out");
  });
});
