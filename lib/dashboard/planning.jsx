// Quarterly Planning widget
import { getQuarterMonths, getUpcomingWeekMonday, formatWeekLabel, quarterLabel } from "constants/quarters";
import { IS_DEV_ENVIRONMENT } from "constants/settings";
import { buildPlanTargetFromPlans, currentQuarterCardAction } from "dashboard/build-plan-quarter";
import DashboardTippy from "dashboard/dashboard-tooltip-tippy";
import PlanWizard from "dashboard/plan-wizard/plan-wizard";
import { useWidgetLoadedEvent } from "dashboard-load-tracking";
import {
  createOrAppendMonthlyPlan,
  createOrAppendWeeklyPlan,
  createQuarterlyPlan,
  getMonthlyPlanContent,
} from "data-service";
import NoteEditor from "note-editor";
import { mirrorQuarterPlanNote } from "plan-wizard/mirror-quarter-plan";
import { useEffect, useState } from "react";
import { navigateToNote } from "util/goal-notes";
import { logIfEnabled } from "util/log";
import { renderBlockMarkdown } from "util/utility";
import WidgetWrapper from "widget-wrapper";
import "styles/planning.scss"

async function handleOpenPlan(app, plan) {
  if (plan.noteUUID) {
    return await navigateToNote(app, plan.noteUUID);
  }
  return await createQuarterlyPlan(app, plan);
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
      const result = await getMonthlyPlanContent(app, noteUUID, month.full);
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
    const result = await createOrAppendMonthlyPlan(app, monthContent.plan, monthContent.monthName);
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
    const result = await createOrAppendWeeklyPlan(app, plan, weekLabel);
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
  const quarterLabel = plan.domainName ? `${ plan.label } · ${ plan.domainName }` : plan.label;

  const indicatorIcon = allMonths ? '✅' : '🚧';
  const indicatorTip = allMonths
    ? 'All 3 months in this quarter have been planned.'
    : 'Monthly details are missing for one or more months — this plan is a work in progress.';

  return (
    <div className={cardClass} onClick={onCardClick}>
      <span className="quarter-label">{quarterLabel}</span>
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

// ----------------------------------------------------------------------------------------------
// @desc The Quarterly Planning widget: two quarter cards, the month and week sections beneath them, and the
//   Plan Builder overlay either card or the header action opens.
// @param {object} props - An object with the following properties:
//   - {object} app - Amplenote embed app proxy.
//   - {number} [gridHeightSize=1] - Cell height in grid rows; two rows adds the upcoming week's section.
//   - {object} quarterlyPlans - The current and upcoming quarterly plans, or null while they load.
//   - {Function|null} [onOpenSettings] - Opens Dashboard Settings, taking a callback to run when that popup
//     closes. Plan Builder uses it to send a user with no AI provider to settings and to reopen itself after.
//   - {string|null} [taskDomainName] - Active task domain's display name, or null for All Notes.
//   - {string|null} [taskDomainUUID] - Active task domain's UUID, or null for All Notes.
// @returns {JSX.Element} The widget.
export default function PlanningWidget({ app, gridHeightSize = 1, onOpenSettings = null, quarterlyPlans,
    taskDomainName = null, taskDomainUUID = null }) {
  const [activeTab, setActiveTab] = useState(null);
  const [wizardPlan, setWizardPlan] = useState(null);
  const [monthContent, setMonthContent] = useState(null);
  const [monthLoading, setMonthLoading] = useState(false);
  const [weekContent, setWeekContent] = useState(null);
  const [weekLoading, setWeekLoading] = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [editingNoteUUID, setEditingNoteUUID] = useState(null);
  const [mirroredCurrentNoteUuid, setMirroredCurrentNoteUuid] = useState(null);

  const isTwoTall = gridHeightSize >= 2;
  const currentPlan = quarterlyPlans?.current
    ? { ...quarterlyPlans.current, noteUUID: quarterlyPlans.current.noteUUID || mirroredCurrentNoteUuid }
    : null;
  const nextPlan = quarterlyPlans?.next ?? null;
  const plansReady = !!(currentPlan && nextPlan);
  const displayedPlans = { current: currentPlan, next: nextPlan };
  const domainName = currentPlan?.domainName || nextPlan?.domainName || null;
  const months = plansReady ? getQuarterMonths(currentPlan, nextPlan) : [];
  const monthClickDeps = { activeTab, setActiveTab, setMonthLoading, setMonthContent };
  const createPlanDeps = { setMonthLoading, setMonthContent };
  const upcomingMonday = getUpcomingWeekMonday();
  const weekLabel = formatWeekLabel(upcomingMonday);
  const widgetTitle = domainName ? `Quarterly Planning · ${ domainName }` : undefined;
  const wizardQuarterPlan = buildPlanTargetFromPlans({ quarterlyPlans: displayedPlans });
  const canStartWizard = !!(wizardQuarterPlan?.quarter && wizardQuarterPlan?.year);
  const buildPlanTitle = wizardQuarterPlan
    ? `Gather your intents and build a plan for ${ quarterLabel(wizardQuarterPlan.year, wizardQuarterPlan.quarter) }`
    : "";
  const headerActions = canStartWizard ? (
    <button className="widget-header-action" onClick={ () => setWizardPlan({ mirrorTarget: null,
      quarter: wizardQuarterPlan.quarter, year: wizardQuarterPlan.year }) } title={ buildPlanTitle } type="button">
      ✨ Build plan
    </button>
  ) : null;

  useWidgetLoadedEvent('planning', plansReady && initialLoadDone && !monthLoading && (!isTwoTall || !weekLoading));

  // Reset month/week UI when the Task Domain (and therefore the plan note set) changes.
  useEffect(() => {
    setActiveTab(null);
    setMonthContent(null);
    setWeekContent(null);
    setInitialLoadDone(false);
    setMirroredCurrentNoteUuid(null);
    setWizardPlan(null);
  }, [domainName]);

  useEffect(() => {
    if (!plansReady || initialLoadDone) return;
    const currentMonth = months.find(m => m.current);
    if (currentMonth) {
      setInitialLoadDone(true);
      handleMonthClick(app, currentMonth, monthClickDeps);
    }
  }, [domainName, initialLoadDone, plansReady]);

  useEffect(() => {
    if (!plansReady || !isTwoTall) return;
    const noteUUID = currentPlan?.noteUUID;
    if (!noteUUID) return;
    setWeekLoading(true);
    getMonthlyPlanContent(app, noteUUID, weekLabel)
      .then(result => {
        logIfEnabled(`[Planning] Weekly section "${weekLabel}":`, result);
        setWeekContent(result);
      })
      .catch(() => setWeekContent({ found: false, content: null }))
      .finally(() => setWeekLoading(false));
  }, [currentPlan?.noteUUID, isTwoTall, plansReady, weekLabel]);

  if (editingNoteUUID && IS_DEV_ENVIRONMENT) {
    return (
      <WidgetWrapper title={widgetTitle} widgetId="planning">
        <NoteEditor
          app={app}
          noteUUID={editingNoteUUID}
          onBack={() => setEditingNoteUUID(null)}
        />
      </WidgetWrapper>
    );
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Copy the quarter the wizard just published onto the current quarter. Used when the current quarter
  //   had no plan of its own and the card opened the upcoming quarter's wizard instead.
  // @returns {Promise<void>} Resolves once the current quarter's note holds the copied plan.
  const handleWizardFinished = async () => {
    if (!wizardPlan?.mirrorTarget) return;
    if (!nextPlan?.label) throw new Error("The upcoming quarter's plan could not be copied.");
    const mirrored = await mirrorQuarterPlanNote(app, { sourcePlan: nextPlan, targetPlan: wizardPlan.mirrorTarget });
    if (mirrored?.noteUuid) setMirroredCurrentNoteUuid(mirrored.noteUuid);
  };

  // ----------------------------------------------------------------------------------------------
  // @desc Send a user whose dashboard has no AI provider to Dashboard Settings, and put Plan Builder back in
  //   front of them once they are done there. The wizard closes first because it portals above the settings
  //   popup's stacking layer and holds a document-level Escape handler, so leaving it open would bury the very
  //   popup the user was sent to. Reopening mounts a fresh wizard, which reads the key that was just saved.
  const handleOpenProviderSettings = () => {
    const reopenedPlan = wizardPlan;
    setWizardPlan(null);
    onOpenSettings(() => setWizardPlan(reopenedPlan));
  };

  // ----------------------------------------------------------------------------------------------
  // @desc The wizard, when one is open. It renders as a fixed overlay above the whole dashboard rather than
  //   inside the widget body, since a widget cell is far too narrow for a five-page form. Both render branches
  //   below include it so opening the wizard does not depend on the quarterly plans having finished loading.
  // @returns {JSX.Element|null} The wizard overlay, or null when no plan is being edited.
  const planWizardOverlay = wizardPlan ? (
    <PlanWizard app={app} domainName={taskDomainName} domainUuid={taskDomainUUID}
      onClose={() => setWizardPlan(null)} onFinished={wizardPlan.mirrorTarget ? handleWizardFinished : null}
      onOpenSettings={onOpenSettings ? handleOpenProviderSettings : null}
      quarter={wizardPlan.quarter} year={wizardPlan.year} />
  ) : null;

  if (!plansReady) {
    return (
      <WidgetWrapper title={widgetTitle} widgetId="planning">
        <p className="planning-empty">Loading quarterly plans…</p>
        {planWizardOverlay}
      </WidgetWrapper>
    );
  }

  const handleDevEdit = (result) => {
    if (result?.devEdit && result.noteUUID) {
      setEditingNoteUUID(result.noteUUID);
    }
  };

  // ----------------------------------------------------------------------------------------------
  // @desc Handle a click on either quarter card. A card opens that quarter's wizard, except in the last 15 days
  //   of the quarter when the current quarter has no plan yet: an upcoming plan is copied in as this quarter's
  //   note, and when neither quarter has a plan the wizard opens on the upcoming quarter and copies its note
  //   back here once the user finishes. The fallback opens or creates the note when a card has no quarter.
  // @param {Object} plan - A quarterly plan card's plan, with the following properties:
  //   - {number|undefined} quarter - Quarter being planned, 1 through 4.
  //   - {number|undefined} year - Planning year.
  //   - {string|null} noteUUID - UUID of the existing plan note, absent until a plan has been created.
  // @returns {Promise<void>} Resolves once the wizard has been opened, the plan copied, or the note handled.
  const handleQuarterCardClick = async (plan) => {
    if (!(plan.quarter && plan.year)) {
      const result = await handleOpenPlan(app, plan);
      handleDevEdit(result);
      return;
    }
    const action = currentQuarterCardAction({ plan, quarterlyPlans: displayedPlans });
    if (action.kind === "mirror-existing") {
      try {
        const mirrored = await mirrorQuarterPlanNote(app, { sourcePlan: action.sourcePlan, targetPlan: action.mirrorTarget });
        if (mirrored?.noteUuid) setMirroredCurrentNoteUuid(mirrored.noteUuid);
      } catch (mirrorError) {
        logIfEnabled("[planning] could not copy the upcoming quarter's plan", mirrorError?.message || mirrorError);
      }
      return;
    }
    setWizardPlan({ mirrorTarget: action.mirrorTarget, quarter: action.quarterPlan.quarter, year: action.quarterPlan.year });
  };

  return (
    <WidgetWrapper headerActions={headerActions} title={widgetTitle} widgetId="planning">
      <div className="planning-quarters">
        {[currentPlan, nextPlan].map(plan => (
          <QuarterCard
            key={plan.label}
            plan={plan}
            onCardClick={() => handleQuarterCardClick(plan)}
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
          year={currentPlan.year}
          weekLoading={weekLoading}
          weekContent={weekContent}
          onCreateWeekPlan={async () => {
            const result = await handleCreateWeekPlan(app, currentPlan, weekLabel, setWeekLoading, setWeekContent);
            handleDevEdit(result);
          }}
        />
      ) : null}
      {planWizardOverlay}
    </WidgetWrapper>
  );
}
