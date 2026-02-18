export default function PlanningWidget({ quarterlyPlans }) {
  const h = React.createElement;
  const [activeTab, setActiveTab] = React.useState(new Date().getMonth());

  const handleOpenPlan = async (plan) => {
    if (plan.noteUUID) {
      await callPlugin('navigateToNote', plan.noteUUID);
    } else {
      await callPlugin('createQuarterlyPlan', {
        label: plan.label, year: plan.year, quarter: plan.quarter
      });
    }
  };

  const months = _getQuarterMonths(quarterlyPlans.current, quarterlyPlans.next);

  return h(WidgetWrapper, { title: 'Planning', icon: '📋', widgetId: 'planning' },
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
          onClick: () => setActiveTab(m.index)
        }, m.short)
      )
    )
  );
}

function _getQuarterMonths(current, next) {
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const startMonth = (current.quarter - 1) * 3;
  const months = [];
  for (let i = 0; i < 6; i++) {
    const idx = (startMonth + i) % 12;
    months.push({ index: idx, short: MONTH_NAMES[idx] });
  }
  return months;
}
