// Quarterly Planning widget
import { formatWeekLabel, getQuarterMonths, getUpcomingWeekMonday, hasQuarterEnded,
  quarterLabel } from "constants/quarters";
import { IS_DEV_ENVIRONMENT, SETTING_KEYS } from "constants/settings";
import { buildPlanTargetFromPlans, currentQuarterCardAction } from "dashboard/build-plan-quarter";
import DashboardTippy from "dashboard/dashboard-tooltip-tippy";
import { hasStartedFirstPlanIdeaRun, recordFirstPlanIdeaRun } from "dashboard/idea-generation/first-plan-idea-run";
import IdeaRunProgressPopup from "dashboard/idea-generation/idea-run-progress";
import MonthFocusPlan, { MonthIntensityMeter } from "dashboard/month-focus-plan";
import PlanWizard from "dashboard/plan-wizard/plan-wizard";
import { homePageOffset, quarterPageWindow, quarterPlanForPage, quartersMatch } from "dashboard/quarter-page";
import QuarterPageButton from "dashboard/quarter-page-button";
import QuarterRetrospective from "dashboard/quarter-retrospective/quarter-retrospective";
import { useWidgetLoadedEvent } from "dashboard-load-tracking";
import { useIdeaGenerationRun } from "hooks/use-idea-generation-run";
import useQuarterPlanProgress, { quarterProgressKey } from "hooks/use-quarter-plan-progress";
import NoteEditor from "note-editor";
import { mirrorQuarterPlanNote } from "plan-wizard/mirror-quarter-plan";
import { monthFocusProjects } from "plan-wizard/month-focus-projects";
import { pluginSettings, updatePluginSetting } from "plugin-data";
import QuarterlyPlanEntry from "quarterly-plan-entry";
import { createOrAppendMonthlyPlan, createOrAppendWeeklyPlan, createQuarterlyPlan, findQuarterPlan,
  getMonthlyPlanContent, starMonthFocusProject } from "quarterly-plan-service";
import { useEffect, useRef, useState } from "react";
import { navigateToNote } from "util/goal-notes";
import { logIfEnabled } from "util/log";
import { isQuarterPlanEnabled, quarterlyPlanTogglesFromSetting, quarterlyPlanTogglesWithState,
  storedQuarterToggle } from "util/quarterly-plan-toggles";
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

