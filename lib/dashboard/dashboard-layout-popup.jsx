/**
 * [Claude-authored file]
 * Created: 2026-03-07 | Model: claude-4.6-opus-high-thinking
 * Task: Dashboard layout popup with tabbed Components/Sizing interface
 * Prompt summary: "rename dashboard-config-popup to dashboard-layout-popup; add sizing tab for width and vertical tile count per component"
 */
import { LAYOUT_PROFILES, getProfileById, sizingFromProfile } from "layout-profiles";
import { useState, useRef } from "react";
import { WIDGET_REGISTRY } from "constants/settings";
import { snapDashboardAction } from "util/plausible";
import "styles/dashboard-layout-popup.scss"

// ── Pure data helpers ─────────────────────────────────────────────────────────────────

// ----------------------------------------------------------------------------------------------
// @desc Fire a Plausible add/remove event when a widget crosses the active (rendered) ↔ available (hidden)
//   boundary, which is how components are added to or removed from the dashboard's component registry. A move
//   that stays within the same section (pure reorder) snaps nothing.
// @param {string} widgetId - The widget being moved.
// @param {boolean} wasRendered - Whether the widget was in the active section before the move.
// @param {boolean} nowRendered - Whether the widget is in the active section after the move.
function _snapComponentMembershipChange(widgetId, wasRendered, nowRendered) {
  if (wasRendered === nowRendered) return;
  snapDashboardAction(nowRendered ? "addDashboardComponent" : "removeDashboardComponent", { widgetId });
}

function getWidget(widgetId) {
  return WIDGET_REGISTRY.find(w => w.widgetId === widgetId);
}

// ------------------------------------------------------------------------------------------
// [Claude] Task: use Array.isArray guard so non-array truthy values don't crash .map
// Prompt: "clicking Layout link fails with (currentLayout || []).map is not a function"
// Date: 2026-03-07 | Model: claude-4.6-opus-high-thinking
function deriveInitialIds(currentLayout, excludeWidgetIds) {
  const excluded = new Set(excludeWidgetIds || []);
  const allWidgetIds = WIDGET_REGISTRY.map(w => w.widgetId).filter(id => !excluded.has(id));
  const layoutArray = Array.isArray(currentLayout) ? currentLayout : [];
  const renderedIds = layoutArray.map(c => c.widgetId).filter(id => allWidgetIds.includes(id));
  const hiddenIds = allWidgetIds.filter(id => !renderedIds.includes(id));
  return { renderedIds, hiddenIds };
}

