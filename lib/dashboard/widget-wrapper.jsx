/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Reusable widget wrapper with header, icon, and optional configure button
 * Prompt summary: "shared widget chrome component used by all dashboard widgets"
 */
import { widgetIconFromId, widgetSubtitleFromId, widgetTitleFromId } from "constants/settings";
import { createContext, useContext } from "react"
import DraggableHeading from "draggable-heading";

import "./styles/widget.scss";

// [OpenAI gpt-5.4] Task: share dashboard cell sizing with WidgetWrapper
// Prompt: "when a widget is resized from dashboard-layout-popup, update the inner widget-* sizing classes too"
export const WidgetSizeContext = createContext(null);

/**
 * [Claude] Task: add full JSDoc parameter documentation to WidgetWrapper
 * Prompt: "Update WidgetWrapper with full JSDoc for each of its parameters"
 * Date: 2026-02-21 | Model: claude-sonnet-4-6
 *
 * Shared chrome component rendered around every dashboard widget. Provides a
 * consistent header bar (icon + title + optional configure button) and a body
 * region for widget-specific content.
 */
// [Claude] Task: add onConfigure callback prop to support inline popup configuration
// Prompt: "popup component that pops up setting options upon clicking Configure"
// Date: 2026-02-22 | Model: claude-opus-4-6
// [Claude] Task: add sizing classes (horizontal-N-cell, vertical-N-cell) to widget root element
// Prompt: "Ensure that the widget-calendar widget also possesses the classes applied for its sizing"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
// [Claude claude-4.7-opus] Task: migrate WidgetWrapper from createElement to JSX
// Prompt: "translate this project to render components with JSX instead"
// ------------------------------------------------------------------------------------------
// @desc The header's icon, title, and subtitle all default to what WIDGET_REGISTRY says about
//   widgetId, so a widget only names them when it needs something the registry cannot know (a
//   state-dependent icon, a subtitle carrying today's date or a chosen note's name). A widgetId
//   missing from the registry falls back to no icon and the id itself as the title.
// [Claude claude-opus-5 (1M context)] Task: default icon/title/subtitle from the widget registry
// Prompt: "sets default title, icon and subtitle props based on the widgetId that is passed to the
//   component ... so they don't need to include icon/title/subtitle"
export default function WidgetWrapper({ app, children, configurable, gridHeightSize, gridWidthSize, headerActions,
    icon, onConfigure, subtitle, title, widgetId }) {
  const cellSizing = useContext(WidgetSizeContext);
  const resolvedIcon = icon ?? widgetIconFromId(widgetId);
  const resolvedSubtitle = subtitle ?? widgetSubtitleFromId(widgetId);
  const resolvedTitle = title ?? widgetTitleFromId(widgetId);
  const handleConfigure = async () => {
    if (onConfigure) {
      onConfigure();
    } else if (app) {
      const result = await app.configure(widgetId);
      if (result) window.location.reload();
    }
  };
  const resolvedGridWidthSize = gridWidthSize ?? cellSizing?.gridWidthSize;
  const resolvedGridHeightSize = gridHeightSize ?? cellSizing?.gridHeightSize;
  const w = Number(resolvedGridWidthSize) > 0 ? Number(resolvedGridWidthSize) : 1;
  const hSize = Number(resolvedGridHeightSize) > 0 ? Number(resolvedGridHeightSize) : 1;
  const sizeClasses = `horizontal-${w}-cell vertical-${hSize}-cell`;
  return (
    <div className={`widget widget-${widgetId} ${sizeClasses}`}>
      <DraggableHeading
        configurable={configurable}
        headerActions={headerActions}
        icon={resolvedIcon}
        subtitle={resolvedSubtitle}
        title={resolvedTitle}
        widgetId={widgetId}
        onConfigure={handleConfigure}
      />
      <div className="widget-body">{children}</div>
    </div>
  );
}
