/**
 * [Claude-authored file]
 * Created: 2026-02-22 | Model: claude-opus-4-6
 * Task: Reusable settings popup with Submit/Cancel actions
 * Prompt summary: "popup component for widget configuration with onSubmit, onCancel, and content props"
 */
import { createElement } from "react";
import "styles/config-popup.scss"

// [Claude] Task: render a modal popup overlay with settings content and Submit/Cancel buttons
// Prompt: "popup component that pops up setting options upon clicking Configure"
// Date: 2026-02-22 | Model: claude-opus-4-6
export default function ConfigPopup({ title, onSubmit, onCancel, submitLabel = 'Submit', children, scrollTop }) {
  const h = createElement;

  // When scrollTop is provided the overlay is absolutely positioned so it sits at the current scroll
  // position. pointer-events:none on the backdrop lets the underlying page continue to scroll;
  // the modal card itself restores pointer events.
  const overlayStyle = scrollTop !== undefined
    ? { position: 'absolute', top: scrollTop, left: 0, right: 0, minHeight: '100vh', pointerEvents: 'none',
        alignItems: 'flex-start', padding: '16px' }
    : undefined;

  return h('div', {
    className: 'config-popup-overlay',
    style: overlayStyle,
    onClick: scrollTop === undefined ? (e) => { if (e.target === e.currentTarget) onCancel(); } : undefined,
  },
    h('div', { className: 'config-popup-container', style: scrollTop !== undefined ? { pointerEvents: 'auto' } : undefined },
      title ? h('div', { className: 'config-popup-header' },
        h('h3', { className: 'config-popup-title' }, title)
      ) : null,
      h('div', { className: 'config-popup-body' }, children),
      h('div', { className: 'config-popup-actions' },
        h('button', { className: 'config-popup-btn config-popup-btn--cancel', onClick: onCancel }, 'Cancel'),
        h('button', { className: 'config-popup-btn config-popup-btn--submit', onClick: onSubmit }, submitLabel)
      )
    )
  );
}
