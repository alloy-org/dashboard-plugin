// Quarter Retrospective soundtrack: each vibe's tempo fits whole bars into a slide, the loop schedules its notes ahead of
// the audio clock, and pausing, muting, fading and stopping act on that clock and the master volume.
import { jest } from "@jest/globals";
import { FakeAudioContext } from "./fake-audio-context";

const { RETROSPECTIVE_SOUNDTRACK_VIBES } = await import("dashboard/quarter-retrospective/retrospective-generation");
const { createRetrospectiveAudioContext, midiNoteFrequency, RetrospectiveSoundtrack, SOUNDTRACK_FADE_SECONDS,
  SOUNDTRACK_LOOKAHEAD_SECONDS, SOUNDTRACK_SCHEDULER_MILLISECONDS, SOUNDTRACK_VIBE_ARRANGEMENTS, SOUNDTRACK_VOLUME,
  soundtrackBeatsPerMinute } = await import("dashboard/quarter-retrospective/retrospective-soundtrack");

const SLIDE_MILLISECONDS = 7200;

// ----------------------------------------------------------------------------------------------
// @desc A soundtrack on a fake context.
// @param {object} [options] - { muted, vibe }.
// @returns {object} { audioContext, soundtrack }.
function fakeSoundtrack({ muted = false, vibe = RETROSPECTIVE_SOUNDTRACK_VIBES.chill } = {}) {
  const audioContext = new FakeAudioContext();
  const soundtrack = new RetrospectiveSoundtrack({ audioContext, muted, slideMilliseconds: SLIDE_MILLISECONDS, vibe });
  return { audioContext, soundtrack };
}

// ----------------------------------------------------------------------------------------------
// @desc Move the audio clock and the scheduler's timer together.
// @param {FakeAudioContext} audioContext - The context.
// @param {number} seconds - How far.
function advanceAudio(audioContext, seconds) {
  const tickSeconds = SOUNDTRACK_SCHEDULER_MILLISECONDS / 1000;
  for (let elapsed = 0; elapsed < seconds; elapsed += tickSeconds) {
    audioContext.advance(tickSeconds);
    jest.advanceTimersByTime(SOUNDTRACK_SCHEDULER_MILLISECONDS);
  }
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  delete window.AudioContext;
});

describe("retrospective soundtrack", () => {
  it("fits a whole number of bars into one slide for every vibe", () => {
    Object.values(RETROSPECTIVE_SOUNDTRACK_VIBES).forEach(vibe => {
      const beatsPerMinute = soundtrackBeatsPerMinute({ slideMilliseconds: SLIDE_MILLISECONDS, vibe });
      const barsPerSlide = beatsPerMinute * (SLIDE_MILLISECONDS / 60000) / 4;
      expect(barsPerSlide).toBeCloseTo(SOUNDTRACK_VIBE_ARRANGEMENTS[vibe].barsPerSlide);
      expect(beatsPerMinute).toBeGreaterThanOrEqual(80);
      expect(beatsPerMinute).toBeLessThanOrEqual(140);
    });
    expect(midiNoteFrequency(69)).toBe(440);
    expect(midiNoteFrequency(81)).toBeCloseTo(880);
  });

  it("schedules notes only within the lookahead, and keeps scheduling as the clock moves", () => {
    const { audioContext, soundtrack } = fakeSoundtrack({ vibe: RETROSPECTIVE_SOUNDTRACK_VIBES.anthem });
    soundtrack.play();
    expect(audioContext.state).toBe("running");
    const firstStartTimes = audioContext.startedSources.map(started => started.time);
    expect(firstStartTimes.length).toBeGreaterThan(0);
    expect(Math.max(...firstStartTimes)).toBeLessThan(SOUNDTRACK_LOOKAHEAD_SECONDS);

    advanceAudio(audioContext, 2);
    const laterStartTimes = audioContext.startedSources.map(started => started.time);
    expect(Math.max(...laterStartTimes)).toBeGreaterThan(1.9);
    expect(Math.max(...laterStartTimes)).toBeLessThan(2 + SOUNDTRACK_LOOKAHEAD_SECONDS + 0.03);
    soundtrack.stop();
  });

  it("starts silent when muted, and ramps the volume when muted or unmuted", () => {
    const { audioContext, soundtrack } = fakeSoundtrack({ muted: true });
    soundtrack.play();
    const masterGain = audioContext.nodes.find(audioNode => audioNode.kind === "gain" && audioNode.connections.includes(audioContext.destination));
    expect(masterGain.gain.value).toBe(0);
    soundtrack.setMuted(false);
    expect(masterGain.gain.value).toBe(SOUNDTRACK_VOLUME);
    soundtrack.setMuted(true);
    expect(masterGain.gain.value).toBe(0);
    soundtrack.stop();
  });

  it("suspends the clock on pause, and resumes on play without starting over", () => {
    const { audioContext, soundtrack } = fakeSoundtrack();
    soundtrack.play();
    advanceAudio(audioContext, 1);
    soundtrack.pause();
    expect(audioContext.state).toBe("suspended");
    const scheduledBeforeResume = audioContext.startedSources.length;
    soundtrack.play();
    expect(audioContext.state).toBe("running");
    expect(audioContext.startedSources.length).toBe(scheduledBeforeResume);
    soundtrack.stop();
  });

  it("fades out and stops, and plays again from the first bar afterward", () => {
    const { audioContext, soundtrack } = fakeSoundtrack();
    soundtrack.play();
    const masterGain = audioContext.nodes.find(audioNode => audioNode.kind === "gain" && audioNode.connections.includes(audioContext.destination));
    soundtrack.fadeOut();
    expect(masterGain.gain.value).toBe(0);
    jest.advanceTimersByTime(SOUNDTRACK_FADE_SECONDS * 1000);
    expect(masterGain.disconnected).toBe(true);
    const scheduledAfterFade = audioContext.startedSources.length;
    advanceAudio(audioContext, 1);
    expect(audioContext.startedSources.length).toBe(scheduledAfterFade);

    soundtrack.play();
    expect(audioContext.startedSources.length).toBeGreaterThan(scheduledAfterFade);
    soundtrack.stop();
  });

  it("schedules every step through a set end at once, fading out over the last seconds, for an offline render", () => {
    const { audioContext, soundtrack } = fakeSoundtrack();
    soundtrack.scheduleThrough(10);
    const masterGain = audioContext.nodes.find(audioNode => audioNode.kind === "gain" && audioNode.connections.includes(audioContext.destination));
    const lastAutomation = masterGain.gain.automations[masterGain.gain.automations.length - 1];
    expect(lastAutomation).toEqual({ kind: "linear", target: 0, time: 10 });
    expect(masterGain.gain.automations).toContainEqual({ kind: "set", target: SOUNDTRACK_VOLUME, time: 10 - SOUNDTRACK_FADE_SECONDS });
    const startTimes = audioContext.startedSources.map(started => started.time);
    expect(Math.min(...startTimes)).toBe(0);
    expect(Math.max(...startTimes)).toBeLessThan(10);
    expect(Math.max(...startTimes)).toBeGreaterThan(9);
  });

  it("makes a started context where Web Audio exists, and none where it doesn't", () => {
    expect(createRetrospectiveAudioContext()).toBeNull();
    window.AudioContext = FakeAudioContext;
    const audioContext = createRetrospectiveAudioContext();
    expect(audioContext).toBeInstanceOf(FakeAudioContext);
    expect(audioContext.state).toBe("running");
  });
});
