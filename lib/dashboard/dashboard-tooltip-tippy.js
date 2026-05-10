/**
 * [Claude-authored file]
 * Created: 2026-03-09 | Model: claude-4.6-opus-high-thinking
 * Task: Tippy.js tooltip wrapper — React component and canvas hook
 * Prompt summary: "replace hand-rolled tooltips with tippy.js, separated into its own component and stylesheet"
 */
import tippy from 'tippy.js';
import { createElement, useEffect, useRef } from 'react';
import "styles/dashboard-tippy.scss"

const TIPPY_DEFAULTS = {
  theme: 'dashboard',
  duration: [120, 80],
  arrow: true,
  offset: [0, 8],
};

// [Claude] Task: React wrapper component that attaches a tippy tooltip to its children
// Prompt: "replace hand-rolled tooltips with tippy.js, separated into its own component"
// Date: 2026-03-09 | Model: claude-4.6-opus-high-thinking
export default function DashboardTippy({ content, placement, interactive, children, ...rest }) {
  const ref = useRef(null);
  const instanceRef = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    instanceRef.current = tippy(ref.current, {
      ...TIPPY_DEFAULTS,
      content: content || '',
      placement: placement || 'top',
      interactive: interactive || false,
      allowHTML: true,
      ...rest,
    });
    return () => {
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (instanceRef.current && content != null) {
      instanceRef.current.setContent(content);
    }
  }, [content]);

  return createElement('span', { ref, style: { display: 'inline' } }, children);
}

// [Claude] Task: hook for canvas-based tooltips using a tippy virtual element with optional interactive mode
// Prompt: "when a user hovers on a bar, show interactive tooltip; on mouse leave, schedule delayed hide"
// Date: 2026-03-18 | Model: claude-4.6-opus-high-thinking
export function useCanvasTippy(options = {}) {
  const instanceRef = useRef(null);
  const rectRef = useRef({ width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 });
  const hideTimerRef = useRef(null);
  const hideDelayRef = useRef(options.hideDelay || 300);
  const onScheduledHideRef = useRef(null);

  function cancelScheduledHide() {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }

  function scheduleHide(delay, onHide) {
    cancelScheduledHide();
    if (onHide !== undefined) onScheduledHideRef.current = onHide;
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      instanceRef.current?.hide();
      if (onScheduledHideRef.current) onScheduledHideRef.current();
    }, delay ?? hideDelayRef.current);
  }

  useEffect(() => {
    instanceRef.current = tippy(document.createElement('div'), {
      ...TIPPY_DEFAULTS,
      getReferenceClientRect: () => rectRef.current,
      trigger: 'manual',
      hideOnClick: false,
      allowHTML: true,
      interactive: !!options.interactive,
      placement: options.placement || 'top',
      appendTo: () => document.body,
      ...options,
    });

    let onPopperEnter, onPopperLeave;
    if (options.interactive) {
      const popper = instanceRef.current.popper;
      onPopperEnter = () => cancelScheduledHide();
      onPopperLeave = () => scheduleHide();
      popper.addEventListener('mouseenter', onPopperEnter);
      popper.addEventListener('mouseleave', onPopperLeave);
    }

    return () => {
      if (options.interactive && instanceRef.current) {
        const popper = instanceRef.current.popper;
        if (onPopperEnter) popper.removeEventListener('mouseenter', onPopperEnter);
        if (onPopperLeave) popper.removeEventListener('mouseleave', onPopperLeave);
      }
      cancelScheduledHide();
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
  }, []);

  // [Claude] Task: support dynamic above/below placement with below-chart class toggle
  // Prompt: "evaluate whether to pop tooltip above or below the date bar"
  // Date: 2026-03-09 | Model: claude-4.6-opus-high-thinking
  function show(content, screenX, screenY, options) {
    cancelScheduledHide();
    const inst = instanceRef.current;
    if (!inst) return;
    rectRef.current = { width: 0, height: 0, top: screenY, right: screenX, bottom: screenY, left: screenX };
    inst.setContent(content);

    const opts = options || {};
    const placement = opts.placement || inst.props.placement;
    if (placement !== inst.props.placement) inst.setProps({ placement });
    const box = inst.popper.firstElementChild;
    if (box) box.classList.toggle('below-chart', !!opts.belowChart);

    if (inst.state.isVisible) {
      inst.popperInstance?.update();
    } else {
      inst.show();
    }
  }

  function hide() {
    cancelScheduledHide();
    instanceRef.current?.hide();
  }

  return { show, hide, scheduleHide, cancelScheduledHide };
}
