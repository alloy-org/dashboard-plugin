// Render a Quarter Retrospective story as a video file: each slide drawn on a canvas, frame by frame, at 1080×1920, with
// the soundtrack rendered offline beside it, encoded in the browser with WebCodecs and muxed into an MP4, or a WebM where
// the browser can't encode H.264. The canvas draws each slide's words, its counting figure, and its list, on the
// slide's tone with drifting shapes and film grain; it doesn't yet draw the bars, heap, timeline, or photos that some
// kinds show on screen. Interactive slides, which wait for the user, are left out.
import { AudioBufferSource, BufferTarget, CanvasSource, canEncodeAudio, canEncodeVideo, Mp4OutputFormat, Output, QUALITY_HIGH,
  QUALITY_MEDIUM, WebMOutputFormat } from "mediabunny";
import { slideDurationFactor, SLIDE_KINDS } from "dashboard/quarter-retrospective/retrospective-slides";
import { renderSoundtrackOffline } from "dashboard/quarter-retrospective/retrospective-soundtrack";

export const VIDEO_WIDTH = 1080;
export const VIDEO_HEIGHT = 1920;
export const VIDEO_FRAMES_PER_SECOND = 30;
// Slides that wait on the user have nothing to show in a video.
export const VIDEO_SKIPPED_SLIDE_KINDS = Object.freeze([SLIDE_KINDS.endCard, SLIDE_KINDS.payoffRanking, SLIDE_KINDS.hardestTasks]);
// The same tones as $retrospective-tones in quarter-retrospective.scss, as (dark stop, light stop, accent).
export const VIDEO_TONES = Object.freeze({ dusk: ["#1e2a4f", "#4c2a63", "#8f7bff"], ember: ["#5a1010", "#9c2a1c", "#ff7a59"],
  forest: ["#0b3d2c", "#1d6b48", "#4be3a0"], gold: ["#5c3b00", "#a8460f", "#ffb347"], intro: ["#1f1147", "#6d1d74", "#ff5fa2"],
  ocean: ["#0a2a5c", "#1b5aa0", "#4fb3ff"], sunrise: ["#5e1d3c", "#a3402a", "#ff9a5c"], teal: ["#063f47", "#0f6e78", "#3ee6e0"],
  violet: ["#2e1065", "#6331a8", "#b18cff"] });
const COUNT_UP_SECONDS = 1.2;
// Each part of a slide enters this many seconds after the slide starts, rising into place over ENTRANCE_SECONDS.
const ENTRANCE_DELAYS = Object.freeze({ caption: 0.9, figure: 0.25, headline: 0.55, items: 0.75, kicker: 0.05 });
const ENTRANCE_SECONDS = 0.5;
const ENTRANCE_RISE_PIXELS = 40;
const CROSSFADE_SECONDS = 0.35;
const SIDE_MARGIN = 96;
const LISTED_ITEM_LIMIT = 5;
const GRAIN_TILE_PIXELS = 256;
// Grain that moved between frames would leave the encoder nothing to carry over, roughly tripling the file, so it
// stays still.
const GRAIN_OPACITY = 0.07;
const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// ----------------------------------------------------------------------------------------------
// @desc Whether this browser has the WebCodecs encoders a video needs.
// @returns {boolean} True when VideoEncoder exists.
export function retrospectiveVideoSupported() {
  return typeof globalThis.VideoEncoder === "function";
}

// ----------------------------------------------------------------------------------------------
// @desc Lay a story's slides along the video's clock, leaving out the interactive ones. Each slide holds as long as it
//   does in the story.
// @param {Array<object>} slides - The story's slides.
// @param {number} slideMilliseconds - The story's usual slide length.
// @returns {Array<object>} { durationSeconds, slide, startSeconds } per slide shown, in order.
export function videoTimeline(slides, slideMilliseconds) {
  const shownSlides = slides.filter(slide => !VIDEO_SKIPPED_SLIDE_KINDS.includes(slide.kind));
  let startSeconds = 0;
  const timeline = shownSlides.map(slide => {
    const durationSeconds = (slideMilliseconds * slideDurationFactor(slide)) / 1000;
    const entry = { durationSeconds, slide, startSeconds };
    startSeconds += durationSeconds;
    return entry;
  });
  return timeline;
}

