// Persist domain-scoped quarterly project evidence and expose it to agenda generation.
import { DASHBOARD_NOTE_TAG } from "constants/settings";
import { resolvePlanScope } from "plan-wizard/plan-models";
import { guideSectionRange, jsonPayloadMarkdown, parseJsonPayload } from "plan-wizard/vision-guide-markdown";
import { checkedAppResult, replaceGuideSection } from "plan-wizard/vision-guide-notes";
import { readVisionGuide } from "plan-wizard/vision-guide-repository";
import { projectMatchesTask, projectProgressEvidence, projectWithTaskEvidence, quarterlyProgressProjects } from "project-progress-model";
import { fetchDomainOrAllNotesTasks } from "util/all-notes-tasks";
import { dateKeyFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";

const PROGRESS_HEADING = "Project progress data";
const writesByApp = new WeakMap();

// ----------------------------------------------------------------------------------------------
// @desc Read explicit project and completion records, preserving all previous quarter history on refresh.
// @param {object} app - Host-compatible app bridge.
// @param {object} options - { domainName, domainUuid, quarterlyContent, targetDate }.
// @returns {Promise<object>} Active projects with evidence and compact, uncapped project task candidates.
export async function loadProjectProgress(app, options) {
  const previous = writesByApp.get(app) || Promise.resolve();
  const pending = previous.catch(() => {}).then(() => refreshProjectProgress(app, options));
  writesByApp.set(app, pending);
  try { return await pending; }
  finally { if (writesByApp.get(app) === pending) writesByApp.delete(app); }
}

// ----------------------------------------------------------------------------------------------
// @desc Validate stored progress and retain the source note identity when its payload cannot be read.
// @param {object} options - Note content, identity, section range, and expected domain/quarter scope.
// @returns {object|null} Existing progress payload, or null for a new note.
function projectProgressFromContent({ content, domainUuid, name, note, scope, section }) {
  try {
    const stored = section ? parseJsonPayload(content.slice(section.bodyStart, section.end)).payload : null;
    if (note && content.trim() && !stored) throw new Error(`Missing project progress data in ${ name }`);
    if (stored && (stored.schemaVersion !== 1 || stored.domainUuid !== domainUuid || stored.quarterKey !== scope.quarterKey
      || !Array.isArray(stored.projects))) throw new Error(`Invalid project progress data in ${ name }`);
    return stored;
  } catch (error) {
    error.noteUuid = note?.uuid || null;
    throw error;
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Serialize one evidence refresh so overlapping date requests cannot overwrite one another's project UUIDs.
//   Skip optional progress for incompatible guides without changing guide or progress notes; the agenda can still use its quarterly plan and tasks.
// @param {object} app - Host-compatible app bridge.
// @param {object} options - { domainName, domainUuid, quarterlyContent, targetDate }.
// @returns {Promise<object>} { candidates, markdown, projects }.
async function refreshProjectProgress(app, { domainName, domainUuid, quarterlyContent, targetDate }) {
  const scope = resolvePlanScope({ domainName, domainUuid, quarter: Math.floor(targetDate.getMonth() / 3) + 1,
    year: targetDate.getFullYear() });
  const guide = await readVisionGuide(app, scope);
  const name = `Project Builder Q${ scope.quarter } ${ scope.year } ${ scope.domainName } Progress`;
  const note = checkedAppResult(await app.findNote({ name }));
  const content = note ? checkedAppResult(await app.getNoteContent(note)) : "";
  const section = guideSectionRange(content, PROGRESS_HEADING);
  const stored = projectProgressFromContent({ content, domainUuid, name, note, scope, section });
  const previousProjects = stored?.projects || [];
  const projects = quarterlyProgressProjects({ guide, previousProjects, quarterlyContent, scope });
  if (!projects.length) return { candidates: [], markdown: "", projects: [] };
  const tasks = checkedAppResult(await fetchDomainOrAllNotesTasks(app, domainUuid));
  const quarterStart = new Date(scope.year, (scope.quarter - 1) * 3, 1);
  const queryStart = new Date(Math.min(quarterStart.getTime(), targetDate.getTime()));
  queryStart.setDate(queryStart.getDate() - 7);
  const quarterEnd = new Date(scope.year, scope.quarter * 3, 1);
  const queryEnd = Math.min(Date.now(), quarterEnd.getTime());
  const completed = queryStart.getTime() < queryEnd ? checkedAppResult(await app.getCompletedTasks(Math.floor(queryStart.getTime() / 1000),
    Math.floor(queryEnd / 1000), domainUuid ? { taskDomainUUID: domainUuid } : {})) : [];
  if (!Array.isArray(tasks) || !Array.isArray(completed)) throw new Error("Could not read project task evidence");
  const observedTasks = [...completed, ...tasks];
  const updatedProjects = projects.map(project => projectWithTaskEvidence(project, observedTasks));
  const retiredProjects = previousProjects.filter(project => !updatedProjects.some(updated => updated.uuid === project.uuid));
  const payload = { domainUuid, projects: [...retiredProjects, ...updatedProjects], quarterKey: scope.quarterKey,
    schemaVersion: 1, updatedAt: new Date().toISOString() };
  const evidenceProjects = updatedProjects.map(project => ({ ...project, ...projectProgressEvidence(project, targetDate) }));
  const markdown = evidenceProjects.map(project => `- ${ project.summary } (project:${ project.uuid }): ${ project.reason }
  Completions in past week: ${ project.completedPastWeek }; due: ${ project.due }. Task UUIDs: ${ project.relatedTasks.join(", ") || "none" }.
  Focus months: ${ project.focusMonths?.join(", ") || "whole quarter" }; preferred weekdays: ${ project.preferredWeekdays?.join(", ") || "any" }.`).join("\n");
  const body = `As evaluated for ${ dateKeyFromDateInput(targetDate) }. Task counts are a proxy for blocks, not time spent.\n\n`
    + `${ markdown }\n\n${ jsonPayloadMarkdown(payload) }`;
  await writeProjectProgress(app, { body, content, name, note, section });
  const openTasks = tasks.filter(task => task.uuid && !task.completedAt && !task.dismissedAt);
  const projectTasks = openTasks.filter(task => evidenceProjects.some(project => projectMatchesTask(project, task)));
  const candidates = projectTasks.map(task => ({ duration: task.duration || null, noteUuid: task.noteUUID,
    scheduledOnTarget: task.startAt ? dateKeyFromDateInput(task.startAt) === dateKeyFromDateInput(targetDate) : false,
    taskText: task.content, taskUuid: task.uuid }));
  return { candidates, markdown, projects: evidenceProjects };
}

// ----------------------------------------------------------------------------------------------
// @desc Write only the dedicated data section, retaining any user-authored prose elsewhere in the progress note.
// @param {object} app - Host-compatible app bridge.
// @param {object} options - { body, content, name, note, section }.
// @returns {Promise<void>}
async function writeProjectProgress(app, { body, content, name, note, section }) {
  let handle = note;
  if (!handle) {
    const created = checkedAppResult(await app.createNote(name, [DASHBOARD_NOTE_TAG]));
    handle = typeof created === "string" ? { uuid: created } : created;
    if (!handle?.uuid) throw new Error("Could not create project progress note");
  }
  if (section) await replaceGuideSection(app, body, handle, { heading: { level: section.level, text: PROGRESS_HEADING } });
  else checkedAppResult(await app.replaceNoteContent(handle, `${ content }\n# ${ PROGRESS_HEADING }\n\n${ body }`));
}
