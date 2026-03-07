/**
 * [Claude-authored file]
 * Created: 2026-03-07 | Model: claude-4.6-opus-high-thinking
 * Task: Dashboard layout popup with tabbed Components/Sizing interface
 * Prompt summary: "rename dashboard-config-popup to dashboard-layout-popup; add sizing tab for width and vertical tile count per component"
 */
import { createElement, useState, useRef } from "react";
import { WIDGET_REGISTRY } from "constants/settings";

// ── Pure data helpers ─────────────────────────────────────────────────────────────────

function getWidget(widgetId) {
  return WIDGET_REGISTRY.find(w => w.widgetId === widgetId);
}

function deriveInitialIds(currentLayout) {
  const allWidgetIds = WIDGET_REGISTRY.map(w => w.widgetId);
  const renderedIds = (currentLayout || []).map(c => c.widgetId).filter(id => allWidgetIds.includes(id));
  const hiddenIds = allWidgetIds.filter(id => !renderedIds.includes(id));
  return { renderedIds, hiddenIds };
}

function deriveInitialSizing(currentLayout) {
  const sizing = {};
  WIDGET_REGISTRY.forEach(w => {
    sizing[w.widgetId] = {
      gridWidthSize: w.defaultGridWidthSize || 1,
      gridHeightSize: 1,
    };
  });
  (currentLayout || []).forEach(c => {
    if (sizing[c.widgetId]) {
      sizing[c.widgetId] = {
        gridWidthSize: c.gridWidthSize || sizing[c.widgetId].gridWidthSize,
        gridHeightSize: c.gridHeightSize || 1,
      };
    }
  });
  return sizing;
}

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

function applyDropOnSection(renderedIds, hiddenIds, draggedId, section) {
  const newRendered = renderedIds.filter(id => id !== draggedId);
  const newHidden = hiddenIds.filter(id => id !== draggedId);
  (section === 'rendered' ? newRendered : newHidden).push(draggedId);
  return { renderedIds: newRendered, hiddenIds: newHidden };
}

// ── Components tab render helpers ─────────────────────────────────────────────────────

function renderItem(h, widgetId, ctx) {
  const widget = getWidget(widgetId);
  if (!widget) return null;
  const combined = [...ctx.renderedIds, ...ctx.hiddenIds];
  const idx = combined.indexOf(widgetId);
  return h('div', {
    key: widgetId,
    className: ['dashboard-layout-popup-item',
      ctx.draggingId === widgetId ? 'dashboard-layout-popup-item--dragging' : '',
      ctx.dragOverId === widgetId ? 'dashboard-layout-popup-item--drag-over' : '',
    ].filter(Boolean).join(' '),
    draggable: true,
    onDragStart: (e) => ctx.onDragStart(e, widgetId),
    onDragEnd: ctx.onDragEnd,
    onDragOver: (e) => ctx.onDragOverItem(e, widgetId),
    onDrop: (e) => ctx.onDropOnItem(e, widgetId),
  },
    h('span', { className: 'dashboard-layout-popup-item-handle', 'aria-hidden': 'true' }, '⠿'),
    h('span', { className: 'dashboard-layout-popup-item-icon', 'aria-hidden': 'true' }, widget.icon),
    h('div', { className: 'dashboard-layout-popup-item-info' },
      h('span', { className: 'dashboard-layout-popup-item-name' }, widget.name),
      widget.description && h('span', { className: 'dashboard-layout-popup-item-description' }, widget.description)
    ),
    h('div', { className: 'dashboard-layout-popup-item-actions' },
      h('button', {
        className: 'dashboard-layout-popup-arrow-button', type: 'button', disabled: idx === 0,
        title: 'Move up', 'aria-label': `Move ${widget.name} up`,
        onClick: (e) => { e.stopPropagation(); ctx.onMove(widgetId, 'up'); },
      }, '↑'),
      h('button', {
        className: 'dashboard-layout-popup-arrow-button', type: 'button', disabled: idx === combined.length - 1,
        title: 'Move down', 'aria-label': `Move ${widget.name} down`,
        onClick: (e) => { e.stopPropagation(); ctx.onMove(widgetId, 'down'); },
      }, '↓')
    )
  );
}

