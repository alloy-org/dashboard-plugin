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
// The Amplenote app object is mocked; widgets receive it directly via the app prop.
import DashboardApp from '../lib/dashboard/dashboard.js';
import { mockPlugin } from "./test-helpers.js";
import { dateKeyFromDateInput, weekStartFromDateInput } from "util/date-utility";
import {
  SAMPLE_TASKS, COMPLETED_TASKS, DOMAINS, nowSec, daysAgo,
} from "./fixtures/tasks.js";

// --------------------------------------------------
// Factory: fresh mock app for each test so call counts start at zero.
// Builds a raw Amplenote API mock, then wraps it with a Proxy that routes
// high-level dashboard methods (init, saveSetting, etc.) through onEmbedCall.
// --------------------------------------------------
// [Claude] Task: build mock app that routes high-level methods through onEmbedCall
// Prompt: "only in dev do we need to create a simulated app; in production the app flows from renderEmbed"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
function buildMockApp(plugin) {
  const app = { settings: {} };

  app.getTaskDomains = jest.fn().mockResolvedValue(DOMAINS);

  app.getTaskDomainTasks = jest.fn().mockImplementation(async (domainUuid) => {
    if (domainUuid === 'dom-work') return SAMPLE_TASKS;
    return SAMPLE_TASKS.filter(t => !t.important);
  });

  app.getCompletedTasks = jest.fn().mockImplementation(async (fromSec, toSec) =>
    COMPLETED_TASKS.filter(t => t.completedAt >= fromSec && t.completedAt < toSec)
  );

  app.getMoodRatings = jest.fn().mockResolvedValue([
    { timestamp: daysAgo(6), rating:  1 },
    { timestamp: daysAgo(5), rating:  0 },
    { timestamp: daysAgo(4), rating:  2 },
    { timestamp: daysAgo(3), rating:  1 },
    { timestamp: daysAgo(2), rating:  2 },
    { timestamp: daysAgo(1), rating:  1 },
    { timestamp: nowSec,     rating:  2 },
  ]);

  app.recordMoodRating = jest.fn().mockResolvedValue('mock-mood-uuid');
  app.findNote = jest.fn().mockResolvedValue(null);
  app.createNote = jest.fn().mockResolvedValue('mock-note-uuid');
  app.insertNoteContent = jest.fn().mockResolvedValue();
  app.getNoteSections = jest.fn().mockResolvedValue([]);
  app.getNoteContent = jest.fn().mockResolvedValue('');
  app.attachNoteMedia = jest.fn().mockResolvedValue('https://example.com/image.png');

  app.filterNotes = jest.fn().mockResolvedValue([]);
  app.setSetting  = jest.fn().mockImplementation((k, v) => { app.settings[k] = v; });
  app.getExternalCalendarEvents = jest.fn().mockResolvedValue(null);

  // Wrap with a Proxy: methods present on `app` are used directly;
  // unknown methods (init, saveSetting, etc.) route through onEmbedCall.
  return new Proxy(app, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === 'symbol') return undefined;
      return (...args) => plugin.onEmbedCall(target, prop, ...args);
    }
  });
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
// initPromise defaults to app.init() so most callers don't need to supply it.
async function mountDashboard(container, root, app, initPromise = app.init()) {
  await act(async () => { root.render(createElement(DashboardApp, { app, initPromise })); });
  await flushAsync();
}

