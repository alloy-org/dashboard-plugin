// Write a Quarter Retrospective's story in the chosen style. The Data style plays the slides built from the statistics
// as they are. The Roast and Spotify styles make one AI call that rewrites each slide's kicker, headline, and caption in
// the style's voice, may add photo slides from the images the month digests chose, and, for Spotify, names the
// quarter's genre. The AI writes words only: every figure, list, bar, and heap stays as the statistics built it, a
// rewritten line citing a number the slide's facts don't hold is put back, and an image it names must be one offered.
import { RETROSPECTIVE_STYLES, SLIDE_KINDS } from "dashboard/quarter-retrospective/retrospective-slides";
import { logIfEnabled } from "util/log";

export const STORY_TEXT_LIMITS = Object.freeze({ caption: 200, genreName: 40, headline: 80, kicker: 48 });
export const MAXIMUM_IMAGE_SLIDES = 3;
export const OFFERED_IMAGE_LIMIT = 9;
export const STORY_GENERATED_BY = Object.freeze({ ai: "ai", fallback: "fallback", statistics: "statistics" });
const IMAGE_CONTEXT_CHARACTERS = 160;
const PROMPT_LISTED_ROWS = 5;
const PROMPT_MONTH_LINES = 3;
const STORY_LOG_LABEL = "[retrospective-story-writer]";
const TEXT_FIELDS = Object.freeze(["kicker", "headline", "caption"]);
const NUMBER_PATTERN = /\d+(?:[.,]\d+)*/g;

const STYLE_RECIPES = Object.freeze({
  roast: Object.freeze({
    label: "Roast",
    rules: ["- Voice: affectionate ribbing, like a friend who is proud of them underneath. Tease the patterns the facts show, such "
      + "as a project that hogged the hours, a streak that broke, or open tasks left behind, never the person's worth.",
    "- Never joke about health, illness, family, relationships, grief, money trouble, or any other personal hardship. When a "
      + "fact touches one, state it plainly or leave it out.",
    "- The slide with id \"summary\" is sincere: no jokes, only honest credit for the quarter."],
  }),
  spotify: Object.freeze({
    label: "Spotify",
    rules: ["- Voice: an upbeat year-in-review story in the second person, like a music service's annual recap. Short, punchy "
      + "headlines; celebratory kickers such as \"Your Top Project\".",
    "- Never compare the person with other people or claim a rank among users; nothing is known about anyone else.",
    "- genre: a made-up genre for their quarter in two to four words, such as \"Deep-Focus Builder\", with a one-sentence "
      + "caption on why, drawn from the facts."],
  }),
});

// ----------------------------------------------------------------------------------------------
// @desc Write the story for a style. Without an AI, or when the reply holds nothing usable, the slides keep the words
//   the statistics gave them.
// @param {object} storyInput - An object with the following properties:
//   - {Array<object>} baseSlides - From slidesFromStatistics
//   - {Array<object>} media - Image candidates { alt, footnoteText, taskText, taskUuid, url }; empty when images were left out
//   - {Array<object>} monthDigests - The quarter's three month digests
//   - {object} statistics - From retrospectiveStatistics
//   - {string} style - A RETROSPECTIVE_STYLES value
// @param {object} options - { requestPrompt }: async (prompt) => parsed JSON reply, or null when no AI can answer.
// @returns {Promise<object>} { generatedBy, imageUrls, slides }: generatedBy is a STORY_GENERATED_BY value, imageUrls
//   the images the story shows.
export async function writeRetrospectiveStory(storyInput, { requestPrompt }) {
  const { baseSlides, media, monthDigests, statistics, style } = storyInput;
  if (!STYLE_RECIPES[style]) return { generatedBy: STORY_GENERATED_BY.statistics, imageUrls: [], slides: baseSlides };
  const fallback = { generatedBy: STORY_GENERATED_BY.fallback, imageUrls: [], slides: baseSlides };
  if (!requestPrompt) return fallback;
  const imageOffers = storyImageOffers(monthDigests, media);
  const prompt = storySlidesPrompt({ baseSlides, imageOffers, monthDigests, statistics, style });
  let reply = null;
  try {
    reply = await requestPrompt(prompt);
  } catch (error) {
    logIfEnabled(`${ STORY_LOG_LABEL } the story prompt failed`, error?.message);
  }
  const written = writtenStorySlides(reply, { baseSlides, imageOffers, statistics, style });
  return written ? { generatedBy: STORY_GENERATED_BY.ai, ...written } : fallback;
}