// ------------------------------------------------------------------------------------------
function deriveInitialSizing(currentLayout, excludeWidgetIds) {
  const excluded = new Set(excludeWidgetIds || []);
  const sizing = {};
  WIDGET_REGISTRY.filter(w => !excluded.has(w.widgetId)).forEach(w => {
    sizing[w.widgetId] = {
      gridWidthSize: w.defaultGridWidthSize || 1,
      gridHeightSize: 1,
    };
  });
  const layoutArray = Array.isArray(currentLayout) ? currentLayout : [];
  layoutArray.forEach(c => {
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

// [Claude claude-4.7-opus] Task: drop createElement `h` parameter; render JSX directly
// Prompt: "translate this project to render components with JSX instead"
function LayoutItem({ widgetId, ctx }) {
  const widget = getWidget(widgetId);
  if (!widget) return null;
  const combined = [...ctx.renderedIds, ...ctx.hiddenIds];
  const idx = combined.indexOf(widgetId);
  const className = [
    'dashboard-layout-popup-item',
    ctx.draggingId === widgetId ? 'dashboard-layout-popup-item--dragging' : '',
    ctx.dragOverId === widgetId ? 'dashboard-layout-popup-item--drag-over' : '',
  ].filter(Boolean).join(' ');
  return (
    <div
      className={className}
      draggable
      onDragStart={(e) => ctx.onDragStart(e, widgetId)}
      onDragEnd={ctx.onDragEnd}
      onDragOver={(e) => ctx.onDragOverItem(e, widgetId)}
      onDrop={(e) => ctx.onDropOnItem(e, widgetId)}
    >
      <span className="dashboard-layout-popup-item-handle" aria-hidden="true">⠿</span>
      <span className="dashboard-layout-popup-item-icon" aria-hidden="true">{widget.icon}</span>
      <div className="dashboard-layout-popup-item-info">
        <span className="dashboard-layout-popup-item-name">{widget.name}</span>
        {widget.description && <span className="dashboard-layout-popup-item-description">{widget.description}</span>}
      </div>
      <div className="dashboard-layout-popup-item-actions">
        <button
          className="dashboard-layout-popup-arrow-button"
          type="button"
          disabled={idx === 0}
          title="Move up"
          aria-label={`Move ${widget.name} up`}
          onClick={(e) => { e.stopPropagation(); ctx.onMove(widgetId, 'up'); }}
        >↑</button>
        <button
          className="dashboard-layout-popup-arrow-button"
          type="button"
          disabled={idx === combined.length - 1}
          title="Move down"
          aria-label={`Move ${widget.name} down`}
          onClick={(e) => { e.stopPropagation(); ctx.onMove(widgetId, 'down'); }}
        >↓</button>
      </div>
    </div>
  );
}

function LayoutSection({ sectionId, label, icon, items, ctx }) {
  const className = [
    'dashboard-layout-popup-section',
    ctx.dragOverSection === sectionId ? 'dashboard-layout-popup-section--drag-over' : '',
  ].filter(Boolean).join(' ');
  return (
    <div
      className={className}
      onDragOver={(e) => ctx.onDragOverSection(e, sectionId)}
      onDragLeave={ctx.onDragLeaveSection}
      onDrop={(e) => ctx.onDropOnSection(e, sectionId)}
    >
      <div className="dashboard-layout-popup-section-header">
        <span className="dashboard-layout-popup-section-icon" aria-hidden="true">{icon}</span>
        <h4 className="dashboard-layout-popup-section-title">{label}</h4>
      </div>
      {items.length === 0 ? (
        <div className="dashboard-layout-popup-empty">
          {sectionId === 'rendered'
            ? 'Drag components here to show them on the dashboard'
            : 'All components are currently shown'}
        </div>
      ) : (
        <div className="dashboard-layout-popup-list">
          {items.map(id => <LayoutItem key={id} widgetId={id} ctx={ctx} />)}
        </div>
      )}
    </div>
  );
}

// ── Sizing tab render helpers ─────────────────────────────────────────────────────────

// [Claude] Task: render per-widget width and vertical tile count controls
// Prompt: "create a new tab that allows specifying the width and vertical tile count for each component"
// Date: 2026-03-07 | Model: claude-4.6-opus-high-thinking
function SizingItem({ widgetId, sizing, onSizingChange }) {
  const widget = getWidget(widgetId);
  if (!widget) return null;
  const currentWidth = sizing[widgetId]?.gridWidthSize ?? widget.defaultGridWidthSize ?? 1;
  const currentHeight = sizing[widgetId]?.gridHeightSize ?? 1;
  const maxWidth = widget.maxHorizontalTiles || 4;
  const maxHeight = widget.maxVerticalTiles || 2;

  return (
    <div className="dashboard-layout-popup-sizing-item">
      <div className="dashboard-layout-popup-sizing-item-header">
        <span className="dashboard-layout-popup-item-icon" aria-hidden="true">{widget.icon}</span>
        <span className="dashboard-layout-popup-item-name">{widget.name}</span>
      </div>
      <div className="dashboard-layout-popup-sizing-item-controls">
        <div className="dashboard-layout-popup-sizing-field">
          <label className="dashboard-layout-popup-sizing-label">Width</label>
          <select
            className="dashboard-layout-popup-sizing-select"
            value={currentWidth}
            onChange={e => onSizingChange(widgetId, 'gridWidthSize', Number(e.target.value))}
          >
            {Array.from({ length: maxWidth }, (_, i) => (
              <option key={i + 1} value={i + 1}>{`${i + 1}`}</option>
            ))}
          </select>
        </div>
        <div className="dashboard-layout-popup-sizing-field">
          <label className="dashboard-layout-popup-sizing-label">Vertical tiles</label>
          <select
            className="dashboard-layout-popup-sizing-select"
            value={currentHeight}
            onChange={e => onSizingChange(widgetId, 'gridHeightSize', Number(e.target.value))}
          >
            {Array.from({ length: maxHeight }, (_, i) => (
              <option key={i + 1} value={i + 1}>{`${i + 1}`}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

// ── State and event-handling hook ─────────────────────────────────────────────────────

// [Claude claude-sonnet-4-6] Task: accept selectedLayoutProfile to scope reset to current profile's widget list
// Prompt: "Reset to defaults should reset to the selected profile's widgets, not all WIDGET_REGISTRY widgets"
// [Claude claude-sonnet-4-6] Task: accept excludeWidgetIds to filter debug-only widgets from layout popup
// Prompt: "DebugConsole should only be visible in layout config popup when SETTING_KEYS.DEBUG_CONSOLE is 'true'"
function useLayoutState(currentLayout, excludeWidgetIds) {
  const { renderedIds: initRendered, hiddenIds: initHidden } = deriveInitialIds(currentLayout, excludeWidgetIds);
  const [renderedIds, setRenderedIds] = useState(initRendered);
  const [hiddenIds, setHiddenIds] = useState(initHidden);
  const [sizing, setSizing] = useState(() => deriveInitialSizing(currentLayout, excludeWidgetIds));
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
    if (result) {
      _snapComponentMembershipChange(widgetId, renderedIds.includes(widgetId), result.renderedIds.includes(widgetId));
      setRenderedIds(result.renderedIds); setHiddenIds(result.hiddenIds);
    }
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
    _snapComponentMembershipChange(draggedId, renderedIds.includes(draggedId), r.includes(draggedId));
    setRenderedIds(r); setHiddenIds(hi);
  };

  const onDropOnSection = (e, section) => {
    e.preventDefault();
    const draggedId = dragItemRef.current;
    clearDrag();
    if (!draggedId) return;
    const { renderedIds: r, hiddenIds: hi } = applyDropOnSection(renderedIds, hiddenIds, draggedId, section);
    _snapComponentMembershipChange(draggedId, renderedIds.includes(draggedId), r.includes(draggedId));
    setRenderedIds(r); setHiddenIds(hi);
  };

  const onSizingChange = (widgetId, field, value) => {
    setSizing(prev => ({
      ...prev,
      [widgetId]: { ...prev[widgetId], [field]: value },
    }));
  };

  // [Claude claude-sonnet-4-6] Task: reset to active profile's widget list when a profile is selected
  // Prompt: "Reset to defaults should reset to the selected profile's widgets, not all WIDGET_REGISTRY widgets"
  const onReset = (currentSelectedProfileId) => {
    const excluded = new Set(excludeWidgetIds || []);
    const profile = getProfileById(currentSelectedProfileId);
    if (profile) {
      const profileWidgetIds = profile.widgets.map(widget => widget.widgetId).filter(id => !excluded.has(id));
      const allWidgetIds = WIDGET_REGISTRY.map(w => w.widgetId).filter(id => !excluded.has(id));
      setRenderedIds(profileWidgetIds);
      setHiddenIds(allWidgetIds.filter(id => !profileWidgetIds.includes(id)));
      setSizing(sizingFromProfile(profile));
    } else {
      const allWidgetIds = WIDGET_REGISTRY.map(w => w.widgetId).filter(id => !excluded.has(id));
      setRenderedIds(allWidgetIds);
      setHiddenIds([]);
      setSizing(deriveInitialSizing(null, excludeWidgetIds));
    }
    setHasReset(true);
  };

  return {
    renderedIds, hiddenIds, sizing, draggingId, dragOverId, dragOverSection, hasReset,
    onMove, onDragStart, onDragEnd, onDragOverItem, onDragOverSection,
    onDragLeaveSection, onDropOnItem, onDropOnSection, onSizingChange, onReset,
  };
}

// ── Component ─────────────────────────────────────────────────────────────────────────

// [Claude claude-sonnet-4-6] Task: add selectedLayoutProfile prop and profile selector to layout popup
// Prompt: "add a 'Default layout' selector row above the tabs; pass selectedProfileId to onSave; reset to profile widgets"
// [Claude] Task: tabbed layout popup with Components and Sizing tabs
// Prompt: "rename dashboard-config-popup to dashboard-layout-popup; add sizing tab for width and vertical tile count"
// Date: 2026-03-07 | Model: claude-4.6-opus-high-thinking
// [Claude claude-4.7-opus] Task: migrate DashboardLayoutPopup from createElement to JSX
// Prompt: "translate this project to render components with JSX instead"
export default function DashboardLayoutPopup({ currentLayout, excludeWidgetIds, onSave, onCancel, selectedLayoutProfile }) {
  const [activeTab, setActiveTab] = useState('components');
  const [selectedProfileId, setSelectedProfileId] = useState(selectedLayoutProfile || null);
  const ctx = useLayoutState(currentLayout, excludeWidgetIds);
  const { renderedIds, hiddenIds, sizing, hasReset, onReset, onSizingChange } = ctx;

  const bodyContent = activeTab === 'components' ? (
    <>
      <LayoutSection sectionId="rendered" label="Rendered Dashboard Elements" icon="👁" items={renderedIds} ctx={ctx} />
      <LayoutSection sectionId="hidden" label="Hidden Dashboard Elements" icon="🚫" items={hiddenIds} ctx={ctx} />
    </>
  ) : (
    renderedIds.length === 0 ? (
      <div className="dashboard-layout-popup-empty">
        No rendered components. Add components in the Components tab.
      </div>
    ) : (
      <div className="dashboard-layout-popup-sizing">
        {renderedIds.map(id => (
          <SizingItem key={id} widgetId={id} sizing={sizing} onSizingChange={onSizingChange} />
        ))}
      </div>
    )
  );

  return (
    <div className="config-popup-overlay" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="config-popup-container dashboard-layout-popup">
        <div className="config-popup-header">
          <h3 className="config-popup-title">⚙️ Dashboard Layout</h3>
          <div className="explanation-paragraph">{`Customize the order of your widgets by dragging or sizing them in this menu. You can also reorder widgets outside this menu by clicking on their header for 2 seconds to engage drag reordering.`}</div>
          <div className="explanation-paragraph">
            <label className="dashboard-layout-popup-profile-label">Default layout</label>
            <select
              className="dashboard-layout-popup-profile-select"
              value={selectedProfileId || ''}
              onChange={e => setSelectedProfileId(e.target.value || null)}
            >
              <option value="">Custom (no preset)</option>
              {LAYOUT_PROFILES.map(profile => (
                <option key={profile.id} value={profile.id}>{profile.name}</option>
              ))}
            </select>
          </div>
          <div className="dashboard-layout-popup-tabs">
            <button
              className={'dashboard-layout-popup-tab' + (activeTab === 'components' ? ' active' : '')}
              type="button"
              onClick={() => setActiveTab('components')}
            >Components</button>
            <button
              className={'dashboard-layout-popup-tab' + (activeTab === 'sizing' ? ' active' : '')}
              type="button"
              onClick={() => setActiveTab('sizing')}
            >Sizing</button>
          </div>
        </div>
        <div className="config-popup-body dashboard-layout-popup-body">{bodyContent}</div>
        <div className="config-popup-actions">
          <button className="config-popup-link" type="button" onClick={() => onReset(selectedProfileId)}>Reset to defaults</button>
          <button className="config-popup-btn config-popup-btn--cancel" type="button" onClick={onCancel}>Cancel</button>
          <button
            className="config-popup-btn config-popup-btn--submit"
            type="button"
            onClick={() => {
              snapDashboardAction("saveDashboardLayout", { widgetCount: renderedIds.length });
              onSave(renderedIds, hasReset, sizing, selectedProfileId);
            }}
          >Save Layout</button>
        </div>
      </div>
    </div>
  );
}
