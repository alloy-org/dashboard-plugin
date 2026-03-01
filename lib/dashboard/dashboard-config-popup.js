import { createElement, useState, useRef, useCallback } from "react";
import { WIDGET_REGISTRY } from "constants/settings";

// ------------------------------------------------------------------------------------------
// DashboardConfigPopup
//
// Allows the user to control which dashboard components are shown and in what order.
// Widgets are split into "Rendered" (shown) and "Hidden" (not shown) sections.
// Both sections support HTML5 drag-and-drop reordering across and within sections.
// Arrow buttons provide the same movement capability without drag.
//
// @param {Array<object>} currentLayout - The current dashboard_elements array
//   (each entry: { widgetId, gridWidthSize, gridHeightSize, settings }).
// @param {Function} onSave  - Called with an ordered array of widgetId strings to render.
// @param {Function} onCancel - Called when the user dismisses without saving.
// ------------------------------------------------------------------------------------------
export default function DashboardConfigPopup({ currentLayout, onSave, onCancel }) {
  const h = createElement;

  const allWidgetIds = WIDGET_REGISTRY.map(w => w.widgetId);
  const currentRenderedIds = (currentLayout || [])
    .map(c => c.widgetId)
    .filter(id => allWidgetIds.includes(id));
  const initialHiddenIds = allWidgetIds.filter(id => !currentRenderedIds.includes(id));

  const [renderedIds, setRenderedIds] = useState(currentRenderedIds);
  const [hiddenIds, setHiddenIds] = useState(initialHiddenIds);
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [dragOverSection, setDragOverSection] = useState(null);

  const dragItemRef = useRef(null);

  const getWidget = useCallback(
    (widgetId) => WIDGET_REGISTRY.find(w => w.widgetId === widgetId),
    []
  );

  // Move an item one step up or down through the combined [rendered..., hidden...] list.
  // Swapping the last rendered with the first hidden (or vice versa) naturally
  // transfers the item between sections while keeping the rendered count constant.
  const moveItem = useCallback((widgetId, direction) => {
    const combined = [...renderedIds, ...hiddenIds];
    const renderedCount = renderedIds.length;
    const index = combined.indexOf(widgetId);
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === combined.length - 1) return;

    const newIndex = direction === 'up' ? index - 1 : index + 1;
    const next = [...combined];
    [next[index], next[newIndex]] = [next[newIndex], next[index]];
    setRenderedIds(next.slice(0, renderedCount));
    setHiddenIds(next.slice(renderedCount));
  }, [renderedIds, hiddenIds]);

  // ── Drag handlers ──────────────────────────────────────────────────────────────────

  const handleDragStart = useCallback((e, widgetId) => {
    dragItemRef.current = widgetId;
    e.dataTransfer.effectAllowed = 'move';
    // Delay visual opacity so the drag ghost captures the un-dimmed element first
    requestAnimationFrame(() => setDraggingId(widgetId));
  }, []);

  const handleDragEnd = useCallback(() => {
    dragItemRef.current = null;
    setDraggingId(null);
    setDragOverId(null);
    setDragOverSection(null);
  }, []);

  const handleDragOverItem = useCallback((e, targetId) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDragOverId(targetId);
    setDragOverSection(null);
  }, []);

  const handleDragOverSection = useCallback((e, section) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverSection(section);
    setDragOverId(null);
  }, []);

  const handleDragLeaveSection = useCallback((e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragOverSection(null);
    }
  }, []);

  const handleDropOnItem = useCallback((e, targetId) => {
    e.preventDefault();
    e.stopPropagation();
    const draggedId = dragItemRef.current;
    if (!draggedId || draggedId === targetId) {
      setDraggingId(null);
      setDragOverId(null);
      setDragOverSection(null);
      return;
    }

    const targetInRendered = renderedIds.includes(targetId);
    const newRendered = renderedIds.filter(id => id !== draggedId);
    const newHidden = hiddenIds.filter(id => id !== draggedId);

    if (targetInRendered) {
      const idx = newRendered.indexOf(targetId);
      newRendered.splice(idx, 0, draggedId);
    } else {
      const idx = newHidden.indexOf(targetId);
      newHidden.splice(idx, 0, draggedId);
    }

    setRenderedIds(newRendered);
    setHiddenIds(newHidden);
    setDraggingId(null);
    setDragOverId(null);
    setDragOverSection(null);
    dragItemRef.current = null;
  }, [renderedIds, hiddenIds]);

  const handleDropOnSection = useCallback((e, section) => {
    e.preventDefault();
    const draggedId = dragItemRef.current;
    if (!draggedId) return;

    const newRendered = renderedIds.filter(id => id !== draggedId);
    const newHidden = hiddenIds.filter(id => id !== draggedId);

    if (section === 'rendered') {
      newRendered.push(draggedId);
    } else {
      newHidden.push(draggedId);
    }

    setRenderedIds(newRendered);
    setHiddenIds(newHidden);
    setDraggingId(null);
    setDragOverId(null);
    setDragOverSection(null);
    dragItemRef.current = null;
  }, [renderedIds, hiddenIds]);

  // ── Render helpers ─────────────────────────────────────────────────────────────────

  const renderItem = (widgetId) => {
    const widget = getWidget(widgetId);
    if (!widget) return null;

    const combined = [...renderedIds, ...hiddenIds];
    const combinedIndex = combined.indexOf(widgetId);
    const isFirst = combinedIndex === 0;
    const isLast = combinedIndex === combined.length - 1;
    const isDragging = draggingId === widgetId;
    const isDragOver = dragOverId === widgetId;

    return h('div', {
      key: widgetId,
      className: [
        'dcf-item',
        isDragging ? 'dcf-item--dragging' : '',
        isDragOver ? 'dcf-item--drag-over' : '',
      ].filter(Boolean).join(' '),
      draggable: true,
      onDragStart: (e) => handleDragStart(e, widgetId),
      onDragEnd: handleDragEnd,
      onDragOver: (e) => handleDragOverItem(e, widgetId),
      onDrop: (e) => handleDropOnItem(e, widgetId),
    },
      h('span', { className: 'dcf-item-handle', 'aria-hidden': 'true' }, '⠿'),
      h('span', { className: 'dcf-item-icon', 'aria-hidden': 'true' }, widget.icon),
      h('span', { className: 'dcf-item-name' }, widget.name),
      h('div', { className: 'dcf-item-actions' },
        h('button', {
          className: 'dcf-arrow-btn',
          type: 'button',
          disabled: isFirst,
          title: 'Move up',
          'aria-label': `Move ${widget.name} up`,
          onClick: (e) => { e.stopPropagation(); moveItem(widgetId, 'up'); },
        }, '↑'),
        h('button', {
          className: 'dcf-arrow-btn',
          type: 'button',
          disabled: isLast,
          title: 'Move down',
          'aria-label': `Move ${widget.name} down`,
          onClick: (e) => { e.stopPropagation(); moveItem(widgetId, 'down'); },
        }, '↓')
      )
    );
  };

  const renderSection = (sectionId, label, icon, items) => {
    const isDragOver = dragOverSection === sectionId;
    return h('div', {
      className: ['dcf-section', isDragOver ? 'dcf-section--drag-over' : ''].filter(Boolean).join(' '),
      onDragOver: (e) => handleDragOverSection(e, sectionId),
      onDragLeave: handleDragLeaveSection,
      onDrop: (e) => handleDropOnSection(e, sectionId),
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
        : h('div', { className: 'dcf-list' }, ...items.map(renderItem))
    );
  };

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) onCancel();
  };

  return h('div', { className: 'config-popup-overlay', onClick: handleOverlayClick },
    h('div', { className: 'config-popup-container dcf-container' },
      h('div', { className: 'config-popup-header' },
        h('h3', { className: 'config-popup-title' }, '⚙\uFE0F Dashboard Layout')
      ),
      h('div', { className: 'config-popup-body dcf-body' },
        renderSection('rendered', 'Rendered Dashboard Elements', '👁', renderedIds),
        renderSection('hidden', 'Hidden Dashboard Elements', '🚫', hiddenIds)
      ),
      h('div', { className: 'config-popup-actions' },
        h('button', {
          className: 'config-popup-btn config-popup-btn--cancel',
          type: 'button',
          onClick: onCancel,
        }, 'Cancel'),
        h('button', {
          className: 'config-popup-btn config-popup-btn--submit',
          type: 'button',
          onClick: () => onSave(renderedIds),
        }, 'Save Layout')
      )
    )
  );
}
