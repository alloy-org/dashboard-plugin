// Shared SVG chart pieces drawn the way the host app's Task Stats graph draws them: faint grid lines with low-contrast
// value labels, uppercase axis labels, and a hovered column marked by a highlight line and a value pill.
import { useEffect, useRef, useState } from "react";
import "dashboard/styles/stats-chart.scss";

const DEFAULT_GRID_LABEL_COUNT = 4;
const GRID_LABEL_HORIZONTAL_OFFSET = 8;
const GRID_LABEL_VERTICAL_OFFSET = 4;
const VALUE_PILL_CHARACTER_WIDTH = 7;
const VALUE_PILL_HEIGHT = 18;
const VALUE_PILL_HORIZONTAL_PADDING = 12;
const X_AXIS_LABEL_OFFSET = 18;
const X_AXIS_SUBLABEL_OFFSET = 14;

// ------------------------------------------------------------------------------------------
// @desc A soft vertical rule centered on the hovered column, drawn before the bars so it sits behind them.
// @param {Object} props - { plot, x }: the plot area's edges and the column's center.
// @returns {JSX.Element} The highlight line.
export function ChartHighlightLine({ plot, x }) {
  return <line className="stats-chart-highlight-line" x1={ x } x2={ x } y1={ plot.top } y2={ plot.bottom } />;
}

// ------------------------------------------------------------------------------------------
// @desc A transparent full-height target covering one column, so hovering anywhere in the column selects it.
// @param {Object} props - { index, onEnter, onLeave, plot, width, x }: the column's index, hover callbacks, the plot
//   area's edges, and the column's width and left edge.
// @returns {JSX.Element} The hit area.
export function ChartHitArea({ index, onEnter, onLeave, plot, width, x }) {
  return (
    <rect className="stats-chart-hit-area" height={ plot.bottom - plot.top } onMouseEnter={ () => onEnter(index) }
      onMouseLeave={ onLeave } width={ width } x={ x } y={ plot.top } />
  );
}

// ------------------------------------------------------------------------------------------
// @desc Horizontal grid lines with their values labeled to the left, from zero at the base to the maximum at the top.
// @param {Object} props - { formatLabel, labelCount, maximum, plot }: label formatter, number of steps above zero, the
//   value at the top line, and the plot area's edges.
// @returns {JSX.Element} The grid.
export function ChartGridLines({ formatLabel = String, labelCount = DEFAULT_GRID_LABEL_COUNT, maximum, plot }) {
  const steps = Array.from({ length: labelCount + 1 }, (unused, index) => index);
  return (
    <g className="stats-chart-grid">
      { steps.map(step => {
        const y = plot.bottom - ((plot.bottom - plot.top) * step) / labelCount;
        return (
          <g key={ step }>
            <text className="stats-chart-grid-label" x={ plot.left - GRID_LABEL_HORIZONTAL_OFFSET }
              y={ y + GRID_LABEL_VERTICAL_OFFSET }>{ formatLabel((maximum * step) / labelCount) }</text>
            <line className="stats-chart-grid-line" x1={ plot.left } x2={ plot.right } y1={ y } y2={ y } />
          </g>
        );
      }) }
    </g>
  );
}

// ------------------------------------------------------------------------------------------
// @desc Value pill drawn at the top of the hovered column: a rounded rect in the given color with the value inside.
// @param {Object} props - { className, text, x, y }: extra class for the fill color, the label, and the pill's center.
// @returns {JSX.Element} The pill.
export function ChartValuePill({ className, text, x, y }) {
  const width = Math.max(VALUE_PILL_HEIGHT, String(text).length * VALUE_PILL_CHARACTER_WIDTH + VALUE_PILL_HORIZONTAL_PADDING);
  const top = Math.round(y - VALUE_PILL_HEIGHT / 2);
  return (
    <g className={ `stats-chart-value-pill${ className ? ` ${ className }` : "" }` }>
      <rect height={ VALUE_PILL_HEIGHT } rx={ VALUE_PILL_HEIGHT / 2 } width={ width } x={ x - width / 2 } y={ top } />
      <text x={ x } y={ top + VALUE_PILL_HEIGHT / 2 }>{ text }</text>
    </g>
  );
}

// ------------------------------------------------------------------------------------------
// @desc Labels under the plot, each centered on its column, with an optional smaller second line.
// @param {Object} props - { labels, plot }: [{ key, sublabel, text, x }] and the plot area's edges.
// @returns {JSX.Element} The axis labels.
export function ChartXAxisLabels({ labels, plot }) {
  return (
    <g className="stats-chart-x-axis">
      { labels.map(label => (
        <g key={ label.key }>
          <text className="stats-chart-x-axis-label" x={ label.x } y={ plot.bottom + X_AXIS_LABEL_OFFSET }>
            { label.text }
          </text>
          { label.sublabel ? (
            <text className="stats-chart-x-axis-sublabel" x={ label.x }
              y={ plot.bottom + X_AXIS_LABEL_OFFSET + X_AXIS_SUBLABEL_OFFSET }>{ label.sublabel }</text>
          ) : null }
        </g>
      )) }
    </g>
  );
}

// ------------------------------------------------------------------------------------------
// @desc Round a chart's largest value up so the grid's steps land on whole numbers.
// @param {number} value - Largest plotted value.
// @param {number} labelCount - Number of grid steps above zero.
// @returns {number} The value at the top grid line, at least labelCount.
export function niceChartMaximum(value, labelCount = DEFAULT_GRID_LABEL_COUNT) {
  const rawStep = Math.max(value, 1) / labelCount;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const niceStep = [ 1, 2, 2.5, 5, 10 ].map(factor => factor * magnitude).find(step => step >= rawStep);
  return Math.max(Math.ceil(niceStep) * labelCount, labelCount);
}

// ------------------------------------------------------------------------------------------
// @desc Track an element's rendered size, so an SVG chart can lay itself out in real pixels.
// @returns {Array} [ ref to attach to the measured element, { height, width } in pixels ].
export function useElementSize() {
  const elementRef = useRef(null);
  const [ size, setSize ] = useState({ height: 0, width: 0 });
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return undefined;
    const { height, width } = element.getBoundingClientRect();
    setSize({ height, width });
    if (typeof ResizeObserver === "undefined") return undefined;
    const sizeObserver = new ResizeObserver(entries => {
      const { height: observedHeight, width: observedWidth } = entries[0].contentRect;
      setSize({ height: observedHeight, width: observedWidth });
    });
    sizeObserver.observe(element);
    return () => sizeObserver.disconnect();
  }, []);
  return [ elementRef, size ];
}
