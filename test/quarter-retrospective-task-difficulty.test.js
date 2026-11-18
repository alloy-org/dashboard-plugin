// Verify the Quarter Retrospective's task difficulty ranking: which projects are rated, batches asked per project,
// recorded ratings reused, a failed batch tolerated, each project's three hardest tasks above the shown difficulty,
// the "Aw no you di'nt" slide and where it is placed, a generation that records and reuses the ratings, and the slide
// drawn.
import { jest } from "@jest/globals";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { retrospectiveSectionsFromContent } from "dashboard/quarter-retrospective/retrospective-data-note";
import { generateRetrospective } from "dashboard/quarter-retrospective/retrospective-generation";
import { DIFFICULTY_CRITERIA, difficultyQuestions, difficultyRatedProjects, difficultyState, HARDEST_TASKS_SLIDE_ID, hardestTaskProjects,
  hardestTasksSlide, rateTaskDifficulties, recordedTaskDifficulties, slidesWithHardestTasks,
  taskDifficultyPayload } from "dashboard/quarter-retrospective/retrospective-task-difficulty";
import { DecisionsEndpoint } from "providers/decisions-endpoint";
import { maintenanceApp } from "./project-maintenance-test-app";

const { default: RetrospectiveSlide } = await import("dashboard/quarter-retrospective/retrospective-slide");

// ----------------------------------------------------------------------------------------------
// @desc Completions credited to one project.
// @param {string} projectName - The project's name; its UUID is derived from it.
// @param {number} count - How many completions.
// @returns {Array<object>} Completions as { projectName, projectUuid, taskUuid, text, victoryValue }.
function projectCompletions(projectName, count) {
  return Array.from({ length: count }, (unused, index) => ({ projectName, projectUuid: `project-${ projectName }`,
    taskUuid: `${ projectName }-${ index + 1 }`, text: `${ projectName } task ${ index + 1 }`, victoryValue: index }));
}

// ----------------------------------------------------------------------------------------------
// @desc An endpoint that rates each task of a batch by the difficulty its text maps to, recording each request.
// @param {object} difficultyByText - 1–10 rating by task text; a task not listed gets 2.
// @returns {object} { endpoint, requests }.
function ratingEndpoint(difficultyByText) {
  const requests = [];
  const endpoint = DecisionsEndpoint.fromRequester(async ({ questions, state }) => {
    requests.push({ questions, state });
    const answers = Object.fromEntries(state.completedTasks.map(task => [`difficulty_${ task.number }`,
      { score: (difficultyByText[task.task] || 2) - 1, type: "score" }]));
    return { answers };
  });
  return { endpoint, requests };
}

