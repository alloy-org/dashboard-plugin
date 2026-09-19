// Open dated agenda notes and add task references without overwriting existing tasks or prose.
import { DASHBOARD_NOTE_TAG } from "constants/settings";
import { checkedAppResult } from "plan-wizard/vision-guide-notes";
import { dateKeyFromDateInput } from "util/date-utility";
import { activeTaskDomainInfo } from "util/task-domain-utility";

// ----------------------------------------------------------------------------------------------
// @desc Add only missing suggestions, re-reading tasks before each insertion so retrying a partial save is safe.
// @param {object} app - Amplenote app bridge.
// @param {object} note - Dated note handle.
// @param {Array<object>} suggestions - Timed activities or untimed due-project suggestions.
// @returns {Promise<void>}
export async function populateAgendaNote(app, note, suggestions) {
  for (const suggestion of suggestions) {
    const tasks = checkedAppResult(await app.getNoteTasks(note, { includeDone: true }));
    if (!Array.isArray(tasks)) throw new Error("Could not check existing agenda tasks");
    const sourceLink = suggestion.taskUuid ? `https://www.amplenote.com/notes/tasks/${ suggestion.taskUuid }` : null;
    const projectMarker = suggestion.projectUuid ? `project:${ suggestion.projectUuid }` : null;
    const exists = tasks.some(task => (sourceLink && task.content?.includes(sourceLink))
      || (projectMarker && task.content?.includes(projectMarker)) || task.content === suggestion.title
      || (suggestion.taskUuid && task.uuid === suggestion.taskUuid));
    if (exists) continue;
    const title = String(suggestion.title).replace(/\s+/g, " ").trim();
    const timeLabel = suggestion.startTime ? `${ suggestion.startTime } — ` : "When time allows — ";
    const reference = sourceLink ? ` ([source task](${ sourceLink }))` : "";
    const projectLabel = projectMarker ? ` (${ projectMarker })` : "";
    const content = `${ timeLabel }${ title }${ reference }${ projectLabel } — ${ suggestion.reason || "" }`;
    const taskUuid = checkedAppResult(await app.insertTask(note, { content }));
    if (!taskUuid) throw new Error("Could not add agenda task");
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Find or create the chosen date's agenda note and read its existing tasks before generating suggestions.
// @param {object} app - Amplenote app bridge.
// @param {object} options - { domainName, domainUuid, targetDate }.
// @returns {Promise<object>} { note, tasks }.
export async function prepareAgendaNote(app, { domainName, domainUuid, targetDate }) {
  const name = `Proposed Agenda ${ dateKeyFromDateInput(targetDate) } ${ domainName || "All Notes" }`;
  let note = checkedAppResult(await app.findNote({ name }));
  if (!note) {
    const created = checkedAppResult(await app.createNote(name, [DASHBOARD_NOTE_TAG]));
    note = typeof created === "string" ? { uuid: created } : created;
    if (!note?.uuid) throw new Error("Could not create the dated agenda note");
  }
  if (domainUuid) {
    const added = checkedAppResult(await app.addTaskDomainNote(domainUuid, note));
    if (added === false) throw new Error("Could not include the agenda note in this Task Domain");
  }
  const tasks = checkedAppResult(await app.getNoteTasks(note, { includeDone: true }));
  if (!Array.isArray(tasks)) throw new Error("Could not check existing agenda tasks");
  return { note, tasks };
}

// ----------------------------------------------------------------------------------------------
// @desc Schedule a generated project step using its existing dated checkbox, creating one only when absent.
// @param {object} activity - Project suggestion with projectUuid and title.
// @param {object} app - Host-compatible app bridge.
// @param {number} startAt - Approved calendar time in Unix seconds.
// @returns {Promise<object>} Scheduled task identity or an explicit failure reason.
export async function scheduleProjectStep(activity, app, startAt) {
  const { domainName, domainUuid } = await activeTaskDomainInfo(app);
  const { note, tasks } = await prepareAgendaNote(app, { domainName, domainUuid, targetDate: new Date(startAt * 1000) });
  const marker = `project:${ activity.projectUuid }`;
  const existing = tasks.find(task => !task.completedAt && !task.dismissedAt && task.content?.includes(marker));
  if (existing) {
    const updated = checkedAppResult(await app.updateTask(existing.uuid, { startAt }));
    return updated ? { noteUuid: note.uuid, startAt, taskUuid: existing.uuid } : { reason: "update_failed" };
  }
  const taskUuid = checkedAppResult(await app.insertTask(note, { content: `${ activity.title } (${ marker })`, startAt }));
  return taskUuid ? { noteUuid: note.uuid, startAt, taskUuid } : { reason: "insert_failed" };
}
