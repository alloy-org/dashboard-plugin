// [Claude claude-opus-4-8 (1M context)-authored file]
// Prompt summary: "test the per-date/priority/LLM proposed-agenda record: monthly note naming, store→load round
//   trip, status updates, replacement on regeneration, and that generateProposedAgenda serves an identical
//   request from the note (no second LLM call) yet replaces the stored record when reseeding"
import { jest } from "@jest/globals";
import { SETTING_KEYS } from "constants/settings";
import { setPluginData } from "plugin-data";
import { loadCachedProposedAgenda, PROPOSED_TASK_STATUS, proposedAgendaNoteNameFromDate, proposedTaskKey,
  storeProposedAgenda, updateProposedTaskStatuses } from "proposed-agenda-archive";
import { generateProposedAgenda } from "proposed-agenda-service";

const PRIORITY = "goal-progress";
const PROVIDER = "anthropic";
const DATE = new Date(2026, 5, 28); // June 28, 2026 (local)

const ACT_A = { durationMinutes: 60, isExisting: true, noteUuid: "note-1", reason: "advances Q plan",
  startMinutes: 540, startTime: "09:00", taskUuid: "task-1", title: "Deep work block" };
const ACT_B = { durationMinutes: 30, isExisting: false, noteUuid: null, reason: "recovery",
  startMinutes: 660, startTime: "11:00", taskUuid: null, title: "Walk break" };

// ----------------------------------------------------------------------------------------------
// @desc Build an in-memory Amplenote app exposing the note surface the archive uses (find/create/get/replace),
//   keyed by note name so data survives across calls within one test.
// @param {object} [extra] - Extra app methods to merge in (task/LLM surface for the service-level test).
// @returns {object} App stub with a `_notes` array for inspection.
// [Claude claude-opus-4-8 (1M context)] Task: in-memory note-persistence app stub for archive tests
function buildNoteApp(extra = {}) {
  const notes = [];
  let counter = 0;
  return {
    findNote: jest.fn(async ({ name }) => notes.find(note => note.name === name) || null),
    createNote: jest.fn(async (name, tags) => { const uuid = `note-${ ++counter }`; notes.push({ content: "", name,
      tags, uuid }); return uuid; }),
    getNoteContent: jest.fn(async ({ uuid }) => notes.find(note => note.uuid === uuid)?.content ?? ""),
    replaceNoteContent: jest.fn(async (handle, content) => { const note = notes.find(n => n.uuid === handle.uuid);
      if (note) note.content = content; }),
    _notes: notes,
    ...extra,
  };
}

// ----------------------------------------------------------------------------------------------
// @desc Parse the records array out of the month's stored proposed-tasks note for assertions.
// @param {object} app - The in-memory app stub.
// @param {Date} date - Month-bearing date.
// @returns {Array<object>} Persisted records.
// [Claude claude-opus-4-8 (1M context)] Task: read back stored records in tests
function storedRecords(app, date) {
  const note = app._notes.find(n => n.name === proposedAgendaNoteNameFromDate(date));
  if (!note) return [];
  const match = note.content.match(/```json\s*([\s\S]*?)```/i);
  return JSON.parse(match[1]).records;
}