function renderSection(h, sectionId, label, icon, items, ctx) {
  return h('div', {
    className: ['dashboard-layout-popup-section', ctx.dragOverSection === sectionId ? 'dashboard-layout-popup-section--drag-over' : ''].filter(Boolean).join(' '),
    onDragOver: (e) => ctx.onDragOverSection(e, sectionId),
    onDragLeave: ctx.onDragLeaveSection,
    onDrop: (e) => ctx.onDropOnSection(e, sectionId),
  },
    h('div', { className: 'dashboard-layout-popup-section-header' },
      h('span', { className: 'dashboard-layout-popup-section-icon', 'aria-hidden': 'true' }, icon),
      h('h4', { className: 'dashboard-layout-popup-section-title' }, label)
    ),
    items.length === 0
      ? h('div', { className: 'dashboard-layout-popup-empty' },
          sectionId === 'rendered'
            ? 'Drag components here to show them on the dashboard'
            : 'All components are currently shown'
        )
      : h('div', { className: 'dashboard-layout-popup-list' }, ...items.map(id => renderItem(h, id, ctx)))
  );
}

// ── Sizing tab render helpers ─────────────────────────────────────────────────────────

// [Claude] Task: render per-widget width and vertical tile count controls
// Prompt: "create a new tab that allows specifying the width and vertical tile count for each component"
// Date: 2026-03-07 | Model: claude-4.6-opus-high-thinking
function renderSizingItem(h, widgetId, sizing, onSizingChange) {
  const widget = getWidget(widgetId);
  if (!widget) return null;
  const currentWidth = sizing[widgetId]?.gridWidthSize ?? widget.defaultGridWidthSize ?? 1;
  const currentHeight = sizing[widgetId]?.gridHeightSize ?? 1;
  const maxWidth = widget.maxHorizontalTiles || 4;
  const maxHeight = widget.maxVerticalTiles || 2;

  return h('div', { key: widgetId, className: 'dashboard-layout-popup-sizing-item' },
    h('div', { className: 'dashboard-layout-popup-sizing-item-header' },
      h('span', { className: 'dashboard-layout-popup-item-icon', 'aria-hidden': 'true' }, widget.icon),
      h('span', { className: 'dashboard-layout-popup-item-name' }, widget.name),
    ),
    h('div', { className: 'dashboard-layout-popup-sizing-item-controls' },
      h('div', { className: 'dashboard-layout-popup-sizing-field' },
        h('label', { className: 'dashboard-layout-popup-sizing-label' }, 'Width'),
        h('select', {
          className: 'dashboard-layout-popup-sizing-select',
          value: currentWidth,
          onChange: e => onSizingChange(widgetId, 'gridWidthSize', Number(e.target.value)),
        }, ...Array.from({ length: maxWidth }, (_, i) =>
          h('option', { key: i + 1, value: i + 1 }, `${i + 1}`)
        ))
      ),
      h('div', { className: 'dashboard-layout-popup-sizing-field' },
        h('label', { className: 'dashboard-layout-popup-sizing-label' }, 'Vertical tiles'),
        h('select', {
          className: 'dashboard-layout-popup-sizing-select',
          value: currentHeight,
          onChange: e => onSizingChange(widgetId, 'gridHeightSize', Number(e.target.value)),
        }, ...Array.from({ length: maxHeight }, (_, i) =>
          h('option', { key: i + 1, value: i + 1 }, `${i + 1}`)
        ))
      ),
    )
  );
}

// ── State and event-handling hook ─────────────────────────────────────────────────────

