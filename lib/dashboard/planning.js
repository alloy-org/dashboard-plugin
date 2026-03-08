/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Planning widget — quarterly plan cards and month tabs
 * Prompt summary: "widget showing current/next quarter plans with month tab navigation"
 */
import { getQuarterMonths } from "constants/quarters";
import { widgetTitleFromId } from "constants/settings";
import { createElement, useEffect, useState } from "react";
import { logIfEnabled } from "util/log";
import { renderBlockMarkdown } from "util/utility";
import WidgetWrapper from "widget-wrapper";

// [Claude] Task: render quarterly plan cards, month tabs, and expandable monthly content
// Prompt: "when a month is clicked, check the quarterly plan note for a section that corresponds with the month"
// Date: 2026-03-08 | Model: claude-4.6-opus-high-thinking
export default function PlanningWidget({ quarterlyPlans }) {
  const h = createElement;
  const [activeTab, setActiveTab] = useState(null);
  const [monthContent, setMonthContent] = useState(null);
  const [monthLoading, setMonthLoading] = useState(false);
  const [planOverrides, setPlanOverrides] = useState({});
  const [initialLoadDone, setInitialLoadDone] = useState(false);

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
        await callPlugin('navigateToNote', result.noteUUID);
      }
    } catch {
      // keep showing the create link on error
    } finally {
      setMonthLoading(false);
    }
  };

  // [Claude] Task: auto-select the current month tab on first render
  // Prompt: "update quarters.js so that, by default, the current month is selected"
  // Date: 2026-03-08 | Model: claude-4.6-opus-high-thinking
  useEffect(() => {
    if (initialLoadDone) return;
    const currentMonth = months.find(m => m.current);
    if (currentMonth) {
      setInitialLoadDone(true);
      handleMonthClick(currentMonth);
    }
  }, [initialLoadDone]);

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
                  h('div', {
                    className: 'month-content-text',
                    dangerouslySetInnerHTML: {
                      __html: renderBlockMarkdown(monthContent.content) || '<p>(Empty section)</p>'
                    }
                  })
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
