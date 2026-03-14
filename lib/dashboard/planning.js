/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Planning widget — quarterly plan cards and month tabs
 * Prompt summary: "widget showing current/next quarter plans with month tab navigation"
 */
import { getQuarterMonths, getUpcomingWeekMonday, formatWeekLabel } from "constants/quarters";
import { IS_DEV_ENVIRONMENT, widgetTitleFromId } from "constants/settings";
import DashboardTippy from "dashboard-tippy";
import NoteEditor from "note-editor";
import { createElement, useEffect, useState } from "react";
import {
  fetchSectionContent,
  createMonthlyPlan,
  createWeeklyPlan,
  openOrCreateQuarterlyPlan,
  navigateToNote,
} from "util/goal-notes";
import { logIfEnabled } from "util/log";
import { renderBlockMarkdown } from "util/utility";
import WidgetWrapper from "widget-wrapper";

// ────────────────────────────────────────────────────────────────
/**
 * Opens an existing quarterly plan note or creates a new one.
 * Returns a devEdit signal when running in dev mode.
 * @param {Object} plan - The quarterly plan object.
 * @returns {Promise<{ devEdit?: boolean, noteUUID?: string }|void>}
 */
async function handleOpenPlan(plan) {
  if (plan.noteUUID) {
    return await navigateToNote(plan.noteUUID);
  }
  return await openOrCreateQuarterlyPlan(plan);
}

// ────────────────────────────────────────────────────────────────
/**
 * Handles clicking a month tab — toggles the tab off if already active,
 * otherwise fetches the month's plan content from the quarterly note.
 * @param {import("constants/quarters").Month} month - Month instance.
 * @param {Object} deps - Component state and setters.
 * @param {number|null} deps.activeTab - Currently active tab index.
 * @param {Function} deps.setActiveTab - Setter for active tab index.
 * @param {Function} deps.setMonthLoading - Setter for loading flag.
 * @param {Function} deps.setMonthContent - Setter for month content.
 * @returns {Promise<void>}
 */
async function handleMonthClick(month, { activeTab, setActiveTab, setMonthLoading, setMonthContent }) {
  if (activeTab === month.index) {
    setActiveTab(null);
    setMonthContent(null);
    return;
  }

  setActiveTab(month.index);
  setMonthLoading(true);
  setMonthContent(null);

  const noteUUID = month.plan.noteUUID;

  try {
    if (!noteUUID) {
      setMonthContent({ found: false, plan: month.plan, monthName: month.full, year: month.plan.year });
    } else {
      const result = await fetchSectionContent(noteUUID, month.full);
      logIfEnabled(`[Planning] Raw markdown for ${month.full}:`, result?.content);
      setMonthContent({
        ...result,
        plan: month.plan,
        monthName: month.full,
        year: month.plan.year,
      });
    }
  } catch {
    setMonthContent({ found: false, plan: month.plan, monthName: month.full, year: month.plan.year });
  } finally {
    setMonthLoading(false);
  }
}

// ────────────────────────────────────────────────────────────────
/**
 * Creates or appends a monthly plan section in the quarterly note,
 * updates content state, then navigates to the note.
 * @param {Object} monthContent - Current month content state (plan, monthName, etc.).
 * @param {Object} deps - Component state setters.
 * @param {Function} deps.setMonthLoading - Setter for loading flag.
 * @param {Function} deps.setMonthContent - Setter for month content.
 * @returns {Promise<{ devEdit?: boolean, noteUUID?: string }|void>}
 */
async function handleCreateMonthPlan(monthContent, { setMonthLoading, setMonthContent }) {
  if (!monthContent) return;
  setMonthLoading(true);
  try {
    const result = await createMonthlyPlan(monthContent.plan, monthContent.monthName);
    if (result && result.noteUUID) {
      setMonthContent(prev => ({ ...prev, found: true, content: result.content || '' }));
      return await navigateToNote(result.noteUUID);
    }
  } catch {
    // keep showing the create link on error
  } finally {
    setMonthLoading(false);
  }
}