function useLayoutState(currentLayout) {
  const { renderedIds: initRendered, hiddenIds: initHidden } = deriveInitialIds(currentLayout);
  const [renderedIds, setRenderedIds] = useState(initRendered);
  const [hiddenIds, setHiddenIds] = useState(initHidden);
  const [sizing, setSizing] = useState(() => deriveInitialSizing(currentLayout));
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [dragOverSection, setDragOverSection] = useState(null);
  const dragItemRef = useRef(null);
  const [hasReset, setHasReset] = useState(false);

  const clearDrag = () => {
    dragItemRef.current = null;
    setDraggingId(null);
    setDragOverId(null);
    setDragOverSection(null);
  };

  const onMove = (widgetId, direction) => {
    const result = applyMove(renderedIds, hiddenIds, widgetId, direction);
    if (result) { setRenderedIds(result.renderedIds); setHiddenIds(result.hiddenIds); }
  };

  const onDragStart = (e, widgetId) => {
    dragItemRef.current = widgetId;
    e.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => setDraggingId(widgetId));
  };

  const onDragEnd = () => clearDrag();

  const onDragOverItem = (e, targetId) => {
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDragOverId(targetId); setDragOverSection(null);
  };

  const onDragOverSection = (e, section) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverSection(section); setDragOverId(null);
  };

  const onDragLeaveSection = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setDragOverSection(null);
  };

  const onDropOnItem = (e, targetId) => {
    e.preventDefault(); e.stopPropagation();
    const draggedId = dragItemRef.current;
    clearDrag();
    if (!draggedId || draggedId === targetId) return;
    const { renderedIds: r, hiddenIds: hi } = applyDropOnItem(renderedIds, hiddenIds, draggedId, targetId);
    setRenderedIds(r); setHiddenIds(hi);
  };

  const onDropOnSection = (e, section) => {
    e.preventDefault();
    const draggedId = dragItemRef.current;
    clearDrag();
    if (!draggedId) return;
    const { renderedIds: r, hiddenIds: hi } = applyDropOnSection(renderedIds, hiddenIds, draggedId, section);
    setRenderedIds(r); setHiddenIds(hi);
  };

  const onSizingChange = (widgetId, field, value) => {
    setSizing(prev => ({
      ...prev,
      [widgetId]: { ...prev[widgetId], [field]: value },
    }));
  };

  const onReset = () => {
    setRenderedIds(WIDGET_REGISTRY.map(w => w.widgetId));
    setHiddenIds([]);
    setHasReset(true);
    setSizing(deriveInitialSizing(null));
  };

  return {
    renderedIds, hiddenIds, sizing, draggingId, dragOverId, dragOverSection, hasReset,
    onMove, onDragStart, onDragEnd, onDragOverItem, onDragOverSection,
    onDragLeaveSection, onDropOnItem, onDropOnSection, onSizingChange, onReset,
  };
}

// ── Component ─────────────────────────────────────────────────────────────────────────

// [Claude] Task: tabbed layout popup with Components and Sizing tabs
// Prompt: "rename dashboard-config-popup to dashboard-layout-popup; add sizing tab for width and vertical tile count"
// Date: 2026-03-07 | Model: claude-4.6-opus-high-thinking
export default function DashboardLayoutPopup({ currentLayout, onSave, onCancel }) {
  const h = createElement;
  const [activeTab, setActiveTab] = useState('components');
  const ctx = useLayoutState(currentLayout);
  const { renderedIds, hiddenIds, sizing, hasReset, onReset, onSizingChange } = ctx;

  const bodyContent = activeTab === 'components'
    ? [
        renderSection(h, 'rendered', 'Rendered Dashboard Elements', '\uD83D\uDC41', renderedIds, ctx),
        renderSection(h, 'hidden', 'Hidden Dashboard Elements', '\uD83D\uDEAB', hiddenIds, ctx),
      ]
    : [
        renderedIds.length === 0
          ? h('div', { key: 'empty', className: 'dashboard-layout-popup-empty' },
              'No rendered components. Add components in the Components tab.')
          : h('div', { key: 'sizing-list', className: 'dashboard-layout-popup-sizing' },
              ...renderedIds.map(id => renderSizingItem(h, id, sizing, onSizingChange))
            ),
      ];

  return h('div', { className: 'config-popup-overlay', onClick: (e) => e.target === e.currentTarget && onCancel() },
    h('div', { className: 'config-popup-container dashboard-layout-popup' },
      h('div', { className: 'config-popup-header' },
        h('h3', { className: 'config-popup-title' }, '\u2699\uFE0F Dashboard Layout'),
        h('div', { className: 'dashboard-layout-popup-tabs' },
          h('button', {
            className: 'dashboard-layout-popup-tab' + (activeTab === 'components' ? ' active' : ''),
            type: 'button',
            onClick: () => setActiveTab('components'),
          }, 'Components'),
          h('button', {
            className: 'dashboard-layout-popup-tab' + (activeTab === 'sizing' ? ' active' : ''),
            type: 'button',
            onClick: () => setActiveTab('sizing'),
          }, 'Sizing'),
        )
      ),
      h('div', { className: 'config-popup-body dashboard-layout-popup-body' }, ...bodyContent),
      h('div', { className: 'config-popup-actions' },
        h('button', { className: 'config-popup-link', type: 'button', onClick: onReset }, 'Reset to defaults'),
        h('button', { className: 'config-popup-btn config-popup-btn--cancel', type: 'button', onClick: onCancel }, 'Cancel'),
        h('button', { className: 'config-popup-btn config-popup-btn--submit', type: 'button', onClick: () => onSave(renderedIds, { isReset: hasReset, sizing }) }, 'Save Layout')
      )
    )
  );
}
