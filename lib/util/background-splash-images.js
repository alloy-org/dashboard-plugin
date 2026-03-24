/**
 * [Claude-authored file]
 * Created: 2026-03-24 | Model: gpt-5.3-codex
 * Task: Shared deterministic background splash image selection utility
 * Prompt summary: "move BG_IMAGES to util/background-splash-images.js and add backgroundSplashUrl(size, ...)"
 */

// [Claude] Task: centralize curated splash image pool for quote tiles and dashboard backgrounds
// Prompt: "move BG_IMAGES to util/background-splash-images.js and add backgroundSplashUrl(size, ...)"
// Date: 2026-03-24 | Model: gpt-5.3-codex
const SPLASH_IMAGE_BASE_URLS = [
  'https://images.unsplash.com/photo-1506905925346-21bda4d32df4', // Snowy mountain range at golden hour
  'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05', // Misty evergreen forest valley
  'https://images.unsplash.com/photo-1501785888041-af3ef285b470', // Mountain lake with dramatic peaks
  'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b', // Alpine summit under soft clouds
  'https://images.unsplash.com/photo-1519681393784-d120267933ba', // Starry night over mountain silhouettes
  'https://images.unsplash.com/photo-1475924156734-496f6cac6ec1', // Sunlit mountain meadow and ridges
  'https://images.unsplash.com/photo-1490730141103-6cac27aaab94', // Warm sunrise landscape tones
  'https://images.unsplash.com/photo-1433086966358-54859d0ed716', // Waterfall framed by lush greenery
  'https://images.unsplash.com/photo-1472214103451-9374bd1c798e', // Rolling hills beneath open sky
  'https://images.unsplash.com/photo-1414609245224-afa02bfb3fda', // Bright sky over rugged cliffs
  'https://images.unsplash.com/photo-1469474968028-56623f02e42e', // Lake reflection at dawn
  'https://images.unsplash.com/photo-1426604966848-d7adac402bff', // Desert dunes with layered shadows
  'https://images.unsplash.com/photo-1465146344425-f00d5f5c8f07', // Coastal cliff and ocean horizon
  'https://images.unsplash.com/photo-1491553895911-0055eca6402d', // Pine forest with sunbeams
  'https://images.unsplash.com/photo-1470770841072-f978cf4d019e', // Mountain road through the valley
  'https://images.unsplash.com/photo-1464823063530-08f10ed1a2dd', // Cloud sea above mountain ridges
  'https://images.unsplash.com/photo-1439853949127-fa647821eba0', // Lone tree in wide open field
  'https://images.unsplash.com/photo-1472396961693-142e6e269027', // Layered mountains with morning haze
  'https://images.unsplash.com/photo-1431794062232-2a99a5431c6c', // Ocean waves along rocky shore
  'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa', // Earth-from-space inspirational vista
  'https://images.unsplash.com/photo-1506744038136-46273834b3fb', // Turquoise lake and mountain pines
  'https://images.unsplash.com/photo-1493244040629-496f6d136cc3', // Aerial view of winding river
  'https://images.unsplash.com/photo-1418065460487-3e41a6c84dc5', // Snow-capped peaks and alpine forest
  'https://images.unsplash.com/photo-1470246973918-29a93221c455', // Quiet path through tall trees
  'https://images.unsplash.com/photo-1473116763249-2faaef81ccda', // Open sky and calm horizon line
  'https://images.unsplash.com/photo-1439792675105-701e6a4ab6f0', // Glacier blue water and mountains
  'https://images.unsplash.com/photo-1463320726281-696a485928c7', // Sunset clouds over layered hills
  'https://images.unsplash.com/photo-1499002238440-d264edd596ec', // Foggy forest with soft light
  'https://images.unsplash.com/photo-1510798831971-661eb04b3739', // Ocean cliffside at sunrise
  'https://images.unsplash.com/photo-1507525428034-b723cf961d3e', // Tropical ocean waves and sky
  'https://images.unsplash.com/photo-1441974231531-c6227db76b6e', // Dense forest canopy in sunlight
  'https://images.unsplash.com/photo-1450101499163-c8848c66ca85', // Mountain ridge during blue hour
  'https://images.unsplash.com/photo-1458668383970-8ddd3927deed', // Desert mountains and open sky
  'https://images.unsplash.com/photo-1470770903676-69b98201ea1c', // River bend through evergreen valley
  'https://images.unsplash.com/photo-1464037866556-6812c9d1c72e', // Waterfall plunge into rocky basin
  'https://images.unsplash.com/photo-1455218873509-8097305ee378', // Sunrise through mountain pass
  'https://images.unsplash.com/photo-1465919292275-c60ba49da6ae', // Tranquil lake with mirrored peaks
  'https://images.unsplash.com/photo-1448375240586-882707db888b', // Wildflower meadow in mountain light
  'https://images.unsplash.com/photo-1451187580459-43490279c0fa', // Night sky over silent mountains
  'https://images.unsplash.com/photo-1465101046530-73398c7f28ca', // Coastal sunrise with waves
  'https://images.unsplash.com/photo-1421789665209-c9b2a435e3dc', // Rolling countryside under warm light
  'https://images.unsplash.com/photo-1477414348463-c0eb7f1359b6', // Peak panorama with cloud layers
  'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee', // Calm sea and colorful dusk sky
  'https://images.unsplash.com/photo-1455156218388-5e61b526818b', // Mountain trail into the horizon
  'https://images.unsplash.com/photo-1447752875215-b2761acb3c5d', // Forest path with bright green foliage
  'https://images.unsplash.com/photo-1443890923422-7819ed4101c0', // Dramatic rock formations at sunset
  'https://images.unsplash.com/photo-1494783367193-149034c05e8f', // Coastal cliffs and deep blue water
  'https://images.unsplash.com/photo-1517821365201-20a37d5f3f6f', // Mountain lake with gentle ripples
  'https://images.unsplash.com/photo-1502082553048-f009c37129b9', // Snow-covered valley with pines
  'https://images.unsplash.com/photo-1519904981063-b0cf448d479e', // Mountain cabin view at sunrise
  'https://images.unsplash.com/photo-1476231682828-37e571bc172f', // Soft dawn over misty hills
];

const SIZE_DIMENSIONS = {
  small: { width: 600, height: 600 },
  large: { width: 1920, height: 1080 },
};

// [Claude] Task: derive deterministic URL selection from a stable seed and optional variant
// Prompt: "returns a value that remains stable across multiple renders; pass a seed value"
// Date: 2026-03-24 | Model: gpt-5.3-codex
function hashSeed(seedValue) {
  const text = String(seedValue ?? 'default-seed');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// [Claude] Task: provide size-aware deterministic splash image URL API
// Prompt: "export function backgroundSplashUrl(size, ...)"
// Date: 2026-03-24 | Model: gpt-5.3-codex
export function backgroundSplashUrl(size = 'small', seed = 'default', variant = 0) {
  const dimensions = SIZE_DIMENSIONS[size] || SIZE_DIMENSIONS.small;
  const selectionSeed = `${ seed }:${ variant }`;
  const imageIndex = hashSeed(selectionSeed) % SPLASH_IMAGE_BASE_URLS.length;
  const baseUrl = SPLASH_IMAGE_BASE_URLS[imageIndex];
  const query = `?w=${ dimensions.width }&h=${ dimensions.height }&fit=crop&auto=format`;
  return `${ baseUrl }${ query }`;
}
