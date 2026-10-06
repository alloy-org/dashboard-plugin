// A calendar pass re-checks cached suggestions against the user's tasks: completed or deleted tasks and ideas the user
// already accepted from the calendar drop out, and a pass soon after another checks only the notes changed since.
import { jest } from "@jest/globals";
import { SETTING_KEYS } from "constants/settings";
import { changedNoteUuidsSinceLastGeneration, recordSuggestionGeneration, RECENT_GENERATION_WINDOW_SECONDS,
  staleSuggestionReview, suggestionIdentityKey } from "suggestion-staleness";

const NOW_SECONDS = 1_790_000_000;
const DAY_KEYS = ["Tue Oct 06 2026", "Wed Oct 07 2026"];
const EPIC_IDEA = { ideaId: "idea-epic", isExisting: false, noteUuid: "note-epic", projectUuid: "project-epic",
  scheduledEm: "pending", taskUuid: null, title: "Email Epic's primary contact to verify the proposal" };
const OPEN_TASK = { isExisting: true, noteUuid: "note-open", scheduledEm: "pending", taskUuid: "task-open", title: "Open" };
const DONE_TASK = { isExisting: true, noteUuid: "note-done", scheduledEm: "pending", taskUuid: "task-done", title: "Done" };

// ----------------------------------------------------------------------------------------------
// @desc An app whose getTask and getNoteTasks read fixed task state.
// @param {object} [options] - { noteTasks, settings, tasks }: noteTasks maps a note UUID to its tasks.
// @returns {object} App stub.
function buildApp({ noteTasks = {}, settings = {}, tasks = {} } = {}) {
  return {
    filterNotes: jest.fn(async () => []),
    getNoteTasks: jest.fn(async ({ uuid }) => noteTasks[uuid] || []),
    getTask: jest.fn(async uuid => tasks[uuid] || null),
    setSetting: jest.fn(async () => undefined),
    settings,
  };
}

// ----------------------------------------------------------------------------------------------
// @desc A stored generation record, as recordSuggestionGeneration writes it.
// @param {number} generatedAtSeconds - When the previous pass ran.
// @param {Array<string>} [dayKeys] - The days it planned.
// @returns {object} Settings holding the record.
function settingsWithGeneration(generatedAtSeconds, dayKeys = DAY_KEYS) {
  return { [SETTING_KEYS.CALENDAR_SUGGESTIONS_GENERATED]: JSON.stringify({ dayKeys, generatedAtSeconds }) };
}

