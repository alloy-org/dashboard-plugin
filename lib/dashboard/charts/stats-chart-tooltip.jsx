// Tooltips for dashboard charts, in the layout the host app's Task Stats tooltips use: a title row with an icon, then
// one stat row per value, each with a small icon in front. Content is React, rendered into the tooltip on show.
import { useCanvasTippy } from "dashboard/dashboard-tooltip-tippy";
import { ICON_DEFAULTS } from "dashboard/icon-defaults";
import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { IconContext } from "react-icons";

const STAT_ICON_SIZE = 14;
const TITLE_ICON_SIZE = 18;

// Positioning for chart tooltips; the 'dashboard-chart' theme is styled in styles/dashboard-tippy.scss.
export const STATS_CHART_TOOLTIP_OPTIONS = { arrow: false, interactive: true, offset: [ 0, 8 ],
  placement: "right-start", popperOptions: { modifiers: [ { name: "flip",
    options: { fallbackPlacements: [ "left-start", "bottom", "top" ] } } ] }, theme: "dashboard-chart" };

// ------------------------------------------------------------------------------------------
// @desc One stat row: an icon, the text (or rendered markup), and optional right-aligned trailing text.
// @param {Object} props - { className, html, Icon, iconColor, text, trailing }: `html` is trusted, already-rendered
//   markup (task content) shown in place of `text`; `iconColor` overrides the icon's color.
// @returns {JSX.Element} The row.
export function StatsChartTooltipRow({ children, className, html, Icon, iconColor, text, trailing }) {
  return (
    <div className={ `stats-chart-tooltip-stat${ className ? ` ${ className }` : "" }` }>
      { Icon ? <Icon className="stats-chart-tooltip-icon" size={ STAT_ICON_SIZE } style={ iconColor ? { color: iconColor } : undefined } /> : null }
      { html ? <span className="stats-chart-tooltip-text" dangerouslySetInnerHTML={ { __html: html } } />
        : <span className="stats-chart-tooltip-text">{ text }{ children }</span> }
      { trailing ? <span className="stats-chart-tooltip-trailing">{ trailing }</span> : null }
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// @desc A chart tooltip: a title row with an icon, then its stat rows.
// @param {Object} props - { children, title, TitleIcon }: the rows, the title text, and the title's icon component.
// @returns {JSX.Element} The tooltip content.
export function StatsChartTooltipContent({ children, title, TitleIcon }) {
  return (
    <div className="stats-chart-tooltip-content">
      <div className="stats-chart-tooltip-title">
        { TitleIcon ? <TitleIcon className="stats-chart-tooltip-icon" size={ TITLE_ICON_SIZE } /> : null }
        <span className="stats-chart-tooltip-title-text">{ title }</span>
      </div>
      { children }
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// @desc A chart tooltip anchored at a screen point, showing React content. The tooltip lives outside the dashboard's
//   React tree, so its content renders through its own root, with the dashboard's icon defaults.
// @returns {Object} { scheduleHide(delay), show(content, screenX, screenY, options) }.
export function useStatsChartTooltip() {
  const tooltip = useCanvasTippy(STATS_CHART_TOOLTIP_OPTIONS);
  const contentRef = useRef(null);
  useEffect(() => () => {
    const content = contentRef.current;
    contentRef.current = null;
    if (content) setTimeout(() => content.root.unmount(), 0);
  }, []);

  // ------------------------------------------------------------------------------------------
  // @desc Render the content synchronously, so the tooltip measures its final size, then show it at the point. Charts
  //   call this from an effect, where React cannot flush another root, so the render waits for a microtask.
  function show(content, screenX, screenY, options) {
    if (!contentRef.current) {
      const element = document.createElement("div");
      contentRef.current = { element, root: createRoot(element) };
    }
    const { element, root } = contentRef.current;
    queueMicrotask(() => {
      if (contentRef.current?.root !== root) return;
      flushSync(() => root.render(<IconContext.Provider value={ ICON_DEFAULTS }>{ content }</IconContext.Provider>));
      tooltip.show(element, screenX, screenY, options);
    });
  }

  return { scheduleHide: tooltip.scheduleHide, show };
}
