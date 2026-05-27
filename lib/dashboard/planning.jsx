/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Planning widget — quarterly plan cards and month tabs
 * Prompt summary: "widget showing current/next quarter plans with month tab navigation"
 */
import { getQuarterMonths, getUpcomingWeekMonday, formatWeekLabel } from "constants/quarters";
import { IS_DEV_ENVIRONMENT, widgetTitleFromId } from "constants/settings";
import DashboardTippy from "dashboard/dashboard-tooltip-tippy";
import NoteEditor from "note-editor";
import { useEffect, useState } from "react";
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
import "styles/planning.scss"

async function handleOpenPlan(app, plan) {
  if (plan.noteUUID) {
    return await navigateToNote(app, plan.noteUUID);
  }
  return await openOrCreateQuarterlyPlan(app, plan);
}

async function handleMonthClick(app, month, { activeTab, setActiveTab, setMonthLoading, setMonthContent }) {
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
      const result = await fetchSectionContent(app, noteUUID, month.full);
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

async function handleCreateMonthPlan(app, monthContent, { setMonthLoading, setMonthContent }) {
  if (!monthContent) return;
  setMonthLoading(true);
  try {
    const result = await createMonthlyPlan(app, monthContent.plan, monthContent.monthName);
    if (result && result.noteUUID) {
      setMonthContent(prev => ({ ...prev, found: true, content: result.content || '' }));
      return await navigateToNote(app, result.noteUUID);
    }
  } catch {
    // keep showing the create link on error
  } finally {
    setMonthLoading(false);
  }
}

async function handleCreateWeekPlan(app, plan, weekLabel, setWeekLoading, setWeekContent) {
  setWeekLoading(true);
  try {
    const result = await createWeeklyPlan(app, plan, weekLabel);
    if (result?.noteUUID) {
      setWeekContent({ found: true, content: result.content || '' });
      return await navigateToNote(app, result.noteUUID);
    }
  } catch {
    // keep showing the create link on error
  } finally {
    setWeekLoading(false);
  }
}

// [Claude claude-4.7-opus] Task: convert renderQuarterCard to JSX component
// Prompt: "translate this project to render components with JSX instead"
function QuarterCard({ plan, onCardClick }) {
  const hasNote = !!plan.noteUUID;
  const allMonths = !!plan.hasAllMonthlyDetails;
  const cardClass = 'quarter-card' + (hasNote ? ' quarter-card--has-plan' : '');

  const indicatorIcon = allMonths ? '✅' : '🚧';
  const indicatorTip = allMonths
    ? 'All 3 months in this quarter have been planned.'
    : 'Monthly details are missing for one or more months — this plan is a work in progress.';

  return (
    <div className={cardClass} onClick={onCardClick}>
      <span className="quarter-label">{plan.label}</span>
      <div className="quarter-status-row">
        <span className="quarter-status">{hasNote ? '📝 Open Plan' : '+ Create Plan'}</span>
        {hasNote ? (
          <DashboardTippy content={indicatorTip} placement="bottom">
            <span className="quarter-plan-indicator" onClick={(e) => e.stopPropagation()}>{indicatorIcon}</span>
          </DashboardTippy>
        ) : null}
      </div>
    </div>
  );
}

function MonthContentArea({ monthLoading, monthContent, onCreatePlan }) {
  if (monthLoading) {
    return <div className="month-content-loading">Loading…</div>;
  }
  if (!monthContent) return null;
  if (monthContent.found) {
    return (
      <div className="month-content">
        <div className="month-content-header">{monthContent.monthName}</div>
        <div
          className="month-content-text"
          dangerouslySetInnerHTML={{
            __html: renderBlockMarkdown(monthContent.content) || '<p>(Empty section)</p>'
          }}
        />
      </div>
    );
  }
  return (
    <div className="month-content-empty">
      <button className="create-month-plan-link" onClick={onCreatePlan}>
        {`Create a plan for ${monthContent.monthName} ${monthContent.year}`}
      </button>
    </div>
  );
}

function WeeklyPlanSection({ weekLabel, year, weekLoading, weekContent, onCreateWeekPlan }) {
  if (weekLoading) {
    return (
      <div className="weekly-plan-section">
        <div className="weekly-plan-loading">Loading…</div>
      </div>
    );
  }
  if (weekContent?.found) {
    return (
      <div className="month-content-area">
        <div className="month-content">
          <div className="month-content-header">{weekLabel}</div>
          <div
            className="month-content-text"
            dangerouslySetInnerHTML={{
              __html: renderBlockMarkdown(weekContent.content) || '<p>(Empty section)</p>'
            }}
          />
        </div>
      </div>
    );
  }
  return (
    <div className="weekly-plan-section">
      <div className="weekly-plan-header">Weekly Plan</div>
      <button className="create-week-plan-link" onClick={onCreateWeekPlan}>
        {`Create a weekly plan for ${weekLabel}, ${year}`}
      </button>
    </div>
  );
}

// [Claude claude-4.7-opus] Task: migrate PlanningWidget from createElement to JSX
// Prompt: "translate this project to render components with JSX instead"
export default function PlanningWidget({ app, gridHeightSize = 1, quarterlyPlans }) {
  const [activeTab, setActiveTab] = useState(null);
  const [monthContent, setMonthContent] = useState(null);
  const [monthLoading, setMonthLoading] = useState(false);
  const [weekContent, setWeekContent] = useState(null);
  const [weekLoading, setWeekLoading] = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [editingNoteUUID, setEditingNoteUUID] = useState(null);

  const isTwoTall = gridHeightSize >= 2;

  if (editingNoteUUID && IS_DEV_ENVIRONMENT) {
    return (
      <WidgetWrapper title={widgetTitleFromId('planning')} icon="📋" widgetId="planning">
        <NoteEditor
          app={app}
          noteUUID={editingNoteUUID}
          onBack={() => setEditingNoteUUID(null)}
        />
      </WidgetWrapper>
    );
  }

  if (!quarterlyPlans?.current || !quarterlyPlans?.next) {
    return (
      <WidgetWrapper title={widgetTitleFromId('planning')} icon="📋" widgetId="planning">
        <p className="planning-empty">Loading quarterly plans…</p>
      </WidgetWrapper>
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

  const upcomingMonday = getUpcomingWeekMonday();
  const weekLabel = formatWeekLabel(upcomingMonday);

  useEffect(() => {
    if (initialLoadDone) return;
    const currentMonth = months.find(m => m.current);
    if (currentMonth) {
      setInitialLoadDone(true);
      handleMonthClick(app, currentMonth, monthClickDeps);
    }
  }, [initialLoadDone]);

  useEffect(() => {
    if (!isTwoTall) return;
    const noteUUID = quarterlyPlans.current?.noteUUID;
    if (!noteUUID) return;
    setWeekLoading(true);
    fetchSectionContent(app, noteUUID, weekLabel)
      .then(result => {
        logIfEnabled(`[Planning] Weekly section "${weekLabel}":`, result);
        setWeekContent(result);
      })
      .catch(() => setWeekContent({ found: false, content: null }))
      .finally(() => setWeekLoading(false));
  }, [isTwoTall, quarterlyPlans.current?.noteUUID, weekLabel]);

  return (
    <WidgetWrapper title={widgetTitleFromId('planning')} icon="📋" widgetId="planning">
      <div className="planning-quarters">
        {[quarterlyPlans.current, quarterlyPlans.next].map(plan => (
          <QuarterCard
            key={plan.label}
            plan={plan}
            onCardClick={async () => {
              const result = await handleOpenPlan(app, plan);
              handleDevEdit(result);
            }}
          />
        ))}
      </div>
      <div className="month-tabs">
        {months.map(m => (
          <button
            key={m.index}
            className={'month-tab' + (m.index === activeTab ? ' active' : '')}
            onClick={() => handleMonthClick(app, m, monthClickDeps)}
          >{m.short}</button>
        ))}
      </div>
      {activeTab !== null ? (
        <div className="month-content-area">
          <MonthContentArea
            monthLoading={monthLoading}
            monthContent={monthContent}
            onCreatePlan={async () => {
              const result = await handleCreateMonthPlan(app, monthContent, createPlanDeps);
              handleDevEdit(result);
            }}
          />
        </div>
      ) : null}
      {isTwoTall ? (
        <WeeklyPlanSection
          weekLabel={weekLabel}
          year={quarterlyPlans.current.year}
          weekLoading={weekLoading}
          weekContent={weekContent}
          onCreateWeekPlan={async () => {
            const result = await handleCreateWeekPlan(app, quarterlyPlans.current, weekLabel, setWeekLoading, setWeekContent);
            handleDevEdit(result);
          }}
        />
      ) : null}
    </WidgetWrapper>
  );
}
