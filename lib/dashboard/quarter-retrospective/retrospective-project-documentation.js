// Write the note a "Document how you did it" link on the "Aw no you di'nt" slide opens: one note per project and
// quarter, such as "How I pulled off Launch (Q3 2026)", listing the project's hardest tasks above headings for the user
// to fill in. It carries the retrospective tag, and a note already written for the project and quarter is reopened as it
// stands rather than written again.
import { quarterLabel } from "constants/quarters";
import { retrospectiveNoteTag } from "dashboard/quarter-retrospective/retrospective-note-tag";
import { checkedAppResult, resolvedNoteHandle } from "plan-wizard/vision-guide-notes";

export const PROJECT_DOCUMENTATION_HEADINGS = Object.freeze(["How I did it", "What made it hard", "What I'd tell myself next time"]);

// ----------------------------------------------------------------------------------------------
// @desc The documentation note's starting markdown: the project's hardest tasks, then an empty section per heading.
// @param {object} options - An object with the following properties:
//   - {object} project - { name, tasks } from hardestTaskProjects, each task { difficulty, text }
//   - {number} quarter - 1 through 4
//   - {number} year - Calendar year
// @returns {string} The markdown.
export function projectDocumentationMarkdown({ project, quarter, year }) {
  const taskLines = project.tasks.map(task => `- ${ task.text } (difficulty ${ task.difficulty }/10)`);
  const headingSections = PROJECT_DOCUMENTATION_HEADINGS.map(heading => `## ${ heading }\n\n`);
  const introduction = `The hardest tasks I completed for **${ project.name }** in ${ quarterLabel(year, quarter) }, as the `
    + "retrospective's task difficulty ranker saw them:";
  return `${ introduction }\n\n${ taskLines.join("\n") }\n\n${ headingSections.join("\n") }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Name the documentation note for one project and quarter.
// @param {object} options - { projectName, quarter, year }.
// @returns {string} Such as "How I pulled off Launch (Q3 2026)".
export function projectDocumentationNoteName({ projectName, quarter, year }) {
  return `How I pulled off ${ projectName } (${ quarterLabel(year, quarter) })`;
}

// ----------------------------------------------------------------------------------------------
// @desc Find the project's documentation note, writing it with the retrospective tag first when it doesn't exist yet.
// @param {object} app - Amplenote API.
// @param {object} options - An object with the following properties:
//   - {object} project - { name, tasks } from hardestTaskProjects
//   - {number} quarter - 1 through 4
//   - {number} year - Calendar year
// @returns {Promise<object>} { created, noteUuid }: created is false when the note was already written.
// @throws When the note couldn't be created or written.
export async function saveProjectDocumentationNote(app, { project, quarter, year }) {
  const noteName = projectDocumentationNoteName({ projectName: project.name, quarter, year });
  const found = checkedAppResult(await app.findNote({ name: noteName }));
  if (found?.uuid) return { created: false, noteUuid: found.uuid };
  const created = checkedAppResult(await app.createNote(noteName, [retrospectiveNoteTag()]));
  const createdUuid = typeof created === "string" ? created : created?.uuid;
  if (!createdUuid) throw new Error(`Could not create the note "${ noteName }"`);
  // createNote can hand back a local identifier that a later write silently misses; looking it up exchanges it.
  const noteUuid = (await resolvedNoteHandle(app, createdUuid)).uuid;
  const replaced = checkedAppResult(await app.replaceNoteContent({ uuid: noteUuid }, projectDocumentationMarkdown({ project, quarter, year })));
  if (replaced === false) throw new Error(`Could not write the note "${ noteName }"`);
  return { created: true, noteUuid };
}
