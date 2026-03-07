/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Root dashboard component — fetches data and renders widget grid
 * Prompt summary: "main React component that calls init, shows loading/error, and lays out widgets"
 */
import { createElement, memo, useEffect, useState, useCallback, useRef, useMemo } from "react";
import PlanningWidget from 'planning';
import VictoryValueWidget from 'victory-value';
import MoodWidget from 'mood';
import CalendarWidget from 'calendar';
import AgendaWidget from 'agenda';
import QuotesWidget from 'quotes';
import QuickActionsWidget from 'quick-actions';
import RecentNotesWidget from 'recent-notes';
import TaskDomains from 'task-domains';
import DashboardLayoutPopup from 'dashboard-layout-popup';
import DashboardSettingsPopup from 'dashboard-settings-popup';
import { DASHBOARD_COMPONENTS, DASHBOARD_FOCUS, DEFAULT_DASHBOARD_COMPONENTS, SETTING_KEYS, WIDGET_REGISTRY } from 'constants/settings';
import useCompletedTasks from 'hooks/use-completed-tasks';
import useDomainTasks from 'hooks/use-domain-tasks';
import { weekStartFromDateInput, weekEndFromDateInput } from 'util/date-utility';

// ------------------------------------------------------------------------------------------
// Computes the CSS grid span style for a widget cell from its layout config.
//
// [Claude] Task: shared grid cell style helper for memoized widget cells
// Prompt: "re-render only components whose data changed"
// Date: 2026-03-01 | Model: claude-4.6-opus-high-thinking
function gridCellStyle(config) {
  const w = Number(config?.gridWidthSize) > 0 ? Number(config.gridWidthSize) : 1;
  const h = Number(config?.gridHeightSize) > 0 ? Number(config.gridHeightSize) : 1;
  return { gridColumn: `span ${w}`, gridRow: `span ${h}` };
}

// ------------------------------------------------------------------------------------------
// Memoized widget cell components
//
// Each component is defined at module scope and wrapped in React.memo so it only
// re-renders when its own props change — unrelated state updates in DashboardApp
// (e.g. completedTasksByDate arriving while planning/mood data is unchanged) are
// invisible to cells that don't depend on those values.
//
// Props are intentionally minimal: each cell receives only the slice of app state
// it actually needs, rather than the full parent state bag.
// ------------------------------------------------------------------------------------------

// [Claude] Task: memoized widget cell components with explicit prop scoping
// Prompt: "re-render only components whose data changed"
// Date: 2026-03-01 | Model: claude-4.6-opus-high-thinking
const PlanningCell = memo(function PlanningCell({ config, quarterlyPlans }) {
  console.log('Rendered widget "planning"');
  return createElement('div', { className: 'grid-cell', style: gridCellStyle(config) },
    createElement(PlanningWidget, { quarterlyPlans })
  );
});

// [Claude] Task: memoized widget cell components with explicit prop scoping
// Prompt: "re-render only components whose data changed"
// Date: 2026-03-01 | Model: claude-4.6-opus-high-thinking
const VictoryValueCell = memo(function VictoryValueCell({
  config, completedTasksByDate, dailyValues, weeklyTotal,
  moodRatings, referenceDate, onReferenceDateChange, settings,
}) {
  console.log('Rendered widget "victory-value"');
  return createElement('div', { className: 'grid-cell', style: gridCellStyle(config) },
    createElement(VictoryValueWidget, {
      completedTasksByDate, dailyValues, weeklyTotal, moodRatings,
      referenceDate, onReferenceDateChange,
      settings: { ...settings, 'victory-value': config?.settings || {} },
    })
  );
});

// [Claude] Task: memoized widget cell components with explicit prop scoping
// Prompt: "re-render only components whose data changed"
// Date: 2026-03-01 | Model: claude-4.6-opus-high-thinking
const MoodCell = memo(function MoodCell({ config, moodRatings, onMoodRecorded }) {
  console.log('Rendered widget "mood"');
  return createElement('div', { className: 'grid-cell', style: gridCellStyle(config) },
    createElement(MoodWidget, { moodRatings, onMoodRecorded })
  );
});

