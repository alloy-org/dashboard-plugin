// Quarter Retrospective story player and overlay: auto-advance, tap and keyboard navigation, pausing, the soundtrack
// following the story, and closing.
import { jest } from "@jest/globals";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { FakeAudioContext } from "./fake-audio-context";

const { default: RetrospectiveOverlay } = await import("dashboard/quarter-retrospective/retrospective-overlay");
const { default: RetrospectiveStory, HOLD_MILLISECONDS, STORY_TICK_MILLISECONDS } = await import("dashboard/quarter-retrospective/retrospective-story");

const SLIDE_MILLISECONDS = 1000;
const slides = [
  { caption: "tasks completed.", figure: { prefix: "", suffix: "", value: 1234 }, headline: "Q3 2026, wrapped", id: "intro", items: [],
    kicker: "Your quarter in review", tone: "intro" },
  { caption: "5 VV across 2 tasks.", figure: null, headline: "Launch the app", id: "project-victory",
    items: [{ label: "Launch the app", value: "5 VV" }, { label: "Get fit", value: "2 VV" }], kicker: "Your most victorious project",
    tone: "forest" },
  { caption: "On to the next one.", figure: null, headline: "That was Q3 2026", id: "summary", items: [], kicker: "The whole quarter",
    tone: "intro" },
];

let mounted = null;

// ----------------------------------------------------------------------------------------------
// @desc Mount an element into the document.
// @param {JSX.Element} element - What to render.
// @returns {Promise<HTMLElement>} The mount point.
async function render(element) {
  const mountPoint = document.createElement("div");
  document.body.appendChild(mountPoint);
  const root = createRoot(mountPoint);
  await act(async () => { root.render(element); });
  mounted = { mountPoint, root };
  return mountPoint;
}

// ----------------------------------------------------------------------------------------------
// @desc Mount the story with one-second slides.
// @returns {Promise<HTMLElement>} The mount point.
async function renderStory() {
  return render(createElement(RetrospectiveStory, { label: "Q3 2026 retrospective", slideMilliseconds: SLIDE_MILLISECONDS, slides }));
}

