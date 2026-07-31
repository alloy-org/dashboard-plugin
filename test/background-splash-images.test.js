/**
 * [Cursor-authored file]
 * Created: 2026-07-30 | Model: opus-5
 * Task: Unit tests for index-based splash image selection used by the "Swap background" quick action
 * Prompt summary: "one for 'Swap background', which animates a transition to a new background from our array"
 */
import { backgroundSplashUrl, backgroundSplashUrlFromIndex, SPLASH_IMAGE_COUNT } from "util/background-splash-images";

describe('backgroundSplashUrlFromIndex', () => {
  it('sizes large requests for a full-bleed dashboard background', () => {
    const url = backgroundSplashUrlFromIndex('large', 0);
    expect(url).toContain('images.unsplash.com');
    expect(url).toContain('w=1920');
    expect(url).toContain('h=1080');
    expect(url).toContain('fit=crop');
  });

  it('returns a distinct image for every position in the pool', () => {
    const urls = Array.from({ length: SPLASH_IMAGE_COUNT }, (unused, index) => backgroundSplashUrlFromIndex('large', index));
    expect(new Set(urls).size).toBe(SPLASH_IMAGE_COUNT);
  });

  it('wraps out-of-range and negative indexes back into the pool', () => {
    expect(backgroundSplashUrlFromIndex('large', SPLASH_IMAGE_COUNT)).toBe(backgroundSplashUrlFromIndex('large', 0));
    expect(backgroundSplashUrlFromIndex('large', -1)).toBe(backgroundSplashUrlFromIndex('large', SPLASH_IMAGE_COUNT - 1));
  });

  it('falls back to small dimensions for an unknown size key', () => {
    expect(backgroundSplashUrlFromIndex('gigantic', 3)).toBe(backgroundSplashUrlFromIndex('small', 3));
  });

  it('keeps seeded selection stable, since widgets re-render with the same seed', () => {
    expect(backgroundSplashUrl('large', '2026-07-30')).toBe(backgroundSplashUrl('large', '2026-07-30'));
  });
});
