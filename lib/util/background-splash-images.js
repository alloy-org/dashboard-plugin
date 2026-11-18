// Curated backgrounds and deterministic, size-aware image URL selection for dashboard widgets.

// ------------------------------------------------------------------------------------------
// @desc Shared dashboard and quote backgrounds; each URL has a visual description for easy pruning.
const SPLASH_IMAGE_BASE_URLS = [
  'https://images.unsplash.com/photo-1506905925346-21bda4d32df4', // Snowy mountain peaks above a sea of clouds at pink dawn
  'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05', // Sun breaking through clouds over a green rocky valley
  'https://images.unsplash.com/photo-1501785888041-af3ef285b470', // Rowboat on a turquoise lake beneath steep mountain cliffs
  'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b', // Pine forest overlooking a glacier between snowy mountain ranges
  'https://images.unsplash.com/photo-1519681393784-d120267933ba', // Milky Way and shooting star above snowy mountain silhouettes
  'https://images.unsplash.com/photo-1475924156734-496f6cac6ec1', // Purple sunset over a rocky coastline and calm sea
  'https://images.unsplash.com/photo-1490730141103-6cac27aaab94', // Person with outstretched arms reflected in shallow water at sunset
  'https://images.unsplash.com/photo-1433086966358-54859d0ed716', // Tiered waterfall and arched footbridge surrounded by green foliage
  'https://images.unsplash.com/photo-1472214103451-9374bd1c798e', // Stone circle in a bright green valley beneath a golden sky
  'https://images.unsplash.com/photo-1414609245224-afa02bfb3fda', // Small shore waves beneath an orange ocean sunset
  'https://images.unsplash.com/photo-1469474968028-56623f02e42e', // Hiker on a rocky ridge above a hazy sunlit forest valley
  'https://images.unsplash.com/photo-1426604966848-d7adac402bff', // Sheer granite cliff above a sunlit meadow and pine trees
  'https://images.unsplash.com/photo-1465146344425-f00d5f5c8f07', // Red poppies and wildflowers against a pale sky
  'https://images.unsplash.com/photo-1491553895911-0055eca6402d', // Black athletic shoe suspended against a white background
  'https://images.unsplash.com/photo-1470770841072-f978cf4d019e', // Wooden lakeside boathouse beneath misty mountain cliffs
  'https://images.unsplash.com/photo-1464823063530-08f10ed1a2dd', // Glacier winding between snow-covered mountains
  'https://images.unsplash.com/photo-1439853949127-fa647821eba0', // Pale distant cliffs framed by dark mountain slopes
  'https://images.unsplash.com/photo-1472396961693-142e6e269027', // Evergreen trees beneath towering granite rock faces
  'https://images.unsplash.com/photo-1431794062232-2a99a5431c6c', // Waterfall dropping from an orange sandstone cliff
  'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa', // Cloud-covered Earth and part of a spacecraft seen from orbit
  'https://images.unsplash.com/photo-1506744038136-46273834b3fb', // River and pine trees beneath Yosemite cliffs at dusk
  'https://images.unsplash.com/photo-1572293071277-ef1b3e761045', // Aerial view of a turquoise river winding through marshland
  'https://images.unsplash.com/photo-1418065460487-3e41a6c84dc5', // Evergreen forest fading into pale morning fog
  'https://images.unsplash.com/photo-1470246973918-29a93221c455', // Tall forest trees illuminated beneath a starry night sky
  'https://images.unsplash.com/photo-1473116763249-2faaef81ccda', // Gentle surf washing onto a sandy beach at pastel sunset
  'https://images.unsplash.com/photo-1439792675105-701e6a4ab6f0', // Thin orange twilight band behind a dark mountain silhouette
  'https://images.unsplash.com/photo-1463320726281-696a485928c7', // Rows of books displayed on outdoor market tables
  'https://images.unsplash.com/photo-1499002238440-d264edd596ec', // Purple lavender rows leading toward a golden sunset
  'https://images.unsplash.com/photo-1510798831971-661eb04b3739', // Warmly lit snowy cabin reflected in a winter lake
  'https://images.unsplash.com/photo-1507525428034-b723cf961d3e', // Tropical beach with pale sand and turquoise surf at sunrise
  'https://images.unsplash.com/photo-1441974231531-c6227db76b6e', // Sunlight filtering between tall trees along a forest path
  'https://images.unsplash.com/photo-1458668383970-8ddd3927deed', // Jagged snowy mountain peaks rising above thick white clouds
  'https://images.unsplash.com/photo-1470770903676-69b98201ea1c', // Wooden boats and boathouse beside a still alpine lake
  'https://images.unsplash.com/photo-1464037866556-6812c9d1c72e', // Passenger airplane at an airport gate beneath a colorful dusk sky
  'https://images.unsplash.com/photo-1455218873509-8097305ee378', // Narrow waterfall descending a cliff behind evergreen trees
  'https://images.unsplash.com/photo-1465919292275-c60ba49da6ae', // Small stone hut on a grassy mountain ridge
  'https://images.unsplash.com/photo-1448375240586-882707db888b', // Mossy forest floor and tall trunks in soft mist
  'https://images.unsplash.com/photo-1451187580459-43490279c0fa', // Earth at night with city lights along its curved horizon
  'https://images.unsplash.com/photo-1465101046530-73398c7f28ca', // Milky Way above dark hills and a lone tree silhouette
  'https://images.unsplash.com/photo-1421789665209-c9b2a435e3dc', // Tiny evergreen saplings growing from a moss-covered mound
  'https://images.unsplash.com/photo-1477414348463-c0eb7f1359b6', // Green, yellow, orange, and red leaves hanging from a string
  'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee', // Straight road winding between red sandstone formations
  'https://images.unsplash.com/photo-1455156218388-5e61b526818b', // Snow-covered forest and mountains reflected in a still lake
  'https://images.unsplash.com/photo-1447752875215-b2761acb3c5d', // Wooden footbridge leading into a dense evergreen forest
  'https://images.unsplash.com/photo-1443890923422-7819ed4101c0', // Pointed snowy mountain peak above dark wooded slopes
  'https://images.unsplash.com/photo-1494783367193-149034c05e8f', // Empty highway across a golden plain toward distant mountains
  'https://images.unsplash.com/photo-1608953029601-7a6e5e7fd548', // Blue-green lake enclosed by bare rocky mountain slopes
  'https://images.unsplash.com/photo-1502082553048-f009c37129b9', // Lone broad-canopied tree in a sunlit grassy field
  'https://images.unsplash.com/photo-1519904981063-b0cf448d479e', // Hiker on a rocky ledge above cloud-filled mountain valleys
  'https://images.unsplash.com/photo-1476231682828-37e571bc172f', // Aerial view of a narrow road curving through dense forest
  // Additional landscapes; keep each description beside its URL for easy pruning.
  'https://images.unsplash.com/photo-1764957080224-3e560f1cb107', // Purple heather overlooking jagged green mountain ridges
  'https://images.unsplash.com/photo-1759434190960-87511b2a5e5c', // Rocks in a still alpine pond reflecting green mountain slopes
  'https://images.unsplash.com/photo-1511884642898-4c92249e20b6', // Whitewater river threading through a misty evergreen valley
  'https://images.unsplash.com/photo-1506260408121-e353d10b87c7', // Soft green pasture hills dotted with dark evergreen groves
  'https://images.unsplash.com/photo-1778431193202-b0e2345eeab9', // Layered blue mountain silhouettes beneath a pale peach sky
  'https://images.unsplash.com/photo-1532274402911-5a369e4c4bb5', // Purple lakeside flowers framing a mountain sunset
  'https://images.unsplash.com/photo-1776871002050-f479a540f7c0', // Golden evening light on granite cliffs above a forest valley
  'https://images.unsplash.com/photo-1523712999610-f77fbcfc3843', // Amber sunbeams streaming between tall autumn forest trunks
  'https://images.unsplash.com/photo-1758023822490-d67991c886ca', // Dark conifer treetops disappearing into thick gray fog
  'https://images.unsplash.com/photo-1542273917363-3b1817f69a2d', // Lush green forest valley filled with pale low clouds
  'https://images.unsplash.com/photo-1770575454632-a70f66f56089', // Gnarled oak trees standing in a misty green meadow
  'https://images.unsplash.com/photo-1503435980610-a51f3ddfee50', // Pink-tinted fog above a line of evergreen treetops
  'https://images.unsplash.com/photo-1506452305024-9d3f02d1c9b5', // Dark evergreen silhouettes scattered across a foggy hillside
  'https://images.unsplash.com/photo-1759790524934-66e5e54e36ca', // Sparse conifer spires against a pale wall of mist
  'https://images.unsplash.com/photo-1765871319901-0aaafe3f1a2a', // Bands of low white mist between distant forested hills
  'https://images.unsplash.com/photo-1775471234419-f440ba697d58', // Steep wooded ravine fading into blue-gray fog
  'https://images.unsplash.com/photo-1544039161-b0c20826c6f6', // Straight forest path vanishing between dark misty trees
  'https://images.unsplash.com/photo-1488330890490-c291ecf62571', // Bright evergreen canopy crossed by drifting wisps of fog
  'https://images.unsplash.com/photo-1542401886-65d6c61db217', // Burnt-orange dune ridges beneath a hazy peach desert sky
  'https://images.unsplash.com/photo-1765498069280-b863094c17bf', // White sand dunes beneath a distant blue-gray mountain ridge
  'https://images.unsplash.com/photo-1488197047962-b48492212cda', // Sweeping golden dunes and soft shadows beneath a pale blue sky
  'https://images.unsplash.com/photo-1785270101227-b989c85cab00', // Close view of rippled sand along a sunlit dune crest
  'https://images.unsplash.com/photo-1511860810434-a92f84c6f01e', // Sharp orange dune ridge against a lightly clouded blue sky
  'https://images.unsplash.com/photo-1559767180-47d8f4919e5d', // Deep shadows between rolling dunes beneath streaked clouds
  'https://images.unsplash.com/photo-1781902835009-a1042ade0cba', // Desert shrubs and a bare tree beside an orange dune
  'https://images.unsplash.com/photo-1621795307430-3ff25aa08945', // Windblown sand lifting from layered brown dune crests
  'https://images.unsplash.com/photo-1617374128851-c84e37dc9f37', // Broad expanse of golden dunes leading toward rocky hills
  'https://images.unsplash.com/photo-1506147854445-5a3f534191f8', // Low sun peeking over a smooth shadowed sand dune
  'https://images.unsplash.com/photo-1503803548695-c2a7b4a5b875', // Orange sun reflected across a calm sea beneath heavy clouds
  'https://images.unsplash.com/photo-1773829148917-8556d051740d', // Golden ocean horizon framed by radiating orange clouds
  'https://images.unsplash.com/photo-1588001832198-c15cff59b078', // Pink cloud bank above breaking waves at ocean sunset
  'https://images.unsplash.com/photo-1762895619964-601c024165df', // Wispy gold clouds above a dark sea and distant sunset
  'https://images.unsplash.com/photo-1647962431451-d0fdaf1cf21c', // Gentle waves beneath long blue and gold sunset clouds
  'https://images.unsplash.com/photo-1762013606492-82f0ad43f6be', // White surf breaking beneath a glowing orange cloud bank
  'https://images.unsplash.com/photo-1422493757035-1e5e03968f95', // Smooth sea beneath horizontal bands of violet, pink, and gold
  'https://images.unsplash.com/photo-1559494007-9f5847c49d94', // Palm-lined beach and wet sand glowing in a peach sunset
  'https://images.unsplash.com/photo-1439405326854-014607f694d7', // Close view of teal ocean ripples beneath a soft pink sky
  'https://images.unsplash.com/photo-1533371452382-d45a9da51ad9', // Purple surf and vivid magenta clouds around a red setting sun
  'https://images.unsplash.com/photo-1507272931001-fc06c17e4f43', // Pale green northern lights above jagged snowy mountains
  'https://images.unsplash.com/photo-1589392997806-0066ab70c2d9', // Green aurora ribbons in a purple sky above a snowy plateau
  'https://images.unsplash.com/photo-1739233841148-930a9bb2eb90', // Green northern lights over a warmly lit snowy coastal village
  'https://images.unsplash.com/photo-1759675739458-6e5a4a60a117', // Starry purple sky and a low aurora above snowy mountain peaks
  'https://images.unsplash.com/photo-1768943555081-fa5802db470a', // Sweeping green aurora above a village between dark mountains
  'https://images.unsplash.com/photo-1776854660396-885fa89799cd', // Vertical pink, green, and blue aurora curtains among stars
  'https://images.unsplash.com/photo-1776854634319-e853ea3aa6af', // Bright green aurora ribbons curling across a star-filled sky
  'https://images.unsplash.com/photo-1546882418-73fb64201ec4', // Green aurora and dense stars above a dark mountain horizon
  'https://images.unsplash.com/photo-1641487379327-0c271bae490c', // Teal northern lights and drifting clouds above an open plain
  'https://images.unsplash.com/photo-1716155705161-fcf2e13da07a', // Small hillside chapel beneath vivid pink northern lights
  'https://images.unsplash.com/photo-1715535384818-8e673eb3a620', // Broad magenta aurora curtains above distant city lights
  'https://images.unsplash.com/photo-1716677825305-153fa99b1e39', // Pink and green aurora over snowy peaks framed by a dark tree
];

