// [GPT-5.5-authored file]
// Prompt summary: "test Recent Notes archived daily note persistence and multi-day selection"
import { jest } from "@jest/globals";
import { DASHBOARD_NOTE_TAG } from "../lib/constants/settings.js";
import { buildRecentNotesSeed, findStaleTaskNotes } from "../lib/recent-notes-service.js";

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
// @desc Build an in-memory Amplenote app with 200 task-bearing notes plus data-note persistence.
// [GPT-5.5] Task: simulate notebook notes and archived dashboard data notes
// Prompt: "simulate a notebook with 200 notes, all of which have tasks"
function buildRecentNotesMockApp() {
  const sourceNotes = Array.from({ length: NOTE_COUNT }, (_, index) => ({
    name: [
      SOURCE_NOTE_NAME_PREFIX,
      String(index + NOTE_NUMBER_OFFSET).padStart(NOTE_NUMBER_PAD_LENGTH, NOTE_NUMBER_PAD_FILL),
    ].join(" "),
    uuid: `${ SOURCE_NOTE_UUID_PREFIX }-${ index + NOTE_NUMBER_OFFSET }`,
  }));
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
    getTaskDomains: jest.fn().mockResolvedValue([{
      name: TASK_DOMAIN_NAME,
      notes: sourceNotes,
      uuid: TASK_DOMAIN_UUID,
    }]),
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
      const results = await findStaleTaskNotes(app, buildRecentNotesSeed(0), {
        maxNotes: SELECTED_NOTES_PER_DAY,
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
  });
});
