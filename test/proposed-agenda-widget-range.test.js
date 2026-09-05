import { jest } from "@jest/globals";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { SETTING_KEYS } from "constants/settings";
import { SAMPLE_TASKS } from "./fixtures/tasks.js";

const SECONDS_PER_DAY = 24 * 60 * 60;
const SECONDS_PER_MINUTE = 60;

const llmMock = jest.fn();

await jest.unstable_mockModule("providers/fetch-ai-provider", async () => ({
  llmPromptWithPluginFallback: (...args) => llmMock(...args),
}));

const { default: ProposedAgendaWidget } = await import("proposed-agenda");
const { setPluginData } = await import("plugin-data");

// ----------------------------------------------------------------------------------------------
// @desc Build the Amplenote app stub the widget generates against: fixture tasks, a quarterly plan note, and
//   the archive note surface. No cached record exists (findNote resolves null), so every render generates.
// @returns {object} App stub.
// [Claude claude-opus-5[1m]] Task: stub the embed-side app surface for a Proposed Agenda render
function buildMockApp() {
  const openTasks = SAMPLE_TASKS.filter(task => !task.completedAt && !task.dismissedAt);
  return {
    alert: jest.fn().mockResolvedValue(undefined),
    createNote: jest.fn().mockResolvedValue({ uuid: "archive-note" }),
    filterNotes: jest.fn().mockResolvedValue([]),
    findNote: jest.fn().mockResolvedValue(null),
    getExternalCalendarEvents: jest.fn().mockResolvedValue([]),
    getNoteContent: jest.fn().mockResolvedValue(""),
    getTaskDomains: jest.fn().mockResolvedValue([{ name: "Work", uuid: "dom-work" }]),
    getTaskDomainTasks: jest.fn().mockResolvedValue(openTasks),
    navigate: jest.fn().mockResolvedValue(undefined),
    replaceNoteContent: jest.fn().mockResolvedValue(true),
    setSetting: jest.fn().mockResolvedValue(undefined),
    updateTask: jest.fn().mockResolvedValue(true),
  };
}

function midnightSeconds(date) {
  return Math.floor(new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0).getTime() / 1000);
}

// A stable reference date, so re-rendering the widget does not look like a changed `currentDate` prop.
const CURRENT_DATE = new Date();

// ----------------------------------------------------------------------------------------------
// @desc Mount the widget with the given props and return its container plus a `rerender` that reuses the same
//   React root (a second createRoot on one container would remount, which would regenerate regardless).
// @param {object} [props={}] - Props merged over the defaults (notably `dateRange`).
// @returns {Promise<object>} { app, container, rerender }
// [Claude claude-opus-5[1m]] Task: mount the Proposed Agenda widget for range-rendering assertions
async function renderWidget(props = {}) {
  setPluginData({ context: {},
    settings: { [SETTING_KEYS.LLM_API_KEY_OPENAI]: "test-key", [SETTING_KEYS.LLM_PROVIDER_MODEL]: "openai" } });
  const app = buildMockApp();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const baseProps = { app, calendarEvents: [], currentDate: CURRENT_DATE, defaultNoteUuid: null,
    timeFormat: "12h", ...props };
  const root = createRoot(container);
  const rerender = async (extraProps = {}) => {
    await act(async () => { root.render(createElement(ProposedAgendaWidget, { ...baseProps, ...extraProps })); });
  };
  await rerender();
  return { app, container, rerender };
}

// A three-weekday window starting on a pinned Monday, well clear of "today" so nothing is filtered as past.
// The widget clamps only today's rows, so a wholly future window renders every proposal the model returns.
function futureWeekdayWindow() {
  const monday = new Date(2026, 11, 7, 8, 0, 0); // 2026-12-07 is a Monday
  return { endAt: Math.floor(monday.getTime() / 1000) + 2 * SECONDS_PER_DAY,
    startAt: Math.floor(monday.getTime() / 1000) };
}

beforeEach(() => {
  llmMock.mockReset();
  llmMock.mockResolvedValue({ activities: [{ durationMinutes: 60, reason: "Highest-leverage item of the day.",
    startTime: "09:00", taskUuid: "task-7", title: "Update budget" }] });
});

describe("ProposedAgendaWidget date range", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    setPluginData({ context: {}, settings: {} });
  });

  // Without a range the widget plans its single auto-resolved day, so there is nothing to head — the list
  // looks exactly as it did before the range support landed.
  it("renders one un-headed day block when no range is supplied", async () => {
    const { container } = await renderWidget();
    expect(container.querySelectorAll(".proposed-agenda-day-group")).toHaveLength(1);
    expect(container.querySelector(".proposed-agenda-day-heading")).toBeNull();
    expect(llmMock).toHaveBeenCalledTimes(1);
  });

  // Each day's suggestion keeps its own row (rather than collapsing into a single shared key), and the
  // duration the API spec requires is what the row offers to schedule.
  it("renders one duration-bearing row per planned day", async () => {
    const { container } = await renderWidget({ dateRange: futureWeekdayWindow() });
    const rows = container.querySelectorAll(".proposed-agenda-item");
    expect(rows).toHaveLength(3);
    const durations = [...container.querySelectorAll(".proposed-agenda-add-duration")].map(node => node.textContent);
    expect(durations).toEqual(["60m duration", "60m duration", "60m duration"]);
    expect(container.querySelector(".proposed-agenda-pending").textContent).toBe("3 pending");
  });

  // The window's bounds may arrive as a fresh object literal on every render; an unchanged window must not
  // re-trigger the range's LLM calls.
  it("does not regenerate when an equivalent range object is passed again", async () => {
    const { rerender } = await renderWidget({ dateRange: futureWeekdayWindow() });
    expect(llmMock).toHaveBeenCalledTimes(3);
    await rerender({ dateRange: futureWeekdayWindow() });
    expect(llmMock).toHaveBeenCalledTimes(3);
  });
});
