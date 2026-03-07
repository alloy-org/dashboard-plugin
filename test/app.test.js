/**
 * [Claude-authored file]
 * Created: 2026-02-28 | Model: claude-sonnet-4-6
 * Task: DashboardApp integration tests — real hooks + real widgets, app object mocked
 * Prompt summary: "mock the app object so hooks receive real sample task data"
 */
import { jest } from "@jest/globals";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
// No jest.unstable_mockModule calls — hooks AND widgets both run for real.
// The Amplenote app object is mocked instead; callPlugin routes through the real plugin.
import DashboardApp from '../lib/dashboard/dashboard.js';
import { mockPlugin } from "./test-helpers.js";
import { dateKeyFromDateInput, weekStartFromDateInput } from "util/date-utility";
import {
  SAMPLE_TASKS, COMPLETED_TASKS, DOMAINS, nowSec, daysAgo,
} from "./fixtures/tasks.js";

// --------------------------------------------------
// Factory: fresh mock app for each test so call counts start at zero.
// --------------------------------------------------
// [Claude] Task: build Amplenote app mock that routes task/mood queries to sample data
// Date: 2026-02-28 | Model: claude-sonnet-4-6
function buildMockApp() {
  const app = { settings: {} };

  app.getTaskDomains = jest.fn().mockResolvedValue(DOMAINS);

  // Return all sample tasks for the Work domain; fewer for Personal.
  app.getTaskDomainTasks = jest.fn().mockImplementation(async (domainUuid) => {
    if (domainUuid === 'dom-work') return SAMPLE_TASKS;
    return SAMPLE_TASKS.filter(t => !t.important);
  });

  // Filter completed tasks to those whose completedAt falls in [fromSec, toSec).
  app.getCompletedTasks = jest.fn().mockImplementation(async (fromSec, toSec) =>
    COMPLETED_TASKS.filter(t => t.completedAt >= fromSec && t.completedAt < toSec)
  );

  // Mood ratings — a week of sample ratings
  app.getMoodRatings = jest.fn().mockResolvedValue([
    { timestamp: daysAgo(6), rating:  1 },
    { timestamp: daysAgo(5), rating:  0 },
    { timestamp: daysAgo(4), rating:  2 },
    { timestamp: daysAgo(3), rating:  1 },
    { timestamp: daysAgo(2), rating:  2 },
    { timestamp: daysAgo(1), rating:  1 },
    { timestamp: nowSec,     rating:  2 },
  ]);

  // Mood recording
  app.recordMoodRating = jest.fn().mockResolvedValue('mock-mood-uuid');
  app.findNote = jest.fn().mockResolvedValue(null);
  app.createNote = jest.fn().mockResolvedValue('mock-note-uuid');
  app.insertNoteContent = jest.fn().mockResolvedValue();

  // No LLM key → fetchQuotes returns static fallback (no HTTP call).
  app.filterNotes = jest.fn().mockResolvedValue([]);
  app.setSetting  = jest.fn().mockImplementation((k, v) => { app.settings[k] = v; });

  return app;
}

// --------------------------------------------------
// Shared test helpers
// --------------------------------------------------
const flushAsync = () =>
  act(async () => { await new Promise(r => setTimeout(r, 0)); });

function mondayWeekStartKey(date) {
  return dateKeyFromDateInput(weekStartFromDateInput(date));
}

// Mount DashboardApp into container and flush all async work.
async function mountDashboard(container, root, callPluginImpl) {
  global.callPlugin = jest.fn().mockImplementation(callPluginImpl);
  await act(async () => { root.render(createElement(DashboardApp)); });
  await flushAsync();
}

// --------------------------------------------------
// Tests
// --------------------------------------------------