// --------------------------------------------------
// @description Temporarily overrides jsdom's viewport width so responsive dashboard behaviors
//   can be tested without remounting the entire test environment.
// @param {number} width - New window.innerWidth value to expose during the test
// [OpenAI gpt-5.4] Task: test desktop-only widget focus mode across viewport sizes
// Prompt: "Implement a new widget behavior via a new behavior only available on desktop clients"
function setWindowInnerWidth(width) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width, writable: true });
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
    const mockGradient = { addColorStop: jest.fn() };
    const mockCtx = {
      scale: jest.fn(), clearRect: jest.fn(), fillRect: jest.fn(),
      beginPath: jest.fn(), closePath: jest.fn(), roundRect: jest.fn(),
      fill: jest.fn(), stroke: jest.fn(), moveTo: jest.fn(), lineTo: jest.fn(),
      arc: jest.fn(), fillText: jest.fn(), setLineDash: jest.fn(), save: jest.fn(),
      restore: jest.fn(), clip: jest.fn(), quadraticCurveTo: jest.fn(),
      createRadialGradient: jest.fn().mockReturnValue(mockGradient),
      createLinearGradient: jest.fn().mockReturnValue(mockGradient),
      measureText: jest.fn().mockReturnValue({ width: 0 }),
      fillStyle: '', strokeStyle: '', font: '', textAlign: '', textBaseline: '',
      globalAlpha: 1, lineWidth: 1, lineCap: '', lineJoin: '', shadowColor: '',
      shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
    };
    HTMLCanvasElement.prototype.getContext = jest.fn().mockReturnValue(mockCtx);

    plugin = mockPlugin();
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    mockApp = buildMockApp(plugin);
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
      const hangingApp = new Proxy({}, {
        get(_, prop) { if (typeof prop === 'symbol') return undefined; return () => Promise.resolve(null); }
      });
      const initPromise = new Promise(() => {}); // never resolves

      await act(async () => { root.render(createElement(DashboardApp, { app: hangingApp, initPromise })); });

      expect(container.querySelector('.dashboard-loading')).not.toBeNull();
      expect(container.querySelector('.spinner')).not.toBeNull();
      expect(container.textContent).toContain('Loading dashboard');
    });
  });

  // ------------------------------------------------
  describe('error state', () => {
    it('shows an error banner when init returns an error object', async () => {
      const initPromise = Promise.resolve({ error: 'Something went wrong' });
      const errorApp = new Proxy({}, {
        get(_, prop) { if (typeof prop === 'symbol') return undefined; return () => Promise.resolve(null); }
      });

      await act(async () => { root.render(createElement(DashboardApp, { app: errorApp, initPromise })); });
      await flushAsync();

      expect(container.querySelector('.dashboard-error')).not.toBeNull();
      expect(container.textContent).toContain('Dashboard Error');
      expect(container.textContent).toContain('Something went wrong');
    });

    it('shows an error banner when the init promise rejects', async () => {
      const initPromise = Promise.reject(new Error('Network timeout'));
      initPromise.catch(() => {}); // suppress unhandled rejection warning
      const errorApp = new Proxy({}, {
        get(_, prop) { if (typeof prop === 'symbol') return undefined; return () => Promise.resolve(null); }
      });

      await act(async () => { root.render(createElement(DashboardApp, { app: errorApp, initPromise })); });
      await flushAsync();

      expect(container.querySelector('.dashboard-error')).not.toBeNull();
      expect(container.textContent).toContain('Network timeout');
    });
  });

  // ------------------------------------------------
  describe('app object calls during init', () => {
    beforeEach(async () => {
      const initPromise = mockApp.init();
      await act(async () => { root.render(createElement(DashboardApp, { app: mockApp, initPromise })); });
      await flushAsync();
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
      // useCompletedTasks fires 7 calls (one per day), and PeakHoursWidget makes
      // one additional call for the full month, so expect at least 7 total.
      expect(mockApp.getCompletedTasks.mock.calls.length).toBeGreaterThanOrEqual(7);
    });
  });

  // ------------------------------------------------
  describe('widget rendering with real task data', () => {
    beforeEach(async () => {
      const initPromise = mockApp.init();
      await act(async () => { root.render(createElement(DashboardApp, { app: mockApp, initPromise })); });
      await flushAsync();
    });

    it('renders the outer dashboard shell without errors', () => {
      expect(container.querySelector('.dashboard-outer-container')).not.toBeNull();
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

    it('focuses a widget from its icon and restores the grid from the backdrop click', async () => {
      const planningIconButton = container.querySelector('.widget-planning .widget-icon-button');
      const planningCell = container.querySelector('.grid-cell[data-widget-id="planning"]');
      const moodCell = container.querySelector('.grid-cell[data-widget-id="mood"]');
      expect(planningIconButton).not.toBeNull();
      expect(planningCell).not.toBeNull();
      expect(moodCell).not.toBeNull();

      await act(async () => { planningIconButton.click(); });
      await flushAsync();

      const focusBackdrop = container.querySelector('.dashboard-grid-focus-backdrop');
      expect(container.querySelector('.dashboard-grid--focused')).not.toBeNull();
      expect(focusBackdrop).not.toBeNull();
      expect(planningCell.className).toContain('grid-cell--focused');
      expect(moodCell.className).toContain('grid-cell--focus-hidden');
      expect(planningCell.style.getPropertyValue('--focus-x')).not.toBe('');

      await act(async () => { focusBackdrop.click(); });
      await flushAsync();

      expect(container.querySelector('.dashboard-grid--focused')).toBeNull();
      expect(container.querySelector('.dashboard-grid-focus-backdrop')).toBeNull();
      expect(planningCell.className).not.toContain('grid-cell--focused');
      expect(moodCell.className).not.toContain('grid-cell--focus-hidden');
    });

    it('keeps widget focus mode unavailable below the desktop breakpoint', async () => {
      const originalWidth = window.innerWidth;
      try {
        setWindowInnerWidth(760);
        await act(async () => { window.dispatchEvent(new Event('resize')); });
        await flushAsync();

        expect(container.querySelector('.widget-planning .widget-icon-button')).toBeNull();
        expect(container.querySelector('.widget-planning .widget-icon')).not.toBeNull();

        const planningIcon = container.querySelector('.widget-planning .widget-icon');
        await act(async () => {
          planningIcon.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await flushAsync();

        expect(container.querySelector('.dashboard-grid--focused')).toBeNull();
      } finally {
        setWindowInnerWidth(originalWidth);
        await act(async () => { window.dispatchEvent(new Event('resize')); });
        await flushAsync();
      }
    });
  });

  // ------------------------------------------------
  describe('domain switching', () => {
    it('calls app.getTaskDomainTasks for the new domain when a domain button is clicked', async () => {
      const initPromise = mockApp.init();
      await act(async () => { root.render(createElement(DashboardApp, { app: mockApp, initPromise })); });
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
      const initPromise = mockApp.init();
      await act(async () => { root.render(createElement(DashboardApp, { app: mockApp, initPromise })); });
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
      const origInit = mockApp.init.bind(mockApp);
      const overrideApp = new Proxy(mockApp, {
        get(target, prop) {
          if (prop === 'init') return async (...args) => {
            const result = await origInit(...args);
            return { ...result, settings: { ...result.settings, dashboard_elements: {} } };
          };
          const val = Reflect.get(target, prop);
          return typeof val === 'function' ? val.bind(target) : val;
        }
      });
      const initPromise = overrideApp.init();

      await act(async () => { root.render(createElement(DashboardApp, { app: overrideApp, initPromise })); });
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
      const origInit = mockApp.init.bind(mockApp);
      const overrideApp = new Proxy(mockApp, {
        get(target, prop) {
          if (prop === 'init') return async (...args) => {
            const result = await origInit(...args);
            return { ...result, settings: { ...result.settings, dashboard_elements: {} } };
          };
          if (prop === 'saveLayout') return () => Promise.resolve();
          const val = Reflect.get(target, prop);
          return typeof val === 'function' ? val.bind(target) : val;
        }
      });
      const initPromise = overrideApp.init();

      await act(async () => { root.render(createElement(DashboardApp, { app: overrideApp, initPromise })); });
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

    it('updates both grid-cell and inner widget sizing classes after resizing a widget', async () => {
      await mountDashboard(container, root, mockApp);

      const initialPlanningCell = container.querySelector('.grid-cell[data-widget-id="planning"]');
      const initialPlanningWidget = container.querySelector('.widget-planning');
      expect(initialPlanningCell.className).toContain('horizontal-2-cell');
      expect(initialPlanningWidget.className).toContain('horizontal-2-cell');

      const layoutBtn = Array.from(container.querySelectorAll('.dashboard-configure-button'))
        .find(btn => btn.textContent.includes('Layout'));
      await act(async () => { layoutBtn.click(); });
      await flushAsync();

      const sizingTab = Array.from(container.querySelectorAll('.dashboard-layout-popup-tab'))
        .find(btn => btn.textContent.includes('Sizing'));
      await act(async () => { sizingTab.click(); });
      await flushAsync();

      const planningSizingItem = Array.from(container.querySelectorAll('.dashboard-layout-popup-sizing-item'))
        .find(item => item.textContent.includes('Planning'));
      expect(planningSizingItem).toBeDefined();

      const [widthSelect, heightSelect] = planningSizingItem.querySelectorAll('select');
      await act(async () => {
        widthSelect.value = '3';
        widthSelect.dispatchEvent(new Event('change', { bubbles: true }));
        heightSelect.value = '2';
        heightSelect.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await flushAsync();

      const saveBtn = Array.from(container.querySelectorAll('.config-popup-btn--submit'))
        .find(btn => btn.textContent.includes('Save Layout'));
      await act(async () => { saveBtn.click(); });
      await flushAsync();

      const updatedPlanningCell = container.querySelector('.grid-cell[data-widget-id="planning"]');
      const updatedPlanningWidget = container.querySelector('.widget-planning');
      expect(updatedPlanningCell.className).toContain('horizontal-3-cell');
      expect(updatedPlanningCell.className).toContain('vertical-2-cell');
      expect(updatedPlanningWidget.className).toContain('horizontal-3-cell');
      expect(updatedPlanningWidget.className).toContain('vertical-2-cell');
    });
  });

  // ------------------------------------------------
  describe('calendar-selected week propagation', () => {
    it('re-fetches completed tasks when clicking a day in a different week', async () => {
      const initPromise = mockApp.init();
      await act(async () => { root.render(createElement(DashboardApp, { app: mockApp, initPromise })); });
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
