/**
 * [Cursor-authored file]
 * Created: 2026-07-30 | Model: opus-5
 * Task: Session-only background override plus the cross-fade state machine behind "Swap background"
 * Prompt summary: "one for 'Swap background', which animates a transition to a new background from our array"
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { backgroundSplashUrlFromIndex, SPLASH_IMAGE_COUNT } from "util/background-splash-images";
import { logIfEnabled } from "util/log";

// Fade length shared by the CSS animation (applied inline by the dashboard) and the commit timer
// below, so the overlay is never promoted to the base background mid-animation.
export const BACKGROUND_FADE_DURATION_MS = 700;

// Keyframes name declared in styles/dashboard.scss. Driving the fade with an animation rather than a
// transition means the overlay animates from its mounting paint, with no need to toggle a class on a
// later frame.
export const BACKGROUND_FADE_ANIMATION_NAME = 'dashboard-background-fade-in';

// Upper bound on waiting for the incoming image to decode before fading anyway.
const IMAGE_PRELOAD_TIMEOUT_MS = 4000;

// ------------------------------------------------------------------------------------------
// @desc Pick a random splash-pool position that differs from the one on screen, so every swap is a
//   visible change rather than an occasional no-op re-render of the same picture.
// @param {number} excludedIndex - Position currently displayed, or -1 when nothing has been swapped yet
// @returns {number} Position to display next; always different from excludedIndex when the pool has 2+ images
// [Cursor opus-5] Task: guarantee consecutive swaps land on different images
// Prompt: "animates a transition to a new background from our array"
// Date: 2026-07-30 | Model: opus-5
function imageIndexExcluding(excludedIndex) {
  if (SPLASH_IMAGE_COUNT <= 1) return 0;
  const baseIndex = excludedIndex >= 0 ? excludedIndex : Math.floor(Math.random() * SPLASH_IMAGE_COUNT);
  const forwardOffset = 1 + Math.floor(Math.random() * (SPLASH_IMAGE_COUNT - 1));
  return (baseIndex + forwardOffset) % SPLASH_IMAGE_COUNT;
}

// ------------------------------------------------------------------------------------------
// @desc Warm the browser cache for an image so the cross-fade reveals a painted picture instead of an
//   empty layer. Resolves rather than rejects on load failure, and gives up after
//   IMAGE_PRELOAD_TIMEOUT_MS, so a slow or unreachable CDN cannot leave a swap stuck in flight forever.
// @param {string} url - Image URL to fetch and decode
// @returns {Promise<void>} Always resolves, whether the image loaded, failed, or timed out
// [Cursor opus-5] Task: preload the incoming background before starting the fade
// Prompt: "animates a transition to a new background"
// Date: 2026-07-30 | Model: opus-5
function preloadedImage(url) {
  return new Promise(resolve => {
    const image = new Image();
    const timer = setTimeout(resolve, IMAGE_PRELOAD_TIMEOUT_MS);
    const settle = () => { clearTimeout(timer); resolve(); };
    image.onload = settle;
    image.onerror = settle;
    image.src = url;
  });
}

// ------------------------------------------------------------------------------------------
// @desc Own the dashboard's swapped-background state and the two-layer cross-fade that animates each
//   swap. The dashboard paints incomingBackgroundUrl into an overlay that mounts transparent, fades to
//   opaque, and is then committed as the new base image. The override is deliberately session-only —
//   nothing is written to app settings — so a reload restores whatever background the user configured.
// @returns {Object} An object with the following properties:
// - {string|null} incomingBackgroundUrl - Image the overlay layer should paint, or null while idle
// - {function(): Promise<void>} swapBackground - Start a swap; no-ops while one is already in flight
// - {string|null} swappedBackgroundUrl - Committed override that outranks the configured background
// [Cursor opus-5] Task: cross-fade to a new splash background on demand
// Prompt: "one for 'Swap background', which animates a transition to a new background from our array"
// Date: 2026-07-30 | Model: opus-5
export default function useBackgroundSwap() {
  const [incomingBackgroundUrl, setIncomingBackgroundUrl] = useState(null);
  const [swappedBackgroundUrl, setSwappedBackgroundUrl] = useState(null);
  const imageIndexRef = useRef(-1);
  const isMountedRef = useRef(true);
  const isSwapInFlightRef = useRef(false);

  useEffect(() => () => { isMountedRef.current = false; }, []);

  const swapBackground = useCallback(async () => {
    if (isSwapInFlightRef.current) return;
    isSwapInFlightRef.current = true;
    const nextIndex = imageIndexExcluding(imageIndexRef.current);
    const nextUrl = backgroundSplashUrlFromIndex('large', nextIndex);
    logIfEnabled(`[background-swap] fading to splash image ${ nextIndex } of ${ SPLASH_IMAGE_COUNT }`);
    await preloadedImage(nextUrl);
    if (!isMountedRef.current) return;
    imageIndexRef.current = nextIndex;
    setIncomingBackgroundUrl(nextUrl);
  }, []);

  // Once the fade has played out, promote the overlay image to the base background and drop the
  // overlay. Both layers show the same image by then, so the handoff is invisible.
  useEffect(() => {
    if (!incomingBackgroundUrl) return undefined;
    const timer = setTimeout(() => {
      setSwappedBackgroundUrl(incomingBackgroundUrl);
      setIncomingBackgroundUrl(null);
      isSwapInFlightRef.current = false;
    }, BACKGROUND_FADE_DURATION_MS);
    return () => clearTimeout(timer);
  }, [incomingBackgroundUrl]);

  return { incomingBackgroundUrl, swapBackground, swappedBackgroundUrl };
}
