/**
 * [Claude-authored file]
 * Created: 2026-02-22 | Model: claude-opus-4-6
 * Task: Reusable settings popup with Submit/Cancel actions
 * Prompt summary: "popup component for widget configuration with onSubmit, onCancel, and content props"
 */
import { useEffect, useRef } from "react";
import "styles/config-popup.scss"

// [Claude] Task: render a modal popup overlay with settings content and Submit/Cancel buttons
// Prompt: "popup component that pops up setting options upon clicking Configure"
// Date: 2026-02-22 | Model: claude-opus-4-6
// [Composer] Task: click-outside-to-close for document-anchored (scrollTop) mode via document mousedown listener
// Prompt: "clicking outside dashboard-settings-popup should close it; check parent chain to avoid false closes"
// Date: 2026-04-09
// [Claude claude-4.7-opus] Task: migrate ConfigPopup from createElement to JSX
// Prompt: "translate this project to render components with JSX instead"
export default function ConfigPopup({ title, onSubmit, onCancel, submitLabel = 'Submit', children, scrollTop }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (scrollTop === undefined) return;
    const handleMouseDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) onCancel();
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [scrollTop, onCancel]);

  const overlayStyle = scrollTop !== undefined
    ? { position: 'absolute', top: scrollTop, left: 0, right: 0, minHeight: '100vh', pointerEvents: 'none',
        alignItems: 'flex-start', padding: '16px' }
    : undefined;

  return (
    <div
      className="config-popup-overlay"
      style={overlayStyle}
      onClick={scrollTop === undefined ? (e) => { if (e.target === e.currentTarget) onCancel(); } : undefined}
    >
      <div
        className="config-popup-container"
        ref={containerRef}
        style={scrollTop !== undefined ? { pointerEvents: 'auto' } : undefined}
      >
        {title ? (
          <div className="config-popup-header">
            <h3 className="config-popup-title">{title}</h3>
          </div>
        ) : null}
        <div className="config-popup-body">{children}</div>
        <div className="config-popup-actions">
          <button className="config-popup-btn config-popup-btn--cancel" onClick={onCancel}>Cancel</button>
          <button className="config-popup-btn config-popup-btn--submit" onClick={onSubmit}>{submitLabel}</button>
        </div>
      </div>
    </div>
  );
}
