// The in-memory notebook and fixtures the project maintenance tests share: a quarterly plan with one project, a
// backlog of tasks a rater finds similar or not, a Jev stand-in, and a job context like the one a work runtime gives.
import { jest } from "@jest/globals";
import QuarterProjectRepository from "dashboard/quarter-project-repository";
import { createAppDispatch } from "dashboard/work-queue/dashboard-app-dispatch";
import { createProviderDispatch } from "dashboard/work-queue/dashboard-provider-dispatch";
import DashboardResourceBudget from "dashboard/work-queue/dashboard-resource-budget";
import { guideHeadingRanges } from "plan-wizard/vision-guide-markdown";
import { quarterlyPlanNoteName } from "util/quarterly-plan-notes";

export const NOW = new Date("2026-09-19T12:00:00.000Z");
export const PROJECT_UUID = "project-uuid";
export const QUARTERLY_CONTENT = "# Projects\n\n## Launch dashboard\n- Weekly rhythm: Two focused blocks per week\n"
  + "- Outcome: Ship the date picker\n";
export const SCOPE_INPUT = { domainName: "Work", domainUuid: "work-domain", quarter: 3, year: 2026 };
export const DISCOVERED_TERMS = { terms: [{ definition: "The plugin's home screen of widgets and agendas.", term: "dashboard" }] };
export const GENERATED_IDEA = { beforeTask: null, generatedAt: "2026-09-19T11:00:00.000Z", taskText: "Audit widget memory before ship" };

// ----------------------------------------------------------------------------------------------
// @desc The tasks every scenario reads: the project's own open and completed tasks, and a backlog of errands with a
//   few widget tasks a rater finds similar and a few chart tasks it rates low, spread across both rounds of batches.
// @returns {Array<object>} Tasks.
export function backlogTasks() {
  const errands = Array.from({ length: 120 }, (unused, index) => {
    const content = index % 30 === 7 ? `Tune widget layout ${ index }` : index % 40 === 3 ? `Sketch chart idea ${ index }`
      : `Errand ${ index }`;
    return { content, createdAt: "2026-09-01T00:00:00.000Z", noteUUID: "task-note", updatedAt: 1000 - index, uuid: `errand-${ index }` };
  });
  return [{ content: "Launch dashboard date picker", createdAt: "2026-09-01T00:00:00.000Z", noteUUID: "task-note",
    updatedAt: 2000, uuid: "open-task" },
  { completedAt: 1789552800, content: "Launch dashboard polish", noteUUID: "task-note", uuid: "finished-task" }, ...errands];
}

// ----------------------------------------------------------------------------------------------
// @desc An in-memory Amplenote app holding the quarterly plan note, with notes found by name, tag, or UUID, and whole
//   or section-scoped writes located the way the store's own heading parser locates them.
// @param {object} options - { tasks }.
// @returns {object} App mock carrying `noteContent(name)` for assertions.
export function maintenanceApp({ tasks }) {
  const notes = new Map();
  let sequence = 0;
  const createNote = (name, tags = []) => {
    sequence += 1;
    notes.set(`note-${ sequence }`, { content: "", name, tags });
    return `note-${ sequence }`;
  };
  const planUuid = createNote(quarterlyPlanNoteName("Work", "Q3 2026"));
  notes.get(planUuid).content = QUARTERLY_CONTENT;
  const entryNamed = name => [...notes.entries()].find(([, note]) => note.name === name) || null;
  return {
    createNote: async (name, tags) => createNote(name, tags),
    filterNotes: async ({ query, tag } = {}) => {
      const matching = [...notes.entries()].filter(([, note]) => (!query || note.name.includes(query))
        && (!tag || note.tags.includes(tag)));
      return matching.map(([uuid, note]) => ({ name: note.name, uuid }));
    },
    findNote: async ({ name, uuid }) => {
      if (uuid) return notes.has(uuid) ? { name: notes.get(uuid).name, uuid } : null;
      const entry = entryNamed(name);
      return entry ? { name, uuid: entry[0] } : null;
    },
    getNoteContent: async ({ uuid }) => notes.get(uuid)?.content ?? "",
    getTaskDomainTasks: jest.fn(async () => tasks.map(task => ({ ...task }))),
    noteContent: name => entryNamed(name)?.[1].content ?? null,
    replaceNoteContent: async ({ uuid }, body, options) => {
      const note = notes.get(uuid);
      if (!options?.section) {
        note.content = body;
        return true;
      }
      const { heading } = options.section;
      const range = guideHeadingRanges(note.content).find(candidate => candidate.text === heading.text
        && candidate.level === heading.level);
      if (!range) throw new Error(`Section not found: ${ heading.text }`);
      note.content = `${ note.content.slice(0, range.bodyStart) }${ body }${ note.content.slice(range.end) }`;
      return true;
    },
    setSetting: async () => true,
  };
}

// ----------------------------------------------------------------------------------------------
// @desc A Jev stand-in rating widget tasks 9, chart tasks 4, and everything else 1.
// @param {object} [options] - { failingText }: a batch holding a task with this text is rejected.
// @returns {function} A requestAnswers mock.
export function ratingRequest({ failingText = null } = {}) {
  return jest.fn(async ({ questions, state }) => {
    const texts = Object.keys(questions).map(questionName => state.prospectiveTasks[questionName].text);
    if (failingText && texts.includes(failingText)) throw new Error("Jev rejected the batch");
    const answerEntries = Object.keys(questions).map((questionName, index) => {
      const score = texts[index].includes("widget") ? 8 : texts[index].includes("chart") ? 3 : 0;
      return [questionName, { confidence: 0.5, score, type: "score" }];
    });
    return { answers: Object.fromEntries(answerEntries) };
  });
}

// ----------------------------------------------------------------------------------------------
// @desc A job context over the app with its own resource budget, as a work runtime gives a running job.
// @param {object} app - From maintenanceApp.
// @returns {object} { app, appDispatch, clock, providerDispatch }.
export function jobContext(app) {
  const budget = new DashboardResourceBudget();
  return { app, appDispatch: createAppDispatch({ app, budget }), clock: () => NOW.getTime(),
    providerDispatch: createProviderDispatch({ budget }) };
}

// ----------------------------------------------------------------------------------------------
// @desc Store the plan's project under a fixed UUID, as reconciliation does before any job names a project, so the live
//   plan gives it that UUID rather than a fresh one on each read.
// @param {object} app - From maintenanceApp.
// @returns {Promise<string>} The project's UUID.
export async function storedProjectUuid(app) {
  const scope = { ...SCOPE_INPUT, quarterKey: "2026-Q3" };
  await new QuarterProjectRepository({ app }).applyResult(scope, { apply: () => {}, projectUuid: PROJECT_UUID,
    summary: "Launch dashboard" });
  return PROJECT_UUID;
}
