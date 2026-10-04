// Read a quarter's projects from the project task store and the live plan, and write a pass's result into one
// project's store section. Every project handed out is the caller's own instance, sharing no collection with another
// caller's. A result is applied to the project as the store holds it at the moment of writing, not to the copy the
// pass began with, so two passes changing different fields of one project both keep their changes.
import { quarterlyProgressProjects } from "project-progress-model";
import { openProjectTaskStore, projectTaskStoreNoteName, readCollectedProjectTasks, storedProjectRecords,
  writeProjectSection } from "project-task-store";
import QuarterProject from "quarter-project";
import DashboardNoteWriter from "dashboard/work-queue/dashboard-note-writer";

// ----------------------------------------------------------------------------------------------
// @desc Reads QuarterProjects and commits results to the project task store through one serialized note writer.
export default class QuarterProjectRepository {
  app; // {object} Host-compatible Amplenote API.
  noteWriter; // {DashboardNoteWriter} Serializes each store note's read-then-write updates.

  // ----------------------------------------------------------------------------------------------
  // @desc Construct a repository over an app interface, sharing that interface's note writer unless given another.
  // @param {object} options - { app, noteWriter }.
  constructor({ app, noteWriter = DashboardNoteWriter.forApp(app) }) {
    Object.assign(this, { app, noteWriter });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Apply one pass's result to a project and write its store section. Once the store note's earlier updates
  //   finish, the project is read fresh from the store and `apply` changes it through its setters, so fields the pass
  //   does not set keep whatever another pass wrote in the meantime. A pass that derived the project from the live plan
  //   passes it as sourceProject: its plan-owned fields and identity are written, with the store-owned fields taken
  //   from the fresh read. Without one, a project the store does not hold yet starts from its summary and UUID. The
  //   written project's output revision advances only when the result changed something its readers consume.
  // @param {object} scope - Resolved plan scope.
  // @param {object} options - An object with the following properties:
  //   - {function} apply - Receives the project to write and changes it through its setters; setActive(false) moves
  //     its section beneath "Past projects", and a project new to the store starts active
  //   - {string} [projectUuid] - Project to write; defaults to sourceProject's UUID
  //   - {QuarterProject|null} [sourceProject=null] - Project whose plan-owned fields are authoritative
  //   - {string} [summary] - Summary for a project new to the store; defaults to sourceProject's
  // @returns {Promise<QuarterProject>} A detached copy of the project as written.
  async applyResult(scope, { apply, projectUuid = null, sourceProject = null, summary = null }) {
    const uuid = projectUuid || sourceProject?.uuid;
    if (!uuid) throw new Error("A project result needs the project's uuid");
    return this.noteWriter.update(projectTaskStoreNoteName(scope), async () => {
      const store = await openProjectTaskStore(this.app, scope);
      const stored = storedProjectRecords(store.content).recordsByUuid.get(uuid) || null;
      const previous = stored ? stored.detachedCopy() : null;
      const project = _writeTarget({ sourceProject, stored, summary: summary || sourceProject?.summary, uuid });
      apply(project);
      project.advanceProjectRevision(previous);
      await writeProjectSection(this.app, { content: store.content, noteHandle: store.noteHandle, project });
      return project.detachedCopy();
    });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Record the user's decisions on generated ideas they were shown, each on the project holding the idea. A
  //   decision naming a project the store does not hold is skipped, since there is no idea there to decide.
  // @param {object} scope - Resolved plan scope.
  // @param {object} options - { decidedAt, decisions }: decisions are { acceptedTaskUuid, ideaId, projectUuid, status },
  //   as QuarterProject#decideIdeas takes them.
  // @returns {Promise<number>} How many ideas changed.
  async decideIdeas(scope, { decidedAt, decisions }) {
    const storedUuids = new Set((await this.readStored(scope, { includeInactive: true })).map(project => project.uuid));
    const decisionsByProject = new Map();
    for (const decision of decisions || []) {
      if (!decision?.ideaId || !storedUuids.has(decision.projectUuid)) continue;
      decisionsByProject.set(decision.projectUuid, [...(decisionsByProject.get(decision.projectUuid) || []), decision]);
    }
    let changedCount = 0;
    for (const [projectUuid, projectDecisions] of decisionsByProject) {
      await this.applyResult(scope, { apply: project => { changedCount += project.decideIdeas(projectDecisions, decidedAt); },
        projectUuid });
    }
    return changedCount;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Read the quarter's live projects, from the Vision Guide and the quarterly plan note, joined to what the store
  //   holds for each. The live projects and the stored ones share no collections, so either can be changed freely.
  // @param {object} scope - Resolved plan scope.
  // @param {object} [options] - { guide = null, includeInactive = false, quarterlyContent = "" }. includeInactive also
  //   returns the store's Past projects among storedProjects.
  // @returns {Promise<object>} { projects, storedProjects }: live QuarterProjects, and the store's own QuarterProjects.
  async readMany(scope, { guide = null, includeInactive = false, quarterlyContent = "" } = {}) {
    const storedProjects = await this.readStored(scope, { includeInactive });
    const previousProjects = storedProjects.map(project => project.detachedCopy());
    const projects = quarterlyProgressProjects({ guide, previousProjects, quarterlyContent, scope });
    return { projects, storedProjects };
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Read one project as the store holds it, whether active or past.
  // @param {object} scope - Resolved plan scope.
  // @param {string} projectUuid - Project to read.
  // @returns {Promise<QuarterProject|null>} The stored project, or null when the store does not hold it.
  async readOne(scope, projectUuid) {
    const storedProjects = await this.readStored(scope, { includeInactive: true });
    return storedProjects.find(project => project.uuid === projectUuid) || null;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Read the projects the store holds, without creating the store. The notes list is brought up to date first,
  //   so a pass about to spend provider requests starts from the store as other devices left it. Each call parses the
  //   note afresh, so every caller receives its own instances.
  // @param {object} scope - Resolved plan scope.
  // @param {object} [options] - { includeInactive = false }: true also returns Past projects, each with isActive false.
  // @returns {Promise<Array<QuarterProject>>} Stored projects, empty when the store does not exist yet.
  async readStored(scope, { includeInactive = false } = {}) {
    await this.noteWriter.refreshNotesList();
    return readCollectedProjectTasks(this.app, scope, { includeInactive });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Append each shown task UUID and idea ID to its project's suggestion log. A project the store does not hold
  //   yet is created from the suggestion's summary, so the log has a section to live in.
  // @param {object} scope - Resolved plan scope.
  // @param {object} options - { shownAt, suggestions } where suggestions are { ideaId?, projectUuid, summary,
  //   taskUuid? }, an idea not yet a task naming its ideaId.
  // @returns {Promise<void>}
  async recordShownTasks(scope, { shownAt, suggestions }) {
    const stampedAt = shownAt || new Date().toISOString();
    const shownByProject = _shownTasksByProject(suggestions);
    for (const [projectUuid, shown] of shownByProject) {
      await this.applyResult(scope, { apply: project => project.recordShownTasks(shown.taskUuids, stampedAt,
        { ideaIds: shown.ideaIds }), projectUuid, summary: shown.summary });
    }
  }
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Group shown suggestions by project, keeping the latest summary given for each.
// @param {Array<object>} suggestions - { ideaId?, projectUuid, summary, taskUuid? }; entries missing a project, or
//   naming neither a task nor an idea, are skipped. A suggestion naming a task is logged as that task.
// @returns {Map<string, object>} { ideaIds, summary, taskUuids } keyed by project UUID.
function _shownTasksByProject(suggestions) {
  const shownByProject = new Map();
  for (const suggestion of suggestions || []) {
    if (!suggestion?.projectUuid || !(suggestion.taskUuid || suggestion.ideaId)) continue;
    const current = shownByProject.get(suggestion.projectUuid) || { ideaIds: [], summary: suggestion.summary, taskUuids: [] };
    if (suggestion.taskUuid) current.taskUuids.push(suggestion.taskUuid);
    else current.ideaIds.push(suggestion.ideaId);
    if (suggestion.summary) current.summary = suggestion.summary;
    shownByProject.set(suggestion.projectUuid, current);
  }
  return shownByProject;
}

// ----------------------------------------------------------------------------------------------
// @desc Choose the project a result is applied to: a copy of the source project carrying the store's fields when one
//   was given, else the freshly read stored project, else a new project with only its identity.
// @param {object} options - { sourceProject, stored, summary, uuid }.
// @returns {QuarterProject} A project no other caller holds.
function _writeTarget({ sourceProject, stored, summary, uuid }) {
  if (sourceProject) {
    const project = sourceProject.detachedCopy();
    if (stored) project.adoptStoreFields(stored);
    return project;
  }
  return stored || new QuarterProject({ summary: summary || "Untitled project", uuid });
}
