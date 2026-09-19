// Position agenda menus outside the widget's scrolling and clipping containers.
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import "styles/proposed-agenda-popover.scss";

// ----------------------------------------------------------------------------------------------
// @desc Anchor a keyboard-accessible popout to its trigger, keeping it inside the viewport.
// @param {object} props - { anchorRef, children, label, onClose }.
// @returns {JSX.Element} Portaled dialog with outside-click dismissal and focus restoration.
export default function ProposedAgendaPopover({ anchorRef, children, label, onClose }) {
  const popupRef = useRef(null);
  const [position, setPosition] = useState({ left: 8, top: 8, visibility: "hidden" });
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const popup = popupRef.current;
    // ------------------------------------------------------------------------------------------
    // @desc Reposition the popout after viewport changes or scrolling its anchor.
    const reposition = () => {
      const bounds = anchor.getBoundingClientRect();
      const left = Math.max(8, Math.min(bounds.left, window.innerWidth - popup.offsetWidth - 8));
      const availableBelow = window.innerHeight - bounds.bottom - 16;
      const top = availableBelow >= popup.offsetHeight ? bounds.bottom + 8
        : Math.max(8, Math.min(bounds.top - popup.offsetHeight - 8, window.innerHeight - popup.offsetHeight - 8));
      setPosition({ left, top, visibility: "visible" });
    };
    // ------------------------------------------------------------------------------------------
    // @desc Close on Escape and contain keyboard focus within the open dialog.
    const onKeyDown = event => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const controls = [...popup.querySelectorAll("button:not(:disabled), input, [tabindex='0']")];
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    // ------------------------------------------------------------------------------------------
    // @desc Dismiss only pointer events outside both the popout and its toggle button.
    const onPointerDown = event => {
      if (!popup.contains(event.target) && !anchor.contains(event.target)) onClose();
    };
    reposition();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reposition);
    resizeObserver?.observe(popup);
    (popup.querySelector("[aria-pressed='true']") || popup.querySelector("button, input"))?.focus();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      anchor?.focus();
    };
  }, [anchorRef, onClose]);
  return createPortal(<div aria-label={ label } aria-modal="true" className="proposed-agenda-popover"
    ref={ popupRef } role="dialog" style={ position }>{ children }</div>, document.body);
}
