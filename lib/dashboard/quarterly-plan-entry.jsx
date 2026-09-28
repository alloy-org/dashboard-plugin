// The splash Quarterly Planning shows until the quarter it would open in Plan Builder has a note: import
// when there are fewer than 25 tasks, connect AI when there are enough tasks but no working model, and a
// video invitation once both are in place.
import { daysUntilQuarterStart, quarterMonthNames, quarterStartDate } from "constants/quarters";
import { resolveQuarterlyPlanEntry } from "quarterly-plan-service";
import { useEffect, useState } from "react";

import "styles/quarterly-plan-entry.scss";

const READY_BENEFITS = [
  { detail: "Each month gets a focus and a key move, drawn from your own tasks.", icon: "focus",
    title: "A focus for every month" },
  { detail: "Daily task suggestions come from your quarterly plan, not just whatever is due.", icon: "agenda",
    title: "Agendas that follow your goals" },
  { detail: "See which tasks actually move your quarter forward, and let the rest wait without guilt.", icon: "rank",
    title: "Less urgent, more important" },
];

// ----------------------------------------------------------------------------------------------
// @desc "Q4 starts Thursday, Oct 1" while the target quarter is still ahead. A quarter already underway
//   has no start badge.
// @param {Object} plan - Target quarter, with label, quarter, and year
// @returns {string|null} The badge text, or null once the quarter has started
function quarterStartsPhrase(plan) {
  if (!plan?.quarter || !plan?.year) return null;
  if (daysUntilQuarterStart({ quarter: plan.quarter, year: plan.year }) <= 0) return null;
  const start = quarterStartDate(plan.year, plan.quarter);
  const weekdayName = start.toLocaleDateString("en-US", { weekday: "long" });
  const monthName = start.toLocaleDateString("en-US", { month: "short" });
  return `${ plan.label } starts ${ weekdayName }, ${ monthName } ${ start.getDate() }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Headline for the ready splash. Names the quarter, and says it has not begun when that is still true.
// @param {Object} plan - Target quarter, with label, quarter, and year
// @returns {string} The headline
function readyHeadline(plan) {
  const beforeQuarter = daysUntilQuarterStart({ quarter: plan.quarter, year: plan.year }) > 0;
  return beforeQuarter ? `Set your ${ plan.label } plan before the quarter begins` : `Set your ${ plan.label } plan`;
}

// ----------------------------------------------------------------------------------------------
// @desc Line icon for one import source. Decorative; the button label carries the name.
// @param {Object} props - { sourceId }
// @returns {JSX.Element} A 24px stroke icon
function ImportSourceIcon({ sourceId }) {
  const path = {
    evernote: "M6 4h8a2 2 0 0 1 2 2v12l-6-3-6 3V6a2 2 0 0 1 2-2z",
    markdown: "M4 6h16v12H4zM7 15V9l2.5 3L12 9v6",
    notion: "M8 4h6l4 4v11a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z",
    obsidian: "M12 3l7 4v10l-7 4-7-4V7z",
    todoist: "M5 7h14M5 12h14M5 17h9",
  }[sourceId];
  return (
    <svg aria-hidden="true" className="plan-entry-source-icon" viewBox="0 0 24 24">
      <path d={ path } fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
    </svg>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Small mark beside a ready-splash benefit.
// @param {Object} props - { name } One of focus, agenda, rank
// @returns {JSX.Element} A circled stroke icon
function BenefitIcon({ name }) {
  const path = {
    agenda: "M7 4v2M17 4v2M6 8h12v10H6zM8 12h4",
    focus: "M12 8v4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
    rank: "M5 16l4-4 3 3 7-7",
  }[name];
  return (
    <svg aria-hidden="true" className="plan-entry-benefit-icon" viewBox="0 0 24 24">
      <circle cx="12" cy="12" fill="none" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path d={ path } fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
    </svg>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Import splash: progress toward 25 tasks, a button per importer, and a path that builds from scratch.
// @param {Object} props - { entry, onBuildPlan, onNavigate, planTitle }
// @returns {JSX.Element} The import splash
function ImportTasksEntry({ entry, onBuildPlan, onNavigate, planTitle }) {
  const taskCount = entry.applicableTaskCount;
  const filledPercent = Math.min(100, Math.round((taskCount / entry.taskThreshold) * 100));
  const taskLabel = taskCount === 1 ? "1 task in your notes" : `${ taskCount } tasks in your notes`;
  return (
    <div className="quarterly-plan-entry quarterly-plan-entry--import">
      <h3 className="plan-entry-title">Start your plan from what you've already been doing</h3>
      <p className="plan-entry-copy">Your quarterly plan is built from the tasks you've already captured. Bring them
        over from your previous app and the Plan Builder will suggest goals, plus a focus and key move for each month.</p>
      <div className="plan-entry-progress">
        <div className="plan-entry-progress-labels">
          <span>{ taskLabel }</span>
          <span>{ entry.taskThreshold }+ gives the best plan</span>
        </div>
        <div aria-valuemax={ entry.taskThreshold } aria-valuemin={ 0 } aria-valuenow={ taskCount }
          className="plan-entry-progress-track" role="progressbar">
          <div className="plan-entry-progress-fill" style={{ width: `${ filledPercent }%` }} />
        </div>
      </div>
      <p className="plan-entry-kicker">Import tasks from</p>
      <div className="plan-entry-sources">
        { entry.importSources.map(source => (
          <button className="plan-entry-source" key={ source.id } onClick={ () => onNavigate(source.url) } type="button">
            <ImportSourceIcon sourceId={ source.id } />
            { source.label }
          </button>
        )) }
      </div>
      <p className="plan-entry-divider">or</p>
      <button className="plan-entry-scratch" onClick={ onBuildPlan } title={ planTitle } type="button">
        ✦ Build my plan from scratch
      </button>
      <p className="plan-entry-footnote">Answer a few guided questions instead. You can import tasks later.</p>
    </div>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Enough tasks, no working AI. Agent Pro and an LLM key are the two ways forward.
// @param {Object} props - { entry, onNavigate, onOpenSettings, plan }
// @returns {JSX.Element} The needs-AI splash
function NeedsAiEntry({ entry, onNavigate, onOpenSettings, plan }) {
  const monthNames = quarterMonthNames(plan.quarter).map(monthName => monthName.slice(0, 3));
  return (
    <div className="quarterly-plan-entry quarterly-plan-entry--needs-ai">
      <h3 className="plan-entry-title">Your { entry.applicableTaskCount } tasks are ready to become a plan</h3>
      <p className="plan-entry-copy">The Plan Builder reads what you've captured, groups it into themes, and proposes
        quarterly goals with a focus and key move for each month. It just needs an AI model to do the thinking.</p>
      <div className="plan-entry-preview">
        <p className="plan-entry-kicker">Preview · { plan.label }</p>
        <div className="plan-entry-months">
          { monthNames.map((monthName, index) => (
            <span className={ index === 0 ? "plan-entry-month plan-entry-month--current" : "plan-entry-month" }
              key={ monthName }>{ monthName }</span>
          )) }
        </div>
        <div className="plan-entry-preview-row"><span>Focus</span><i className="plan-entry-preview-bar plan-entry-preview-bar--focus" /></div>
        <div className="plan-entry-preview-row"><span>Key move</span><i className="plan-entry-preview-bar plan-entry-preview-bar--move" /></div>
      </div>
      <div className="plan-entry-choices">
        <div className="plan-entry-choice plan-entry-choice--recommended">
          <p className="plan-entry-choice-badge">Recommended</p>
          <h4 className="plan-entry-choice-title">Ample Agent Pro</h4>
          <p className="plan-entry-choice-copy">Hosted AI with nothing to configure. Works the moment you subscribe.</p>
          <p className="plan-entry-choice-price">{ entry.agentProPriceLabel }/month</p>
          <button className="plan-entry-choice-button plan-entry-choice-button--primary"
            onClick={ () => onNavigate(entry.agentProUrl) } type="button">Subscribe to Agent Pro</button>
        </div>
        <div className="plan-entry-choice">
          <h4 className="plan-entry-choice-title">Use your own key</h4>
          <p className="plan-entry-choice-copy">Connect an API key from a supported LLM provider. Usage is billed by
            your provider.</p>
          <p className="plan-entry-choice-price">Pay as you go</p>
          <button className="plan-entry-choice-button" onClick={ onOpenSettings } type="button">Add LLM key</button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Enough tasks and a working model. The video explains the builder, then the button opens it.
// @param {Object} props - { entry, onBuildPlan, plan }
// @returns {JSX.Element} The ready splash
function ReadyPlanEntry({ entry, onBuildPlan, plan }) {
  const startsPhrase = quarterStartsPhrase(plan);
  return (
    <div className="quarterly-plan-entry quarterly-plan-entry--ready">
      { startsPhrase ? <p className="plan-entry-starts">{ startsPhrase }</p> : null }
      <h3 className="plan-entry-title">{ readyHeadline(plan) }</h3>
      <p className="plan-entry-copy">You have { entry.applicableTaskCount } tasks to build from. The Plan Builder turns
        them into a handful of quarterly goals, then keeps your daily agenda pointed at them.</p>
      <div className="plan-entry-video">
        <iframe allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen className="plan-entry-video-frame" src={ entry.videoEmbedUrl }
          title="How quarterly planning works in Amplenote" />
        <p className="plan-entry-video-caption"><span>Watch</span> How quarterly planning works in Amplenote</p>
      </div>
      <ul className="plan-entry-benefits">
        { READY_BENEFITS.map(benefit => (
          <li className="plan-entry-benefit" key={ benefit.title }>
            <BenefitIcon name={ benefit.icon } />
            <span>
              <strong>{ benefit.title }</strong>
              { benefit.detail }
            </span>
          </li>
        )) }
      </ul>
      <button className="plan-entry-build" onClick={ onBuildPlan } type="button">✦ Build my { plan.label } plan</button>
      <p className="plan-entry-footnote">Uses your connected AI model</p>
    </div>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Load the entry state and render the splash it names. Settings closing re-runs the check, so a key
//   saved there can move the splash from needs-AI to ready.
// @param {Object} props - An object with the following properties:
//   - {Object} app - Amplenote embed app proxy
//   - {string|null} domainUuid - Active task domain, or null for all notes
//   - {Function} onBuildPlan - Opens Plan Builder for the target quarter
//   - {Function|null} onOpenSettings - Opens plugin settings, then runs the callback it is given
//   - {Function} onSettled - Called once the entry state has been resolved
//   - {Object} plan - Target quarter plan, with label, quarter, and year
//   - {string} planTitle - Tooltip for the from-scratch button
// @returns {JSX.Element} The splash, or a short waiting line while the state resolves
export default function QuarterlyPlanEntry({ app, domainUuid, onBuildPlan, onOpenSettings, onSettled = () => {}, plan,
    planTitle }) {
  const [entryState, setEntryState] = useState(null);
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    let active = true;
    setEntryState(null);
    resolveQuarterlyPlanEntry(app, { domainUuid }).then(state => {
      if (!active) return;
      setEntryState(state);
      onSettled();
    });
    return () => { active = false; };
  }, [app, domainUuid, refreshCount]);

  const openSettings = () => { if (onOpenSettings) onOpenSettings(() => setRefreshCount(count => count + 1)); };
  const navigate = url => { app.navigate(url); };
  if (!entryState) return <p className="quarterly-plan-entry quarterly-plan-entry--loading">Checking your notes…</p>;
  if (entryState.kind === "needs-ai") {
    return <NeedsAiEntry entry={ entryState } onNavigate={ navigate } onOpenSettings={ openSettings } plan={ plan } />;
  }
  if (entryState.kind === "ready") return <ReadyPlanEntry entry={ entryState } onBuildPlan={ onBuildPlan } plan={ plan } />;
  return <ImportTasksEntry entry={ entryState } onBuildPlan={ onBuildPlan } onNavigate={ navigate } planTitle={ planTitle } />;
}