// ────────────────────────────────────────────────────────────────
/**
 * Creates or appends a weekly plan section in the current quarter's note,
 * then navigates to the note.
 * @param {Object} plan - Current quarter plan object.
 * @param {string} weekLabel - Week heading, e.g. "Week of March 16".
 * @param {Function} setWeekLoading - Setter for loading flag.
 * @returns {Promise<{ devEdit?: boolean, noteUUID?: string }|void>}
 */
async function handleCreateWeekPlan(plan, weekLabel, setWeekLoading) {
  setWeekLoading(true);
  try {
    const result = await createWeeklyPlan(plan, weekLabel);
    if (result?.noteUUID) {
      return await navigateToNote(result.noteUUID);
    }
  } catch {
    // keep showing the create link on error
  } finally {
    setWeekLoading(false);
  }
}

// ────────────────────────────────────────────────────────────────
/**
 * Renders a single quarter card with plan status and monthly-details indicator.
 * @param {Function} h - createElement alias.
 * @param {Object} plan - The quarterly plan object.
 * @param {Function} onCardClick - Callback when the card is clicked.
 * @returns {React.ReactElement}
 */
function renderQuarterCard(h, plan, onCardClick) {
  const hasNote = !!plan.noteUUID;
  const allMonths = !!plan.hasAllMonthlyDetails;
  const cardClass = 'quarter-card' + (hasNote ? ' quarter-card--has-plan' : '');

  const indicatorIcon = allMonths ? '✅' : '🚧';
  const indicatorTip = allMonths
    ? 'All 3 months in this quarter have been planned.'
    : 'Monthly details are missing for one or more months — this plan is a work in progress.';

  return h('div', { key: plan.label, className: cardClass, onClick: onCardClick },
    h('span', { className: 'quarter-label' }, plan.label),
    h('div', { className: 'quarter-status-row' },
      h('span', { className: 'quarter-status' },
        hasNote ? '📝 Open Plan' : '+ Create Plan'
      ),
      hasNote
        ? h(DashboardTippy, { content: indicatorTip, placement: 'bottom' },
            h('span', {
              className: 'quarter-plan-indicator',
              onClick: (e) => e.stopPropagation(),
            }, indicatorIcon))
        : null
    )
  );
}

// ────────────────────────────────────────────────────────────────
/**
 * Renders the month content area — loading indicator, plan content, or create-plan prompt.
 * @param {Function} h - createElement alias.
 * @param {boolean} monthLoading - Whether content is currently loading.
 * @param {Object|null} monthContent - The fetched month content, or null.
 * @param {Function} onCreatePlan - Callback to create a monthly plan.
 * @returns {React.ReactElement|null}
 */
function renderMonthContentArea(h, monthLoading, monthContent, onCreatePlan) {
  if (monthLoading) {
    return h('div', { className: 'month-content-loading' }, 'Loading…');
  }
  if (!monthContent) return null;
  if (monthContent.found) {
    return h('div', { className: 'month-content' },
      h('div', { className: 'month-content-header' }, monthContent.monthName),
      h('div', {
        className: 'month-content-text',
        dangerouslySetInnerHTML: {
          __html: renderBlockMarkdown(monthContent.content) || '<p>(Empty section)</p>'
        }
      })
    );
  }
  return h('div', { className: 'month-content-empty' },
    h('button', {
      className: 'create-month-plan-link',
      onClick: onCreatePlan,
    }, `Create a plan for ${monthContent.monthName} ${monthContent.year}`)
  );
}

// ────────────────────────────────────────────────────────────────
/**
 * Renders the weekly plan section shown when the widget is 2-tall.
 * @param {Function} h - createElement alias.
 * @param {string} weekLabel - Week heading, e.g. "Week of March 16".
 * @param {number} year - Year for display.
 * @param {boolean} weekLoading - Whether the weekly action is in progress.
 * @param {Function} onCreateWeekPlan - Callback when the user clicks to create/open a weekly plan.
 * @returns {React.ReactElement}
 */
