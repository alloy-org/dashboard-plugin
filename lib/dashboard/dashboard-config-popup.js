import { createElement, useState, useRef } from "react";
import { WIDGET_REGISTRY } from "constants/settings";

// ── Pure data helpers ─────────────────────────────────────────────────────────────────

// Looks up a widget definition by its unique ID in the global registry.
// @param {string} widgetId - The widget identifier to search for
// @returns {object|undefined} The matching widget definition, or undefined if not found
function getWidget(widgetId) {
  return WIDGET_REGISTRY.find(w => w.widgetId === widgetId);
}

// Derives the initial rendered and hidden widget ID lists from the saved layout.
// Unrecognised widget IDs (absent from WIDGET_REGISTRY) are silently discarded.
// Registry widgets absent from currentLayout are placed in hiddenIds.
// @param {Array<object>|null|undefined} currentLayout - The saved dashboard layout array
// @returns {{ renderedIds: string[], hiddenIds: string[] }}
function deriveInitialIds(currentLayout) {
  const allWidgetIds = WIDGET_REGISTRY.map(w => w.widgetId);
  const renderedIds = (currentLayout || []).map(c => c.widgetId).filter(id => allWidgetIds.includes(id));
  const hiddenIds = allWidgetIds.filter(id => !renderedIds.includes(id));
  return { renderedIds, hiddenIds };
}

// Returns updated rendered/hidden ID lists after moving widgetId one step in the
// combined [rendered..., hidden...] order, or null if already at the boundary.
// @param {string[]}    renderedIds - Currently rendered widget IDs in display order
// @param {string[]}    hiddenIds   - Currently hidden widget IDs
// @param {string}      widgetId    - The ID of the widget to move
// @param {'up'|'down'} direction   - Direction of movement
// @returns {{ renderedIds: string[], hiddenIds: string[] }|null}
function applyMove(renderedIds, hiddenIds, widgetId, direction) {
  const combined = [...renderedIds, ...hiddenIds];
  const index = combined.indexOf(widgetId);
  if (direction === 'up' && index === 0) return null;
  if (direction === 'down' && index === combined.length - 1) return null;
  const next = [...combined];
  const swap = direction === 'up' ? index - 1 : index + 1;
  [next[index], next[swap]] = [next[swap], next[index]];
  return { renderedIds: next.slice(0, renderedIds.length), hiddenIds: next.slice(renderedIds.length) };
}

// Returns updated lists after inserting draggedId immediately before targetId in
// whichever section (rendered or hidden) targetId belongs to.
// @param {string[]} renderedIds - Currently rendered widget IDs
// @param {string[]} hiddenIds   - Currently hidden widget IDs
// @param {string}   draggedId   - The ID of the widget being dragged
// @param {string}   targetId    - The ID of the widget being dropped onto
// @returns {{ renderedIds: string[], hiddenIds: string[] }}
function applyDropOnItem(renderedIds, hiddenIds, draggedId, targetId) {
  const newRendered = renderedIds.filter(id => id !== draggedId);
  const newHidden = hiddenIds.filter(id => id !== draggedId);
  if (renderedIds.includes(targetId)) {
    newRendered.splice(newRendered.indexOf(targetId), 0, draggedId);
  } else {
    newHidden.splice(newHidden.indexOf(targetId), 0, draggedId);
  }
  return { renderedIds: newRendered, hiddenIds: newHidden };
}

// Returns updated lists after appending draggedId to the end of the target section.
// @param {string[]}            renderedIds - Currently rendered widget IDs
// @param {string[]}            hiddenIds   - Currently hidden widget IDs
// @param {string}              draggedId   - The ID of the widget being dragged
// @param {'rendered'|'hidden'} section     - The section to drop into
// @returns {{ renderedIds: string[], hiddenIds: string[] }}
function applyDropOnSection(renderedIds, hiddenIds, draggedId, section) {
  const newRendered = renderedIds.filter(id => id !== draggedId);
  const newHidden = hiddenIds.filter(id => id !== draggedId);
  (section === 'rendered' ? newRendered : newHidden).push(draggedId);
  return { renderedIds: newRendered, hiddenIds: newHidden };
}

// ── Render helpers ─────────────────────────────────────────────────────────────────────

