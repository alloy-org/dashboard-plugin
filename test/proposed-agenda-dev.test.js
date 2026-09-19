// Exercise dated agenda persistence through the real browser adapter, task endpoint, and file-backed dev app.
import { jest } from "@jest/globals";
import { EventEmitter } from "events";
import fs from "fs";
import os from "os";
import path from "path";
import { populateAgendaNote, prepareAgendaNote } from "proposed-agenda-note";
import { createBrowserDevApp } from "util/browser-dev-app";
import { createDevApp } from "../dev/dev-app.js";
import { handleTaskApi } from "../dev/dev-task-api.js";

let directory;
let originalFetch;

// ----------------------------------------------------------------------------------------------
// @desc Create a fresh server app per request to verify data survives request and server instance boundaries.
// @returns {object} File-backed app isolated from the user's development notes.
function serverApp() {
  return createDevApp(path.join(directory, "settings.json"), directory);
}

// ----------------------------------------------------------------------------------------------
// @desc Transport browser requests through the real task handler without opening a network listener.
// @param {string} url - Browser request URL.
// @param {object} options - Fetch options containing the request body.
// @returns {Promise<object>} Fetch-compatible response.
async function taskFetch(url, options = {}) {
  const app = serverApp();
  if (url === "/api/note-tasks") {
    return new Promise(resolve => {
      const request = new EventEmitter();
      request.method = options.method;
      let status;
      handleTaskApi(app, request, { end: body => resolve({ json: async () => JSON.parse(body), ok: status === 200 }),
        writeHead: value => { status = value; } });
      request.emit("data", options.body);
      request.emit("end");
    });
  }
  let result;
  if (url === "/api/note-create") {
    const { name, tags } = JSON.parse(options.body);
    result = { uuid: await app.createNote(name, tags) };
  } else if (url.startsWith("/api/note-find?")) {
    result = await app.findNote(Object.fromEntries(new URL(url, "http://localhost").searchParams));
  } else if (url.startsWith("/api/tasks")) {
    result = await app.getTaskDomainTasks(new URL(url, "http://localhost").searchParams.get("domain"));
  } else throw new Error(`Unexpected dev request: ${ url }`);
  return { json: async () => result, ok: true };
}

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "agenda-dev-"));
  originalFetch = global.fetch;
  global.fetch = jest.fn(taskFetch);
});

afterEach(() => {
  global.fetch = originalFetch;
  fs.rmSync(directory, { force: true, recursive: true });
});

// ----------------------------------------------------------------------------------------------
// @desc Explicit date selection can create and populate a domain agenda using the actual development API surface.
it("persists the selected day's agenda and avoids duplicate tasks after retrying", async () => {
  const app = createBrowserDevApp();
  const options = { domainName: "Work", domainUuid: "domain-work-uuid", targetDate: new Date(2026, 8, 22) };
  const { note, tasks } = await prepareAgendaNote(app, options);
  expect(tasks).toEqual([]);
  const suggestions = [{ reason: "Quarterly progress", startTime: "09:00", taskUuid: "source-task", title: "Draft the spec" }];
  await populateAgendaNote(app, note, suggestions);
  const retried = await prepareAgendaNote(app, options);
  await populateAgendaNote(app, retried.note, suggestions);
  expect(retried.note.uuid).toBe(note.uuid);
  expect(retried.tasks).toHaveLength(1);
  const domainTasks = await app.getTaskDomainTasks(options.domainUuid);
  expect(domainTasks.filter(task => task.noteUUID === note.uuid)).toHaveLength(1);
  const otherTasks = await app.getTaskDomainTasks("domain-personal-uuid");
  expect(otherTasks.some(task => task.noteUUID === note.uuid)).toBe(false);
  const content = await serverApp().getNoteContent(note);
  expect(content.match(/- \[ \]/g)).toHaveLength(1);
  expect(content).toContain("Draft the spec");
});

// ----------------------------------------------------------------------------------------------
// @desc Completed tasks remain available to includeDone reads so agenda retries do not reinsert finished work.
it("honors includeDone for persisted agenda tasks", async () => {
  const app = createBrowserDevApp();
  const uuid = await app.createNote("Completed agenda", []);
  await app.insertTask({ uuid }, { completedAt: 100, content: "Already finished" });
  expect(await app.getNoteTasks({ uuid })).toEqual([]);
  expect(await app.getNoteTasks({ uuid }, { includeDone: true })).toHaveLength(1);
});

// ----------------------------------------------------------------------------------------------
// @desc Invalid domain or note handles must not appear to succeed, and failed writes cannot create tasks.
it("reports invalid memberships and rejects task API failures", async () => {
  const app = createBrowserDevApp();
  await expect(app.addTaskDomainNote("domain-work-uuid", { uuid: "missing" })).resolves.toBe(false);
  await expect(app.addTaskDomainNote("missing-domain", { uuid: "missing" })).rejects.toThrow("Unknown Task Domain");
  await expect(app.insertTask({ uuid: "missing" }, { content: "Missing note" })).resolves.toBeNull();
  global.fetch.mockResolvedValueOnce({ json: async () => ({ error: "Write failed" }), ok: false });
  await expect(app.insertTask({ uuid: "missing" }, { content: "New task" })).rejects.toThrow("Write failed");
});

// ----------------------------------------------------------------------------------------------
// @desc A dev server missing the new route needs a restart, not a source-note repair or a JSON parser error.
it("explains a missing task endpoint without trying to parse its plain-text 404", async () => {
  const json = jest.fn().mockRejectedValue(new SyntaxError("Unexpected non-whitespace character after JSON at position 4"));
  global.fetch.mockResolvedValueOnce({ json, ok: false, status: 404 });
  await expect(createBrowserDevApp().getNoteTasks({ uuid: "any-note" })).rejects.toThrow("Restart npm run dev");
  expect(json).not.toHaveBeenCalled();
});

// ----------------------------------------------------------------------------------------------
// @desc Malformed HTTP responses are distinguished from malformed note content even when HTTP reports success.
it("identifies invalid task endpoint responses", async () => {
  global.fetch.mockResolvedValueOnce({ json: async () => { throw new SyntaxError("Bad JSON"); }, ok: true, status: 200 });
  await expect(createBrowserDevApp().getNoteTasks({ uuid: "any-note" })).rejects.toThrow("invalid response (HTTP 200)");
});
