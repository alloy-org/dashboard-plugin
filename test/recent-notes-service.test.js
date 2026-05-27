// [GPT-5.5-authored file]
// Prompt summary: "test Recent Notes archived daily note persistence and multi-day selection"
import { jest } from "@jest/globals";
import { DASHBOARD_NOTE_TAG } from "constants/settings";
import { buildRecentNotesSeed, findStaleTaskNotes } from "recent-notes-service";

const NOTE_COUNT = 200;
const DATA_NOTE_UUID_PREFIX = "recent-data-note";
const EXPECTED_RENDER_COUNT = 3;
const JSON_CAPTURE_GROUP_INDEX = 1;
const LOCAL_MIDDAY_HOUR = 12;
const NOTE_NUMBER_OFFSET = 1;
const NOTE_NUMBER_PAD_FILL = "0";
const NOTE_NUMBER_PAD_LENGTH = 3;
const SECOND_RENDER_INDEX = 1;
const SELECTED_NOTES_PER_DAY = 5;
const SECOND_TASK_DOMAIN_NAME = "Work Notes";
const SECOND_TASK_DOMAIN_UUID = "domain-work";
const SECOND_SOURCE_NOTE_NAME_PREFIX = "Work Note";
const SECOND_SOURCE_NOTE_UUID_PREFIX = "work-note";
const SOURCE_NOTE_NAME_PREFIX = "Project Note";
const SOURCE_NOTE_UUID_PREFIX = "project-note";
const TASK_CONTENT = "Follow up";
const TASK_DOMAIN_NAME = "All Notes";
const TASK_DOMAIN_UUID = "domain-all";
const TEST_DAYS = [27, 28, 29];
const TEST_MONTH_INDEX = 3;
const TEST_YEAR = (new Date()).getFullYear();
const THIRD_RENDER_INDEX = 2;

