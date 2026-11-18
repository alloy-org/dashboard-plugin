// Helpers that read the browser and the viewer's preferences in it, such as whether they asked for reduced motion.

// ----------------------------------------------------------------------------------------------
// @desc Whether the viewer asked for reduced motion. The host plugin, jsdom and older embeds lack matchMedia, which
//   reads as no.
// @returns {boolean} True when motion should be skipped.
export function prefersReducedMotion() {
  try {
    return !!globalThis.window?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  } catch {
    return false;
  }
}