// ----------------------------------------------------------------------------------------------
// @desc The images a story may show: those the month digests chose, in month order, that are still among the
//   collected candidates, each with the words around it.
// @param {Array<object>} monthDigests - The quarter's month digests, each with imageUrls.
// @param {Array<object>} media - Image candidates { alt, footnoteText, taskText, url }.
// @returns {Array<object>} { alt, context, id, monthName, taskText, url } per image, ids "i1", "i2", and so on.
export function storyImageOffers(monthDigests, media) {
  const candidateByUrl = new Map((media || []).map(candidate => [candidate.url, candidate]));
  const offers = [];
  for (const digest of monthDigests || []) {
    for (const url of digest?.imageUrls || []) {
      const candidate = candidateByUrl.get(url);
      if (!candidate || offers.some(offer => offer.url === url) || offers.length >= OFFERED_IMAGE_LIMIT) continue;
      offers.push({ alt: _cleanText(candidate.alt, IMAGE_CONTEXT_CHARACTERS), context: _cleanText(candidate.footnoteText, IMAGE_CONTEXT_CHARACTERS),
        id: `i${ offers.length + 1 }`, monthName: digest.monthName || "", taskText: _cleanText(candidate.taskText, STORY_TEXT_LIMITS.caption), url });
    }
  }
  return offers;
}

// ----------------------------------------------------------------------------------------------
// @desc The prompt asking for a style's words.
// @param {object} options - { baseSlides, imageOffers, monthDigests, statistics, style }.
// @returns {string} Prompt answered with { genre, imageSlides, slides }.
export function storySlidesPrompt({ baseSlides, imageOffers, monthDigests, statistics, style }) {
  const recipe = STYLE_RECIPES[style];
  const quarterLabel = `Q${ statistics.quarter } ${ statistics.year }`;
  const nameLine = statistics.quarterName ? `The person named the quarter "${ statistics.quarterName }".` : null;
  const intentLines = statistics.intentTexts?.length ? ["", "What they set out to do this quarter:", ...statistics.intentTexts.map(text => `- ${ text }`)] : [];
  const monthLines = (monthDigests || []).map(digest => JSON.stringify(_monthFacts(digest)));
  const imageLines = imageOffers.length ? ["", "Images from their notes, which you may show as photo slides:",
    ...imageOffers.map(offer => JSON.stringify({ alt: offer.alt, context: offer.context, id: offer.id, month: offer.monthName, task: offer.taskText }))] : [];
  const isSpotify = style === RETROSPECTIVE_STYLES.spotify;
  const replyShape = `{ "slides": [{ "id": "...", "kicker": "...", "headline": "...", "caption": "..." }], "imageSlides": [{ "imageId": "i1", `
    + `"afterSlideId": "...", "kicker": "...", "headline": "..." }]${ isSpotify ? ', "genre": { "name": "...", "caption": "..." }' : "" } }`;
  const lines = [`Write the words for a ${ recipe.label } style retrospective of ${ quarterLabel }: a story of slides that helps a person see `
      + "how much forward progress their quarter's completed tasks amounted to.",
    nameLine,
    ...intentLines,
    "",
    "Each month of the quarter, summarized from its tasks:",
    ...monthLines,
    "",
    "The slides, in the order they play. Each is one JSON line: its id, its kind, its facts (figure, items, bars, columns), and "
      + "its current plain words (kicker, headline, caption):",
    ...baseSlides.map(slide => JSON.stringify(_slideFacts(slide))),
    ...imageLines,
    "",
    "Reply with JSON only, in this shape:",
    replyShape,
    "",
    "Rules:",
    ...recipe.rules,
    "- slides: rewrite the kicker, headline, and caption of every slide listed, by id. "
      + `Keep kickers under ${ STORY_TEXT_LIMITS.kicker } characters, headlines under ${ STORY_TEXT_LIMITS.headline }, and captions under `
      + `${ STORY_TEXT_LIMITS.caption }.`,
    "- A slide's figure shows as a large number between its kicker and headline, so the headline must read naturally right after "
      + "the number, as \"212\" followed by \"tasks finished\" does.",
    "- Use only numbers that appear in that slide's facts or words, or the quarter's totals. Never invent counts, percentages, "
      + "dates, or rankings; leave out any joke or claim that would need one.",
    "- Mention projects and tasks by the names given, without renaming them.",
    baseSlides.some(slide => slide.id === "previous-quarter") ? "- The slide with id \"previous-quarter\" compares the quarter with the "
      + "one before. Celebrate what grew. When it has no figure, the quarter was a little lighter: frame it as breathing room, never "
      + "as falling behind, and don't tease it." : null,
    imageOffers.length ? `- imageSlides: up to ${ MAXIMUM_IMAGE_SLIDES } photo slides, each showing one image id given and placed after the `
      + "slide whose id is afterSlideId. Choose images whose words suggest they show the quarter's work. The image's task "
      + "shows as its caption, so the kicker and headline introduce it without repeating it. Empty when none fit."
      : "- imageSlides: an empty list.",
    `- Quarter totals: ${ statistics.totalTaskCount } tasks completed, ${ statistics.totalVictoryValue } Victory Value.`];
  const promptLines = lines.filter(line => line !== null);
  return promptLines.join("\n");
}

