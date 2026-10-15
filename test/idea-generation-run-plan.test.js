// Exercise what a "Generate ideas" run asks the work queue for: the projects in focus this month, the ones not yet
// saturated with well-rated ideas, and requests that run in the foreground even when the same work completed before.
import { activeMonthProjects, ideaGenerationRunRequests, ideaGenerationTargets, RUN_CATEGORY } from "dashboard/idea-generation-run-plan";
import { normalizedIdeaRecords } from "dashboard/project-idea-records";
import { ratedIdeaRecords } from "dashboard/project-task-idea-ratings";
import { DISCOVER_DICTIONARY_TERMS_JOB_TYPE, GENERATE_PROJECT_IDEAS_JOB_TYPE, RANK_PROJECT_TASKS_JOB_TYPE,
  RATE_PROJECT_IDEAS_JOB_TYPE } from "dashboard/work-queue/jobs/project-job-requests";

const NOW = new Date("2026-10-15T12:00:00");
const INPUT = { domainName: "Work", domainUuid: "domain-1", quarter: 4, year: 2026 };

// ----------------------------------------------------------------------------------------------
// @desc Idea records for a project, each rated as given.
// @param {string} projectUuid - The project.
// @param {number} count - How many ideas.
// @param {object|null} rating - { actionability, relevance }, or null to leave them unrated.
// @returns {Array<object>} Idea records.
function ideas(projectUuid, count, rating) {
  const texts = Array.from({ length: count }, (_, index) => `${ projectUuid } idea ${ index + 1 }`);
  const records = normalizedIdeaRecords(texts.map(taskText => ({ taskText })), { projectUuid });
  if (!rating) return records;
  const ratingsById = new Map(records.map(record => [record.ideaId, rating]));
  return ratedIdeaRecords(records, ratingsById, { ratedAt: NOW.toISOString(), ratedIdeas: records, raterEm: "jev" });
}

// ----------------------------------------------------------------------------------------------
// @desc A project as the plan reads it.
// @param {string} uuid - Its UUID.
// @param {object} [fields] - Overrides.
// @returns {object} The project.
function project(uuid, fields = {}) {
  return { focusMonths: [], refreshState: {}, relatedTaskRecords: [], suggestedTasks: [], summary: `Project ${ uuid }`, uuid, ...fields };
}

describe("idea generation run plan", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A project naming this month, or naming no month at all, is active; one naming only other months is not.
  it("takes the projects in focus this month", () => {
    const projects = [project("a", { focusMonths: ["2026-10"] }), project("b", { focusMonths: ["2026-11"] }), project("c")];
    const activeUuids = activeMonthProjects(projects, NOW).map(activeProject => activeProject.uuid);
    expect(activeUuids).toEqual(["a", "c"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A project the store holds a dozen well-rated ideas for is saturated; one with poorly rated ideas, or none
  //   stored at all, is a target.
  it("skips projects already saturated with well-rated ideas", () => {
    const activeProjects = [project("full"), project("weak"), project("new")];
    const storedProjects = [project("full", { suggestedTasks: ideas("full", 12, { actionability: 8, relevance: 8 }) }),
      project("weak", { suggestedTasks: ideas("weak", 12, { actionability: 4, relevance: 5 }) })];
    const targetUuids = ideaGenerationTargets(activeProjects, storedProjects).map(target => target.uuid);
    expect(targetUuids).toEqual(["weak", "new"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Every request runs in the foreground; rankings for every active project are held inside a discovery request
  //   whose revision names the run; ideas name the run so a completed pass runs again; and ratings are requested only
  //   for active projects the ideas step leaves alone that hold unrated ideas.
  it("builds forced foreground requests for each step", () => {
    const activeProjects = [project("full"), project("weak")];
    const storedProjects = [project("full", { suggestedTasks: [...ideas("full", 12, { actionability: 8, relevance: 8 }), ...ideas("extra", 1, null)] }),
      project("weak", { suggestedTasks: ideas("weak", 2, null) })];
    const termRequests = [{ category: RUN_CATEGORY, key: "collectTermEvidence:2026:roadmap", type: "collectTermEvidence" }];
    const requests = ideaGenerationRunRequests({ activeProjects, input: INPUT, now: NOW, runId: "run-1", scorerEm: "jev", storedProjects,
      targets: [activeProjects[1]], termRequests });

    const [discovery, ...refineRest] = requests.refine;
    expect(discovery).toMatchObject({ category: RUN_CATEGORY, desiredRevision: "run:run-1", type: DISCOVER_DICTIONARY_TERMS_JOB_TYPE });
    expect(discovery.input.heldRequests.map(request => [request.type, request.entityId, request.category, request.desiredRevision]))
      .toEqual([[RANK_PROJECT_TASKS_JOB_TYPE, "full", RUN_CATEGORY, null], [RANK_PROJECT_TASKS_JOB_TYPE, "weak", RUN_CATEGORY, null]]);
    expect(refineRest).toEqual(termRequests);
    expect(requests.ideas.map(request => [request.type, request.entityId, request.category, request.desiredRevision]))
      .toEqual([[GENERATE_PROJECT_IDEAS_JOB_TYPE, "weak", RUN_CATEGORY, "run:run-1"]]);
    expect(requests.rate.map(request => [request.type, request.entityId, request.category]))
      .toEqual([[RATE_PROJECT_IDEAS_JOB_TYPE, "full", RUN_CATEGORY]]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Without a rater, no ratings are requested.
  it("requests no ratings when nothing can rate", () => {
    const activeProjects = [project("full")];
    const storedProjects = [project("full", { suggestedTasks: ideas("full", 2, null) })];
    const requests = ideaGenerationRunRequests({ activeProjects, input: INPUT, now: NOW, runId: "run-2", scorerEm: null, storedProjects,
      targets: [], termRequests: [] });
    expect(requests.rate).toEqual([]);
    expect(requests.ideas).toEqual([]);
  });
});
