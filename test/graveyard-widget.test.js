/**
 * [OpenAI gpt-5.4-authored file]
 * Prompt summary: "add focused tests for graveyard hover tooltip and 1-column date label behavior"
 */
import { jest } from "@jest/globals";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

const CREATED_AT_SECONDS = Math.floor(new Date("2024-05-20T12:00:00Z").getTime() / 1000);
const TOOLTIP_DELAY_MS = 500;

await jest.unstable_mockModule("dashboard/dashboard-tooltip-tippy", async () => {
  const React = await import("react");
  const { createElement, useEffect, useRef } = React;

  function setTooltipContent(container, content) {
    container.innerHTML = typeof content === "string" ? content : (content == null ? "" : String(content));
  }

  function DashboardTippyMock({ children, content, delay, onShown }) {
    const timerRef = useRef(null);
    const tooltipRef = useRef(null);

    useEffect(() => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      tooltipRef.current?.remove();
      tooltipRef.current = null;
    }, []);

    const clearTooltip = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      tooltipRef.current?.remove();
      tooltipRef.current = null;
    };

    const showTooltip = () => {
      clearTooltip();
      tooltipRef.current = document.createElement("div");
      setTooltipContent(tooltipRef.current, content);
      document.body.appendChild(tooltipRef.current);
      onShown?.({ popper: tooltipRef.current });
    };

    const showDelay = Array.isArray(delay) ? Number(delay[0]) || 0 : Number(delay) || 0;

    return createElement("span", {
      onBlur: clearTooltip,
      onFocus: () => {
        if (showDelay > 0) {
          timerRef.current = setTimeout(showTooltip, showDelay);
        } else {
          showTooltip();
        }
      },
      onMouseLeave: clearTooltip,
      onMouseOver: () => {
        if (showDelay > 0) {
          timerRef.current = setTimeout(showTooltip, showDelay);
        } else {
          showTooltip();
        }
      },
      style: { display: "inline" },
    }, children);
  }

  return { default: DashboardTippyMock };
});

