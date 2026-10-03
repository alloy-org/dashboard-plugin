// Exercise DashboardNoteWriter's per-note serialization and its notes-list refresh, on the host and over the bridge.
import { jest } from "@jest/globals";
import plugin from "plugin";
import DashboardNoteWriter, { NOTES_LIST_FRESH_MILLISECONDS } from "dashboard/work-queue/dashboard-note-writer";

// ----------------------------------------------------------------------------------------------
// @desc A promise with its resolve function exposed, so a test decides when an update finishes.
// @returns {object} { promise, resolve }.
function deferred() {
  let resolve = null;
  const promise = new Promise(settle => { resolve = settle; });
  return { promise, resolve };
}

// ----------------------------------------------------------------------------------------------
// @desc Let every queued promise callback run.
// @returns {Promise<void>}
async function flushPromises() {
  for (let round = 0; round < 10; round += 1) await Promise.resolve();
}

describe("DashboardNoteWriter updates", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A second update to a note waits for the first to finish, so its fresh read sees the first one's write.
  it("runs updates to the same note one at a time", async () => {
    const writer = new DashboardNoteWriter();
    const firstGate = deferred();
    const events = [];
    const first = writer.update("store", async () => { events.push("first start"); await firstGate.promise;
      events.push("first end"); return "first"; });
    const second = writer.update("store", async () => { events.push("second start"); return "second"; });
    await flushPromises();
    expect(events).toEqual(["first start"]);
    firstGate.resolve();
    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
    expect(events).toEqual(["first start", "first end", "second start"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc An update to one note never waits behind a slow update to another.
  it("runs updates to different notes independently", async () => {
    const writer = new DashboardNoteWriter();
    const slowGate = deferred();
    const slow = writer.update("store", () => slowGate.promise);
    await expect(writer.update("dictionary", async () => "done")).resolves.toBe("done");
    slowGate.resolve("slow");
    await expect(slow).resolves.toBe("slow");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A failed update rejects its own caller and the note's next update still runs.
  it("does not let a failed update stop later updates", async () => {
    const writer = new DashboardNoteWriter();
    const failed = writer.update("store", async () => { throw new Error("write failed"); });
    const next = writer.update("store", async () => "written");
    await expect(failed).rejects.toThrow("write failed");
    await expect(next).resolves.toBe("written");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Callers holding the same app share one writer, and so one chain per note.
  it("shares one writer per app interface", () => {
    const app = {};
    expect(DashboardNoteWriter.forApp(app)).toBe(DashboardNoteWriter.forApp(app));
    expect(DashboardNoteWriter.forApp({})).not.toBe(DashboardNoteWriter.forApp(app));
  });
});

describe("DashboardNoteWriter notes-list refresh", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc The host's app.context method runs before the update reads, and a success is reused within the window.
  it("refreshes the host notes list before an update and reuses a recent success", async () => {
    let now = 1000;
    const events = [];
    const context = { refreshNotesList: jest.fn(async () => { events.push("refresh"); return true; }) };
    const writer = new DashboardNoteWriter({ app: { context }, clock: () => now });
    await writer.update("store", async () => events.push("update"));
    await writer.update("store", async () => events.push("update"));
    expect(events).toEqual(["refresh", "update", "update"]);
    now += NOTES_LIST_FRESH_MILLISECONDS;
    await writer.update("store", async () => events.push("update"));
    expect(context.refreshNotesList).toHaveBeenCalledTimes(2);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Concurrent readers share one request rather than each asking Amplenote.
  it("shares a refresh already in flight", async () => {
    const gate = deferred();
    const context = { refreshNotesList: jest.fn(() => gate.promise) };
    const writer = new DashboardNoteWriter({ app: { context } });
    const first = writer.refreshNotesList();
    const second = writer.refreshNotesList();
    gate.resolve(true);
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(context.refreshNotesList).toHaveBeenCalledTimes(1);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A refresh Amplenote could not complete is not trusted, so the next reader asks again, and the update still
  //   runs against the notes the client holds.
  it("retries after a failed refresh and still runs the update", async () => {
    const context = { refreshNotesList: jest.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(true) };
    const writer = new DashboardNoteWriter({ app: { context } });
    await expect(writer.update("store", async () => "first")).resolves.toBe("first");
    await expect(writer.update("store", async () => "second")).resolves.toBe("second");
    await expect(writer.refreshNotesList()).resolves.toBe(true);
    expect(context.refreshNotesList).toHaveBeenCalledTimes(3);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The embed reaches app.context through the bridge's refreshNotesList action; a failure envelope is not true.
  it("refreshes through the embed bridge", async () => {
    const context = { refreshNotesList: jest.fn().mockResolvedValue(true) };
    const embedApp = { context: () => null, refreshNotesList: () => plugin.onEmbedCall({ context }, "refreshNotesList") };
    const writer = new DashboardNoteWriter({ app: embedApp });
    await expect(writer.refreshNotesList()).resolves.toBe(true);
    expect(context.refreshNotesList).toHaveBeenCalledTimes(1);
    const failingApp = { refreshNotesList: async () => ({ embedCallFailed: true, error: "bridge closed" }) };
    await expect(new DashboardNoteWriter({ app: failingApp }).refreshNotesList()).resolves.toBe(false);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A host without the method, such as an older client, answers false over the bridge without throwing.
  it("reports no refresh where the client lacks the method", async () => {
    await expect(plugin.onEmbedCall({ context: {} }, "refreshNotesList")).resolves.toBe(false);
    await expect(new DashboardNoteWriter({ app: {} }).refreshNotesList()).resolves.toBe(false);
  });
});