// Photos revealed as tasks are dismissed from the graveyard widget.
const GRAVEYARD_MEADOW_BASE_URLS = [
  'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429', // Layered mountain ridges fading into warm peach haze
  'https://images.unsplash.com/photo-1501854140801-50d01698950b', // Aerial view of vivid green folded hills
  'https://images.unsplash.com/photo-1559827260-dc66d52bef19', // Dark ocean wave beneath pink storm clouds
  'https://images.unsplash.com/photo-1530908295418-a12e326966ba', // Soft pink clouds seen from above
  'https://images.unsplash.com/photo-1592290435338-682c400cb6f8', // Red, purple, blue, and white wildflowers in a meadow
  'https://images.unsplash.com/photo-1520962880247-cfaf541c8724', // Lone hiker above hazy mountain ridges at sunset
  'https://images.unsplash.com/photo-1444210971048-6130cf0c46cf', // Friends silhouetted on a beach beneath a pastel evening sky
  'https://images.unsplash.com/photo-1528360983277-13d401cdc186', // Red lantern illuminating a narrow Japanese alley at night
  'https://images.unsplash.com/photo-1607136104080-78bbfe2d1234', // Sunlit green rolling hills beneath gray clouds
  'https://images.unsplash.com/photo-1440342359743-84fcb8c21f21', // Bamboo trunks converging around a bright green canopy
];