// ----------------------------------------------------------------------------------------------
// @desc Merge a story reply into the slides built from the statistics. Each slide keeps its kind, figure, items, and
//   drawing; only its kicker, headline, and caption can change, and a rewritten line is kept only when it is text within
//   its limit citing no number outside the slide's facts and the quarter's totals. Photo slides need an offered image
//   and a headline, and a Spotify genre a name with no number.
// @param {*} reply - The parsed reply.
// @param {object} options - { baseSlides, imageOffers, statistics, style }.
// @returns {object|null} { imageUrls, slides }, or null when no slide was rewritten.
export function writtenStorySlides(reply, { baseSlides, imageOffers, statistics, style }) {
  if (!reply || typeof reply !== "object" || Array.isArray(reply)) return null;
  const quarterNumbers = _quarterNumbers(statistics);
  const writtenById = new Map(_objects(reply.slides).map(written => [String(written.id || ""), written]));
  let rewrittenCount = 0;
  const rewrittenSlides = baseSlides.map(slide => {
    const written = writtenById.get(slide.id);
    if (!written) return slide;
    const allowedNumbers = new Set([...quarterNumbers, ..._slideNumbers(slide)]);
    const words = _groundedWords(written, { allowedNumbers, fallback: slide });
    if (TEXT_FIELDS.some(field => words[field] !== slide[field])) rewrittenCount += 1;
    return { ...slide, ...words };
  });
  if (!rewrittenCount) return null;
  const imageSlides = _imageSlides(reply.imageSlides, { imageOffers, quarter: statistics.quarter, quarterNumbers });
  const genreSlide = style === RETROSPECTIVE_STYLES.spotify ? _genreSlide(reply.genre, quarterNumbers) : null;
  const slides = _placedSlides(rewrittenSlides, { genreSlide, imageSlides });
  return { imageUrls: imageSlides.map(({ slide }) => slide.imageUrl), slides };
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Text trimmed to one line, or an empty string when it isn't text or runs past its limit, so an overlong line
//   falls back whole rather than ending mid-thought.
// @param {*} value - Candidate text.
// @param {number} characters - The limit.
// @returns {string} Clean text.
function _boundedText(value, characters) {
  if (typeof value !== "string") return "";
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > characters ? "" : singleLine;
}

// ----------------------------------------------------------------------------------------------
// @desc Text trimmed to one line and cut to a length.
function _cleanText(value, characters) {
  if (typeof value !== "string") return "";
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > characters ? `${ singleLine.slice(0, characters - 1).trimEnd() }…` : singleLine;
}

// ----------------------------------------------------------------------------------------------
// @desc The Spotify genre slide, or null when the reply's genre has no usable name.
// @param {*} genre - The reply's { caption, name }.
// @param {Set<string>} quarterNumbers - Numbers the quarter's totals hold.
// @returns {object|null} A figure slide with id "personality".
function _genreSlide(genre, quarterNumbers) {
  if (!genre || typeof genre !== "object") return null;
  const name = _boundedText(genre.name, STORY_TEXT_LIMITS.genreName);
  if (!name || !_numbersAllowed(name, quarterNumbers)) return null;
  const caption = _boundedText(genre.caption, STORY_TEXT_LIMITS.caption);
  return { caption: caption && _numbersAllowed(caption, quarterNumbers) ? caption : "", figure: null, headline: name, id: "personality", items: [],
    kicker: "Your quarter's genre", kind: SLIDE_KINDS.figure, tone: "violet" };
}

// ----------------------------------------------------------------------------------------------
// @desc A written slide's kicker, headline, and caption, each falling back to the slide's own when the written one is
//   missing, too long, or cites a number it may not.
// @param {object} written - The reply's entry for the slide.
// @param {object} options - { allowedNumbers, fallback }: the numbers it may cite and the slide whose words stand in.
// @returns {object} { caption, headline, kicker }.
function _groundedWords(written, { allowedNumbers, fallback }) {
  const words = {};
  for (const field of TEXT_FIELDS) {
    const text = _boundedText(written[field], STORY_TEXT_LIMITS[field]);
    words[field] = text && _numbersAllowed(text, allowedNumbers) ? text : fallback[field];
  }
  return words;
}

// ----------------------------------------------------------------------------------------------
// @desc The reply's photo slides that show an offered image, each image once, at most MAXIMUM_IMAGE_SLIDES. Each
//   slide's caption is the text of the task holding its image, so the words beneath a photo always name the work it
//   came from; the reply's kicker and headline introduce it, falling back to the month and "A Q3 moment from the
//   archives…". An image whose task has no text keeps the reply's caption, or else its alt text.
// @param {*} imageSlides - The reply's imageSlides.
// @param {object} options - { imageOffers, quarter, quarterNumbers }.
// @returns {Array<object>} { afterSlideId, slide } per photo slide, slide being of kind image.
function _imageSlides(imageSlides, { imageOffers, quarter, quarterNumbers }) {
  const offerById = new Map(imageOffers.map(offer => [offer.id, offer]));
  const archiveHeadline = `A Q${ quarter } moment from the archives…`;
  const shownIds = new Set();
  const placed = [];
  for (const written of _objects(imageSlides)) {
    const offer = offerById.get(String(written.imageId || ""));
    if (!offer || shownIds.has(offer.id) || placed.length >= MAXIMUM_IMAGE_SLIDES) continue;
    const fallback = { caption: offer.alt || "", headline: archiveHeadline, kicker: offer.monthName };
    const words = _groundedWords(written, { allowedNumbers: quarterNumbers, fallback });
    const caption = offer.taskText || words.caption;
    shownIds.add(offer.id);
    placed.push({ afterSlideId: String(written.afterSlideId || ""), slide: { ...words, caption, figure: null, id: `image-${ offer.id }`,
      imageUrl: offer.url, items: [], kind: SLIDE_KINDS.image, tone: "dusk" } });
  }
  return placed;
}

// ----------------------------------------------------------------------------------------------
// @desc What the prompt tells of one month: its name, mood, and leading highlights and moments.
function _monthFacts(digest) {
  const highlights = (digest?.highlights || []).slice(0, PROMPT_MONTH_LINES).map(highlight => highlight.summary);
  const notableMoments = (digest?.notableMoments || []).slice(0, PROMPT_MONTH_LINES);
  return { highlights, month: digest?.monthName || "", mood: digest?.mood || "", notableMoments };
}

// ----------------------------------------------------------------------------------------------
// @desc Whether every number in a text is one it may cite.
// @param {string} text - The text.
// @param {Set<string>} allowedNumbers - Numbers as normalized by _numbersIn.
// @returns {boolean} True when the text cites no other number.
function _numbersAllowed(text, allowedNumbers) {
  return _numbersIn(text).every(number => allowedNumbers.has(number));
}

// ----------------------------------------------------------------------------------------------
// @desc The numbers a text cites, with thousands separators dropped, so "1,234" and "1234" match.
// @param {*} text - The text.
// @returns {Array<string>} Numbers as text.
function _numbersIn(text) {
  const matches = String(text ?? "").match(NUMBER_PATTERN) || [];
  return matches.map(match => match.replace(/,(?=\d{3}\b)/g, ""));
}

// ----------------------------------------------------------------------------------------------
function _objects(value) {
  return Array.isArray(value) ? value.filter(item => item && typeof item === "object" && !Array.isArray(item)) : [];
}

// ----------------------------------------------------------------------------------------------
// @desc Slot photo slides after the slides they name, or before the summary when the one named isn't in the story, and
//   the genre slide before the summary.
// @param {Array<object>} slides - The rewritten slides.
// @param {object} options - { genreSlide, imageSlides }.
// @returns {Array<object>} The story's slides in order.
function _placedSlides(slides, { genreSlide, imageSlides }) {
  const slideIds = new Set(slides.map(slide => slide.id));
  const closingIndex = slides.findIndex(slide => slide.id === "summary");
  const placed = [];
  const beforeClosing = imageSlides.filter(({ afterSlideId }) => !slideIds.has(afterSlideId) || afterSlideId === "summary").map(({ slide }) => slide);
  if (genreSlide) beforeClosing.push(genreSlide);
  slides.forEach((slide, index) => {
    if (index === closingIndex) placed.push(...beforeClosing);
    placed.push(slide);
    const following = imageSlides.filter(({ afterSlideId }) => afterSlideId === slide.id && afterSlideId !== "summary");
    placed.push(...following.map(({ slide: imageSlide }) => imageSlide));
  });
  if (closingIndex === -1) placed.push(...beforeClosing);
  return placed;
}

// ----------------------------------------------------------------------------------------------
// @desc The numbers any slide may cite: the quarter's totals, its number and year, and each month's count.
// @param {object} statistics - From retrospectiveStatistics.
// @returns {Set<string>} Numbers as text.
function _quarterNumbers(statistics) {
  const values = [statistics.totalTaskCount, statistics.totalVictoryValue, statistics.quarter, statistics.year,
    ...(statistics.monthlyTaskCounts || [])];
  const numbers = new Set(values.filter(value => Number.isFinite(value)).map(String));
  for (const number of _numbersIn(statistics.quarterName)) numbers.add(number);
  return numbers;
}

// ----------------------------------------------------------------------------------------------
// @desc What the prompt tells of one slide: its words and the facts it draws, but not the heap's blocks.
// @param {object} slide - A slide from slidesFromStatistics.
// @returns {object} Prompt facts.
function _slideFacts(slide) {
  const facts = { id: slide.id, kind: slide.kind, kicker: slide.kicker, headline: slide.headline, caption: slide.caption };
  if (slide.figure) facts.figure = `${ slide.figure.prefix }${ slide.figure.value }${ slide.figure.suffix }`;
  if (slide.items?.length) facts.items = slide.items.slice(0, PROMPT_LISTED_ROWS).map(item => (item.value ? `${ item.label }: ${ item.value }` : item.label));
  if (slide.bars?.length) facts.bars = slide.bars.map(bar => `${ bar.label }: ${ bar.done } done, ${ bar.open } open`);
  if (slide.columns?.length) facts.columns = slide.columns.map(column => `${ column.label }: ${ column.value } tasks${ column.note ? ` (${ column.note })` : "" }`);
  if (slide.heap?.legend?.length) facts.projects = slide.heap.legend.map(entry => `${ entry.label }: ${ entry.taskCount } tasks`);
  return facts;
}

// ----------------------------------------------------------------------------------------------
// @desc Every number a slide's facts and words hold.
// @param {object} slide - A slide from slidesFromStatistics.
// @returns {Array<string>} Numbers as text.
function _slideNumbers(slide) {
  const facts = _slideFacts(slide);
  const numbers = _numbersIn(JSON.stringify(facts));
  if (slide.figure) numbers.push(String(slide.figure.value));
  return numbers;
}