// Renders a single draggable widget row with move-up/move-down arrow buttons.
// ctx contains both display state (renderedIds, hiddenIds, draggingId, dragOverId,
// dragOverSection) and event handlers (onMove, onDragStart, onDragEnd, and others).
// @param {Function} h        - React.createElement
// @param {string}   widgetId - The ID of the widget to render
// @param {object}   ctx      - Combined display state and event handlers from useLayoutState
// @returns {ReactElement|null}
function renderItem(h, widgetId, ctx) {
  const widget = getWidget(widgetId);
  if (!widget) return null;
  const combined = [...ctx.renderedIds, ...ctx.hiddenIds];
  const idx = combined.indexOf(widgetId);
  return h('div', {
    key: widgetId,
    className: ['dcf-item',
      ctx.draggingId === widgetId ? 'dcf-item--dragging' : '',
      ctx.dragOverId === widgetId ? 'dcf-item--drag-over' : '',
    ].filter(Boolean).join(' '),
    draggable: true,
    onDragStart: (e) => ctx.onDragStart(e, widgetId),
    onDragEnd: ctx.onDragEnd,
    onDragOver: (e) => ctx.onDragOverItem(e, widgetId),
    onDrop: (e) => ctx.onDropOnItem(e, widgetId),
  },
    h('span', { className: 'dcf-item-handle', 'aria-hidden': 'true' }, '⠿'),
    h('span', { className: 'dcf-item-icon', 'aria-hidden': 'true' }, widget.icon),
    h('span', { className: 'dcf-item-name' }, widget.name),
    h('div', { className: 'dcf-item-actions' },
      h('button', {
        className: 'dcf-arrow-btn', type: 'button', disabled: idx === 0,
        title: 'Move up', 'aria-label': `Move ${widget.name} up`,
        onClick: (e) => { e.stopPropagation(); ctx.onMove(widgetId, 'up'); },
      }, '↑'),
      h('button', {
        className: 'dcf-arrow-btn', type: 'button', disabled: idx === combined.length - 1,
        title: 'Move down', 'aria-label': `Move ${widget.name} down`,
        onClick: (e) => { e.stopPropagation(); ctx.onMove(widgetId, 'down'); },
      }, '↓')
    )
  );
}

// Renders a drop-target section ("Rendered" or "Hidden") containing its widget rows.
// Shows an empty-state message when the items array has no entries.
// @param {Function}  h         - React.createElement
// @param {string}    sectionId - Section identifier ('rendered' or 'hidden')
// @param {string}    label     - Human-readable section heading
// @param {string}    icon      - Emoji icon shown in the section header
// @param {string[]}  items     - Ordered widget IDs to render in this section
// @param {object}    ctx       - Combined display state and event handlers from useLayoutState
// @returns {ReactElement}
function renderSection(h, sectionId, label, icon, items, ctx) {
  return h('div', {
    className: ['dcf-section', ctx.dragOverSection === sectionId ? 'dcf-section--drag-over' : ''].filter(Boolean).join(' '),
    onDragOver: (e) => ctx.onDragOverSection(e, sectionId),
    onDragLeave: ctx.onDragLeaveSection,
    onDrop: (e) => ctx.onDropOnSection(e, sectionId),
  },
    h('div', { className: 'dcf-section-header' },
      h('span', { className: 'dcf-section-icon', 'aria-hidden': 'true' }, icon),
      h('h4', { className: 'dcf-section-title' }, label)
    ),
    items.length === 0
      ? h('div', { className: 'dcf-empty' },
          sectionId === 'rendered'
            ? 'Drag components here to show them on the dashboard'
            : 'All components are currently shown'
        )
      : h('div', { className: 'dcf-list' }, ...items.map(id => renderItem(h, id, ctx)))
  );
}

// ── State and event-handling hook ─────────────────────────────────────────────────────