// [Claude claude-opus-4-8 (1M context)] Generated tests for: monthly proposed-agenda record store/cache
describe("proposed-agenda-archive", () => {
  it("names the monthly data note '[Month] [Year] Dashboard Proposed Tasks'", () => {
    expect(proposedAgendaNoteNameFromDate(DATE)).toBe("June 2026 Dashboard Proposed Tasks");
  });

  it("stores a generated set and loads it back as pending activities", async () => {
    const app = buildNoteApp();
    await storeProposedAgenda(app, { activities: [ACT_A, ACT_B], date: DATE, priorityKey: PRIORITY,
      providerEm: PROVIDER, llmAttributionFooter: "by Claude" });

    const loaded = await loadCachedProposedAgenda(app, { date: DATE, priorityKey: PRIORITY, providerEm: PROVIDER });
    expect(loaded.activities.map(a => a.title)).toEqual(["Deep work block", "Walk break"]);
    expect(loaded.activities[0]).toMatchObject({ startMinutes: 540, startTime: "09:00", taskUuid: "task-1" });
    expect(loaded.llmAttributionFooter).toBe("by Claude");
    expect(loaded.scheduledKeys).toEqual([]);
    expect(loaded.dismissedKeys).toEqual([]);
  });

  it("misses on a different date, priority, or LLM", async () => {
    const app = buildNoteApp();
    await storeProposedAgenda(app, { activities: [ACT_A], date: DATE, priorityKey: PRIORITY, providerEm: PROVIDER });
    expect(await loadCachedProposedAgenda(app, { date: DATE, priorityKey: PRIORITY, providerEm: "openai" })).toBeNull();
    expect(await loadCachedProposedAgenda(app, { date: DATE, priorityKey: "low-energy", providerEm: PROVIDER }))
      .toBeNull();
    expect(await loadCachedProposedAgenda(app, { date: new Date(2026, 6, 1), priorityKey: PRIORITY,
      providerEm: PROVIDER })).toBeNull();
  });

  it("replaces (does not duplicate) the record when the same date+priority+LLM is re-stored", async () => {
    const app = buildNoteApp();
    await storeProposedAgenda(app, { activities: [ACT_A, ACT_B], date: DATE, priorityKey: PRIORITY,
      providerEm: PROVIDER });
    await storeProposedAgenda(app, { activities: [ACT_A], date: DATE, priorityKey: PRIORITY, providerEm: PROVIDER });

    const records = storedRecords(app, DATE);
    expect(records).toHaveLength(1);
    expect(records[0].proposedTasks).toHaveLength(1);
    const loaded = await loadCachedProposedAgenda(app, { date: DATE, priorityKey: PRIORITY, providerEm: PROVIDER });
    expect(loaded.activities.map(a => a.title)).toEqual(["Deep work block"]);
  });

  it("keeps distinct records per priority and per LLM within one month", async () => {
    const app = buildNoteApp();
    await storeProposedAgenda(app, { activities: [ACT_A], date: DATE, priorityKey: PRIORITY, providerEm: PROVIDER });
    await storeProposedAgenda(app, { activities: [ACT_B], date: DATE, priorityKey: "low-energy",
      providerEm: PROVIDER });
    await storeProposedAgenda(app, { activities: [ACT_B], date: DATE, priorityKey: PRIORITY, providerEm: "openai" });
    expect(storedRecords(app, DATE)).toHaveLength(3);
  });

  it("records scheduled/dismissed statuses back onto the stored proposals", async () => {
    const app = buildNoteApp();
    await storeProposedAgenda(app, { activities: [ACT_A, ACT_B], date: DATE, priorityKey: PRIORITY,
      providerEm: PROVIDER });
    await updateProposedTaskStatuses(app, { activityKeys: [proposedTaskKey(ACT_A)], date: DATE, priorityKey: PRIORITY,
      providerEm: PROVIDER, scheduledEm: PROPOSED_TASK_STATUS.SCHEDULED });
    await updateProposedTaskStatuses(app, { activityKeys: [proposedTaskKey(ACT_B)], date: DATE, priorityKey: PRIORITY,
      providerEm: PROVIDER, scheduledEm: PROPOSED_TASK_STATUS.DISMISSED });

    const loaded = await loadCachedProposedAgenda(app, { date: DATE, priorityKey: PRIORITY, providerEm: PROVIDER });
    expect(loaded.scheduledKeys).toEqual([proposedTaskKey(ACT_A)]);
    expect(loaded.dismissedKeys).toEqual([proposedTaskKey(ACT_B)]);
  });
});