describe("task difficulty ratings", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Only projects with at least five completions are rated, and tasks in no project never are.
  it("rates projects with at least five completed tasks", () => {
    const completions = [...projectCompletions("Launch", 5), ...projectCompletions("Garden", 4), { taskUuid: "loose", text: "Loose" }];
    expect(difficultyRatedProjects(completions).map(project => project.name)).toEqual(["Launch"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Each task is asked one ten-level score question, numbered as the state lists it.
  it("asks one score question per task about the project's numbered tasks", () => {
    const completions = [{ footnoteText: "Booked the venue", noteName: "Conference", text: "Plan the keynote" }, { text: "Email Sam" }];
    const questions = difficultyQuestions(completions);
    expect(Object.keys(questions)).toEqual(["difficulty_1", "difficulty_2"]);
    expect(questions.difficulty_1).toMatchObject({ criteria: [...DIFFICULTY_CRITERIA], type: "score" });
    expect(questions.difficulty_1.instructions).toContain("10+ hours of work, impeccable consistency");
    expect(questions.difficulty_2.instructions).toContain('task 2, "Email Sam"');
    expect(difficultyState({ completions, projectName: "Conference" })).toEqual({ completedTasks: [{ details: "Booked the venue",
      note: "Conference", number: 1, task: "Plan the keynote" }, { number: 2, task: "Email Sam" }], project: "Conference" });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A project's tasks are asked in batches of twenty, a recorded rating is kept rather than asked again, and a
  //   batch whose request fails leaves only its own tasks unrated.
  it("batches by project, reuses recorded ratings, and tolerates a failed batch", async () => {
    const completions = [...projectCompletions("Launch", 22), ...projectCompletions("Garden", 5)];
    const { endpoint, requests } = ratingEndpoint({ "Launch task 22": 9 });
    const recordedDifficulties = new Map([["Launch-1", 7]]);
    const difficulties = await rateTaskDifficulties(completions, { endpoint, recordedDifficulties });
    expect(requests.map(request => [request.state.project, request.state.completedTasks.length])).toEqual([["Launch", 20], ["Launch", 1],
      ["Garden", 5]]);
    expect(difficulties.get("Launch-1")).toBe(7);
    expect(difficulties.get("Launch-22")).toBe(9);
    expect(difficulties.size).toBe(27);

    const failingEndpoint = DecisionsEndpoint.fromRequester(async ({ state }) => {
      if (state.project === "Launch") throw new Error("Jev is down");
      return { answers: { difficulty_1: { score: 5, type: "score" } } };
    });
    const partial = await rateTaskDifficulties(completions, { endpoint: failingEndpoint });
    expect([...partial.entries()]).toEqual([["Garden-1", 6]]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A project shows its three hardest tasks rated above 5, hardest first; one with none above 5 is left out, and
  //   projects are ordered by their hardest task.
  it("lists each project's three hardest tasks above 5", () => {
    const completions = [...projectCompletions("Launch", 6), ...projectCompletions("Garden", 5), ...projectCompletions("Chores", 5)];
    const difficulties = new Map([["Launch-1", 6], ["Launch-2", 8], ["Launch-3", 5], ["Launch-4", 7], ["Launch-5", 9], ["Launch-6", 6],
      ["Garden-1", 10], ["Chores-1", 5], ["Chores-2", 3]]);
    expect(hardestTaskProjects(completions, difficulties)).toEqual([
      { name: "Garden", taskCount: 5, tasks: [{ difficulty: 10, text: "Garden task 1" }] },
      { name: "Launch", taskCount: 6, tasks: [{ difficulty: 9, text: "Launch task 5" }, { difficulty: 8, text: "Launch task 2" },
        { difficulty: 7, text: "Launch task 4" }] }]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The slide sits before the summary, holds longer for more projects, and is left out when no project qualifies.
  it("builds the slide and places it before the summary", () => {
    expect(hardestTasksSlide([])).toBeNull();
    const projects = [{ name: "Launch", taskCount: 6, tasks: [{ difficulty: 9, text: "Ship" }] }, { name: "Garden", taskCount: 5, tasks: [] }];
    const slide = hardestTasksSlide(projects);
    expect(slide).toMatchObject({ hardestProjects: projects, headline: "Aw no you di'nt", id: HARDEST_TASKS_SLIDE_ID, kind: "hardest-tasks",
      subheadline: "Which tasks impressed our 'task difficulty' ranker most?" });
    expect(slide.durationFactor).toBeCloseTo(1.35);
    const placed = slidesWithHardestTasks([{ id: "intro" }, { id: "summary" }], slide);
    expect(placed.map(placedSlide => placedSlide.id)).toEqual(["intro", HARDEST_TASKS_SLIDE_ID, "summary"]);
    expect(slidesWithHardestTasks([{ id: "intro" }], null)).toEqual([{ id: "intro" }]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Recorded ratings read back by task, the newest note's rating winning.
  it("records ratings and reads them back newest first", () => {
    const completions = projectCompletions("Launch", 2);
    const payload = taskDifficultyPayload(completions, new Map([["Launch-1", 8]]));
    expect(payload).toEqual({ ratings: [{ difficulty: 8, taskUuid: "Launch-1", text: "Launch task 1" }] });
    expect(taskDifficultyPayload(completions, new Map())).toBeNull();
    const older = { payloads: new Map([["Task Difficulty", { ratings: [{ difficulty: 3, taskUuid: "Launch-1" }, { difficulty: 6, taskUuid: "Launch-2" }] }]]) };
    const newer = { payloads: new Map([["Task Difficulty", payload]]) };
    expect([...recordedTaskDifficulties([newer, older]).entries()]).toEqual([["Launch-1", 8], ["Launch-2", 6]]);
  });
});

describe("generation with task difficulty", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A generation rates an inferred project's tasks, shows the slide, and records the ratings; another style
  //   reuses them without asking again.
  it("adds the slide, records the ratings, and reuses them", async () => {
    const app = maintenanceApp({ tasks: [] });
    const completedAt = day => Math.floor(new Date(2026, 6, day, 12).getTime() / 1000);
    const tasks = [1, 2, 3, 4, 5, 6].map(day => ({ completedAt: completedAt(day), content: `Chapter ${ day }`, uuid: `task-${ day }`, victoryValue: 2 }));
    app.getCompletedTasks = jest.fn(async () => tasks);
    const requestPrompt = async prompt => {
      if (prompt.includes("Merge them into")) return { projects: [{ name: "Write the book", themeIds: ["th1"] }] };
      if (!prompt.startsWith("Summarize July")) return null;
      const taskIds = tasks.map((task, index) => `t${ index + 1 }`);
      return { highlights: [{ summary: "Drafted", taskIds }], themes: [{ name: "Drafting", taskIds }] };
    };
    const { endpoint, requests } = ratingEndpoint({ "Chapter 3": 8, "Chapter 5": 6 });
    const decisionsEndpointFactory = jest.fn(async () => endpoint);
    const request = { domainName: "Work", domainUuid: "work-domain", options: {}, quarter: 3, year: 2026 };
    const generated = await generateRetrospective(app, { ...request, style: "data" }, { decisionsEndpointFactory, requestPrompt });
    const slideIds = generated.slides.map(slide => slide.id);
    expect(slideIds.indexOf(HARDEST_TASKS_SLIDE_ID)).toBe(slideIds.indexOf("summary") - 1);
    const slide = generated.slides.find(generatedSlide => generatedSlide.id === HARDEST_TASKS_SLIDE_ID);
    expect(slide.hardestProjects).toEqual([{ name: "Write the book", taskCount: 6, tasks: [{ difficulty: 8, text: "Chapter 3" },
      { difficulty: 6, text: "Chapter 5" }] }]);
    const { payloads } = retrospectiveSectionsFromContent(app.noteContent("Work Q3 2026 Data Retrospective Data"));
    expect(payloads.get("Task Difficulty").ratings).toHaveLength(6);

    const spotify = await generateRetrospective(app, { ...request, style: "spotify" }, { decisionsEndpointFactory, requestPrompt });
    expect(requests).toHaveLength(1);
    expect(spotify.slides.some(spotifySlide => spotifySlide.id === HARDEST_TASKS_SLIDE_ID)).toBe(true);
  });
});

describe("hardest tasks slide", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc The slide shows its subtitle and each project's tasks with their difficulty.
  it("draws each project's hardest tasks", async () => {
    const mountPoint = document.createElement("div");
    document.body.appendChild(mountPoint);
    const root = createRoot(mountPoint);
    const slide = hardestTasksSlide([{ name: "Launch", taskCount: 6, tasks: [{ difficulty: 9, text: "Ship the beta" }] }]);
    await act(async () => { root.render(createElement(RetrospectiveSlide, { slide })); });
    expect(mountPoint.querySelector(".retrospective-slide-subheadline").textContent).toBe("Which tasks impressed our 'task difficulty' ranker most?");
    expect(mountPoint.querySelector(".retrospective-slide-hardest-project-name").textContent).toBe("Launch");
    expect(mountPoint.querySelector(".retrospective-slide-hardest-task").textContent).toBe("Ship the beta9/10");
    await act(async () => { root.unmount(); });
    mountPoint.remove();
  });
});