// ----------------------------------------------------------------------------------------------
// @desc Build the expected Recent Notes data-note title for the given local date.
// @param {Date} date - Simulated current date.
// [GPT-5.5] Task: derive expected Recent Notes daily note names in tests
// Prompt: "test writing and reading to the expected note file"
function recentNotesDataNoteNameFromDate(date) {
  const dateLabel = date.toLocaleString([], { day: "numeric", month: "long", year: "numeric" });
  return `Dashboard recent notes for ${ dateLabel }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Parse the fenced JSON state block written to a Recent Notes data note.
// @param {string} content - Persisted note markdown.
// [GPT-5.5] Task: inspect Recent Notes archived-note state in tests
// Prompt: "test writing and reading to the expected note file"
function recentNotesStateFromContent(content) {
  const match = content.match(/```json\s*([\s\S]*?)```/i);
  return JSON.parse(match[JSON_CAPTURE_GROUP_INDEX]);
}

// ----------------------------------------------------------------------------------------------
// @desc Set Jest's system clock to a local midday value to avoid timezone boundary drift.
// @param {Date} date - Simulated current date.
// [GPT-5.5] Task: simulate consecutive Recent Notes dates in tests
// Prompt: "progressively chooses more of these notes on subsequent days"
function setSystemDate(date) {
  jest.setSystemTime(date);
}

// ----------------------------------------------------------------------------------------------
// @desc Build sequential mock note handles for a specific task domain.
// @param {number} count - Number of source notes to create.
// @param {string} namePrefix - Display name prefix for each note.
// @param {string} uuidPrefix - UUID prefix for each note.
// [OpenAI gpt-5.4] Task: support domain-specific Recent Notes test fixtures
// Prompt: "Update lib/recent-notes-service.js to receive the selected task domain ID from the dashboard parent"
function buildSourceNotes(count, namePrefix, uuidPrefix) {
  return Array.from({ length: count }, (_, index) => ({
    name: [
      namePrefix,
      String(index + NOTE_NUMBER_OFFSET).padStart(NOTE_NUMBER_PAD_LENGTH, NOTE_NUMBER_PAD_FILL),
    ].join(" "),
    uuid: `${ uuidPrefix }-${ index + NOTE_NUMBER_OFFSET }`,
  }));
}

// ----------------------------------------------------------------------------------------------
// @desc Build an in-memory Amplenote app with 200 task-bearing notes plus data-note persistence.
// [GPT-5.5] Task: simulate notebook notes and archived dashboard data notes
// Prompt: "simulate a notebook with 200 notes, all of which have tasks"
function buildRecentNotesMockApp(domainConfigs = [{
  name: TASK_DOMAIN_NAME,
  notes: buildSourceNotes(NOTE_COUNT, SOURCE_NOTE_NAME_PREFIX, SOURCE_NOTE_UUID_PREFIX),
  uuid: TASK_DOMAIN_UUID,
}]) {
  const sourceNotes = domainConfigs.flatMap(domain => domain.notes || []);
  const sourceNotesByDomain = new Map(domainConfigs.map(domain => [domain.uuid, domain.notes || []]));
  const dataNotes = [];

  const app = {
    createNote: jest.fn().mockImplementation(async (name, tags = [], options = {}) => {
      const note = { body: "", name, options, tags,
        uuid: `${ DATA_NOTE_UUID_PREFIX }-${ dataNotes.length + NOTE_NUMBER_OFFSET }` };
      dataNotes.push(note);
      return note.uuid;
    }),
    findNote: jest.fn().mockImplementation(async ({ name, tags, uuid }) => {
      if (uuid) {
        const sourceNote = sourceNotes.find(note => note.uuid === uuid);
        const dataNote = dataNotes.find(note => note.uuid === uuid);
        return sourceNote || dataNote || null;
      }
      return dataNotes.find(note =>
        note.name === name && tags?.every(tag => note.tags.includes(tag))
      ) || null;
    }),
    getNoteContent: jest.fn().mockImplementation(async ({ uuid }) => {
      return dataNotes.find(note => note.uuid === uuid)?.body || "";
    }),
    getNoteTasks: jest.fn().mockResolvedValue([{ content: TASK_CONTENT }]),
    filterNotes: jest.fn().mockImplementation(async ({ taskDomainUUID }) => sourceNotesByDomain.get(taskDomainUUID) || []),
    replaceNoteContent: jest.fn().mockImplementation(async ({ uuid }, content) => {
      const note = dataNotes.find(candidate => candidate.uuid === uuid);
      if (note) note.body = content;
      return true;
    }),
  };

  return { app, dataNotes };
}

// [GPT-5.5] Generated tests for: Recent Notes archived-note state across consecutive dates
describe("Recent Notes archived daily state", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("rotates selections across 200 task notes and reads prior daily state", async () => {
    const { app, dataNotes } = buildRecentNotesMockApp();
    const selectedByDay = [];
    const dates = TEST_DAYS.map(day =>
      new Date(TEST_YEAR, TEST_MONTH_INDEX, day, LOCAL_MIDDAY_HOUR, 0, 0)
    );

    // Each iteration represents the first widget render on a new calendar day. The service should
    // create/read that day's archived dashboard data note, select five stale notes, and persist
    // those selections into the note so the next day can seed from this saved state.
    for (const date of dates) {
      setSystemDate(date);
      const results = await findStaleTaskNotes({
        app,
        maxNotes: SELECTED_NOTES_PER_DAY,
        seed: buildRecentNotesSeed(0),
        taskDomainUUID: TASK_DOMAIN_UUID,
      });
      selectedByDay.push(results.map(entry => entry.noteHandle.uuid));
    }

    // Verify the widget's backing store is the expected archived note per day, not app.settings.
    expect(app.createNote).toHaveBeenCalledTimes(EXPECTED_RENDER_COUNT);
    for (let i = 0; i < dates.length; i++) {
      expect(app.createNote).toHaveBeenNthCalledWith(
        i + NOTE_NUMBER_OFFSET,
        recentNotesDataNoteNameFromDate(dates[i]),
        [DASHBOARD_NOTE_TAG],
        { archive: true },
      );
    }

    const uniqueSelected = new Set(selectedByDay.flat());
    expect(uniqueSelected.size).toBe(EXPECTED_RENDER_COUNT * SELECTED_NOTES_PER_DAY);
    // This is the primary exclusion assertion: notes selected on the first date are written to
    // `historyByDay`, then excluded from the second day's candidate pool. If first-day exclusions
    // stopped working, day two would be allowed to repeat those same selected UUIDs.
    expect(selectedByDay[SECOND_RENDER_INDEX]).not.toEqual(selectedByDay[0]);
    expect(selectedByDay[THIRD_RENDER_INDEX]).not.toEqual(selectedByDay[SECOND_RENDER_INDEX]);

    const firstDayNote = dataNotes.find(note =>
      note.name === recentNotesDataNoteNameFromDate(dates[0])
    );
    const secondDayNote = dataNotes.find(note =>
      note.name === recentNotesDataNoteNameFromDate(dates[SECOND_RENDER_INDEX])
    );
    const thirdDayNote = dataNotes.find(note =>
      note.name === recentNotesDataNoteNameFromDate(dates[THIRD_RENDER_INDEX])
    );
    expect(app.getNoteContent).toHaveBeenCalledWith({ uuid: firstDayNote.uuid });
    expect(app.getNoteContent).toHaveBeenCalledWith({ uuid: secondDayNote.uuid });

    const firstDayState = recentNotesStateFromContent(firstDayNote.body);
    const thirdDayState = recentNotesStateFromContent(thirdDayNote.body);
    // The first day's note captures exactly what was shown on that first render.
    expect(firstDayState.selectedNotes.map(note => note.uuid)).toEqual(selectedByDay[0]);
    expect(thirdDayState.selectedNotes.map(note => note.uuid)).toEqual(selectedByDay[THIRD_RENDER_INDEX]);
    // The third day has inherited prior-day state, so its history includes all UUIDs selected so far.
    expect(Object.values(thirdDayState.historyByDay).flat())
      .toEqual(expect.arrayContaining([...uniqueSelected]));
    // Prior-day state also carries known stale candidates forward, limiting repeated note-task scans.
    expect(thirdDayState.staleCandidates.length).toBeGreaterThanOrEqual(
      EXPECTED_RENDER_COUNT * SELECTED_NOTES_PER_DAY
    );
    expect(app.getNoteTasks.mock.calls.length).toBeLessThan(NOTE_COUNT * dates.length);
    expect(app.filterNotes).toHaveBeenCalledWith({ group: "taskLists", taskDomainUUID: TASK_DOMAIN_UUID }, "changed");
  });

  it("reuses current-day selected notes before scanning on later clients", async () => {
    const { app, dataNotes } = buildRecentNotesMockApp();
    const date = new Date(TEST_YEAR, TEST_MONTH_INDEX, TEST_DAYS[0], LOCAL_MIDDAY_HOUR, 0, 0);
    setSystemDate(date);

    const firstResults = await findStaleTaskNotes({
      app,
      maxNotes: SELECTED_NOTES_PER_DAY,
      seed: buildRecentNotesSeed(0),
      taskDomainUUID: TASK_DOMAIN_UUID,
    });
    const firstSelectedUuids = firstResults.map(entry => entry.noteHandle.uuid);
    const firstFilterCalls = app.filterNotes.mock.calls.length;
    const firstTaskFetchCalls = app.getNoteTasks.mock.calls.length;

    const secondResults = await findStaleTaskNotes({
      app,
      maxNotes: SELECTED_NOTES_PER_DAY * 2,
      seed: buildRecentNotesSeed(0),
      taskDomainUUID: TASK_DOMAIN_UUID,
    });
    const secondSelectedUuids = secondResults.map(entry => entry.noteHandle.uuid);

    expect(secondSelectedUuids).toEqual(firstSelectedUuids);
    expect(app.createNote).toHaveBeenCalledTimes(1);
    expect(app.filterNotes).toHaveBeenCalledTimes(firstFilterCalls);
    expect(app.getNoteTasks).toHaveBeenCalledTimes(firstTaskFetchCalls);

    const dailyNote = dataNotes.find(note => note.name === recentNotesDataNoteNameFromDate(date));
    expect(recentNotesStateFromContent(dailyNote.body).selectedNotes.map(note => note.uuid))
      .toEqual(firstSelectedUuids);
  });

  it("resets same-day cached selections when the active task domain changes", async () => {
    const { app } = buildRecentNotesMockApp([
      {
        name: TASK_DOMAIN_NAME,
        notes: buildSourceNotes(NOTE_COUNT, SOURCE_NOTE_NAME_PREFIX, SOURCE_NOTE_UUID_PREFIX),
        uuid: TASK_DOMAIN_UUID,
      },
      {
        name: SECOND_TASK_DOMAIN_NAME,
        notes: buildSourceNotes(NOTE_COUNT, SECOND_SOURCE_NOTE_NAME_PREFIX, SECOND_SOURCE_NOTE_UUID_PREFIX),
        uuid: SECOND_TASK_DOMAIN_UUID,
      },
    ]);
    const date = new Date(TEST_YEAR, TEST_MONTH_INDEX, TEST_DAYS[0], LOCAL_MIDDAY_HOUR, 0, 0);
    setSystemDate(date);

    const firstResults = await findStaleTaskNotes({
      app,
      maxNotes: SELECTED_NOTES_PER_DAY,
      seed: buildRecentNotesSeed(0),
      taskDomainUUID: TASK_DOMAIN_UUID,
    });
    const filterCallsAfterFirstDomain = app.filterNotes.mock.calls.length;

    const secondResults = await findStaleTaskNotes({
      app,
      maxNotes: SELECTED_NOTES_PER_DAY,
      seed: buildRecentNotesSeed(0),
      taskDomainUUID: SECOND_TASK_DOMAIN_UUID,
    });

    expect(app.filterNotes.mock.calls.length).toBeGreaterThan(filterCallsAfterFirstDomain);
    expect(app.filterNotes).toHaveBeenCalledWith({ group: "taskLists", taskDomainUUID: SECOND_TASK_DOMAIN_UUID }, "changed");
    expect(firstResults.map(entry => entry.noteHandle.uuid)).not.toEqual(
      secondResults.map(entry => entry.noteHandle.uuid)
    );
    expect(secondResults.every(entry => entry.noteHandle.uuid.startsWith(SECOND_SOURCE_NOTE_UUID_PREFIX))).toBe(true);
  });

  it("recomputes same-day selections when the manual reseed seed changes", async () => {
    const { app, dataNotes } = buildRecentNotesMockApp();
    const date = new Date(TEST_YEAR, TEST_MONTH_INDEX, TEST_DAYS[0], LOCAL_MIDDAY_HOUR, 0, 0);
    setSystemDate(date);

    const firstSeed = buildRecentNotesSeed(0);
    const secondSeed = buildRecentNotesSeed(1);
    const firstResults = await findStaleTaskNotes({
      app,
      maxNotes: SELECTED_NOTES_PER_DAY,
      seed: firstSeed,
      taskDomainUUID: TASK_DOMAIN_UUID,
    });
    const firstFilterCalls = app.filterNotes.mock.calls.length;

    const secondResults = await findStaleTaskNotes({
      app,
      maxNotes: SELECTED_NOTES_PER_DAY,
      seed: secondSeed,
      taskDomainUUID: TASK_DOMAIN_UUID,
    });

    expect(firstResults.map(entry => entry.noteHandle.uuid)).not.toEqual(
      secondResults.map(entry => entry.noteHandle.uuid)
    );
    expect(app.filterNotes.mock.calls.length).toBeGreaterThan(firstFilterCalls);

    const dailyNote = dataNotes.find(note => note.name === recentNotesDataNoteNameFromDate(date));
    expect(recentNotesStateFromContent(dailyNote.body).selectionSeed).toBe(secondSeed);
  });
});
