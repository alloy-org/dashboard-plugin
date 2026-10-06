// Verify file-backed acceptance notebook discovery and task edits survive development app request boundaries.
import { createDevApp } from "../dev/dev-app.js";
import fs from "fs";
import os from "os";
import path from "path";

let directory;

// ----------------------------------------------------------------------------------------------
// @desc Construct a fresh app to model separate server requests reading the same notebook.
// @returns {object} File-backed development app.
function freshApp() {
  return createDevApp(path.join(directory, "settings.json"), directory);
}

// ----------------------------------------------------------------------------------------------
// @desc Create an isolated notebook for each persistence scenario.
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), "dev-notebook-")); });
// ----------------------------------------------------------------------------------------------
// @desc Remove only the temporary notebook created by this scenario.
afterEach(() => { fs.rmSync(directory, { force: true, recursive: true }); });

// ----------------------------------------------------------------------------------------------
// @desc Exercise tag-derived and explicit domain membership through an independent app instance.
// @returns {Promise<void>}
async function verifyDomainDiscovery() {
  const app = freshApp();
  const tagged = await app.createNote("Tagged working note", ["work"]);
  const explicit = await app.createNote("Explicit working note", []);
  await app.addTaskDomainNote("domain-work-uuid", { uuid: explicit });
  const other = await app.createNote("Personal working note", ["personal"]);
  const handles = [...freshApp().filterNotes({ taskDomainUUID: "domain-work-uuid" })];
  expect(handles.some(note => note.uuid === tagged)).toBe(true);
  expect(handles.some(note => note.uuid === explicit)).toBe(true);
  expect(handles.some(note => note.uuid === other)).toBe(false);
}

// ----------------------------------------------------------------------------------------------
// @desc Ensure an edited built-in fixture task replaces its identity instead of creating a duplicate.
// @returns {Promise<void>}
async function verifyFixtureOverrides() {
  const app = freshApp();
  expect(await app.updateTask("dev-task-14", { completedAt: 100 })).toBe(true);
  const matches = (await freshApp().getTaskDomainTasks(null)).filter(task => task.uuid === "dev-task-14");
  expect(matches).toHaveLength(1);
  expect(matches[0].completedAt).toBe(100);
  expect(await app.updateTask("missing-task", { completedAt: 100 })).toBe(false);
}

// ----------------------------------------------------------------------------------------------
// @desc Verify completion, reopen, and content changes remain visible across all task read methods.
// @returns {Promise<void>}
async function verifyStoredTaskEdits() {
  const app = freshApp();
  const noteUuid = await app.createNote("Persistent task note", ["work"]);
  const taskUuid = await app.insertTask({ uuid: noteUuid }, { content: "Investigate load budget" });
  expect(await app.updateTask(taskUuid, { completedAt: 100, content: "Measure first usable load" })).toBe(true);
  expect((await freshApp().getTask(taskUuid)).content).toBe("Measure first usable load");
  expect(await freshApp().getNoteTasks({ uuid: noteUuid })).toEqual([]);
  expect((await freshApp().getNoteTasks({ uuid: noteUuid }, { includeDone: true }))[0].completedAt).toBe(100);
  await freshApp().updateTask(taskUuid, { completedAt: null });
  expect((await freshApp().getNoteTasks({ uuid: noteUuid }))[0].uuid).toBe(taskUuid);
}


it("discovers file-backed notes within their domain", verifyDomainDiscovery);
it("persists completion, content edits, and reopening", verifyStoredTaskEdits);
it("merges fixture overrides without duplicate identities", verifyFixtureOverrides);