// [Claude] Task: memoized widget cell components with explicit prop scoping
// Prompt: "re-render only components whose data changed"
// Date: 2026-03-01 | Model: claude-4.6-opus-high-thinking
const CalendarCell = memo(function CalendarCell({
  config, completedTasksByDate, currentDate, openTasks, onDateSelect, settings, selectedDate,
}) {
  console.log('Rendered widget "calendar"');
  return createElement('div', { className: 'grid-cell', style: gridCellStyle(config) },
    createElement(CalendarWidget, {
      completedTasksByDate, currentDate, openTasks, onDateSelect, selectedDate,
      settings: { ...settings, calendar: config?.settings || {} },
    })
  );
});

// [Claude] Task: memoized widget cell components with explicit prop scoping
// Prompt: "re-render only components whose data changed"
// Date: 2026-03-01 | Model: claude-4.6-opus-high-thinking
const AgendaCell = memo(function AgendaCell({ config, agendaTasks, currentDate, selectedDate }) {
  console.log('Rendered widget "agenda"');
  return createElement('div', { className: 'grid-cell', style: gridCellStyle(config) },
    createElement(AgendaWidget, { currentDate, tasks: agendaTasks, selectedDate })
  );
});

// [Claude] Task: memoized widget cell components with explicit prop scoping
// Prompt: "re-render only components whose data changed"
// Date: 2026-03-01 | Model: claude-4.6-opus-high-thinking
const QuotesCell = memo(function QuotesCell({ config, quarterlyPlans, settings }) {
  console.log('Rendered widget "quotes"');
  return createElement('div', { className: 'grid-cell', style: gridCellStyle(config) },
    createElement(QuotesWidget, {
      quotes: null,
      planContent: null,
      settings: { ...settings, quotes: config?.settings || {} },
    })
  );
});

// [Claude] Task: memoized widget cell components with explicit prop scoping
// Prompt: "re-render only components whose data changed"
// Date: 2026-03-01 | Model: claude-4.6-opus-high-thinking
const RecentNotesCell = memo(function RecentNotesCell({ config }) {
  console.log('Rendered widget "recent-notes"');
  return createElement('div', { className: 'grid-cell', style: gridCellStyle(config) },
    createElement(RecentNotesWidget, {})
  );
});

// [Claude] Task: memoized widget cell components with explicit prop scoping
// Prompt: "re-render only components whose data changed"
// Date: 2026-03-01 | Model: claude-4.6-opus-high-thinking
const QuickActionsCell = memo(function QuickActionsCell({ config }) {
  console.log('Rendered widget "quick-actions"');
  return createElement('div', { className: 'grid-cell', style: gridCellStyle(config) },
    createElement(QuickActionsWidget, {})
  );
});