const { default: GraveyardWidget } = await import("../lib/dashboard/graveyard.js");

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${ year }-${ month }-${ day }`;
}

// [OpenAI gpt-5.4] Task: build a cached graveyard app stub for tooltip and date-label component tests
// Prompt: "When hovering on task text for 500ms, pop a styled tooltip..."
function buildMockApp(taskOverrides = {}) {
  const baseTask = {
    content: "**Finish** the proposal",
    createdAt: CREATED_AT_SECONDS,
    noteName: "Product Roadmap",
    noteUUID: "note-1",
    uuid: "task-1",
    victoryValue: 11,
  };
  const tasks = Array.isArray(taskOverrides)
    ? taskOverrides.map((task, index) => ({ ...baseTask, uuid: `task-${ index + 1 }`, ...task }))
    : [{ ...baseTask, ...taskOverrides }];
  const todayKey = localDateKey(new Date());
  const graveyardNoteContent = [
    "# Graveyard task candidates",
    "",
    "| Date | Task UUIDs |",
    "|------|------------|",
    `| ${ todayKey } | ${ tasks.map(task => task.uuid).join(",") } |`,
    "",
  ].join("\n");

  return {
    appendNoteContent: jest.fn().mockResolvedValue(undefined),
    createNote: jest.fn().mockResolvedValue("graveyard-note"),
    filterNotes: jest.fn().mockResolvedValue([]),
    findNote: jest.fn().mockImplementation(({ name, uuid }) => {
      const matchingTask = tasks.find(task => task.noteUUID === uuid);
      if (matchingTask) return Promise.resolve({ name: matchingTask.noteName, uuid: matchingTask.noteUUID });
      if (name) return Promise.resolve({ name, uuid: "graveyard-note" });
      return Promise.resolve(null);
    }),
    getNoteContent: jest.fn().mockResolvedValue(graveyardNoteContent),
    getTaskDomainTasks: jest.fn().mockResolvedValue(tasks),
    navigate: jest.fn().mockResolvedValue(undefined),
    replaceNoteContent: jest.fn().mockResolvedValue(undefined),
    updateTask: jest.fn().mockResolvedValue(undefined),
  };
}

// [OpenAI gpt-5.4] Task: render graveyard widget into jsdom for focused interaction tests
// Prompt: "add focused tests for graveyard hover tooltip and 1-column date label behavior"
async function renderGraveyardWidget(props = {}, taskOverrides = {}) {
  const app = buildMockApp(taskOverrides);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(GraveyardWidget, {
      app,
      gridHeightSize: 1,
      gridWidthSize: 2,
      taskDomainUUID: "domain-1",
      ...props,
    }));
  });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  return {
    app,
    cleanup: async () => {
      await act(async () => { root.unmount(); });
      container.remove();
    },
    container,
  };
}

// [OpenAI gpt-5.4] Generated tests for: graveyard delayed hover tooltip and compact date labels
describe("GraveyardWidget", () => {
  afterEach(() => {
    jest.useRealTimers();
    document.body.innerHTML = "";
  });

  it("shows the markdown tooltip only after 500ms hover and includes note, created date, and score", async () => {
    jest.useFakeTimers();
    const { cleanup, container } = await renderGraveyardWidget();

    const title = container.querySelector(".graveyard-task-title");
    expect(title).not.toBeNull();
    expect(document.body.querySelector(".graveyard-task-tooltip")).toBeNull();

    await act(async () => {
      title.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    await act(async () => {
      jest.advanceTimersByTime(TOOLTIP_DELAY_MS - 1);
    });
    expect(document.body.querySelector(".graveyard-task-tooltip")).toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(1);
    });

    const tooltip = document.body.querySelector(".graveyard-task-tooltip");
    expect(tooltip).not.toBeNull();
    expect(tooltip.textContent).toContain("Product Roadmap");
    expect(tooltip.textContent).toContain("Created");
    expect(tooltip.textContent).toContain(
      new Date(CREATED_AT_SECONDS * 1000).toLocaleDateString(undefined, { dateStyle: "medium" })
    );
    expect(tooltip.textContent).toContain("Score 11");
    expect(tooltip.querySelector(".graveyard-task-score--hot")).not.toBeNull();
    expect(tooltip.querySelector("strong")?.textContent).toBe("Finish");

    await cleanup();
  });

  it("omits the Created prefix from the row stamp when the widget is 1 column wide", async () => {
    const compact = await renderGraveyardWidget({ gridWidthSize: 1 });
    const compactAge = compact.container.querySelector(".graveyard-task-age");
    expect(compactAge).not.toBeNull();
    expect(compactAge.textContent).toBe(
      new Date(CREATED_AT_SECONDS * 1000).toLocaleDateString(undefined, { month: "short", year: "numeric" })
    );
    expect(compactAge.textContent).not.toContain("Created");
    await compact.cleanup();

    const regular = await renderGraveyardWidget({ gridWidthSize: 2 });
    const regularAge = regular.container.querySelector(".graveyard-task-age");
    expect(regularAge).not.toBeNull();
    expect(regularAge.textContent).toContain("Created");
    await regular.cleanup();
  });

  it("renders Keep and navigates to the task note from the Note action", async () => {
    const { app, cleanup, container } = await renderGraveyardWidget();

    const keepAction = Array.from(container.querySelectorAll(".graveyard-task-action"))
      .find((element) => element.textContent.includes("Keep"));
    const noteAction = Array.from(container.querySelectorAll(".graveyard-task-action"))
      .find((element) => element.textContent.includes("Note"));

    expect(keepAction).not.toBeNull();
    expect(keepAction.textContent).toBe("🧲 Keep");
    expect(noteAction).not.toBeNull();
    expect(noteAction.textContent).toBe("📓 Note");

    await act(async () => {
      noteAction.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(app.navigate).toHaveBeenCalledWith("https://www.amplenote.com/notes/note-1");
    await cleanup();
  });

  it("keeps dismiss prompts and subtitle stable across rerenders within the same hour", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-05-10T08:00:00"));
    const taskOverrides = [
      { content: "First task", noteUUID: "note-1", uuid: "task-1" },
      { content: "Second task", noteUUID: "note-2", uuid: "task-2" },
    ];
    const firstRender = await renderGraveyardWidget({}, taskOverrides);
    const firstSubtitle = firstRender.container.querySelector(".widget-title__subtitle")?.textContent;
    const firstSendLabels = Array.from(firstRender.container.querySelectorAll(".graveyard-task-action--send"))
      .map(element => element.textContent);
    await firstRender.cleanup();

    const secondRender = await renderGraveyardWidget({}, taskOverrides);
    const secondSubtitle = secondRender.container.querySelector(".widget-title__subtitle")?.textContent;
    const secondSendLabels = Array.from(secondRender.container.querySelectorAll(".graveyard-task-action--send"))
      .map(element => element.textContent);

    expect(secondSubtitle).toBe(firstSubtitle);
    expect(secondSendLabels).toEqual(firstSendLabels);
    await secondRender.cleanup();
  });
});
