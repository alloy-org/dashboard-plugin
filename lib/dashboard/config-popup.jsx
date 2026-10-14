/**
 * [Claude-authored file]
 * Created: 2026-02-22 | Model: claude-opus-4-6
 * Task: Reusable settings popup with Submit/Cancel actions
 * Prompt summary: "popup component for widget configuration with onSubmit, onCancel, and content props"
 */
import { Button, IconButton } from "dashboard/controls";
import { useEffect, useRef } from "react";
import { MdClose } from "react-icons/md";
import "styles/config-popup.scss"

// ----------------------------------------------------------------------------------------------
// @desc Modal dialog with a title bar, body content, and a Cancel / submit footer.
// [Claude] Task: render a modal popup overlay with settings content and Submit/Cancel buttons
// Prompt: "popup component that pops up setting options upon clicking Configure"
// Date: 2026-02-22 | Model: claude-opus-4-6
// [Composer] Task: click-outside-to-close for document-anchored (scrollTop) mode via document mousedown listener
// Prompt: "clicking outside dashboard-settings-popup should close it; check parent chain to avoid false closes"
// Date: 2026-04-09
// [Claude claude-4.7-opus] Task: migrate ConfigPopup from createElement to JSX
// Prompt: "translate this project to render components with JSX instead"
// [Claude Opus 5 (1M context)] Task: optional footerLeft slot so a caller can put status text opposite the buttons
// Prompt: "stick it on the left side of the button row with align-items: center"
export default function ConfigPopup({ title, onSubmit, onCancel, submitLabel = 'Submit', children, footerLeft, scrollTop }) {
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
        {title ? <ConfigPopupHeader onClose={ onCancel } title={ title } /> : null}
        <div className="config-popup-body">{children}</div>
        <div className="config-popup-actions">
          {footerLeft ? <div className="config-popup-footer-left">{footerLeft}</div> : null}
          <Button className="config-popup-btn config-popup-btn--cancel" onClick={ onCancel }>Cancel</Button>
          <Button className="config-popup-btn config-popup-btn--submit" onClick={ onSubmit } variant="raised">
            { submitLabel }
          </Button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc The dialog's title bar, in the host's dark dialog-title color with a round close button on the right. Exported
//   so a popup that builds its own container (the Layout popup) draws the same title bar as ConfigPopup.
// @param {Function} onClose - Called when the close button is clicked; callers pass their cancel handler.
// @param {React.ReactNode} title - The dialog title.
export function ConfigPopupHeader({ onClose, title }) {
  return (
    <div className="config-popup-header">
      <h3 className="config-popup-title">{ title }</h3>
      <IconButton className="config-popup-close-button" Icon={ MdClose } label="Close" onClick={ onClose }
        size="dialog" />
    </div>
  );
}