function renderWeeklyPlanSection(h, weekLabel, year, weekLoading, onCreateWeekPlan) {
  return h('div', { className: 'weekly-plan-section' },
    h('div', { className: 'weekly-plan-header' }, 'Weekly Plan'),
    weekLoading
      ? h('div', { className: 'weekly-plan-loading' }, 'Loading…')
      : h('button', {
          className: 'create-week-plan-link',
          onClick: onCreateWeekPlan,
        }, `Create a weekly plan for ${weekLabel}, ${year}`)
  );
}

// ────────────────────────────────────────────────────────────────
export default function PlanningWidget({ quarterlyPlans, gridHeightSize = 1 }) {
  const h = createElement;
  const [activeTab, setActiveTab] = useState(null);
  const [monthContent, setMonthContent] = useState(null);
  const [monthLoading, setMonthLoading] = useState(false);
  const [weekLoading, setWeekLoading] = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [editingNoteUUID, setEditingNoteUUID] = useState(null);

  const isTwoTall = gridHeightSize >= 2;

  if (editingNoteUUID && IS_DEV_ENVIRONMENT) {
    return h(WidgetWrapper, { title: widgetTitleFromId('planning'), icon: '📋', widgetId: 'planning' },
      h(NoteEditor, {
        noteUUID: editingNoteUUID,
        onBack: () => setEditingNoteUUID(null),
      })
    );
  }

  if (!quarterlyPlans?.current || !quarterlyPlans?.next) {
    return h(WidgetWrapper, { title: widgetTitleFromId('planning'), icon: '📋', widgetId: 'planning' },
      h('p', { className: 'planning-empty' }, 'Loading quarterly plans…')
    );
  }

  const months = getQuarterMonths(quarterlyPlans.current, quarterlyPlans.next);
  const monthClickDeps = { activeTab, setActiveTab, setMonthLoading, setMonthContent };
  const createPlanDeps = { setMonthLoading, setMonthContent };

  const handleDevEdit = (result) => {
    if (result?.devEdit && result.noteUUID) {
      setEditingNoteUUID(result.noteUUID);
    }
  };

  useEffect(() => {
    if (initialLoadDone) return;
    const currentMonth = months.find(m => m.current);
    if (currentMonth) {
      setInitialLoadDone(true);
      handleMonthClick(currentMonth, monthClickDeps);
    }
  }, [initialLoadDone]);

  const upcomingMonday = getUpcomingWeekMonday();
  const weekLabel = formatWeekLabel(upcomingMonday);

  return h(WidgetWrapper, { title: widgetTitleFromId('planning'), icon: '📋', widgetId: 'planning' },
    h('div', { className: 'planning-quarters' },
      [quarterlyPlans.current, quarterlyPlans.next].map(plan =>
        renderQuarterCard(h, plan, async () => {
          const result = await handleOpenPlan(plan);
          handleDevEdit(result);
        })
      )
    ),
    h('div', { className: 'month-tabs' },
      months.map(m =>
        h('button', {
          key: m.index,
          className: 'month-tab' + (m.index === activeTab ? ' active' : ''),
          onClick: () => handleMonthClick(m, monthClickDeps),
        }, m.short)
      )
    ),
    activeTab !== null
      ? h('div', { className: 'month-content-area' },
          renderMonthContentArea(h, monthLoading, monthContent, async () => {
            const result = await handleCreateMonthPlan(monthContent, createPlanDeps);
            handleDevEdit(result);
          })
        )
      : null,
    isTwoTall
      ? renderWeeklyPlanSection(h, weekLabel, quarterlyPlans.current.year, weekLoading, async () => {
          const result = await handleCreateWeekPlan(quarterlyPlans.current, weekLabel, setWeekLoading);
          handleDevEdit(result);
        })
      : null,
  );
}