// Abstract textures the Quarter Retrospective's Spotify-style slides blend into their tone: fluid paint, ink clouds, and
// light ribbons, with no subject that competes with the words on top.
const RETROSPECTIVE_BACKGROUND_URLS = [
  'https://images.unsplash.com/photo-1557672172-298e090bd0f1', // Pastel marbled paint
  'https://images.unsplash.com/photo-1541701494587-cb58502866ab', // Blue and red ink cloud
  'https://images.unsplash.com/photo-1553356084-58ef4a67b2a7', // Blue fluid paint swirl
  'https://images.unsplash.com/photo-1567095761054-7a02e69e5c43', // Teal and rust ink on black
  'https://images.unsplash.com/photo-1604076913837-52ab5629fba9', // Red and violet light blur
  'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e', // Magenta ribbon on deep violet
  'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe', // Violet and cyan waves
  'https://images.unsplash.com/photo-1614850523459-c2f4c699c52e', // Deep blue fading to red
  'https://images.unsplash.com/photo-1574169208507-84376144848b', // Red and teal smoke
  'https://images.unsplash.com/photo-1557264337-e8a93017fe92', // Dark swirl of light trails
  'https://images.unsplash.com/photo-1620121692029-d088224ddc74', // Layered blue curves
  'https://images.unsplash.com/photo-1618172193622-ae2d025f4032', // Teal ribbon in three dimensions
];

