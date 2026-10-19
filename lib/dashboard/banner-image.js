// The dashboard's banner image: one of the preset banners ample-web offers for notes, chosen in Dashboard Settings
// and stored by name in the dashboard setting note. Mirrors ample-web's lib/ample-notes-store/util/banner-image.js,
// which serves the same files from assets.amplenote.com.

const BANNER_IMAGE_ASSET_HOST = "https://assets.amplenote.com";
export const DEFAULT_BANNER_IMAGE_NAME = "mountains";
// Stored when the user turns the banner off, so a missing setting can still mean "use the default"
export const NO_BANNER_IMAGE_NAME = "none";

// Ordered as ample-web presents them: its standard banners, then the ones it reserves for paid accounts. The
// dashboard cannot see the account's plan, so it offers all of them.
export const BANNER_IMAGE_NAMES = [
  "clouds",
  "waterfall",
  "fireworks",
  "surfer",
  "mountains",
  "office",
  "succulents",
  "city",
  "building",
  "watch",
  "hills",
  "leaves",
  "dune",
  "sunset",
  "fish",
  "aurora",
  "dog",
  "cats",
  "camera-gear",
  "guitar",
  "jellyfish",
  "fungi",
  "food",
  "chocolate",
  "skier",
  "roller-coaster",
  "car",
  "steps",
  "concert",
  "pattern",
];

// ----------------------------------------------------------------------------------------------
// @desc The banner to show for a stored setting value: the stored banner when it is a known preset or "none", the
//   default banner otherwise (nothing stored yet, or a name this build no longer offers).
// @param {string|null|undefined} settingValue - The "Banner image" value from the dashboard setting note.
// @returns {string} A name from BANNER_IMAGE_NAMES, or NO_BANNER_IMAGE_NAME.
export function bannerImageNameFromSetting(settingValue) {
  const name = typeof settingValue === "string" ? settingValue.trim().toLowerCase() : "";
  if (name === NO_BANNER_IMAGE_NAME || BANNER_IMAGE_NAMES.includes(name)) return name;
  return DEFAULT_BANNER_IMAGE_NAME;
}

// ----------------------------------------------------------------------------------------------
// @desc The URL of a preset banner image, as ample-web builds it.
// @param {string} bannerImageName - A name from BANNER_IMAGE_NAMES, or NO_BANNER_IMAGE_NAME.
// @returns {string|null} The image URL, or null when the banner is off or the name is unknown.
export function bannerImageURLFromBannerImageName(bannerImageName) {
  if (!BANNER_IMAGE_NAMES.includes(bannerImageName)) return null;
  return `${ BANNER_IMAGE_ASSET_HOST }/assets/banners/banner-${ bannerImageName }.jpg`;
}
