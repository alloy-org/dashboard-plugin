// Remember how far the recent-task term scan has read, and where each person the scan met is linked, in an archived
// "User terms dictionary {year} task scan" note as a JSON block. The watermark is the creation time of the newest task
// a scan sent, so the next scan reads only tasks added since; a scan that met more new tasks than it sends records a
// backlog, which brings the next scan due sooner. The person links (the notes an "@Name" link points at and the
// Amplenote people an "@@Name" link names) are what person evidence reads directly, rather than searching for the name.
// The record can always be rebuilt by scanning again, so a note whose JSON cannot be parsed reads as a fresh record.
import { readJsonNote, writeJsonNote } from "dashboard/work-queue/dashboard-json-note";
import DashboardNoteWriter from "dashboard/work-queue/dashboard-note-writer";
import { taskTermDiscoveryRequest } from "dashboard/work-queue/jobs/project-job-requests";
import { millisFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";

export const TASK_TERM_SCAN_SCHEMA_VERSION = 1;
// How far back the first scan of a year reaches.
export const FIRST_SCAN_LOOKBACK_MILLISECONDS = 14 * 24 * 60 * 60 * 1000;
// How often a scan runs while new tasks arrive, and how soon one follows a scan that left a backlog.
export const SCAN_INTERVAL_MILLISECONDS = 24 * 60 * 60 * 1000;
export const BACKLOG_SCAN_INTERVAL_MILLISECONDS = 60 * 60 * 1000;
// The most notes and people one person's record keeps.
const MAXIMUM_LINKS_PER_PERSON = 6;
const SCAN_NOTE_DESCRIPTION = "This archived note is maintained by the dashboard plugin. It records how far the plugin "
  + "has read your recently added tasks for new terms and people, and which notes and people your @ mentions link to.";

// ----------------------------------------------------------------------------------------------
// @desc A request for the recent-task scan when one is due, read from the scan note without writing it.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { domainUuid, now, tasks }: the domain's tasks as read.
// @returns {Promise<Array<object>>} One request for DurableWorkRunner#submitAll, or none.
// @throws When the scan note cannot be read.
export async function dueTaskTermScanRequests(app, { domainUuid, now, tasks }) {
  const year = now.getFullYear();
  const scan = await readTaskTermScan(app, year);
  if (!taskTermScanDue({ now, scan, tasks })) return [];
  return [taskTermDiscoveryRequest({ domainUuid, year }, { requestedAt: now.getTime() })];
}

// ----------------------------------------------------------------------------------------------
// @desc The notes and people linked to any of a person's names.
// @param {object} scan - From readTaskTermScan.
// @param {Array<string>} names - The person's term and aliases.
// @returns {object} { noteUuids, personUuids }, deduplicated.
export function personLinksForNames(scan, names) {
  const records = names.map(name => scan.people[name.trim().toLowerCase()]).filter(Boolean);
  const noteUuids = [...new Set(records.flatMap(record => record.noteUuids))];
  const personUuids = [...new Set(records.flatMap(record => record.personUuids))];
  return { noteUuids, personUuids };
}

// ----------------------------------------------------------------------------------------------
// @desc Read the year's scan record, or a fresh one when there is none or it cannot be read.
// @param {object} app - Host-compatible Amplenote API.
// @param {number} year - Calendar year.
// @returns {Promise<object>} { backlog, lastScanAt, people, scannedThrough }: times as epoch milliseconds or null;
//   people keyed by lowercased name, each { name, noteUuids, personUuids }.
// @throws When an app call fails.
export async function readTaskTermScan(app, year) {
  const { payload } = await _readScanNote(app, taskTermScanNoteName(year));
  return _scanFromPayload(payload);
}

// ----------------------------------------------------------------------------------------------
// @desc The tasks a scan sends: those created after the watermark, or within FIRST_SCAN_LOOKBACK_MILLISECONDS on a
//   year's first scan, oldest first, up to the limit. A task without a readable creation time is never sent.
// @param {Array<object>} tasks - Tasks as read.
// @param {object} options - { limit, now, scannedThrough }.
// @returns {object} { backlog, tasks }: backlog is true when more tasks were new than the limit allowed.
export function tasksForTermScan(tasks, { limit, now, scannedThrough }) {
  const after = scannedThrough ?? now.getTime() - FIRST_SCAN_LOOKBACK_MILLISECONDS;
  const datedTasks = (tasks || []).map(task => ({ createdAt: millisFromDateInput(task?.createdAt), task }));
  const newTasks = datedTasks.filter(({ createdAt, task }) => Number.isFinite(createdAt) && createdAt > after && (task.content || "").trim());
  const oldestFirst = newTasks.sort((first, second) => first.createdAt - second.createdAt);
  const sentTasks = oldestFirst.slice(0, limit).map(({ createdAt, task }) => ({ ...task, createdAtMilliseconds: createdAt }));
  return { backlog: newTasks.length > limit, tasks: sentTasks };
}

// ----------------------------------------------------------------------------------------------
// @desc Whether a scan is due: some task was added since the watermark, and the last scan is older than the scan
//   interval, or than the backlog interval when the last scan left tasks unsent.
// @param {object} options - { now, scan, tasks }.
// @returns {boolean} True when a scan should be requested.
export function taskTermScanDue({ now, scan, tasks }) {
  const interval = scan.backlog ? BACKLOG_SCAN_INTERVAL_MILLISECONDS : SCAN_INTERVAL_MILLISECONDS;
  if (scan.lastScanAt !== null && now.getTime() - scan.lastScanAt < interval) return false;
  return tasksForTermScan(tasks, { limit: 1, now, scannedThrough: scan.scannedThrough }).tasks.length > 0;
}

// ----------------------------------------------------------------------------------------------
// @desc Name the year's scan note.
// @param {number} year - Calendar year.
// @returns {string} Note name.
export function taskTermScanNoteName(year) {
  return `User terms dictionary ${ year } task scan`;
}

// ----------------------------------------------------------------------------------------------
// @desc Record a finished scan: its time, the new watermark, whether it left a backlog, and the links of the people it
//   met, merged into those already recorded. Serialized through the app's note writer.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - An object with the following properties:
//   - {boolean} backlog - Whether more tasks were new than the scan sent
//   - {Array<object>} mentionedPeople - From mentionedPeopleFromTasks
//   - {DashboardNoteWriter} [noteWriter] - Serializes updates; the app's shared writer by default
//   - {number} scannedAt - Epoch milliseconds
//   - {number|null} scannedThrough - Creation time of the newest task sent, or null to keep the watermark
//   - {number} year - The dictionary's year
// @returns {Promise<object>} The record as saved.
// @throws When the note cannot be read or written.
export function savedTaskTermScan(app, { backlog, mentionedPeople, noteWriter = DashboardNoteWriter.forApp(app), scannedAt, scannedThrough, year }) {
  const name = taskTermScanNoteName(year);
  return noteWriter.update(name, async () => {
    const { noteHandle, payload } = await _readScanNote(app, name);
    const scan = _scanFromPayload(payload);
    const people = { ...scan.people };
    for (const person of mentionedPeople) {
      const nameKey = person.name.toLowerCase();
      const recorded = people[nameKey] || { name: person.name, noteUuids: [], personUuids: [] };
      people[nameKey] = { name: recorded.name, noteUuids: _mergedLinks(recorded.noteUuids, person.noteUuids),
        personUuids: _mergedLinks(recorded.personUuids, person.personUuids) };
    }
    const saved = { backlog, lastScanAt: scannedAt, people, scannedThrough: Math.max(scannedThrough ?? 0, scan.scannedThrough ?? 0) || null };
    await writeJsonNote(app, { description: SCAN_NOTE_DESCRIPTION, name, noteHandle,
      payload: { schemaVersion: TASK_TERM_SCAN_SCHEMA_VERSION, ...saved }, title: name });
    return saved;
  });
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Combine two link lists, the newest links last, keeping at most MAXIMUM_LINKS_PER_PERSON of the newest.
// @param {Array<string>} recorded - Links already recorded.
// @param {Array<string>} incoming - Links just met.
// @returns {Array<string>} The combined list.
function _mergedLinks(recorded, incoming) {
  const combined = [...recorded.filter(link => !incoming.includes(link)), ...incoming];
  const newestLinks = combined.slice(-MAXIMUM_LINKS_PER_PERSON);
  return newestLinks;
}

// ----------------------------------------------------------------------------------------------
// @desc Read the scan note, treating an unparseable block as no record, since a scan rebuilds it.
// @param {object} app - Host-compatible Amplenote API.
// @param {string} name - Note name.
// @returns {Promise<object>} { noteHandle, payload }.
async function _readScanNote(app, name) {
  try {
    return await readJsonNote(app, name);
  } catch (error) {
    if (!error?.unreadableJson || Number(error.schemaVersion) > TASK_TERM_SCAN_SCHEMA_VERSION) throw error;
    logIfEnabled("[task-term-scan] rebuilding unreadable scan note", { message: error.message, name });
    return { noteHandle: error.noteHandle, payload: null };
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Normalize a saved payload into a scan record, filling what an older or missing payload lacks.
// @param {object|null} payload - The parsed JSON.
// @returns {object} { backlog, lastScanAt, people, scannedThrough }.
function _scanFromPayload(payload) {
  const number = value => (Number.isFinite(value) ? value : null);
  const people = payload?.people && typeof payload.people === "object" ? payload.people : {};
  return { backlog: payload?.backlog === true, lastScanAt: number(payload?.lastScanAt), people,
    scannedThrough: number(payload?.scannedThrough) };
}