// ----------------------------------------------------------------------------------------------
// @desc Encode a story as a video, frame by frame, faster than real time where the device's encoder allows.
// @param {object} options - An object with the following properties:
//   - {Array<object>} slides - The story's slides; interactive ones are left out
//   - {number} slideMilliseconds - The story's usual slide length
//   - {string|null} [soundtrackVibe] - A RETROSPECTIVE_SOUNDTRACK_VIBES value; none makes a silent video
//   - {Function} [onProgress] - Receives the share of frames encoded, from 0 to 1
// @returns {Promise<object>} { audioCodec, blob, durationSeconds, elapsedMilliseconds, extension, mimeType, videoCodec },
//   where audioCodec is null for a silent video.
export async function encodeRetrospectiveVideo({ slides, slideMilliseconds, soundtrackVibe = null, onProgress = () => {} }) {
  const startedAt = performance.now();
  const timeline = videoTimeline(slides, slideMilliseconds);
  if (!timeline.length) throw new Error("The story has no slides a video can show.");
  const durationSeconds = timeline[timeline.length - 1].startSeconds + timeline[timeline.length - 1].durationSeconds;
  const { audioCodec, format, videoCodec } = await _chooseEncoding(!!soundtrackVibe);

  const canvas = document.createElement("canvas");
  canvas.width = VIDEO_WIDTH;
  canvas.height = VIDEO_HEIGHT;
  const context = canvas.getContext("2d");
  const grainTile = _grainTile();
  const output = new Output({ format, target: new BufferTarget() });
  const videoSource = new CanvasSource(canvas, { bitrate: QUALITY_MEDIUM, codec: videoCodec, keyFrameInterval: 2 });
  output.addVideoTrack(videoSource, { frameRate: VIDEO_FRAMES_PER_SECOND });
  const audioSource = audioCodec ? new AudioBufferSource({ bitrate: QUALITY_HIGH, codec: audioCodec }) : null;
  if (audioSource) output.addAudioTrack(audioSource);
  await output.start();

  if (audioSource) {
    const audioBuffer = await renderSoundtrackOffline({ seconds: durationSeconds, slideMilliseconds, vibe: soundtrackVibe });
    if (audioBuffer) await audioSource.add(audioBuffer);
    audioSource.close();
  }
  const frameCount = Math.ceil(durationSeconds * VIDEO_FRAMES_PER_SECOND);
  const frameSeconds = 1 / VIDEO_FRAMES_PER_SECOND;
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const seconds = frameIndex * frameSeconds;
    _drawFrame(context, { grainTile, seconds, timeline });
    await videoSource.add(seconds, frameSeconds);
    onProgress((frameIndex + 1) / frameCount);
  }
  videoSource.close();
  await output.finalize();

  const mimeType = await output.getMimeType();
  const blob = new Blob([output.target.buffer], { type: mimeType });
  return { audioCodec, blob, durationSeconds, elapsedMilliseconds: performance.now() - startedAt, extension: format.fileExtension,
    mimeType, videoCodec };
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Pick the container and codecs: MP4 with H.264 and AAC where the browser encodes them, since every phone and
//   social app plays it; otherwise WebM with VP9 or VP8 and Opus.
// @param {boolean} withAudio - Whether the video has a soundtrack.
// @returns {Promise<object>} { audioCodec, format, videoCodec }, audioCodec null when silent or no codec is encodable.
async function _chooseEncoding(withAudio) {
  const videoOptions = { bitrate: QUALITY_MEDIUM, frameRate: VIDEO_FRAMES_PER_SECOND, height: VIDEO_HEIGHT, width: VIDEO_WIDTH };
  if (await canEncodeVideo("avc", videoOptions)) {
    let audioCodec = null;
    if (withAudio && await canEncodeAudio("aac", { numberOfChannels: 2, sampleRate: 48000 })) audioCodec = "aac";
    else if (withAudio && await canEncodeAudio("opus", { numberOfChannels: 2, sampleRate: 48000 })) audioCodec = "opus";
    return { audioCodec, format: new Mp4OutputFormat({ fastStart: "in-memory" }), videoCodec: "avc" };
  }
  const videoCodec = await canEncodeVideo("vp9", videoOptions) ? "vp9" : "vp8";
  if (!await canEncodeVideo(videoCodec, videoOptions)) throw new Error("This browser can't encode video.");
  const audioCodec = withAudio && await canEncodeAudio("opus", { numberOfChannels: 2, sampleRate: 48000 }) ? "opus" : null;
  return { audioCodec, format: new WebMOutputFormat(), videoCodec };
}