// ----------------------------------------------------------------------------------------------
// @desc Build an app that serves fixture tasks + a deterministic schedule through the Ample-Agent-Pro
//   callPlugin path (so no network), counting LLM invocations.
// @returns {object} App stub; read `app.callPlugin.mock.calls.length` for the LLM call count.
// [Claude claude-opus-4-8 (1M context)] Task: stub the generation surface with a deterministic LLM
function buildGenerationApp() {
  setPluginData({ context: {}, settings: { [SETTING_KEYS.LLM_PROVIDER_MODEL]: PROVIDER } });
  let llmCalls = 0;
  return buildNoteApp({
    alert: jest.fn(),
    filterNotes: jest.fn(async () => []),
    getTaskDomains: jest.fn(async () => [{ name: "Work", uuid: "dom-work" }]),
    getTaskDomainTasks: jest.fn(async () => [{ content: "Ship the thing", noteUUID: "note-1", uuid: "task-1",
      updatedAt: Math.floor(DATE.getTime() / 1000) }]),
    callPlugin: jest.fn(async () => { llmCalls += 1; return { activities: [
      { durationMinutes: 60, reason: "focus", startTime: "09:00", taskUuid: null, title: `Gen ${ llmCalls } morning` },
      { durationMinutes: 30, reason: "rest", startTime: "11:00", taskUuid: null, title: `Gen ${ llmCalls } midday` }] }; }),
  });
}

// [Claude claude-opus-4-8 (1M context)] Generated tests for: cache-served vs. regenerated proposed agendas
describe("generateProposedAgenda caching + regeneration", () => {
  it("calls the LLM once, then serves the identical request from the note, and replaces the record on reseed",
      async () => {
    const app = buildGenerationApp();

    const first = await generateProposedAgenda(app, { priorityKey: PRIORITY });
    expect(first.error).toBeUndefined();
    expect(first.fromCache).toBe(false);
    expect(first.providerEm).toBe(PROVIDER);
    expect(first.activities.map(a => a.title)).toEqual(["Gen 1 morning", "Gen 1 midday"]);
    expect(app.callPlugin).toHaveBeenCalledTimes(1);
    expect(storedRecords(app, new Date())).toHaveLength(1);

    // Identical date+priority+LLM request — served from the note, no second LLM call.
    const cached = await generateProposedAgenda(app, { priorityKey: PRIORITY });
    expect(cached.fromCache).toBe(true);
    expect(cached.activities.map(a => a.title)).toEqual(["Gen 1 morning", "Gen 1 midday"]);
    expect(app.callPlugin).toHaveBeenCalledTimes(1);

    // Reseed with the same LLM — forces regeneration and replaces the single stored record.
    const reseeded = await generateProposedAgenda(app, { forceRegenerate: true, priorityKey: PRIORITY });
    expect(reseeded.fromCache).toBe(false);
    expect(reseeded.activities.map(a => a.title)).toEqual(["Gen 2 morning", "Gen 2 midday"]);
    expect(app.callPlugin).toHaveBeenCalledTimes(2);
    expect(storedRecords(app, new Date())).toHaveLength(1);

    const afterReseed = await generateProposedAgenda(app, { priorityKey: PRIORITY });
    expect(afterReseed.fromCache).toBe(true);
    expect(afterReseed.activities.map(a => a.title)).toEqual(["Gen 2 morning", "Gen 2 midday"]);
  });

  it("reports 'No tasks found available to schedule in Task Domain' when the domain has no tasks", async () => {
    const app = buildGenerationApp();
    app.getTaskDomainTasks = jest.fn(async () => []);

    const result = await generateProposedAgenda(app, { priorityKey: PRIORITY });
    expect(result.errorCode).toBe("no_tasks");
    expect(result.error).toBe("No tasks found available to schedule in Task Domain.");
    expect(result.activities).toEqual([]);
    expect(app.callPlugin).not.toHaveBeenCalled();
  });

  it("degrades gracefully (no thrown 'find is not a function') when getTaskDomains returns a non-array", async () => {
    // buildGenerationApp sets no TASK_DOMAINS setting, so domain resolution falls through to getTaskDomains().
    const app = buildGenerationApp();
    app.getTaskDomains = jest.fn(async () => ({})); // CORS-degraded shape: truthy but not an array

    const result = await generateProposedAgenda(app, { priorityKey: PRIORITY });
    expect(result.errorCode).toBe("no_tasks");
    expect(result.activities).toEqual([]);
  });
});