// ----------------------------------------------------------------------------------------------
// @desc Advance fake time one clock tick per act, so React renders between ticks as a browser would and the effect
//   that moves to the next slide sees each tick.
// @param {number} milliseconds - Time to pass.
async function passTime(milliseconds) {
  for (let passed = 0; passed < milliseconds; passed += STORY_TICK_MILLISECONDS) {
    await act(async () => { jest.advanceTimersByTime(STORY_TICK_MILLISECONDS); });
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Dispatch an event the story listens for.
async function dispatch(target, event) {
  await act(async () => { target.dispatchEvent(event); });
}

const counterText = container => container.querySelector(".retrospective-story-counter").textContent;
const pressKey = key => dispatch(document, new KeyboardEvent("keydown", { bubbles: true, key }));
const click = element => dispatch(element, new MouseEvent("click", { bubbles: true }));

beforeEach(() => { jest.useFakeTimers(); });

afterEach(async () => {
  if (mounted) {
    await act(async () => { mounted.root.unmount(); });
    mounted.mountPoint.remove();
    mounted = null;
  }
  jest.useRealTimers();
});

describe("RetrospectiveStory", () => {
  it("shows the first slide with a segment per slide and the figure's final value for screen readers", async () => {
    const container = await renderStory();
    expect(container.querySelectorAll(".retrospective-story-segment")).toHaveLength(3);
    expect(counterText(container)).toBe("1 / 3");
    expect(container.querySelector(".retrospective-slide-headline").textContent).toBe("Q3 2026, wrapped");
    expect(container.querySelector(".retrospective-slide-figure").getAttribute("aria-label")).toBe("1,234");
  });

  it("advances on its own, stops on the last slide, and replays from the first", async () => {
    const container = await renderStory();
    await passTime(SLIDE_MILLISECONDS + 100);
    expect(counterText(container)).toBe("2 / 3");
    expect(container.querySelectorAll(".retrospective-slide-item")).toHaveLength(2);

    await passTime((SLIDE_MILLISECONDS + 100) * 3);
    expect(counterText(container)).toBe("3 / 3");
    const replay = container.querySelector(".retrospective-story-control");
    expect(replay.textContent).toBe("↺ Replay");

    await click(replay);
    expect(counterText(container)).toBe("1 / 3");
  });

  it("steps with the tap zones and the arrow keys, never past either end", async () => {
    const container = await renderStory();
    await click(container.querySelector("[aria-label='Previous slide']"));
    expect(counterText(container)).toBe("1 / 3");
    await click(container.querySelector("[aria-label='Next slide']"));
    expect(counterText(container)).toBe("2 / 3");
    await pressKey("ArrowRight");
    await pressKey("ArrowRight");
    expect(counterText(container)).toBe("3 / 3");
    await pressKey("ArrowLeft");
    expect(counterText(container)).toBe("2 / 3");
  });

  it("pauses with Space and the pause button, hinting at it on the first slide and badging the pause", async () => {
    const container = await renderStory();
    expect(container.querySelector(".retrospective-story-hint")).not.toBeNull();
    expect(container.querySelector(".retrospective-story-paused-badge")).toBeNull();
    await pressKey(" ");
    await passTime(SLIDE_MILLISECONDS * 3);
    expect(counterText(container)).toBe("1 / 3");
    expect(container.querySelector(".retrospective-story-control").textContent).toBe("▶ Play");
    expect(container.querySelector(".retrospective-story-paused-badge").textContent).toBe("❚❚ Paused");
    expect(container.querySelector(".retrospective-story-hint")).toBeNull();

    await click(container.querySelector(".retrospective-story-control"));
    await passTime(SLIDE_MILLISECONDS + 100);
    expect(counterText(container)).toBe("2 / 3");
    expect(container.querySelector(".retrospective-story-paused-badge")).toBeNull();
    expect(container.querySelector(".retrospective-story-hint")).toBeNull();
  });

  it("plays its soundtrack, suspending it on pause, fading it at the end, and starting it again on Replay", async () => {
    const audioContext = new FakeAudioContext();
    const container = await render(createElement(RetrospectiveStory, { audioContext, label: "Q3 2026 retrospective",
      slideMilliseconds: SLIDE_MILLISECONDS, slides, soundtrackVibe: "synthwave" }));
    const masterGain = audioContext.nodes.find(audioNode => audioNode.kind === "gain" && audioNode.connections.includes(audioContext.destination));
    expect(audioContext.state).toBe("running");
    expect(audioContext.startedSources.length).toBeGreaterThan(0);

    await pressKey(" ");
    expect(audioContext.state).toBe("suspended");
    await pressKey(" ");
    expect(audioContext.state).toBe("running");

    await passTime(SLIDE_MILLISECONDS * slides.length);
    expect(counterText(container)).toBe("3 / 3");
    expect(masterGain.gain.value).toBe(0);
    await passTime(3000);
    expect(masterGain.disconnected).toBe(true);

    await click(container.querySelector(".retrospective-story-control"));
    const masterGains = audioContext.nodes.filter(audioNode => audioNode.kind === "gain" && audioNode.connections.includes(audioContext.destination));
    const replayGain = masterGains[masterGains.length - 1];
    expect(replayGain).not.toBe(masterGain);
    expect(replayGain.disconnected).toBe(false);
  });

  it("holds while pressed, and letting go of a hold does not change slides", async () => {
    const container = await renderStory();
    const nextZone = container.querySelector("[aria-label='Next slide']");
    await dispatch(nextZone, new MouseEvent("pointerdown", { bubbles: true }));
    await passTime(SLIDE_MILLISECONDS * 2);
    expect(counterText(container)).toBe("1 / 3");

    await dispatch(nextZone, new MouseEvent("pointerup", { bubbles: true }));
    await click(nextZone);
    expect(counterText(container)).toBe("1 / 3");

    await dispatch(nextZone, new MouseEvent("pointerdown", { bubbles: true }));
    await passTime(HOLD_MILLISECONDS / 5);
    await dispatch(nextZone, new MouseEvent("pointerup", { bubbles: true }));
    await click(nextZone);
    expect(counterText(container)).toBe("2 / 3");
  });
});

describe("RetrospectiveOverlay", () => {
  it("closes on Escape, the close button, and the backdrop, but not on a click inside the card", async () => {
    const onClose = jest.fn();
    await render(createElement(RetrospectiveOverlay, { label: "Q3 2026 retrospective", onClose },
      createElement("p", { className: "overlay-test-content" }, "Inside")));
    const overlay = document.body.querySelector(".quarter-retrospective-overlay");
    expect(overlay.querySelector("[role='dialog']").getAttribute("aria-label")).toBe("Q3 2026 retrospective");

    await click(overlay.querySelector(".overlay-test-content"));
    expect(onClose).not.toHaveBeenCalled();
    await click(overlay);
    await click(overlay.querySelector(".retrospective-overlay-close"));
    await pressKey("Escape");
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