// [Claude] Task: root component — owns all data state, renders memoized widget cells
// Prompt: "re-render only components whose data changed"
// Date: 2026-03-01 | Model: claude-4.6-opus-high-thinking
export default function DashboardApp() {
  const h = createElement;
  const { activeTaskDomain, buildAgendaTasksByDate, initializeDomainTasks,
    onDomainChange, openTasks, taskDomains } = useDomainTasks();
  const { completedTasksByDate, fetchCompletedTasks } = useCompletedTasks();

  const [moodRatings, setMoodRatings] = useState(null);
  const [quarterlyPlans, setQuarterlyPlans] = useState(null);
  const [settings, setSettings] = useState(null);
  const [dailyVictoryValues, setDailyVictoryValues] = useState(null);
  const [weeklyVictoryValue, setWeeklyVictoryValue] = useState(null);
  const [currentDate, setCurrentDate] = useState(null);
  const [error, setError] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [focusState, setFocusState] = useState(DASHBOARD_FOCUS.DEFAULT);
  const initDataFreshRef = useRef(false);

  useEffect(() => {
    callPlugin('init').then(result => {
      if (result?.error) {
        setError(result.error);
      } else {
        console.log(`Init returns`, result, `including moodRatinsgs`, result.moodRatings);
        initializeDomainTasks(result);
        setMoodRatings(result.moodRatings);
        setQuarterlyPlans(result.quarterlyPlans);
        setSettings(result.settings);
        setDailyVictoryValues(result.dailyVictoryValues);
        setWeeklyVictoryValue(result.weeklyVictoryValue);
        setCurrentDate(result.currentDate);
        initDataFreshRef.current = true;
      }
    }).catch(err => setError(err.message));
  }, []);

  // [Claude] Task: refetch mood ratings for the week now shown in VictoryValue and Mood when calendar date changes
  // Prompt: "Ensure that when calendar click changes date, that new mood ratings are retrieved for the week that is now being shown in the VictoryValue component and the Mood component"
  // Date: 2026-03-01 | Model: claude-sonnet-4-6
  const fetchMoodRatings = useCallback(async (referenceDate) => {
    const weekStart = weekStartFromDateInput(referenceDate);
    const weekEnd = weekEndFromDateInput(referenceDate);
    const fromUnixSeconds = Math.floor(weekStart.getTime() / 1000);
    const toUnixSeconds = Math.floor(weekEnd.getTime() / 1000);
    try {
      const ratings = await callPlugin('getMoodRatings', fromUnixSeconds, toUnixSeconds);
      if (Array.isArray(ratings)) {
        setMoodRatings(ratings);
      }
    } catch (err) {
      console.error('fetchMoodRatings: failed to load mood ratings', err);
    }
  }, []);

  // [Claude] Task: refetch completed tasks and mood ratings for selected date's week or active domain changes
  // Prompt: "reduce redundant re-renders: skip mood refetch on initial mount since init already provides it"
  // Date: 2026-03-01 | Model: claude-4.6-opus-high-thinking
  useEffect(() => {
    const referenceDate = selectedDate || currentDate;
    if (!referenceDate) return;
    if (initDataFreshRef.current) {
      initDataFreshRef.current = false;
    } else {
      fetchMoodRatings(referenceDate);
    }
    if (activeTaskDomain) {
      fetchCompletedTasks(referenceDate, activeTaskDomain);
    }
  }, [activeTaskDomain, currentDate, fetchCompletedTasks, fetchMoodRatings, selectedDate]);

  const handleDomainChange = useCallback((newDomains, newActiveDomain, taskData) => {
    onDomainChange(newDomains, newActiveDomain, taskData);
    if (taskData) {
      setDailyVictoryValues(taskData.dailyVictoryValues);
      setWeeklyVictoryValue(taskData.weeklyVictoryValue);
    }
  }, [onDomainChange]);

  // [Claude] Task: persist layout with optional per-widget sizing from the Sizing tab
  // Prompt: "rename dashboard-config-popup to dashboard-layout-popup; add sizing tab for width and vertical tile count"
  // Date: 2026-03-07 | Model: claude-4.6-opus-high-thinking
  const handleLayoutSave = useCallback(async (newRenderedWidgetIds, { isReset, sizing } = {}) => {
    const existingLayout = settings?.[DASHBOARD_COMPONENTS] || DEFAULT_DASHBOARD_COMPONENTS;
    const configByWidgetId = {};
    if (!isReset) {
      existingLayout.forEach(c => { configByWidgetId[c.widgetId] = c; });
    }

    const newLayout = newRenderedWidgetIds.map(widgetId => {
      const existing = configByWidgetId[widgetId];
      const registryEntry = WIDGET_REGISTRY.find(w => w.widgetId === widgetId);
      const sizeOverride = sizing?.[widgetId];
      return {
        widgetId,
        gridWidthSize: sizeOverride?.gridWidthSize ?? existing?.gridWidthSize ?? registryEntry?.defaultGridWidthSize ?? 1,
        gridHeightSize: sizeOverride?.gridHeightSize ?? existing?.gridHeightSize ?? 1,
        settings: existing?.settings || {},
      };
    });

    await callPlugin('saveLayout', newLayout);
    setSettings(prev => ({ ...prev, [DASHBOARD_COMPONENTS]: newLayout }));
    setFocusState(DASHBOARD_FOCUS.DEFAULT);
  }, [settings]);

  // [Claude] Task: persist LLM provider, API key, background image URL and mode from the Dashboard Settings popup (deferred until Save to avoid host re-mount/reload on upload)
  // Prompt: "after removing background image, dashboard kept original image"
  // Date: 2026-03-04 | Model: claude-4.6-sonnet-medium-thinking
  const handleSettingsSave = useCallback(async ({ llmProvider, apiKey, backgroundMode, backgroundImageUrl }) => {
    console.log('[dashboard] handleSettingsSave called with:', { llmProvider, backgroundMode, backgroundImageUrl: backgroundImageUrl != null ? '(set)' : '(unchanged)' });
    const saves = [
      callPlugin('saveSetting', SETTING_KEYS.LLM_PROVIDER, llmProvider),
      callPlugin('saveSetting', SETTING_KEYS.LLM_API_KEY, apiKey),
      callPlugin('saveBackgroundImageUrl', backgroundImageUrl || ''),
    ];
    if (backgroundImageUrl && backgroundMode) {
      saves.push(callPlugin('saveBackgroundMode', backgroundMode));
    }
    try {
      await Promise.all(saves);
      console.log('[dashboard] settings save completed successfully');
    } catch (err) {
      console.error('[dashboard] settings save FAILED:', err);
    }
    setSettings(prev => ({
      ...prev,
      [SETTING_KEYS.LLM_PROVIDER]: llmProvider,
      [SETTING_KEYS.LLM_API_KEY]: apiKey,
      [SETTING_KEYS.BACKGROUND_IMAGE_URL]: backgroundImageUrl || '',
      [SETTING_KEYS.BACKGROUND_IMAGE_MODE]: backgroundImageUrl ? (backgroundMode || 'cover') : '',
    }));
    setFocusState(DASHBOARD_FOCUS.DEFAULT);
  }, []);

  // [Claude] Task: append newly recorded mood rating to moodRatings state so sparkline updates immediately
  // Prompt: "after submitting a mood rating, the mood widget will transition to confirmation and a new rating will be visible"
  // Date: 2026-03-07 | Model: claude-4.6-opus-high-thinking
  const handleMoodRecorded = useCallback((newRating) => {
    setMoodRatings(prev => [...(prev || []), newRating]);
  }, []);

  // Pre-compute agenda tasks so AgendaCell's memo can skip re-rendering when only
  // completedTasksByDate or moodRatings change (neither affects open task ordering).
  const agendaTasks = useMemo(
    () => currentDate ? buildAgendaTasksByDate(currentDate) : {},
    [buildAgendaTasksByDate, currentDate]
  );

  // Derive the ordered layout config once per settings change.
  const activeComponents = useMemo(() => {
    const configured = settings?.[DASHBOARD_COMPONENTS];
    return Array.isArray(configured) && configured.length > 0 ? configured : DEFAULT_DASHBOARD_COMPONENTS;
  }, [settings]);

  if (error) return h('div', { className: 'dashboard-error' },
    h('h2', null, 'Dashboard Error'),
    h('p', null, error)
  );

  if (!settings) return h('div', { className: 'dashboard-loading' },
    h('div', { className: 'spinner' }),
    h('p', null, 'Loading dashboard...')
  );

  // [Claude] Task: compute inline background image style from persisted settings
  // Prompt: "add background image upload option to DashboardSettings"
  // Date: 2026-03-01 | Model: claude-4.6-opus-high-thinking
  const backgroundUrl = settings?.[SETTING_KEYS.BACKGROUND_IMAGE_URL];
  const backgroundMode = settings?.[SETTING_KEYS.BACKGROUND_IMAGE_MODE] || 'cover';
  if (backgroundUrl) {
    console.log('[dashboard] background image URL from settings:', backgroundUrl, 'mode:', backgroundMode);
  }
  const backgroundStyle = backgroundUrl ? (() => {
    const isTiling = backgroundMode.startsWith('repeat');
    return {
      backgroundImage: `url(${ backgroundUrl })`,
      backgroundSize: isTiling ? 'auto' : backgroundMode,
      backgroundRepeat: isTiling ? backgroundMode : 'no-repeat',
      backgroundPosition: 'center',
      backgroundAttachment: 'fixed',
    };
  })() : undefined;

  const victoryReferenceDate = selectedDate || currentDate;

  // [Claude] Task: split into full-width background wrapper and max-width content area
  // Prompt: "background wrapper consumes 100% of window, widget area maxes out at 1200px"
  // Date: 2026-03-07 | Model: claude-4.6-opus-high-thinking
  return h('div', { className: 'dashboard', style: backgroundStyle },
    focusState === DASHBOARD_FOCUS.LAYOUT_CONFIG
      ? h(DashboardLayoutPopup, {
          currentLayout: settings?.[DASHBOARD_COMPONENTS] || DEFAULT_DASHBOARD_COMPONENTS,
          onSave: handleLayoutSave,
          onCancel: () => setFocusState(DASHBOARD_FOCUS.DEFAULT),
        })
      : null,
    focusState === DASHBOARD_FOCUS.SETTINGS_CONFIG
      ? (() => {
          console.log('[dashboard] rendering DashboardSettingsPopup, bgUrl:', settings?.[SETTING_KEYS.BACKGROUND_IMAGE_URL]);
          return h(DashboardSettingsPopup, {
            currentLlmProvider: settings?.[SETTING_KEYS.LLM_PROVIDER],
            currentApiKey: settings?.[SETTING_KEYS.LLM_API_KEY],
            currentBackgroundImageUrl: settings?.[SETTING_KEYS.BACKGROUND_IMAGE_URL],
            currentBackgroundMode: settings?.[SETTING_KEYS.BACKGROUND_IMAGE_MODE],
            onSave: handleSettingsSave,
            onCancel: () => setFocusState(DASHBOARD_FOCUS.DEFAULT),
          });
        })()
      : null,
    h('div', { className: 'dashboard-content' },
      h('div', { className: 'dashboard-toolbar' },
        h(TaskDomains, {
          domains: taskDomains,
          activeTaskDomain: activeTaskDomain,
          onDomainChange: handleDomainChange,
        }),
        h('div', { className: 'dashboard-toolbar-actions' },
          h('button', {
            className: 'dashboard-configure-button',
            type: 'button',
            onClick: () => { console.log('[dashboard] opening Settings popup'); setFocusState(DASHBOARD_FOCUS.SETTINGS_CONFIG); },
            title: 'Configure LLM provider and API key for AI-powered features',
          }, '\u2699\uFE0F Settings'),
          h('button', {
            className: 'dashboard-configure-button',
            type: 'button',
            onClick: () => setFocusState(DASHBOARD_FOCUS.LAYOUT_CONFIG),
            title: 'Configure which widgets are shown and in what order',
          }, '\u2630 Layout')
        )
      ),
      h('div', { className: 'dashboard-grid' },
        ...activeComponents.map((config, index) => {
          const widgetId = config?.widgetId || DEFAULT_DASHBOARD_COMPONENTS[index]?.widgetId;
          switch (widgetId) {
            case 'agenda':
              return h(AgendaCell, { key: `agenda-${index}`, config, agendaTasks, currentDate, selectedDate });
            case 'calendar':
              return h(CalendarCell, { key: `calendar-${index}`, config, completedTasksByDate, currentDate,
                openTasks, onDateSelect: setSelectedDate, settings, selectedDate });
            case 'mood':
              return h(MoodCell, { key: `mood-${index}`, config, moodRatings, onMoodRecorded: handleMoodRecorded });
            case 'planning':
              return h(PlanningCell, { key: `planning-${index}`, config, quarterlyPlans });
            case 'quick-actions':
              return h(QuickActionsCell, { key: `quick-actions-${index}`, config });
            case 'quotes':
              return h(QuotesCell, { key: `quotes-${index}`, config, quarterlyPlans, settings });
            case 'recent-notes':
              return h(RecentNotesCell, { key: `recent-notes-${index}`, config });
            case 'victory-value':
              return h(VictoryValueCell, { key: `victory-value-${index}`, config, completedTasksByDate,
                dailyValues: dailyVictoryValues, weeklyTotal: weeklyVictoryValue, moodRatings,
                referenceDate: victoryReferenceDate, onReferenceDateChange: setSelectedDate, settings });
            default:
              return null;
          }
        }).filter(Boolean)
      )
    )
  );
}