// [Claude] Generated tests for: DashboardApp with real hooks, real widgets, mocked app object
// Date: 2026-02-28 | Model: claude-sonnet-4-6
describe('DashboardApp', () => {
  let container;
  let root;
  let plugin;
  let mockApp;

  beforeAll(() => {
    // VictoryValueWidget draws on <canvas>; stub the 2d context so jsdom doesn't throw.
    const mockCtx = {
      scale: jest.fn(), clearRect: jest.fn(), fillRect: jest.fn(),
      beginPath: jest.fn(), roundRect: jest.fn(), fill: jest.fn(),
      stroke: jest.fn(), moveTo: jest.fn(), lineTo: jest.fn(),
      arc: jest.fn(), fillText: jest.fn(), setLineDash: jest.fn(),
      measureText: jest.fn().mockReturnValue({ width: 0 }),
      fillStyle: '', strokeStyle: '', font: '', textAlign: '',
      globalAlpha: 1, lineWidth: 1,
    };
    HTMLCanvasElement.prototype.getContext = jest.fn().mockReturnValue(mockCtx);

    plugin = mockPlugin();
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    mockApp = buildMockApp();
    // Default: route every callPlugin action through the real plugin with the mock app.
    global.callPlugin = jest.fn().mockImplementation(
      (action, ...args) => plugin.onEmbedCall(mockApp, action, ...args)
    );
  });

  afterEach(async () => {
    if (root) {
      await act(async () => { root.unmount(); });
      root = null;
    }
    container.remove();
  });

  // ------------------------------------------------
  describe('loading state', () => {
    it('renders a loading spinner before init resolves', async () => {
      global.callPlugin = jest.fn().mockReturnValue(new Promise(() => {}));

      await act(async () => { root.render(createElement(DashboardApp)); });

      expect(container.querySelector('.dashboard-loading')).not.toBeNull();
      expect(container.querySelector('.spinner')).not.toBeNull();
      expect(container.textContent).toContain('Loading dashboard');
    });
  });

  // ------------------------------------------------
  describe('error state', () => {
    it('shows an error banner when init returns an error object', async () => {
      global.callPlugin = jest.fn().mockResolvedValue({ error: 'Something went wrong' });

      await act(async () => { root.render(createElement(DashboardApp)); });
      await flushAsync();

      expect(container.querySelector('.dashboard-error')).not.toBeNull();
      expect(container.textContent).toContain('Dashboard Error');
      expect(container.textContent).toContain('Something went wrong');
    });

    it('shows an error banner when the init promise rejects', async () => {
      global.callPlugin = jest.fn().mockRejectedValue(new Error('Network timeout'));

      await act(async () => { root.render(createElement(DashboardApp)); });
      await flushAsync();

      expect(container.querySelector('.dashboard-error')).not.toBeNull();
      expect(container.textContent).toContain('Network timeout');
    });
  });

  // ------------------------------------------------
  describe('app object calls during init', () => {
    beforeEach(async () => {
      await act(async () => { root.render(createElement(DashboardApp)); });
      await flushAsync();
    });

    it('calls callPlugin("init") as the first action', () => {
      expect(global.callPlugin.mock.calls[0]).toEqual(['init']);
    });

    it('queries app.getTaskDomains to resolve the active domain', () => {
      expect(mockApp.getTaskDomains).toHaveBeenCalled();
    });

    it('fetches open tasks for the Work domain via app.getTaskDomainTasks', () => {
      expect(mockApp.getTaskDomainTasks).toHaveBeenCalledWith('dom-work');
    });

    it('fetches mood ratings via app.getMoodRatings', () => {
      expect(mockApp.getMoodRatings).toHaveBeenCalled();
    });

    it('fetches completed tasks for each day in a Monday-Sunday week via app.getCompletedTasks', () => {
      // useCompletedTasks fires one getCompletedTasks call per day for the selected week.
      // fetchCompletedTasks is invoked twice: once after init resolves and once when
      // activeTaskDomain changes from null → 'dom-work', so the total is a multiple of 7.
      expect(mockApp.getCompletedTasks.mock.calls.length % 7).toBe(0);
      expect(mockApp.getCompletedTasks).toHaveBeenCalled();
    });
  });

  // ------------------------------------------------
  describe('widget rendering with real task data', () => {
    beforeEach(async () => {
      await act(async () => { root.render(createElement(DashboardApp)); });
      await flushAsync();
    });

    it('renders the outer dashboard shell without errors', () => {
      expect(container.querySelector('.dashboard')).not.toBeNull();
      expect(container.querySelector('.dashboard-grid')).not.toBeNull();
      expect(container.querySelector('.dashboard-loading')).toBeNull();
      expect(container.querySelector('.dashboard-error')).toBeNull();
    });

    it('renders the Planning widget showing the current and next quarters', () => {
      const widget = container.querySelector('.widget-planning');
      expect(widget).not.toBeNull();
      // Both quarter cards should be present (current Q and next Q).
      expect(widget.querySelectorAll('.quarter-card').length).toBe(2);
    });

    it('renders the Mood widget with 5 emoji selector buttons', () => {
      const widget = container.querySelector('.widget-mood');
      expect(widget).not.toBeNull();
      expect(widget.querySelectorAll('.mood-btn').length).toBe(5);
    });

    it('renders the Victory Value widget with a canvas chart', () => {
      expect(container.querySelector('.widget-victory-value')).not.toBeNull();
      expect(container.querySelector('canvas')).not.toBeNull();
    });

    it('renders the Calendar widget with day cells for the current month', () => {
      expect(container.querySelector('.widget-calendar')).not.toBeNull();
      expect(container.querySelectorAll('.cal-day').length).toBeGreaterThan(0);
    });

    it('renders the Agenda widget', () => {
      expect(container.querySelector('.widget-agenda')).not.toBeNull();
    });

    it('renders the Quick Actions widget with its shortcut buttons', () => {
      const widget = container.querySelector('.widget-quick-actions');
      expect(widget).not.toBeNull();
      expect(widget.textContent).toContain('Daily Jot');
      expect(widget.textContent).toContain('Journal');
    });

    it('renders the TaskDomains selector showing both configured domains', () => {
      const domainList = container.querySelector('.task-domains-list');
      expect(domainList).not.toBeNull();
      expect(domainList.textContent).toContain('Work');
      expect(domainList.textContent).toContain('Personal');
    });

    it('shows the upcoming task "💼 Update budget" in the Agenda widget', () => {
      // task-7 has startAt = tomorrow, so it should appear in the agenda.
      const agendaWidget = container.querySelector('.widget-agenda');
      expect(agendaWidget.textContent).toContain('Update budget');
    });
  });

  // ------------------------------------------------
  describe('domain switching', () => {
    it('calls app.getTaskDomainTasks for the new domain when a domain button is clicked', async () => {
      await act(async () => { root.render(createElement(DashboardApp)); });
      await flushAsync();

      // Find the Personal domain button and click it.
      const domainItems = container.querySelectorAll('.task-domain-item');
      const personalBtn = Array.from(domainItems).find(el => el.textContent.includes('Personal'));
      expect(personalBtn).not.toBeNull();

      await act(async () => { personalBtn.click(); });
      await flushAsync();

      // switchTaskDomain → _fetchTasksForDomain → app.getTaskDomainTasks('dom-personal')
      expect(mockApp.getTaskDomainTasks).toHaveBeenCalledWith('dom-personal');
    });
  });

  // ------------------------------------------------
  // [Claude] Generated tests for: Layout popup opens without error
  // Date: 2026-03-07 | Model: claude-4.6-opus-high-thinking
  describe('layout popup', () => {
    it('opens the Layout popup without error when the Layout button is clicked', async () => {
      await act(async () => { root.render(createElement(DashboardApp)); });
      await flushAsync();

      const layoutBtn = Array.from(container.querySelectorAll('.dashboard-configure-button'))
        .find(btn => btn.textContent.includes('Layout'));
      expect(layoutBtn).toBeDefined();

      await act(async () => { layoutBtn.click(); });
      await flushAsync();

      const popup = container.querySelector('.dashboard-layout-popup');
      expect(popup).not.toBeNull();
      expect(popup.textContent).toContain('Dashboard Layout');
      expect(popup.textContent).toContain('Components');
      expect(popup.textContent).toContain('Sizing');
    });

    it('opens the Layout popup without error when settings has non-array dashboard_elements', async () => {
      const origCallPlugin = global.callPlugin;
      global.callPlugin = jest.fn().mockImplementation((action, ...args) => {
        if (action === 'init') {
          return origCallPlugin(action, ...args).then(result => ({
            ...result,
            settings: { ...result.settings, dashboard_elements: {} },
          }));
        }
        return origCallPlugin(action, ...args);
      });

      await act(async () => { root.render(createElement(DashboardApp)); });
      await flushAsync();

      const layoutBtn = Array.from(container.querySelectorAll('.dashboard-configure-button'))
        .find(btn => btn.textContent.includes('Layout'));
      expect(layoutBtn).toBeDefined();

      await act(async () => { layoutBtn.click(); });
      await flushAsync();

      const popup = container.querySelector('.dashboard-layout-popup');
      expect(popup).not.toBeNull();
      expect(popup.textContent).toContain('Dashboard Layout');
    });

    // [Claude] Generated test for: Save Layout from Sizing tab with non-array dashboard_elements
    // Date: 2026-03-07 | Model: claude-4.6-opus-high-thinking
    it('saves layout from the Sizing tab without error when dashboard_elements is non-array', async () => {
      const origCallPlugin = global.callPlugin;
      global.callPlugin = jest.fn().mockImplementation((action, ...args) => {
        if (action === 'init') {
          return origCallPlugin(action, ...args).then(result => ({
            ...result,
            settings: { ...result.settings, dashboard_elements: {} },
          }));
        }
        if (action === 'saveLayout') return Promise.resolve();
        return origCallPlugin(action, ...args);
      });

      await act(async () => { root.render(createElement(DashboardApp)); });
      await flushAsync();

      // Open the Layout popup
      const layoutBtn = Array.from(container.querySelectorAll('.dashboard-configure-button'))
        .find(btn => btn.textContent.includes('Layout'));
      await act(async () => { layoutBtn.click(); });
      await flushAsync();

      // Switch to the Sizing tab
      const sizingTab = Array.from(container.querySelectorAll('.dashboard-layout-popup-tab'))
        .find(btn => btn.textContent.includes('Sizing'));
      expect(sizingTab).toBeDefined();
      await act(async () => { sizingTab.click(); });
      await flushAsync();

      // Click "Save Layout" — this should not throw
      const saveBtn = Array.from(container.querySelectorAll('.config-popup-btn--submit'))
        .find(btn => btn.textContent.includes('Save Layout'));
      expect(saveBtn).toBeDefined();
      await act(async () => { saveBtn.click(); });
      await flushAsync();

      // Popup should close (no longer in DOM)
      expect(container.querySelector('.dashboard-layout-popup')).toBeNull();
    });
  });

  // ------------------------------------------------
  describe('calendar-selected week propagation', () => {
    it('re-fetches completed tasks when clicking a day in a different week', async () => {
      await act(async () => { root.render(createElement(DashboardApp)); });
      await flushAsync();

      const callCountBeforeClick = mockApp.getCompletedTasks.mock.calls.length;
      const monthLabel = container.querySelector('.cal-month');
      const dayCells = Array.from(container.querySelectorAll('.cal-cell .cal-day'));
      expect(monthLabel).not.toBeNull();
      expect(dayCells.length).toBeGreaterThan(0);

      const [monthName, yearString] = monthLabel.textContent.trim().split(' ');
      const monthIndex = new Date(`${monthName} 1, ${yearString}`).getMonth();
      const year = Number(yearString);
      const currentWeek = mondayWeekStartKey(new Date());

      const targetDayCell = dayCells.find((cell) => {
        const day = Number(cell.textContent.trim());
        const candidateDate = new Date(year, monthIndex, day);
        return mondayWeekStartKey(candidateDate) !== currentWeek;
      });
      expect(targetDayCell).toBeDefined();

      await act(async () => { targetDayCell.click(); });
      await flushAsync();

      expect(mockApp.getCompletedTasks.mock.calls.length).toBe(callCountBeforeClick + 7);
    });
  });
});
