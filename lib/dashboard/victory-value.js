import { createElement, useEffect, useRef } from "react"
import WidgetWrapper from "./widget-wrapper"

export default function VictoryValueWidget({ dailyValues, weeklyTotal, moodRatings, settings }) {
  const h = createElement;
  const canvasRef = useRef(null);
  const maxValue = Math.max(...dailyValues.map(d => d.value), 1);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width = canvas.offsetWidth * 2;
    const H = canvas.height = canvas.offsetHeight * 2;
    ctx.scale(2, 2); // Retina
    const w = W / 2, ht = H / 2;
    const barW = (w - 80) / 7;
    const chartH = ht - 50;

    ctx.clearRect(0, 0, w, ht);

    // Bars
    dailyValues.forEach((d, i) => {
      const barH = (d.value / maxValue) * chartH * 0.85;
      const x = 40 + i * barW + barW * 0.15;
      const y = chartH - barH + 10;
      ctx.fillStyle = d.value > 0 ? '#6366f1' : '#e5e7eb';
      ctx.beginPath();
      ctx.roundRect(x, y, barW * 0.7, barH, [4, 4, 0, 0]);
      ctx.fill();

      // Day label
      ctx.fillStyle = '#6b7280';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(d.day, x + barW * 0.35, ht - 12);

      // Value on bar
      if (d.value > 0) {
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 10px system-ui';
        ctx.fillText(d.value, x + barW * 0.35, y + 14);
      }
    });

    // Mood trend line overlay (if showMoodOverlay setting is on)
    if (moodRatings && moodRatings.length > 0) {
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      moodRatings.forEach((m, i) => {
        // Normalize mood from [-2,2] to chart height
        const normalizedY = chartH - ((m.rating + 2) / 4) * chartH + 10;
        const x = 40 + i * barW + barW * 0.5;
        i === 0 ? ctx.moveTo(x, normalizedY) : ctx.lineTo(x, normalizedY);
      });
      ctx.stroke();

      // Mood dots
      moodRatings.forEach((m, i) => {
        const normalizedY = chartH - ((m.rating + 2) / 4) * chartH + 10;
        const x = 40 + i * barW + barW * 0.5;
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(x, normalizedY, 3, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }, [dailyValues, moodRatings]);

  return h(WidgetWrapper, {
    title: 'Victory Value', icon: '🏆', widgetId: 'victory-value', configurable: true
  },
    h('div', { className: 'vv-header' },
      h('span', { className: 'vv-total' }, weeklyTotal),
      h('span', { className: 'vv-label' }, 'points this week')
    ),
    h('canvas', { ref: canvasRef, className: 'vv-chart', style: { width: '100%', height: '180px' } })
  );
}