// ----------------------------------------------------------------------------------------------
// @desc One quarter's card. A card whose quarter has a plan note shows a checkbox, in the slot the plan's status
//   emoji once held, deciding whether the plan feeds Goal Coach, Proposed Agenda, and calendar suggestions. Whether
//   all three months are planned, which that emoji showed, now lives in the checkbox's tooltip. Clicks on the
//   checkbox do not reach the card's own handler. A past quarter's card opens its retrospective, whether or not a
//   plan was recorded, since the quarter's completed tasks exist either way.
// @param {object} props - An object with the following properties:
//   - {boolean} isPast - The quarter has ended. A past card never offers to create a plan.
//   - {Function} onCardClick - Opens the quarter's retrospective, plan, or Plan Builder.
//   - {Function} onSuggestionToggle - Receives the checkbox's new checked state.
//   - {object} plan - The quarter's plan, carrying label, noteUUID, hasAllMonthlyDetails, domainName, and pending.
//   - {boolean} [planBegun] - Plan Builder holds saved answers for the quarter. Without a plan note yet, the card
//     reads Continue Plan rather than Create Plan, and still opens Plan Builder.
//   - {boolean} usedForSuggestions - Whether the checkbox is checked.
// @returns {JSX.Element} The card.
function QuarterCard({ isPast, onCardClick, onSuggestionToggle, plan, planBegun = false, usedForSuggestions }) {
  const hasNote = !!plan.noteUUID;
  const isPending = !!plan.pending;
  const isInProgress = planBegun && !hasNote && !isPast && !isPending;
  const cardClassNames = ["quarter-card"];
  if ((hasNote || isInProgress) && !isPast) cardClassNames.push("quarter-card--has-plan");
  if (isPast) cardClassNames.push("quarter-card--past");
  if (isPending) cardClassNames.push("quarter-card--pending");
  const quarterTitle = plan.domainName ? `${ plan.label } · ${ plan.domainName }` : plan.label;
  let statusText = "+ Create Plan";
  if (isPending) statusText = "Loading…";
  else if (isPast) statusText = "✨ Retrospective";
  else if (hasNote) statusText = "📝 Open Plan";
  else if (isInProgress) statusText = "✏️ Continue Plan";
  const showSuggestionToggle = hasNote && !isPast && !isPending;

  const suggestionTip = usedForSuggestions
    ? `${ plan.label } projects are used when suggesting tasks. Uncheck to leave them out.`
    : `${ plan.label } projects are left out of task suggestions. Check to include them.`;
  const monthsTip = plan.hasAllMonthlyDetails ? 'All 3 months in this quarter have been planned.'
    : 'Monthly details are missing for one or more months.';

  return (
    <div className={ cardClassNames.join(" ") } onClick={ isPending ? undefined : onCardClick }>
      <div className="quarter-label-row">
        <span className="quarter-label">{ quarterTitle }</span>
        { isPast ? <span className="quarter-past-badge">Past</span> : null }
      </div>
      <div className="quarter-status-row">
        <span className="quarter-status">{ statusText }</span>
        { showSuggestionToggle ? (
          <DashboardTippy content={`${ suggestionTip } ${ monthsTip }`} placement="bottom">
            <label className="quarter-suggestion-toggle" onClick={(event) => event.stopPropagation()}>
              <input checked={usedForSuggestions} onChange={(event) => onSuggestionToggle(event.target.checked)}
                type="checkbox" />
            </label>
          </DashboardTippy>
        ) : null}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc A past quarter with no plan note has nothing to open and nothing to create.
// @param {object|null} monthContent - The month area's payload, including its plan.
// @returns {boolean} True when the area should say that no plan was recorded.
function monthContentIsUnrecorded(monthContent) {
  if (!monthContent?.plan || monthContent.plan.noteUUID || monthContent.plan.pending) return false;
  return hasQuarterEnded({ quarter: monthContent.plan.quarter, year: monthContent.plan.year });
}

// ----------------------------------------------------------------------------------------------
// @desc The open month: a loading line, the unrecorded notice, the month's starrable projects, or a link that
//   creates the month's section.
// @param {object} props - { monthContent, monthLoading, onCreatePlan, onStarProject }
// @returns {JSX.Element|null} The month's area
function MonthContentArea({ monthContent, monthLoading, onCreatePlan, onStarProject }) {
  if (monthLoading) {
    return <div className="month-content-loading">Loading…</div>;
  }
  if (!monthContent) return null;
  if (monthContentIsUnrecorded(monthContent)) {
    return (
      <div className="month-content">
        <div className="month-content-header">{ `${ monthContent.monthName } ${ monthContent.year }` }</div>
        <p className="month-content-unrecorded">{ `No plan was recorded for ${ monthContent.plan.label }.` }</p>
      </div>
    );
  }
  if (monthContent.found) {
    return <MonthFocusPlan content={ monthContent.content } monthName={ monthContent.monthName } onStarProject={ onStarProject } />;
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
// @desc Read the quarterly plan checkbox states from the embed's settings snapshot.
// @returns {object} Parsed toggles, as returned by quarterlyPlanTogglesFromSetting.
function storedPlanToggles() {
  return quarterlyPlanTogglesFromSetting(pluginSettings()[SETTING_KEYS.QUARTERLY_PLAN_TOGGLES]);
}

// ----------------------------------------------------------------------------------------------
// @desc The Quarterly Planning widget: two quarter cards, side buttons that step to a past or future quarter,
//   the month and week sections beneath them, and the Plan Builder overlay a card or the header action opens. In the
//   first half of a quarter the cards open on the previous quarter beside the current one; from the midpoint on, on
//   the current quarter beside the next.
// @param {object} props - An object with the following properties:
//   - {object} app - Amplenote embed app proxy.
//   - {number} [gridHeightSize=1] - Cell height in grid rows; two rows adds the upcoming week's section.
//   - {object} quarterlyPlans - The current and upcoming quarterly plans, or null while they load.
//   - {Function|null} [onOpenSettings] - Opens Dashboard Settings, taking a callback to run when that popup
//     closes. Plan Builder uses it to send a user with no AI provider to settings and to reopen itself after.
//   - {string|null} [taskDomainName] - Active task domain's display name, or null for All Notes.
//   - {string|null} [taskDomainUUID] - Active task domain's UUID, or null for All Notes.
// @returns {JSX.Element} The widget.
// ----------------------------------------------------------------------------------------------
// @desc The header action that replaces "Build plan" once the quarter has a plan: it starts a "Generate ideas" run, or
//   reopens the progress window of one under way. Once the day's runs are spent, a click says when ideas can be
//   generated again. It is disabled when the Dashboard has no durable work runner to run the jobs on.
// @param {object} ideaRun - From useIdeaGenerationRun.
// @returns {JSX.Element} The button.
function generateIdeasButton(ideaRun) {
  const { allowance, available, running } = ideaRun;
  const disabled = !running && !available;
  let title = `Generate ideas for this month's projects (run ${ allowance.runNumber } of ${ allowance.maximum } today)`;
  if (running) title = "Show the progress of the ideas being generated";
  else if (!available) title = "Generating ideas needs the Dashboard's work queue, which is switched off";
  else if (!allowance.allowed) title = `Both of today's ${ allowance.maximum } runs are used. You can generate ideas again tomorrow`;
  const startRun = () => {
    Promise.resolve(ideaRun.start()).catch(error => logIfEnabled("[planning] could not start idea generation", error?.message));
  };
  return (
    <button className="widget-header-action" disabled={ disabled } onClick={ running ? ideaRun.openProgress : startRun } title={ title } type="button">
      { running ? "💡 Generating ideas…" : "💡 Generate ideas" }
    </button>
  );
}

export default function PlanningWidget({ app, gridHeightSize = 1, onOpenSettings = null, quarterlyPlans,
    taskDomainName = null, taskDomainUUID = null }) {
  const [activeTab, setActiveTab] = useState(null);
  const [wizardPlan, setWizardPlan] = useState(null);
  const [retrospectivePlan, setRetrospectivePlan] = useState(null);
  const [monthContent, setMonthContent] = useState(null);
  const [monthLoading, setMonthLoading] = useState(false);
  const [weekContent, setWeekContent] = useState(null);
  const [weekLoading, setWeekLoading] = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [editingNoteUUID, setEditingNoteUUID] = useState(null);
  const [mirroredCurrentNoteUuid, setMirroredCurrentNoteUuid] = useState(null);
  const [planEntrySettled, setPlanEntrySettled] = useState(false);
  const [planToggles, setPlanToggles] = useState(() => storedPlanToggles());
  const ideaRun = useIdeaGenerationRun({ app, domainName: taskDomainName, domainUuid: taskDomainUUID });
  // Quarters the user has stepped away from the home pair. The home pair itself depends on how far into the
  // current quarter today is, so it is added below rather than stored.
  const [pageStep, setPageStep] = useState(0);
  const [pagedPlans, setPagedPlans] = useState(null);
  const [pageLoadGeneration, setPageLoadGeneration] = useState(0);
  const monthRequestId = useRef(0);

  const isTwoTall = gridHeightSize >= 2;
  const homeOffset = quarterlyPlans?.current?.quarter ? homePageOffset({ quarter: quarterlyPlans.current.quarter,
    year: quarterlyPlans.current.year }) : 0;
  const pageOffset = homeOffset + pageStep;
  // ----------------------------------------------------------------------------------------------
  // @desc Quarters on screen whose plan note the dashboard has not loaded. Each is looked up for saved Plan Builder
  //   answers, which dismiss the splash and mark the card as a plan in progress, and for a note created since load.
  const fetchedPagePlans = pagedPlans?.pageOffset === pageOffset ? [pagedPlans.earlier, pagedPlans.later] : [];
  const visibleLoadedPlans = quarterlyPlans?.current && quarterlyPlans?.next
    ? [quarterlyPlans.current, quarterlyPlans.next].concat(fetchedPagePlans) : [];
  const progressTargets = visibleLoadedPlans.filter(plan => plan?.quarter && plan?.year && !plan.noteUUID
    && !plan.pending && !hasQuarterEnded({ quarter: plan.quarter, year: plan.year }));
  const progressByQuarter = useQuarterPlanProgress(app, { domainName: taskDomainName, domainUuid: taskDomainUUID,
    generation: pageLoadGeneration, targets: progressTargets });
  // @desc Saved Plan Builder progress for one quarter.
  // @param {object|null} plan - A plan carrying quarter and year.
  // @returns {object|null} { begun, noteUUID }, or null until that quarter has been looked up.
  const quarterProgress = plan => (plan?.quarter && plan?.year ? progressByQuarter[quarterProgressKey(plan)] ?? null : null);
  // @desc The plan note found after the dashboard loaded, when it belongs to this card's quarter.
  // @param {object|null} plan - A current or next quarter from the dashboard payload.
  // @returns {string|null} That note's UUID, or null when none has been found.
  const discoveredNoteUuid = plan => quarterProgress(plan)?.noteUUID || null;
  const currentNoteUuid = quarterlyPlans?.current?.noteUUID || mirroredCurrentNoteUuid
    || discoveredNoteUuid(quarterlyPlans?.current);
  const nextNoteUuid = quarterlyPlans?.next?.noteUUID || discoveredNoteUuid(quarterlyPlans?.next);
  const currentPlan = quarterlyPlans?.current ? { ...quarterlyPlans.current, noteUUID: currentNoteUuid }
    : null;
  const nextPlan = quarterlyPlans?.next ? { ...quarterlyPlans.next, noteUUID: nextNoteUuid } : null;
  const plansReady = !!(currentPlan && nextPlan);
  const displayedPlans = { current: currentPlan, next: nextPlan };
  const domainName = currentPlan?.domainName || nextPlan?.domainName || null;
  const pageWindow = currentPlan?.quarter ? quarterPageWindow({ anchorQuarter: currentPlan.quarter,
    anchorYear: currentPlan.year, pageOffset }) : null;
  const leftPlan = pageWindow ? quarterPlanForPage({ currentPlan, domainName, nextPlan, pagedPlans, pageOffset,
    quarter: pageWindow.earlier }) : null;
  const rightPlan = pageWindow ? quarterPlanForPage({ currentPlan, domainName, nextPlan, pagedPlans, pageOffset,
    quarter: pageWindow.later }) : null;
  const pagePending = !!(leftPlan?.pending || rightPlan?.pending);
  const viewedMonths = leftPlan && rightPlan && !pagePending ? getQuarterMonths(leftPlan, rightPlan) : [];
  const createPlanDeps = { setMonthLoading, setMonthContent };
  const upcomingMonday = getUpcomingWeekMonday();
  const weekLabel = formatWeekLabel(upcomingMonday);
  const widgetTitle = domainName ? `Quarterly Planning · ${ domainName }` : undefined;
  const wizardQuarterPlan = buildPlanTargetFromPlans({ quarterlyPlans: displayedPlans });
  const canStartWizard = !!(wizardQuarterPlan?.quarter && wizardQuarterPlan?.year);
  const buildPlanTitle = wizardQuarterPlan
    ? `Gather your intents and build a plan for ${ quarterLabel(wizardQuarterPlan.year, wizardQuarterPlan.quarter) }`
    : "";
  const planNotesMissing = !!(wizardQuarterPlan?.quarter && !currentPlan?.noteUUID && !nextPlan?.noteUUID);
  const wizardQuarterProgress = quarterProgress(wizardQuarterPlan);
  const checkingPlanProgress = planNotesMissing && !wizardQuarterProgress;
  const showPlanEntry = planNotesMissing && wizardQuarterProgress?.begun === false;
  const weekSectionVisible = isTwoTall && pageStep === 0;
  const planCreated = !!(wizardQuarterPlan?.noteUUID && currentPlan?.noteUUID);
  const generateIdeasAction = planCreated ? generateIdeasButton(ideaRun) : null;
  const buildPlanAction = canStartWizard && !showPlanEntry && !checkingPlanProgress && !planCreated ? (
    <button className="widget-header-action" onClick={ () => setWizardPlan({ mirrorTarget: null,
      quarter: wizardQuarterPlan.quarter, year: wizardQuarterPlan.year }) } title={ buildPlanTitle } type="button">
      ✍️ Build plan
    </button>
  ) : generateIdeasAction;
  const returnToCurrentAction = pageStep !== 0 && currentPlan?.label ? (
    <button className="planning-return-quarter" onClick={ () => setPageStep(0) } type="button">
      { `↩ Back to ${ currentPlan.label }` }
    </button>
  ) : null;
  const headerActions = buildPlanAction || returnToCurrentAction ? (
    <div className="planning-header-actions">{ returnToCurrentAction }{ buildPlanAction }</div>
  ) : null;
  const planEntryLoaded = checkingPlanProgress ? false : showPlanEntry ? planEntrySettled
    : initialLoadDone && !monthLoading && !pagePending && (!weekSectionVisible || !weekLoading);
  const viewedQuarterKey = !plansReady || showPlanEntry || checkingPlanProgress || pagePending ? ""
    : `${ domainName ?? "" }|${ leftPlan.label }|${ leftPlan.noteUUID ?? "" }|${ rightPlan.label }|${ rightPlan.noteUUID ?? "" }`;

  useWidgetLoadedEvent('planning', plansReady && planEntryLoaded);

  // ----------------------------------------------------------------------------------------------
  // @desc Open one month, ignoring the result when a newer page or click has started since.
  // @param {object} month - A month from getQuarterMonths, carrying index, full, and plan.
  // @param {number|null} activeMonthIndex - The month already open. The same month clicked again closes.
  const openPlanningMonth = (month, activeMonthIndex) => {
    const requestId = monthRequestId.current + 1;
    monthRequestId.current = requestId;
    const isCurrentRequest = () => monthRequestId.current === requestId;
    return handleMonthClick(app, month, { activeTab: activeMonthIndex,
      setActiveTab: value => { if (isCurrentRequest()) setActiveTab(value); },
      setMonthContent: value => { if (isCurrentRequest()) setMonthContent(value); },
      setMonthLoading: value => { if (isCurrentRequest()) setMonthLoading(value); } });
  };

  // Reset month/week UI when the Task Domain (and therefore the plan note set) changes.
  useEffect(() => {
    setActiveTab(null);
    setMonthContent(null);
    setWeekContent(null);
    setInitialLoadDone(false);
    setMirroredCurrentNoteUuid(null);
    setPageStep(0);
    setPagedPlans(null);
    setWizardPlan(null);
    setPlanEntrySettled(false);
    setPlanToggles(storedPlanToggles());
  }, [domainName]);

  // Drop the month that belonged to the previous pair. A newer openPlanningMonth call ignores its result.
  useEffect(() => {
    monthRequestId.current += 1;
    setActiveTab(null);
    setMonthContent(null);
  }, [pageOffset]);

  // ----------------------------------------------------------------------------------------------
  // @desc Open a month whenever the viewed quarters change or Plan Builder closes. Closing the wizard bumps
  //   pageLoadGeneration without changing any note UUID, so the generation is what makes the month re-read a plan
  //   note the wizard just republished.
  useEffect(() => {
    if (!viewedQuarterKey) return undefined;
    const monthsForPage = getQuarterMonths(leftPlan, rightPlan);
    const today = new Date();
    const currentMonth = monthsForPage.find(month => month.index === today.getMonth()
      && month.plan.year === today.getFullYear());
    const monthToOpen = currentMonth || monthsForPage[0];
    if (!monthToOpen) return undefined;
    setInitialLoadDone(true);
    openPlanningMonth(monthToOpen, null);
    return undefined;
  }, [pageLoadGeneration, viewedQuarterKey]);

  useEffect(() => {
    if (!plansReady || pageOffset === 0 || !currentPlan?.quarter) return undefined;
    const windowForPage = quarterPageWindow({ anchorQuarter: currentPlan.quarter, anchorYear: currentPlan.year,
      pageOffset });
    const earlierKnown = [currentPlan, nextPlan].find(plan => quartersMatch(plan, windowForPage.earlier)) || null;
    const laterKnown = [currentPlan, nextPlan].find(plan => quartersMatch(plan, windowForPage.later)) || null;
    if (earlierKnown && laterKnown) return undefined;
    let active = true;
    const requestedOffset = pageOffset;
    Promise.all([
      earlierKnown ? Promise.resolve(earlierKnown) : findQuarterPlan(app, { ...windowForPage.earlier, domainName }),
      laterKnown ? Promise.resolve(laterKnown) : findQuarterPlan(app, { ...windowForPage.later, domainName }),
    ]).then(([earlier, later]) => {
      if (active) setPagedPlans({ earlier, later, pageOffset: requestedOffset });
    }).catch(error => {
      if (!active) return;
      logIfEnabled("[planning] could not load the quarter page", error?.message || error);
      const emptyPlan = quarter => ({ ...quarter, domainName, hasAllMonthlyDetails: false, noteUUID: null });
      const earlierPlan = earlierKnown || emptyPlan(windowForPage.earlier);
      const laterPlan = laterKnown || emptyPlan(windowForPage.later);
      setPagedPlans({ earlier: earlierPlan, later: laterPlan, pageOffset: requestedOffset });
    });
    return () => { active = false; };
  }, [app, currentPlan?.noteUUID, currentPlan?.quarter, currentPlan?.year, domainName, nextPlan?.noteUUID,
    nextPlan?.quarter, nextPlan?.year, pageLoadGeneration, pageOffset, plansReady]);

  useEffect(() => {
    if (!plansReady || !weekSectionVisible) return;
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
  }, [currentPlan?.noteUUID, pageLoadGeneration, plansReady, weekLabel, weekSectionVisible]);

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
  // @desc Treat the first Done on the current quarter's plan as a click on "Generate ideas", so the projects just
  //   chosen have ideas by the user's first calendar visit. Later Done clicks leave the day's runs to the user. A
  //   quarter planned ahead is skipped, since a run covers only the current quarter's projects, and so is a Done
  //   that finds the work queue off, a run under way, or the day's runs spent, leaving the next Done to try again.
  // @param {object} completedPlan - The wizard's { quarter, year }.
  const handleWizardDone = completedPlan => {
    if (!quartersMatch(completedPlan, currentPlan)) return;
    const quarterScope = { domainUuid: taskDomainUUID, quarter: completedPlan.quarter, year: completedPlan.year };
    if (hasStartedFirstPlanIdeaRun(quarterScope)) return;
    if (!ideaRun.available || ideaRun.running || !ideaRun.allowance.allowed) return;
    recordFirstPlanIdeaRun(app, quarterScope).catch(error => logIfEnabled("[planning] could not record the first plan's idea run", error?.message));
    Promise.resolve(ideaRun.start()).catch(error => logIfEnabled("[planning] could not start idea generation", error?.message));
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
      onClose={ () => { setWizardPlan(null); setPageLoadGeneration(generation => generation + 1); } }
      onDone={ () => handleWizardDone(wizardPlan) }
      onFinished={wizardPlan.mirrorTarget ? handleWizardFinished : null}
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

  if (checkingPlanProgress) {
    return (
      <WidgetWrapper title={widgetTitle} widgetId="planning">
        <p className="planning-empty">Checking your plan…</p>
        {planWizardOverlay}
      </WidgetWrapper>
    );
  }

  if (showPlanEntry) {
    const openTargetPlan = () => setWizardPlan({ mirrorTarget: null, quarter: wizardQuarterPlan.quarter, year: wizardQuarterPlan.year });
    return (
      <WidgetWrapper title={widgetTitle} widgetId="planning">
        <QuarterlyPlanEntry app={app} domainUuid={taskDomainUUID} onBuildPlan={openTargetPlan}
          onOpenSettings={onOpenSettings} onSettled={() => setPlanEntrySettled(true)} plan={wizardQuarterPlan}
          planTitle={buildPlanTitle} />
        {planWizardOverlay}
      </WidgetWrapper>
    );
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Save the open month's focus star into its Focus bullet, then show the section as saved.
  // @param {string|null} starredLabel - Project label to star, or null to clear the month's star.
  // @returns {Promise<void>} Rejects when the note could not be saved.
  const handleStarMonthProject = async (starredLabel) => {
    const starredMonth = monthContent;
    if (!starredMonth?.plan?.noteUUID) return;
    const result = await starMonthFocusProject(app, { monthName: starredMonth.monthName,
      noteUUID: starredMonth.plan.noteUUID, starredLabel });
    const isSameMonth = previous => previous?.monthName === starredMonth.monthName
      && previous?.plan?.noteUUID === starredMonth.plan.noteUUID;
    setMonthContent(previous => isSameMonth(previous) ? { ...previous, content: result.content } : previous);
  };

  const monthProjectCount = monthContent?.found && !monthLoading
    ? monthFocusProjects(monthContent.content).projects.length : null;

  const handleDevEdit = (result) => {
    if (result?.devEdit && result.noteUUID) {
      setEditingNoteUUID(result.noteUUID);
    }
  };

  // ----------------------------------------------------------------------------------------------
  // @desc Handle a click on either quarter card. A past quarter's card opens its retrospective. Any other card opens
  //   that quarter's wizard, except in the last 15 days of the quarter when the current quarter has no plan yet: an
  //   upcoming plan is copied in as this quarter's note, and when neither quarter has a plan the wizard opens on the
  //   upcoming quarter and copies its note back here once the user finishes. The fallback opens or creates the note
  //   when a card has no quarter.
  // @param {Object} plan - A quarterly plan card's plan, with the following properties:
  //   - {number|undefined} quarter - Quarter being planned, 1 through 4.
  //   - {number|undefined} year - Planning year.
  //   - {string|null} noteUUID - UUID of the existing plan note, absent until a plan has been created.
  // @returns {Promise<void>} Resolves once the wizard has been opened, the plan copied, or the note handled.
  const handleQuarterCardClick = async (plan) => {
    if (plan.pending) return;
    if (plan.quarter && plan.year && hasQuarterEnded({ quarter: plan.quarter, year: plan.year })) {
      setRetrospectivePlan(plan);
      return;
    }
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

  // ----------------------------------------------------------------------------------------------
  // @desc Save a quarter card's checkbox, mirroring it into the settings snapshot the suggestion services read.
  // @param {object} plan - The card's plan, carrying quarter and year.
  // @param {boolean} enabled - The checkbox's new state.
  const handleSuggestionToggle = (plan, enabled) => {
    const nextToggles = quarterlyPlanTogglesWithState(planToggles, { domainUuid: taskDomainUUID, enabled,
      quarter: plan.quarter, year: plan.year });
    const serialized = JSON.stringify(nextToggles);
    setPlanToggles(nextToggles);
    updatePluginSetting(SETTING_KEYS.QUARTERLY_PLAN_TOGGLES, serialized);
    Promise.resolve(app.setSetting(SETTING_KEYS.QUARTERLY_PLAN_TOGGLES, serialized)).catch(error =>
      logIfEnabled("[planning] could not save the quarterly plan checkbox", error?.message || error));
  };

  // @desc Whether a card's checkbox shows as checked, applying the lead-window default to a quarter never toggled.
  const isUsedForSuggestions = plan => isQuarterPlanEnabled({ quarter: plan.quarter, year: plan.year,
    storedState: storedQuarterToggle(planToggles, { domainUuid: taskDomainUUID, quarter: plan.quarter, year: plan.year }) });

  return (
    <WidgetWrapper headerActions={headerActions} title={widgetTitle} widgetId="planning">
      <div className="planning-quarter-row">
        <QuarterPageButton direction="previous" onClick={ () => setPageStep(step => step - 1) }
          quarter={ pageWindow.previous } />
        <div className="planning-quarters">
          {[leftPlan, rightPlan].map(plan => (
            <QuarterCard
              isPast={ hasQuarterEnded({ quarter: plan.quarter, year: plan.year }) }
              key={ plan.label }
              onCardClick={ () => handleQuarterCardClick(plan) }
              onSuggestionToggle={ enabled => handleSuggestionToggle(plan, enabled) }
              plan={ plan }
              planBegun={ !!quarterProgress(plan)?.begun }
              usedForSuggestions={ isUsedForSuggestions(plan) }
            />
          ))}
        </div>
        <QuarterPageButton direction="following" onClick={ () => setPageStep(step => step + 1) }
          quarter={ pageWindow.following } />
      </div>
      {monthProjectCount !== null && activeTab !== null && !pagePending ? (
        <MonthIntensityMeter monthName={ monthContent.monthName } projectCount={ monthProjectCount } />
      ) : null}
      <div className="month-tabs">
        {viewedMonths.map(month => (
          <button
            className={ "month-tab" + (month.index === activeTab ? " active" : "") }
            key={ month.index }
            onClick={ () => openPlanningMonth(month, activeTab) }
          >{ month.short }</button>
        ))}
      </div>
      {activeTab !== null && !pagePending ? (
        <div className="month-content-area">
          <MonthContentArea
            monthContent={monthContent}
            monthLoading={monthLoading}
            onCreatePlan={async () => {
              const result = await handleCreateMonthPlan(app, monthContent, createPlanDeps);
              handleDevEdit(result);
            }}
            onStarProject={handleStarMonthProject}
          />
        </div>
      ) : null}
      {weekSectionVisible ? (
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
      {retrospectivePlan ? (
        <QuarterRetrospective app={ app } domainName={ taskDomainName || "All Notes" } domainUuid={ taskDomainUUID }
          onClose={ () => setRetrospectivePlan(null) } plan={ retrospectivePlan } />
      ) : null}
      {ideaRun.fallbackOpen && ideaRun.snapshot ? <IdeaRunProgressPopup app={ app } onClose={ ideaRun.closeFallback } snapshot={ ideaRun.snapshot } /> : null}
    </WidgetWrapper>
  );
}