describe("staleSuggestionReview", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A completed or missing task is stale; an open one stands.
  it("flags existing tasks that were completed or deleted", async () => {
    const app = buildApp({ tasks: { "task-done": { completedAt: NOW_SECONDS, uuid: "task-done" },
      "task-open": { uuid: "task-open" } } });
    const missing = { ...DONE_TASK, noteUuid: "note-missing", taskUuid: "task-missing" };
    const review = await staleSuggestionReview(app, [OPEN_TASK, DONE_TASK, missing]);
    expect([...review.staleKeys].sort()).toEqual(["task:task-done", "task:task-missing"]);
    expect(review.acceptedIdeas).toEqual([]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Accepting an idea from the calendar creates a task with its wording in the idea's note, done or not.
  it("flags an idea whose note now holds the task it became, and reports it as accepted", async () => {
    const app = buildApp({ noteTasks: { "note-epic": [{ completedAt: NOW_SECONDS,
      content: "Email Epic’s primary contact to verify the proposal", uuid: "task-epic" }] } });
    const review = await staleSuggestionReview(app, [EPIC_IDEA]);
    expect([...review.staleKeys]).toEqual(["idea:idea-epic"]);
    expect(review.acceptedIdeas).toEqual([{ acceptedTaskUuid: "task-epic", ideaId: "idea-epic",
      projectUuid: "project-epic", status: "accepted" }]);
    expect(app.getNoteTasks).toHaveBeenCalledWith({ uuid: "note-epic" }, { includeDone: true });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc An idea stands while its note holds no task with its wording.
  it("keeps an idea whose note holds only unrelated tasks", async () => {
    const app = buildApp({ noteTasks: { "note-epic": [{ content: "Email Epic", uuid: "task-short" }] } });
    const review = await staleSuggestionReview(app, [EPIC_IDEA]);
    expect(review.staleKeys.size).toBe(0);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc With a changed-note set, only suggestions from those notes are looked up.
  it("checks only suggestions whose notes changed when given a changed-note set", async () => {
    const app = buildApp({ tasks: { "task-done": { completedAt: NOW_SECONDS, uuid: "task-done" } } });
    const review = await staleSuggestionReview(app, [OPEN_TASK, DONE_TASK, EPIC_IDEA],
      { changedNoteUuids: new Set(["note-done"]) });
    expect([...review.staleKeys]).toEqual(["task:task-done"]);
    expect(app.getTask).toHaveBeenCalledTimes(1);
    expect(app.getNoteTasks).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A suggestion the user already scheduled or dismissed is not pending, so it is never re-checked.
  it("ignores suggestions that are no longer pending", async () => {
    const app = buildApp();
    const review = await staleSuggestionReview(app, [{ ...DONE_TASK, scheduledEm: "dismissed" }]);
    expect(review.staleKeys.size).toBe(0);
    expect(app.getTask).not.toHaveBeenCalled();
  });
});

describe("changedNoteUuidsSinceLastGeneration", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A recent pass for the same days yields the notes changed since, read until the first older note.
  it("lists the notes changed since a recent pass over the same days", async () => {
    const generatedAtSeconds = NOW_SECONDS - 600;
    const app = buildApp({ settings: settingsWithGeneration(generatedAtSeconds) });
    const isoFromSeconds = seconds => new Date(seconds * 1000).toISOString();
    app.filterNotes.mockResolvedValue([{ changed: isoFromSeconds(NOW_SECONDS - 60), uuid: "note-epic" },
      { changed: isoFromSeconds(NOW_SECONDS - 300), uuid: "note-done" },
      { changed: isoFromSeconds(generatedAtSeconds - 60), uuid: "note-older" }]);
    const changed = await changedNoteUuidsSinceLastGeneration(app, { dayKeys: DAY_KEYS.slice(0, 1),
      nowSeconds: NOW_SECONDS });
    expect([...changed]).toEqual(["note-epic", "note-done"]);
    expect(app.filterNotes).toHaveBeenCalledWith({}, "changed");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc No record, an old record, or a day the previous pass did not plan all mean every suggestion is checked.
  it("returns null when the previous pass cannot vouch for this one", async () => {
    const options = { dayKeys: DAY_KEYS, nowSeconds: NOW_SECONDS };
    expect(await changedNoteUuidsSinceLastGeneration(buildApp(), options)).toBeNull();
    const stale = buildApp({ settings: settingsWithGeneration(NOW_SECONDS - RECENT_GENERATION_WINDOW_SECONDS - 1) });
    expect(await changedNoteUuidsSinceLastGeneration(stale, options)).toBeNull();
    const otherDays = buildApp({ settings: settingsWithGeneration(NOW_SECONDS - 60, DAY_KEYS.slice(0, 1)) });
    expect(await changedNoteUuidsSinceLastGeneration(otherDays, options)).toBeNull();
    expect(otherDays.filterNotes).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A note handle without a changed time cannot be placed before or after the pass.
  it("returns null when a note handle carries no changed time", async () => {
    const app = buildApp({ settings: settingsWithGeneration(NOW_SECONDS - 60) });
    app.filterNotes.mockResolvedValue([{ uuid: "note-undated" }]);
    expect(await changedNoteUuidsSinceLastGeneration(app, { dayKeys: DAY_KEYS, nowSeconds: NOW_SECONDS })).toBeNull();
  });
});

describe("recordSuggestionGeneration", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc The record names the pass's start and days, which the next pass reads back.
  it("stores when and for which days suggestions were generated", async () => {
    const app = buildApp();
    await recordSuggestionGeneration(app, { dayKeys: DAY_KEYS, generatedAtSeconds: NOW_SECONDS });
    expect(app.setSetting).toHaveBeenCalledWith(SETTING_KEYS.CALENDAR_SUGGESTIONS_GENERATED,
      JSON.stringify({ dayKeys: DAY_KEYS, generatedAtSeconds: NOW_SECONDS }));
  });
});

describe("suggestionIdentityKey", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Tasks and ideas are known by candidate ID; anything else by its wording.
  it("names tasks, ideas, and untracked suggestions", () => {
    expect(suggestionIdentityKey({ taskUuid: "task-1" })).toBe("task:task-1");
    expect(suggestionIdentityKey({ ideaId: "idea-1", taskUuid: null })).toBe("idea:idea-1");
    expect(suggestionIdentityKey({ title: "Walk the  Dog!" })).toBe("title:walk the dog");
    expect(suggestionIdentityKey({})).toBeNull();
  });
});