// Custom React hook that owns all drag-and-drop and reorder state for the config popup.
// Initialises rendered/hidden widget lists from currentLayout and exposes event handlers
// consumed by renderItem and renderSection via ctx.
// @param {Array<object>} currentLayout - The current dashboard_elements array
// @returns {object} State values and event handlers for section and item interactions
function useLayoutState(currentLayout) {
  const { renderedIds: initRendered, hiddenIds: initHidden } = deriveInitialIds(currentLayout);
  const [renderedIds, setRenderedIds] = useState(initRendered);
  const [hiddenIds, setHiddenIds] = useState(initHidden);
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [dragOverSection, setDragOverSection] = useState(null);
  const dragItemRef = useRef(null);

  // Resets all active drag tracking state.
  // @returns {void}
  const clearDrag = () => {
    dragItemRef.current = null;
    setDraggingId(null);
    setDragOverId(null);
    setDragOverSection(null);
  };

  // Handles a move-up or move-down button click by delegating to applyMove.
  const onMove = (widgetId, direction) => {
    const result = applyMove(renderedIds, hiddenIds, widgetId, direction);
    if (result) { setRenderedIds(result.renderedIds); setHiddenIds(result.hiddenIds); }
  };

  // Records the dragged widget ID and sets the dragging visual state.
  // Uses requestAnimationFrame so the drag ghost renders before the class is applied.
  const onDragStart = (e, widgetId) => {
    dragItemRef.current = widgetId;
    e.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => setDraggingId(widgetId));
  };

  // Clears all drag state when a drag operation ends (whether dropped or cancelled).
  // @returns {void}
  const onDragEnd = () => clearDrag();

  // Highlights targetId as the active drop target while the cursor is over a widget row.
  // @param {DragEvent} e        - The native dragover event
  // @param {string}    targetId - The widget currently under the drag cursor
  // @returns {void}
  const onDragOverItem = (e, targetId) => {
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDragOverId(targetId); setDragOverSection(null);
  };

  // Highlights the target section drop zone while dragging over an empty section area.
  const onDragOverSection = (e, section) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverSection(section); setDragOverId(null);
  };

  // Clears the section highlight when the cursor leaves the section entirely.
  // Checks relatedTarget to avoid false positives when moving between child elements.
  // @param {DragEvent} e - The native dragleave event
  // @returns {void}
  const onDragLeaveSection = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setDragOverSection(null);
  };

  // Handles a drop onto a widget row, inserting the dragged widget before targetId.
  // No-ops when draggedId is absent or equal to targetId (dropped onto itself).
  // @param {DragEvent} e        - The native drop event
  // @param {string}    targetId - The widget that was dropped onto
  // @returns {void}
  const onDropOnItem = (e, targetId) => {
    e.preventDefault(); e.stopPropagation();
    const draggedId = dragItemRef.current;
    clearDrag();
    if (!draggedId || draggedId === targetId) return;
    const { renderedIds: r, hiddenIds: hi } = applyDropOnItem(renderedIds, hiddenIds, draggedId, targetId);
    setRenderedIds(r); setHiddenIds(hi);
  };

  // Handles a drop onto a section background, appending the dragged widget to that section.
  const onDropOnSection = (e, section) => {
    e.preventDefault();
    const draggedId = dragItemRef.current;
    clearDrag();
    if (!draggedId) return;
    const { renderedIds: r, hiddenIds: hi } = applyDropOnSection(renderedIds, hiddenIds, draggedId, section);
    setRenderedIds(r); setHiddenIds(hi);
  };

  const [hasReset, setHasReset] = useState(false);

  // [Claude] Task: track reset state so handleLayoutSave can restore default widget sizes
  // Prompt: "consolidate DEFAULT_DASHBOARD_COMPONENTS and WIDGET_REGISTRY"
  // Date: 2026-03-01 | Model: claude-sonnet-4-6
  // Resets the layout to the default registry order with all widgets rendered,
  // and flags that the next save should restore registry-default sizes.
  // @returns {void}
  const onReset = () => {
    setRenderedIds(WIDGET_REGISTRY.map(w => w.widgetId));
    setHiddenIds([]);
    setHasReset(true);
  };

  return {
    renderedIds, hiddenIds, draggingId, dragOverId, dragOverSection, hasReset,
    onMove, onDragStart, onDragEnd, onDragOverItem, onDragOverSection,
    onDragLeaveSection, onDropOnItem, onDropOnSection, onReset,
  };
}

// ── Component ─────────────────────────────────────────────────────────────────────────
// Popup for configuring which dashboard widgets are shown and in what order.
// Widgets are split into "Rendered" (shown) and "Hidden" sections. Both sections
// support HTML5 drag-and-drop reordering across and within sections. Arrow buttons
// provide the same movement capability without drag.
// @param {Array<object>} props.currentLayout - The current dashboard_elements array
//   (each entry: { widgetId, gridWidthSize, gridHeightSize, settings }).
// @param {Function} props.onSave   - Called with an ordered array of widgetId strings to render.
// @param {Function} props.onCancel - Called when the user dismisses without saving.
// @returns {ReactElement}
export default function DashboardConfigPopup({ currentLayout, onSave, onCancel }) {
  const h = createElement;
  const ctx = useLayoutState(currentLayout);
  const { renderedIds, hiddenIds, hasReset, onReset } = ctx;

  return h('div', { className: 'config-popup-overlay', onClick: (e) => e.target === e.currentTarget && onCancel() },
    h('div', { className: 'config-popup-container dcf-container' },
      h('div', { className: 'config-popup-header' },
        h('h3', { className: 'config-popup-title' }, '⚙\uFE0F Dashboard Layout')
      ),
      h('div', { className: 'config-popup-body dcf-body' },
        renderSection(h, 'rendered', 'Rendered Dashboard Elements', '👁', renderedIds, ctx),
        renderSection(h, 'hidden', 'Hidden Dashboard Elements', '🚫', hiddenIds, ctx)
      ),
      h('div', { className: 'config-popup-actions' },
        h('button', { className: 'config-popup-link', type: 'button', onClick: onReset }, 'Reset to defaults'),
        h('button', { className: 'config-popup-btn config-popup-btn--cancel', type: 'button', onClick: onCancel }, 'Cancel'),
        h('button', { className: 'config-popup-btn config-popup-btn--submit', type: 'button', onClick: () => onSave(renderedIds, { isReset: hasReset }) }, 'Save Layout')
      )
    )
  );
}