// ----------------------------------------------------------------------------------------------
// @desc Draw the frame at one moment: the slide showing then, and during the first moments of a slide, the one before
//   it fading out on top.
// @param {CanvasRenderingContext2D} context - The video's canvas.
// @param {object} options - { grainTile, seconds, timeline }.
function _drawFrame(context, { grainTile, seconds, timeline }) {
  const currentIndex = Math.max(0, timeline.findLastIndex(entry => entry.startSeconds <= seconds));
  const current = timeline[currentIndex];
  const slideSeconds = seconds - current.startSeconds;
  _drawSlide(context, { entry: current, position: currentIndex, slideSeconds });
  if (currentIndex > 0 && slideSeconds < CROSSFADE_SECONDS) {
    const previous = timeline[currentIndex - 1];
    context.save();
    context.globalAlpha = 1 - slideSeconds / CROSSFADE_SECONDS;
    _drawSlide(context, { entry: previous, position: currentIndex - 1, slideSeconds: previous.durationSeconds + slideSeconds });
    context.restore();
  }
  _drawGrain(context, grainTile);
}

// ----------------------------------------------------------------------------------------------
// @desc Draw one slide at a moment in its own time: its tone, the drifting shapes behind it, then its words, each part
//   rising into place a beat after the one above it.
// @param {CanvasRenderingContext2D} context - The video's canvas.
// @param {object} options - { entry, position, slideSeconds }: entry from videoTimeline, position the slide's place in
//   the video, which arranges its shapes.
function _drawSlide(context, { entry, position, slideSeconds }) {
  const { slide } = entry;
  const [darkStop, lightStop, accent] = VIDEO_TONES[slide.tone] || VIDEO_TONES.intro;
  const background = context.createLinearGradient(0, 0, VIDEO_WIDTH * 0.35, VIDEO_HEIGHT);
  background.addColorStop(0, darkStop);
  background.addColorStop(1, lightStop);
  context.fillStyle = background;
  context.fillRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
  _drawBackdropShapes(context, { accent, position, slideSeconds });

  const textWidth = VIDEO_WIDTH - SIDE_MARGIN * 2;
  let cursorY = VIDEO_HEIGHT * 0.3;
  context.textBaseline = "top";
  context.textAlign = "left";
  if (slide.kicker) {
    cursorY = _drawEnteringText(context, { color: "rgba(255, 255, 255, 0.78)", font: `600 44px ${ FONT_STACK }`, lineHeight: 56,
      delay: ENTRANCE_DELAYS.kicker, slideSeconds, text: slide.kicker.toUpperCase(), width: textWidth, y: cursorY }) + 36;
  }
  if (slide.figure) {
    const countProgress = Math.min(1, Math.max(0, (slideSeconds - ENTRANCE_DELAYS.figure) / COUNT_UP_SECONDS));
    const countedValue = Math.round(slide.figure.value * (1 - Math.pow(1 - countProgress, 3)));
    const figureText = `${ slide.figure.prefix || "" }${ countedValue.toLocaleString() }${ slide.figure.suffix || "" }`;
    cursorY = _drawEnteringText(context, { color: accent, font: `800 220px ${ FONT_STACK }`, lineHeight: 230, delay: ENTRANCE_DELAYS.figure,
      slideSeconds, text: figureText, width: textWidth, y: cursorY }) + 24;
  }
  if (slide.headline) {
    cursorY = _drawEnteringText(context, { color: "#ffffff", font: `700 84px ${ FONT_STACK }`, lineHeight: 98,
      delay: ENTRANCE_DELAYS.headline, slideSeconds, text: slide.headline, width: textWidth, y: cursorY }) + 48;
  }
  const listedItems = (slide.items || []).slice(0, LISTED_ITEM_LIMIT);
  listedItems.forEach((item, itemIndex) => {
    const itemText = item.value ? `${ item.label } — ${ item.value }` : item.label;
    cursorY = _drawEnteringText(context, { color: "rgba(255, 255, 255, 0.92)", font: `500 46px ${ FONT_STACK }`, lineHeight: 58,
      delay: ENTRANCE_DELAYS.items + itemIndex * 0.12, slideSeconds, text: `${ itemIndex + 1 }. ${ itemText }`, width: textWidth,
      y: cursorY }) + 18;
  });
  if (slide.caption) {
    _drawEnteringText(context, { color: "rgba(255, 255, 255, 0.82)", font: `400 50px ${ FONT_STACK }`, lineHeight: 66,
      delay: ENTRANCE_DELAYS.caption, slideSeconds, text: slide.caption, width: textWidth, y: cursorY + 24 });
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Draw the slide's two soft shapes in its accent color, toward opposite edges, drifting slowly as the slide holds.
// @param {CanvasRenderingContext2D} context - The video's canvas.
// @param {object} options - { accent, position, slideSeconds }.
function _drawBackdropShapes(context, { accent, position, slideSeconds }) {
  const flipped = position % 2 === 1;
  const drift = Math.sin(slideSeconds * 0.5) * 40;
  const shapes = [{ radius: 620, x: flipped ? VIDEO_WIDTH * 0.15 : VIDEO_WIDTH * 0.9, y: VIDEO_HEIGHT * 0.08 + drift },
    { radius: 520, x: flipped ? VIDEO_WIDTH * 0.95 : VIDEO_WIDTH * 0.05, y: VIDEO_HEIGHT * 0.9 - drift }];
  context.save();
  shapes.forEach(shape => {
    const glow = context.createRadialGradient(shape.x, shape.y, 0, shape.x, shape.y, shape.radius);
    glow.addColorStop(0, `${ accent }55`);
    glow.addColorStop(1, `${ accent }00`);
    context.fillStyle = glow;
    context.fillRect(shape.x - shape.radius, shape.y - shape.radius, shape.radius * 2, shape.radius * 2);
  });
  context.restore();
}

// ----------------------------------------------------------------------------------------------
// @desc Draw wrapped text that fades in and rises into place after a delay.
// @param {CanvasRenderingContext2D} context - The video's canvas.
// @param {object} options - { color, delay, font, lineHeight, slideSeconds, text, width, y }: delay in seconds from the
//   slide's start, y the top of the first line.
// @returns {number} The y just below the text's last line, where it rests once entered.
function _drawEnteringText(context, { color, delay, font, lineHeight, slideSeconds, text, width, y }) {
  context.font = font;
  const lines = _wrappedLines(context, String(text), width);
  const progress = Math.min(1, Math.max(0, (slideSeconds - delay) / ENTRANCE_SECONDS));
  const eased = 1 - Math.pow(1 - progress, 3);
  if (eased > 0) {
    context.save();
    context.globalAlpha *= eased;
    context.fillStyle = color;
    const offsetY = (1 - eased) * ENTRANCE_RISE_PIXELS;
    lines.forEach((line, lineIndex) => context.fillText(line, SIDE_MARGIN, y + offsetY + lineIndex * lineHeight));
    context.restore();
  }
  return y + lines.length * lineHeight;
}

// ----------------------------------------------------------------------------------------------
// @desc Break text into lines that fit a width in the context's current font, breaking between words.
// @param {CanvasRenderingContext2D} context - A context whose font is set.
// @param {string} text - The text.
// @param {number} width - The widest a line may be, in pixels.
// @returns {Array<string>} The lines.
function _wrappedLines(context, text, width) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  words.forEach(word => {
    const candidate = line ? `${ line } ${ word }` : word;
    if (line && context.measureText(candidate).width > width) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  });
  if (line) lines.push(line);
  return lines;
}

// ----------------------------------------------------------------------------------------------
// @desc Make a tile of grey noise once, for the film grain drawn over every frame.
// @returns {HTMLCanvasElement} The tile.
function _grainTile() {
  const tile = document.createElement("canvas");
  tile.width = GRAIN_TILE_PIXELS;
  tile.height = GRAIN_TILE_PIXELS;
  const tileContext = tile.getContext("2d");
  const pixels = tileContext.createImageData(GRAIN_TILE_PIXELS, GRAIN_TILE_PIXELS);
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    const shade = Math.floor(Math.random() * 256);
    pixels.data[offset] = shade;
    pixels.data[offset + 1] = shade;
    pixels.data[offset + 2] = shade;
    pixels.data[offset + 3] = 255;
  }
  tileContext.putImageData(pixels, 0, 0);
  return tile;
}

// ----------------------------------------------------------------------------------------------
// @desc Lay the grain over the frame, in the same place every frame.
// @param {CanvasRenderingContext2D} context - The video's canvas.
// @param {HTMLCanvasElement} grainTile - From _grainTile.
function _drawGrain(context, grainTile) {
  context.save();
  context.globalAlpha = GRAIN_OPACITY;
  context.globalCompositeOperation = "overlay";
  context.fillStyle = context.createPattern(grainTile, "repeat");
  context.fillRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
  context.restore();
}
