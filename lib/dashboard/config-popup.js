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
export default function ConfigPopup({ title, onSubmit, onCancel, submitLabel = 'Submit', children }) {
  const h = createElement;

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) onCancel();
  };

  return h('div', { className: 'config-popup-overlay', onClick: handleOverlayClick },
    h('div', { className: 'config-popup-container' },
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
