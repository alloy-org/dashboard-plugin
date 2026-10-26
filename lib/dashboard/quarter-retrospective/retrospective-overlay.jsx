// The full-screen layer the Quarter Retrospective opens in: a dimmed backdrop over the dashboard and a tall story
// card centered on it. Escape, the close button, and a click on the backdrop all close it.
import { useSuspendWidgetMounting } from "hooks/use-widget-mount-suspension";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import "styles/quarter-retrospective.scss";

// ----------------------------------------------------------------------------------------------
// @desc Render the overlay into document.body, so no widget cell clips or stacks above it.
// @param {object} props - An object with the following properties:
//   - {JSX.Element} children - What the card holds: the style choice, a loading state, or the story
//   - {string} label - Accessible name for the dialog
//   - {Function} onClose - Closes the retrospective
// @returns {JSX.Element} The overlay, portaled when a document body exists.
export default function RetrospectiveOverlay({ children, label, onClose }) {
  const closeButtonRef = useRef(null);
  useSuspendWidgetMounting(); // The overlay covers the dashboard, so widgets scrolled into view behind it can wait

  useEffect(() => {
    closeButtonRef.current?.focus();
    const handleKeyDown = event => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const overlay = (
    <div className="quarter-retrospective-overlay" onClick={ event => { if (event.target === event.currentTarget) onClose(); } }>
      <div aria-label={ label } aria-modal="true" className="retrospective-overlay-card" role="dialog">
        <button aria-label="Close retrospective" className="retrospective-overlay-close" onClick={ onClose } ref={ closeButtonRef }
          type="button">✕</button>
        { children }
      </div>
    </div>
  );
  return typeof document !== "undefined" && document.body ? createPortal(overlay, document.body) : overlay;
}
