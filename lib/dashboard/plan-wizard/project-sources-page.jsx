// Plan Builder's side page showing what project discovery reads: the intents a project has to carry, the notes where
// the user's important and finished work sits, and the projects drawn from them with the number of tasks each one
// serves. Discovery takes long enough that the wait is the page's main audience, so it opens with the count of notes
// and tasks being considered, fills in as the evidence is collected, and reveals projects one at a time as they
// arrive. When there is too little to read for the projects to be specific, it says so and suggests importing.
// Clicking a project lists the tasks it was drawn from.
//
// It borrows the intent reading page's layout classes, since the two pages are the same kind of explanation for
// different steps and should read alike.

import { IntentReadingProgressBar, ReadItemIcon, useStaggeredReveal } from "dashboard/plan-wizard/intent-reading-page";
import { hasThinSources, projectTaskItems, sourceProjectRows } from "dashboard/plan-wizard/project-sources-page-fields";
import { useEffect, useState } from "react";

const INTENT_REVEAL_MS = 120;
const NOTE_REVEAL_MS = 90;
const PROJECT_REVEAL_MS = 260;

// ----------------------------------------------------------------------------------------------
// @desc Pluralize a count with its noun, as "1 task" or "4 tasks".
// @param {number} count - How many.
// @param {string} noun - Singular noun.
// @returns {string} The count and noun.
function countedNoun(count, noun) {
  return `${ count } ${ noun }${ count === 1 ? "" : "s" }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Describe what a source note contributed, as "2 important · 5 finished · 3 open".
// @param {object} sourceNote - { completedTaskCount, importantTaskCount, openTaskCount }.
// @returns {string} The non-zero counts joined, or an empty string when all are zero.
function sourceNoteDetail(sourceNote) {
  const detailParts = [];
  if (sourceNote.importantTaskCount) detailParts.push(`${ sourceNote.importantTaskCount } important`);
  if (sourceNote.completedTaskCount) detailParts.push(`${ sourceNote.completedTaskCount } finished`);
  if (sourceNote.openTaskCount) detailParts.push(`${ sourceNote.openTaskCount } open`);
  return detailParts.join(" · ");
}

// ----------------------------------------------------------------------------------------------
// @desc Say what the page is waiting on, or that it is done waiting.
// @param {object} params - { isDiscovering, isLoadingSources }.
// @returns {string} Status line.
function sourcesStatusText({ isDiscovering, isLoadingSources }) {
  if (isDiscovering) return "Looking for projects that would carry your intents…";
  if (isLoadingSources) return "Gathering the notes and tasks projects are drawn from…";
  return "These are the notes and tasks behind the projects on the previous page.";
}

// ----------------------------------------------------------------------------------------------
// @desc Describe a cited task's standing beneath its text, as "Important · Finished Sep 14 · Support log".
// @param {object} task - Item from projectTaskItems.
// @returns {string} The parts that apply, joined.
function projectTaskDetail(task) {
  const detailParts = [];
  if (task.isImportant) detailParts.push("Important");
  if (task.completedAt) {
    const finishedOn = new Date(task.completedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" });
    detailParts.push(`Finished ${ finishedOn }`);
  }
  if (task.noteName) detailParts.push(task.noteName);
  return detailParts.join(" · ");
}

// ----------------------------------------------------------------------------------------------
// @desc The tasks a project cites, shown when its row is opened.
// @param {object} params - An object with the following properties:
//   - {object} projectRow - Row from sourceProjectRows.
//   - {object|null} projectSources - Summary from projectSourcesFromEvidence, or null while it is collected.
// @returns {JSX.Element} The task list, or a line saying why there is none yet.
function ProjectSourcesTaskList({ projectRow, projectSources }) {
  if (!projectSources) return <p className="project-sources-task-placeholder">Reading this project's tasks…</p>;
  const { tasks, unreadTaskCount } = projectTaskItems(projectRow, projectSources);
  return (
    <div className="project-sources-task-panel">
      { tasks.length ? (
        <ul className="project-sources-task-list">
          { tasks.map(task => (
            <li className={ `project-sources-task${ task.completedAt ? " project-sources-task--finished" : "" }` } key={ task.uuid }>
              <ReadItemIcon kind="task" />
              <span className="project-sources-task-body">
                <span className="project-sources-task-text">{ task.text || "Untitled task" }</span>
                <span className="project-sources-task-detail">{ projectTaskDetail(task) }</span>
              </span>
            </li>
          )) }
        </ul>
      ) : null }
      { unreadTaskCount ? (
        <p className="project-sources-task-placeholder">
          { `${ countedNoun(unreadTaskCount, "cited task") } ${ unreadTaskCount === 1 ? "isn't" : "aren't" } among the `
            + "tasks read this time, likely since deleted or no longer recent." }
        </p>
      ) : null }
    </div>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc One project with the number of tasks it serves, marked when the user has already chosen its cadence. A
//   project that cites tasks opens on click to list them; one the user named has none to list.
// @param {object} params - An object with the following properties:
//   - {object} projectRow - Row from sourceProjectRows.
//   - {object|null} projectSources - Summary from projectSourcesFromEvidence, or null while it is collected.
// @returns {JSX.Element} The project row.
function ProjectSourcesProject({ projectRow, projectSources }) {
  const [isOpen, setIsOpen] = useState(false);
  const isRatified = Boolean(projectRow.paceLabel);
  const hasTasks = projectRow.servedTaskCount > 0;
  const rowContent = (
    <>
      <svg aria-hidden="true" className="intent-reading-direction-icon" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="4" />
        <circle className="intent-reading-direction-icon-center" cx="12" cy="12" r="1.5" />
      </svg>
      <span className="project-sources-project-name">{ projectRow.summary }</span>
      { projectRow.userCategoryEm === "personal" ? <span className="project-sources-project-category">Personal</span> : null }
      { isRatified ? (
        <span className="project-sources-ratified-badge" title="You chose this project's cadence">
          <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" /></svg>
          { projectRow.paceLabel }
        </span>
      ) : null }
      <span className="project-sources-project-count">
        { hasTasks ? countedNoun(projectRow.servedTaskCount, "task") : "Named by you" }
      </span>
      { hasTasks ? (
        <svg aria-hidden="true" className="project-sources-project-chevron" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" /></svg>
      ) : null }
    </>
  );
  const ratifiedClass = isRatified ? " project-sources-project--ratified" : "";
  const projectClass = `project-sources-project${ ratifiedClass }${ isOpen ? " project-sources-project--open" : "" }`;
  return (
    <li className={ projectClass }>
      { hasTasks ? (
        <button aria-expanded={ isOpen } className="project-sources-project-row" onClick={ () => setIsOpen(open => !open) }
          type="button">
          { rowContent }
        </button>
      ) : <div className="project-sources-project-row">{ rowContent }</div> }
      { isOpen ? <ProjectSourcesTaskList projectRow={ projectRow } projectSources={ projectSources } /> : null }
    </li>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Render the project sources page.
// @param {object} params - An object with the following properties:
//   - {boolean} isDiscovering - True while a discovery pass is running.
//   - {boolean} isLoadingSources - True while sources are being collected without a discovery pass.
//   - {Function} onLoadSources - Collects the sources when none are held yet; called once as the page opens.
//   - {Function} onReturn - Goes back to the projects page.
//   - {object} planningContext - Stored goals and prospects for the scope.
//   - {number} progressFraction - Elapsed fill of the running discovery pass.
//   - {object|null} projectSources - Summary from projectSourcesFromEvidence, or null before one is collected.
// @returns {JSX.Element} The page.
// Intents come from the stored goals rather than the collected sources, since they are known before discovery reads
//   anything and are the first thing the wait can show.
export default function ProjectSourcesPage({ isDiscovering, isLoadingSources, onLoadSources, onReturn, planningContext,
    progressFraction, projectSources }) {
  const intents = planningContext.goals;
  const sourceNotes = projectSources?.notes ?? [];
  const projectRows = sourceProjectRows(planningContext.prospects);
  const revealedIntentCount = useStaggeredReveal(intents.length, true, INTENT_REVEAL_MS);
  const hasRevealedIntents = revealedIntentCount >= intents.length;
  const revealedNoteCount = useStaggeredReveal(sourceNotes.length, hasRevealedIntents && Boolean(projectSources),
    NOTE_REVEAL_MS);
  const hasRevealedNotes = revealedNoteCount >= sourceNotes.length;
  const revealedProjectCount = useStaggeredReveal(projectRows.length, hasRevealedIntents && hasRevealedNotes,
    PROJECT_REVEAL_MS);
  const consideredCount = projectSources ? projectSources.consideredNoteCount + projectSources.consideredTaskCount : 0;

  useEffect(() => {
    onLoadSources();
  }, []);

  const visibleIntents = intents.slice(0, revealedIntentCount);
  const visibleNotes = sourceNotes.slice(0, revealedNoteCount);
  const visibleProjects = projectRows.slice(0, revealedProjectCount);

  return (
    <section aria-label="Project evidence sources" className="plan-step-container intent-reading-page project-sources-page">
      <header className="intent-reading-header">
        <h2 className="plan-heading intent-reading-title">Project evidence sources</h2>
        <button className="intent-reading-return" onClick={ onReturn } type="button">Return to projects</button>
      </header>
      { isDiscovering ? <IntentReadingProgressBar fraction={ progressFraction } /> : null }
      <p className="intent-reading-status" role="status">{ sourcesStatusText({ isDiscovering, isLoadingSources }) }</p>
      <p className="project-sources-considered">
        { projectSources ? (
          <>
            { isDiscovering ? "Considering " : "Considered " }<strong>{ countedNoun(projectSources.consideredTaskCount, "task") }</strong> from{ " " }
            <strong>{ countedNoun(projectSources.consideredNoteCount, "note") }</strong>
            { `, in service of ${ countedNoun(intents.length, "intent") }.` }
          </>
        ) : "Counting the notes and tasks Plan Builder will read…" }
      </p>
      { hasThinSources(projectSources) ? (
        <p className="project-sources-thin-warning" role="note">
          { `Plan Builder had only ${ consideredCount } ${ consideredCount === 1 ? "note or task" : "notes and tasks" } to `
            + "work from, so these projects "
            + "can't be very specific yet. Import your existing notes and tasks into Amplenote and it can suggest "
            + "projects drawn from your actual work." }
        </p>
      ) : null }
      <div className="intent-reading-columns">
        <section className="intent-reading-column">
          <h3 className="intent-reading-section-heading">
            Intents{ intents.length ? <span className="intent-reading-section-count">{ ` ${ intents.length }` }</span> : null }
          </h3>
          { visibleIntents.length ? (
            <ul className="intent-reading-read-list">
              { visibleIntents.map(goal => (
                <li className="intent-reading-read-item" key={ goal.uuid }>
                  <span className={ `project-sources-intent-dot project-sources-intent-dot--${ goal.userCategoryEm }` } />
                  <span className="intent-reading-read-label">{ goal.goalText }</span>
                </li>
              )) }
            </ul>
          ) : null }
          { intents.length ? null : <p className="intent-reading-placeholder">No intents are saved yet.</p> }
        </section>
        <section className="intent-reading-column">
          <h3 className="intent-reading-section-heading">
            Important notes
            { sourceNotes.length ? <span className="intent-reading-section-count">{ ` ${ sourceNotes.length }` }</span> : null }
            <span className="intent-reading-section-hint"> · most important and most finished work</span>
          </h3>
          { visibleNotes.length ? (
            <ul className="intent-reading-read-list">
              { visibleNotes.map(sourceNote => (
                <li className="intent-reading-read-item" key={ sourceNote.noteUuid }>
                  <ReadItemIcon kind="note" />
                  <span className="intent-reading-read-label">
                    { sourceNote.noteName || "Untitled note" }
                    <span className="project-sources-note-detail">{ ` ${ sourceNoteDetail(sourceNote) }` }</span>
                  </span>
                </li>
              )) }
            </ul>
          ) : null }
          { !visibleNotes.length && !(projectSources && sourceNotes.length) ? (
            <p className="intent-reading-placeholder">
              { projectSources ? "No note held important or recently finished tasks." : "Notes appear here as they are read." }
            </p>
          ) : null }
        </section>
      </div>
      <section className="intent-reading-directions">
        <h3 className="intent-reading-section-heading">
          Projects{ projectRows.length ? <span className="intent-reading-section-count">{ ` ${ projectRows.length }` }</span> : null }
          <span className="intent-reading-section-hint"> · with the tasks each would move forward; open one to see them</span>
        </h3>
        { visibleProjects.length ? (
          <ul className="intent-reading-direction-list">
            { visibleProjects.map(projectRow => <ProjectSourcesProject key={ projectRow.uuid } projectRow={ projectRow }
              projectSources={ projectSources } />) }
          </ul>
        ) : null }
        { isDiscovering ? (
          <p className="intent-reading-placeholder">
            { projectRows.length ? "Looking for more projects in these notes…" : "Projects appear here as Plan Builder finds them." }
          </p>
        ) : null }
        { !isDiscovering && !projectRows.length ? (
          <p className="intent-reading-placeholder">No projects yet. Return to projects to suggest some from your tasks.</p>
        ) : null }
      </section>
    </section>
  );
}
