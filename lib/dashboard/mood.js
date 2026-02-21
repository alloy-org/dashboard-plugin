import React from "react";
import WidgetWrapper from "./widget-wrapper";

export default function MoodWidget({ moodRatings }) {
  const h = React.createElement;
  const MOODS = [
    { value: -2, emoji: '😢', label: 'Awful' },
    { value: -1, emoji: '😟', label: 'Bad' },
    { value: 0, emoji: '😐', label: 'Okay' },
    { value: 1, emoji: '🙂', label: 'Good' },
    { value: 2, emoji: '😄', label: 'Great' }
  ];

  // Note: Mood recording may require a separate Amplenote API not yet exposed to plugins.
  // This widget displays mood data read via app.getMoodRatings.
  // If a mood-recording API becomes available, add it here.

  const recentMoods = (moodRatings || []).slice(-7);
  const avgMood = recentMoods.length
    ? (recentMoods.reduce((s, m) => s + m.rating, 0) / recentMoods.length).toFixed(1)
    : '—';

  return h(WidgetWrapper, { title: 'How are you feeling?', icon: '🎭', widgetId: 'mood' },
    h('div', { className: 'mood-selector' },
      MOODS.map(m => h('button', {
        key: m.value,
        className: 'mood-btn',
        title: m.label
      }, h('span', { className: 'mood-emoji' }, m.emoji)))
    ),
    h('div', { className: 'mood-summary' },
      h('span', null, 'Avg mood (7d): ' + avgMood),
      h('div', { className: 'mood-sparkline' },
        recentMoods.map((m, i) => h('div', {
          key: i,
          className: 'mood-dot',
          style: { bottom: ((m.rating + 2) / 4 * 100) + '%' }
        }))
      )
    )
  );
}
