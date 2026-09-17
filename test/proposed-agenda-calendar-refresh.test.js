// Regression coverage for the Proposed Agenda regenerating on every return to the dashboard.
// useExternalCalendarEvents re-fetches on each visibilitychange and normalizeExternalCalendarEvents
// rebuilds the array via .map, so the widget receives an equal-but-new calendarEvents array. That
// must not re-run the LLM; a genuine calendar change still must.
import { jest } from "@jest/globals";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { SETTING_KEYS } from "constants/settings";
import { SAMPLE_TASKS } from "./fixtures/tasks.js";

const llmMock = jest.fn();

await jest.unstable_mockModule("providers/fetch-ai-provider", async () => ({
  llmPromptWithPluginFallback: (...args) => llmMock(...args),
}));

const { default: ProposedAgendaWidget } = await import("proposed-agenda");
const { setPluginData } = await import("plugin-data");

// A stable reference date, so re-rendering does not look like a changed `currentDate` prop.
const CURRENT_DATE = new Date();

// ----------------------------------------------------------------------------------------------
// @desc Build the Amplenote app stub the widget generates against. No cached record exists (findNote
//   resolves null), so generation is gated only by the widget's own dependency tracking.
// @returns {object} App stub.
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

// ----------------------------------------------------------------------------------------------
// @desc Build a calendar event list matching what normalizeExternalCalendarEvents produces, as fresh
//   objects each call so an "unchanged" refetch is modeled by value rather than by reference.
// @param {string} [title="Standup"] - The event title.
// @returns {Array<object>} One normalized calendar event.
function calendarEventsFixture(title = "Standup") {
  return [{ allDay: false, end: new Date(2026, 8, 16, 9, 30, 0), start: new Date(2026, 8, 16, 9, 0, 0), title }];
}

// ----------------------------------------------------------------------------------------------
// @desc Mount the widget and return a `rerender` that reuses the same React root, so a second render
//   is a prop update rather than a remount (which would regenerate regardless).
// @returns {Promise<object>} { container, rerender }
async function renderWidget() {
  setPluginData({ context: {},
    settings: { [SETTING_KEYS.LLM_API_KEY_OPENAI]: "test-key", [SETTING_KEYS.LLM_PROVIDER_MODEL]: "openai" } });
  const app = buildMockApp();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const baseProps = { app, currentDate: CURRENT_DATE, defaultNoteUuid: null, timeFormat: "12h" };
  const root = createRoot(container);
  const rerender = async (extraProps = {}) => {
    await act(async () => { root.render(createElement(ProposedAgendaWidget, { ...baseProps, ...extraProps })); });
  };
  return { container, rerender };
}

beforeEach(() => {
  llmMock.mockReset();
  llmMock.mockResolvedValue({ activities: [{ durationMinutes: 60, reason: "Highest-leverage item of the day.",
    startTime: "09:00", taskUuid: "task-7", title: "Update budget" }] });
});

describe("ProposedAgendaWidget calendar refresh", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    setPluginData({ context: {}, settings: {} });
  });

  it("does not regenerate when a calendar refetch yields equal events in a new array", async () => {
    const { rerender } = await renderWidget();
    await rerender({ calendarEvents: calendarEventsFixture() });
    const callsAfterFirstRender = llmMock.mock.calls.length;

    // A new array of equal events, exactly what a visibilitychange refetch produces.
    await rerender({ calendarEvents: calendarEventsFixture() });

    expect(llmMock.mock.calls).toHaveLength(callsAfterFirstRender);
  });

  it("regenerates when the calendar events actually change", async () => {
    const { rerender } = await renderWidget();
    await rerender({ calendarEvents: calendarEventsFixture() });
    const callsAfterFirstRender = llmMock.mock.calls.length;

    await rerender({ calendarEvents: calendarEventsFixture("Budget review") });

    expect(llmMock.mock.calls.length).toBeGreaterThan(callsAfterFirstRender);
  });
});