const SIZE_DIMENSIONS = {
  small: { width: 600, height: 600 },
  large: { width: 1920, height: 1080 },
  story: { width: 720, height: 1280 },
};

export const SPLASH_IMAGE_COUNT = SPLASH_IMAGE_BASE_URLS.length;

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
export function graveyardMeadowUrl(size = 'small', seed = 'graveyard') {
  const dimensions = SIZE_DIMENSIONS[size] || SIZE_DIMENSIONS.small;
  const baseUrl = GRAVEYARD_MEADOW_BASE_URLS[hashSeed(seed) % GRAVEYARD_MEADOW_BASE_URLS.length];
  return `${ baseUrl }?w=${ dimensions.width }&h=${ dimensions.height }&fit=crop&auto=format`;
}

export function backgroundSplashUrl(size = 'small', seed = 'default', variant = 0) {
  return backgroundSplashUrlFromIndex(size, hashSeed(`${ seed }:${ variant }`));
}

// ------------------------------------------------------------------------------------------
// @desc Build the sized/cropped splash URL for an explicit pool position. Seed-free counterpart to
//   backgroundSplashUrl, for callers that choose the image themselves (the dashboard's "Swap
//   background" quick action) rather than deriving it from a value that must stay stable across renders.
// @param {string} size - Key into SIZE_DIMENSIONS ('small' or 'large'); unknown sizes fall back to 'small'
// @param {number} imageIndex - Position in the splash pool, wrapped modulo the pool length so callers
//   may pass any integer, including negatives, without bounds-checking first
// @returns {string} Unsplash URL carrying the width/height/crop query parameters for the requested size
export function backgroundSplashUrlFromIndex(size = 'small', imageIndex = 0) {
  const dimensions = SIZE_DIMENSIONS[size] || SIZE_DIMENSIONS.small;
  const poolLength = SPLASH_IMAGE_BASE_URLS.length;
  const wrappedIndex = ((Math.trunc(Number(imageIndex) || 0) % poolLength) + poolLength) % poolLength;
  const query = `?w=${ dimensions.width }&h=${ dimensions.height }&fit=crop&auto=format`;
  return `${ SPLASH_IMAGE_BASE_URLS[wrappedIndex] }${ query }`;
}

// ------------------------------------------------------------------------------------------
// @desc The abstract photo behind one slide of a Quarter Retrospective story, sized for the tall story card. The seed
//   picks where in the pool a story starts and each slide takes the next photo, so neighboring slides never repeat
//   and replaying a story shows the same photos.
// @param {string} seed - Stable per story, such as when it was generated
// @param {number} slidePosition - The slide's zero-based position in the story
// @returns {string} Unsplash URL for a 720x1280 crop
export function retrospectiveBackgroundUrl(seed, slidePosition = 0) {
  const dimensions = SIZE_DIMENSIONS.story;
  const poolLength = RETROSPECTIVE_BACKGROUND_URLS.length;
  const poolIndex = (hashSeed(seed) + Math.max(0, Math.trunc(Number(slidePosition) || 0))) % poolLength;
  return `${ RETROSPECTIVE_BACKGROUND_URLS[poolIndex] }?w=${ dimensions.width }&h=${ dimensions.height }&fit=crop&auto=format`;
}
