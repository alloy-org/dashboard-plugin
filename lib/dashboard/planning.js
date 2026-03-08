/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Planning widget — quarterly plan cards and month tabs
 * Prompt summary: "widget showing current/next quarter plans with month tab navigation"
 */
import { getQuarterMonths } from "constants/quarters";
import { widgetTitleFromId } from "constants/settings";
import React from "react";
import WidgetWrapper from "widget-wrapper";

// [Claude] Task: render quarterly plan cards, month tabs, and expandable monthly content
// Prompt: "when a month is clicked, check the quarterly plan note for a section that corresponds with the month"
// Date: 2026-03-08 | Model: claude-4.6-opus-high-thinking
export default function PlanningWidget({ quarterlyPlans }) {
  const h = React.createElement;
  const [activeTab, setActiveTab] = React.useState(null);
  const [monthContent, setMonthContent] = React.useState(null);
  const [monthLoading, setMonthLoading] = React.useState(false);
  const [planOverrides, setPlanOverrides] = React.useState({});

  if (!quarterlyPlans?.current || !quarterlyPlans?.next) {
    return h(WidgetWrapper, { title: widgetTitleFromId('planning'), icon: '📋', widgetId: 'planning' },
      h('p', { className: 'planning-empty' }, 'Loading quarterly plans…')
    );
  }

  const handleOpenPlan = async (plan) => {
    if (plan.noteUUID) {
      await callPlugin('navigateToNote', plan.noteUUID);
    } else {
      await callPlugin('createQuarterlyPlan', {
        label: plan.label, year: plan.year, quarter: plan.quarter
      });
    }
  };

  const months = getQuarterMonths(quarterlyPlans.current, quarterlyPlans.next);

  const effectiveNoteUUID = (plan) => planOverrides[plan.label] || plan.noteUUID;

  // [Claude] Task: month click handler — fetches section content via getMonthlyPlanContent
  // Prompt: "when a month is clicked, check the quarterly plan note for a section that corresponds with the month"
  // Date: 2026-03-08 | Model: claude-4.6-opus-high-thinking
  const handleMonthClick = async (month) => {
    if (activeTab === month.index) {
      setActiveTab(null);
      setMonthContent(null);
      return;
    }

    setActiveTab(month.index);
    setMonthLoading(true);
    setMonthContent(null);

    const noteUUID = effectiveNoteUUID(month.plan);

    try {
      if (!noteUUID) {
        setMonthContent({ found: false, plan: month.plan, monthName: month.full, year: month.plan.year });
      } else {
        const result = await callPlugin('getMonthlyPlanContent', noteUUID, month.full);
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
  };

  // [Claude] Task: create-a-plan click handler — creates or appends month section
  // Prompt: "create a quarterly plan note for the month or append to the existing quarterly plan note"
  // Date: 2026-03-08 | Model: claude-4.6-opus-high-thinking
  const handleCreatePlan = async () => {
    if (!monthContent) return;
    setMonthLoading(true);
    try {
      const result = await callPlugin('createOrAppendMonthlyPlan', monthContent.plan, monthContent.monthName);
      if (result && result.noteUUID) {
        setPlanOverrides(prev => ({ ...prev, [monthContent.plan.label]: result.noteUUID }));
        setMonthContent(prev => ({ ...prev, found: true, content: result.content || '' }));
      }
    } catch {
      // keep showing the create link on error
    } finally {
      setMonthLoading(false);
    }
  };

  return h(WidgetWrapper, { title: widgetTitleFromId('planning'), icon: '📋', widgetId: 'planning' },
    h('div', { className: 'planning-quarters' },
      [quarterlyPlans.current, quarterlyPlans.next].map(plan =>
        h('div', { key: plan.label, className: 'quarter-card', onClick: () => handleOpenPlan(plan) },
          h('span', { className: 'quarter-label' }, plan.label),
          h('span', { className: 'quarter-status' },
            plan.noteUUID ? '📝 Open Plan' : '+ Create Plan'
          )
        )
      )
    ),
    h('div', { className: 'month-tabs' },
      months.map(m =>
        h('button', {
          key: m.index,
          className: 'month-tab' + (m.index === activeTab ? ' active' : ''),
          onClick: () => handleMonthClick(m),
        }, m.short)
      )
    ),
    activeTab !== null ? h('div', { className: 'month-content-area' },
      monthLoading
        ? h('div', { className: 'month-content-loading' }, 'Loading…')
        : monthContent && (
            monthContent.found
              ? h('div', { className: 'month-content' },
                  h('div', { className: 'month-content-header' }, monthContent.monthName),
                  h('div', { className: 'month-content-text' },
                    monthContent.content || '(Empty section)')
                )
              : h('div', { className: 'month-content-empty' },
                  h('button', {
                    className: 'create-month-plan-link',
                    onClick: handleCreatePlan,
                  }, `Create a plan for ${monthContent.monthName} ${monthContent.year}`)
                )
          )
    ) : null
  );
}
