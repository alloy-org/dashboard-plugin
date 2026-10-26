// The Quarter Retrospective's soundtrack: a short loop synthesized with the Web Audio API, one per soundtrack vibe. Each
// vibe is a chord progression, a pad, a bass line and a drum pattern, with a tempo that fits a whole number of bars into
// one slide. Nothing is downloaded or licensed. Every call fails soft, since some embeds can't make or start audio.
import { RETROSPECTIVE_SOUNDTRACK_VIBES } from "dashboard/quarter-retrospective/retrospective-generation";

// Steps are sixteenth notes, so a bar of 4/4 holds 16 of them.
export const SOUNDTRACK_STEPS_PER_BAR = 16;
// How far ahead of the audio clock notes are scheduled, and how often the scheduler checks.
export const SOUNDTRACK_LOOKAHEAD_SECONDS = 0.12;
export const SOUNDTRACK_SCHEDULER_MILLISECONDS = 25;
export const SOUNDTRACK_VOLUME = 0.32;
export const SOUNDTRACK_FADE_SECONDS = 2.5;
const MUTE_RAMP_SECONDS = 0.15;
const NOISE_BUFFER_SECONDS = 1;

// Chords are MIDI note numbers; bass plays the first note of each chord, two octaves down.
const MINOR_PROGRESSION = Object.freeze([[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]);
const MAJOR_PROGRESSION = Object.freeze([[48, 52, 55, 59], [55, 59, 62], [57, 60, 64], [53, 57, 60, 64]]);

// Each vibe's sound. barsPerSlide sets the tempo from the slide's length. Drum and bass patterns list the steps of a bar
// that sound; bassOctaveSteps are the steps whose bass note jumps up an octave.
export const SOUNDTRACK_VIBE_ARRANGEMENTS = Object.freeze({
  [RETROSPECTIVE_SOUNDTRACK_VIBES.anthem]: Object.freeze({
    barsPerSlide: 4, bassOctaveSteps: [6, 14], bassSteps: [0, 2, 4, 6, 8, 10, 12, 14], bassWave: "sawtooth", hatSteps: [2, 6, 10, 14],
    hatVolume: 0.12, kickSteps: [0, 4, 8, 12], padCutoff: 2600, padVolume: 0.1, padWave: "sawtooth", progression: MAJOR_PROGRESSION,
    snareSteps: [4, 12],
  }),
  [RETROSPECTIVE_SOUNDTRACK_VIBES.chill]: Object.freeze({
    barsPerSlide: 3, bassOctaveSteps: [], bassSteps: [0, 10], bassWave: "sine", hatSteps: [2, 6, 10, 14], hatVolume: 0.05,
    kickSteps: [0, 10], padCutoff: 900, padVolume: 0.14, padWave: "triangle", progression: MINOR_PROGRESSION, snareSteps: [4, 12],
  }),
  [RETROSPECTIVE_SOUNDTRACK_VIBES.synthwave]: Object.freeze({
    barsPerSlide: 3, bassOctaveSteps: [2, 6, 10, 14], bassSteps: [0, 2, 4, 6, 8, 10, 12, 14], bassWave: "sawtooth",
    hatSteps: [2, 6, 10, 14], hatVolume: 0.08, kickSteps: [0, 4, 8, 12], padCutoff: 1500, padVolume: 0.11, padWave: "sawtooth",
    progression: MINOR_PROGRESSION, snareSteps: [4, 12],
  }),
});

// ----------------------------------------------------------------------------------------------
// @desc A note's frequency from its MIDI number.
// @param {number} midiNote - 69 is the A above middle C
// @returns {number} Hertz.
export function midiNoteFrequency(midiNote) {
  return 440 * Math.pow(2, (midiNote - 69) / 12);
}

// ----------------------------------------------------------------------------------------------
// @desc A vibe's tempo, chosen so a whole number of bars fills one slide.
// @param {object} options - { slideMilliseconds, vibe }.
// @returns {number} Beats per minute.
export function soundtrackBeatsPerMinute({ slideMilliseconds, vibe }) {
  const arrangement = SOUNDTRACK_VIBE_ARRANGEMENTS[vibe] || SOUNDTRACK_VIBE_ARRANGEMENTS[RETROSPECTIVE_SOUNDTRACK_VIBES.chill];
  const beatsPerSlide = arrangement.barsPerSlide * 4;
  return beatsPerSlide / (slideMilliseconds / 60000);
}

// ----------------------------------------------------------------------------------------------
// @desc Make an audio context and ask it to start. Call this from a click or key press: browsers let audio start only
//   from a user's gesture, and an embed that refuses leaves the context suspended, which plays nothing.
// @returns {AudioContext|null} The context, or null where Web Audio is missing or refused.
export function createRetrospectiveAudioContext() {
  try {
    const AudioContextClass = globalThis.window?.AudioContext || globalThis.window?.webkitAudioContext;
    if (!AudioContextClass) return null;
    const audioContext = new AudioContextClass();
    audioContext.resume?.()?.catch?.(() => {});
    return audioContext;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------------------------
// @desc One vibe's loop, playing through an audio context the caller owns. Notes are scheduled a little ahead of the
//   audio clock on a timer, so the loop keeps time when the page is busy.
export class RetrospectiveSoundtrack {
  // ----------------------------------------------------------------------------------------------
  // @desc Prepare the loop. Nothing sounds until play().
  // @param {object} options - An object with the following properties:
  //   - {AudioContext} audioContext - From createRetrospectiveAudioContext
  //   - {boolean} [muted=false] - Whether it starts silent
  //   - {number} slideMilliseconds - One slide's length, which sets the tempo
  //   - {string} vibe - A RETROSPECTIVE_SOUNDTRACK_VIBES value
  constructor({ audioContext, muted = false, slideMilliseconds, vibe }) {
    this.audioContext = audioContext;
    this.arrangement = SOUNDTRACK_VIBE_ARRANGEMENTS[vibe] || SOUNDTRACK_VIBE_ARRANGEMENTS[RETROSPECTIVE_SOUNDTRACK_VIBES.chill];
    this.stepSeconds = 60 / soundtrackBeatsPerMinute({ slideMilliseconds, vibe }) / 4;
    this.muted = muted;
    this.fading = false;
    this.masterGain = null;
    this.noiseBuffer = null;
    this.schedulerId = null;
    this.fadeTimeoutId = null;
    this.nextStepTime = 0;
    this.stepIndex = 0;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Start the loop from its first bar, or carry on after pause() or during fadeOut().
  play() {
    try {
      this.audioContext.resume?.()?.catch?.(() => {});
      if (this.schedulerId !== null) {
        if (this.fading) this._rampVolume(this._targetVolume(), MUTE_RAMP_SECONDS);
        this.fading = false;
        return;
      }
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = this._targetVolume();
      this.masterGain.connect(this.audioContext.destination);
      this.fading = false;
      this.stepIndex = 0;
      this.nextStepTime = this.audioContext.currentTime + 0.05;
      this.schedulerId = setInterval(() => this._scheduleAhead(), SOUNDTRACK_SCHEDULER_MILLISECONDS);
      this._scheduleAhead();
    } catch {
      this.stop();
    }
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Hold the loop where it is. The audio clock stops with it, so play() picks up in time.
  pause() {
    try {
      this.audioContext.suspend?.()?.catch?.(() => {});
    } catch {
      // A context that can't suspend keeps playing.
    }
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Fade to silence, then stop. play() during the fade brings the volume back.
  // @param {number} [seconds=SOUNDTRACK_FADE_SECONDS] - How long the fade takes
  fadeOut(seconds = SOUNDTRACK_FADE_SECONDS) {
    if (this.schedulerId === null || this.fading) return;
    this.fading = true;
    this._rampVolume(0, seconds);
    this.fadeTimeoutId = setTimeout(() => {
      if (this.fading) this.stop();
    }, seconds * 1000);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Silence or restore the loop without stopping it.
  // @param {boolean} muted - Whether it should be silent
  setMuted(muted) {
    this.muted = muted;
    if (!this.fading) this._rampVolume(this._targetVolume(), MUTE_RAMP_SECONDS);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Stop scheduling and cut the loop off. The audio context stays open for the caller to reuse or close.
  stop() {
    if (this.schedulerId !== null) clearInterval(this.schedulerId);
    if (this.fadeTimeoutId) clearTimeout(this.fadeTimeoutId);
    this.schedulerId = null;
    this.fadeTimeoutId = null;
    this.fading = false;
    try {
      this.masterGain?.disconnect();
    } catch {
      // Already disconnected.
    }
    this.masterGain = null;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc The volume the loop should be at: none when muted.
  // @returns {number} A gain between 0 and 1.
  _targetVolume() {
    return this.muted ? 0 : SOUNDTRACK_VOLUME;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Move the master volume to a level over a few moments, from wherever it is now.
  // @param {number} volume - The gain to reach
  // @param {number} seconds - How long the move takes
  _rampVolume(volume, seconds) {
    if (!this.masterGain) return;
    try {
      const now = this.audioContext.currentTime;
      const gain = this.masterGain.gain;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(volume, now + seconds);
    } catch {
      this.masterGain.gain.value = volume;
    }
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Schedule every step that starts within the lookahead window.
  _scheduleAhead() {
    try {
      const horizon = this.audioContext.currentTime + SOUNDTRACK_LOOKAHEAD_SECONDS;
      while (this.nextStepTime < horizon) {
        this._scheduleStep(this.stepIndex, this.nextStepTime);
        this.stepIndex += 1;
        this.nextStepTime += this.stepSeconds;
      }
    } catch {
      this.stop();
    }
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Schedule the sounds that start on one step: the bar's chord on its first step, then the bass and drums.
  // @param {number} stepIndex - Steps since the loop started
  // @param {number} time - When the step starts, on the audio clock
  _scheduleStep(stepIndex, time) {
    const arrangement = this.arrangement;
    const stepInBar = stepIndex % SOUNDTRACK_STEPS_PER_BAR;
    const barIndex = Math.floor(stepIndex / SOUNDTRACK_STEPS_PER_BAR);
    const chord = arrangement.progression[barIndex % arrangement.progression.length];
    if (stepInBar === 0) this._playPad(chord, time, this.stepSeconds * SOUNDTRACK_STEPS_PER_BAR);
    if (arrangement.bassSteps.includes(stepInBar)) {
      const octaveShift = arrangement.bassOctaveSteps.includes(stepInBar) ? 12 : 0;
      this._playBass(chord[0] - 24 + octaveShift, time, this.stepSeconds * 1.8);
    }
    if (arrangement.kickSteps.includes(stepInBar)) this._playKick(time);
    if (arrangement.snareSteps.includes(stepInBar)) this._playNoise({ cutoff: 1500, duration: 0.18, time, volume: 0.28 });
    if (arrangement.hatSteps.includes(stepInBar)) this._playNoise({ cutoff: 7000, duration: 0.05, time, volume: arrangement.hatVolume });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc A sustained chord: two slightly detuned oscillators per note through a low-pass filter, swelling in and
  //   overlapping the next bar's chord a little as it fades.
  // @param {Array<number>} chord - MIDI notes
  // @param {number} time - When it starts
  // @param {number} duration - One bar, in seconds
  _playPad(chord, time, duration) {
    const context = this.audioContext;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = this.arrangement.padCutoff;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(this.arrangement.padVolume, time + Math.min(0.4, duration / 4));
    envelope.gain.setValueAtTime(this.arrangement.padVolume, time + duration);
    envelope.gain.linearRampToValueAtTime(0, time + duration + 0.3);
    filter.connect(envelope);
    envelope.connect(this.masterGain);
    chord.forEach(midiNote => {
      [-6, 6].forEach(detune => {
        const oscillator = context.createOscillator();
        oscillator.type = this.arrangement.padWave;
        oscillator.frequency.value = midiNoteFrequency(midiNote);
        oscillator.detune.value = detune;
        oscillator.connect(filter);
        oscillator.start(time);
        oscillator.stop(time + duration + 0.35);
      });
    });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc One plucked bass note.
  // @param {number} midiNote - The note
  // @param {number} time - When it starts
  // @param {number} duration - How long it rings
  _playBass(midiNote, time, duration) {
    const context = this.audioContext;
    const oscillator = context.createOscillator();
    oscillator.type = this.arrangement.bassWave;
    oscillator.frequency.value = midiNoteFrequency(midiNote);
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 600;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, time);
    envelope.gain.exponentialRampToValueAtTime(0.35, time + 0.01);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    oscillator.connect(filter);
    filter.connect(envelope);
    envelope.connect(this.masterGain);
    oscillator.start(time);
    oscillator.stop(time + duration + 0.05);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc A kick drum: a sine wave dropping quickly in pitch.
  // @param {number} time - When it hits
  _playKick(time) {
    const context = this.audioContext;
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(150, time);
    oscillator.frequency.exponentialRampToValueAtTime(45, time + 0.12);
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.9, time);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + 0.35);
    oscillator.connect(envelope);
    envelope.connect(this.masterGain);
    oscillator.start(time);
    oscillator.stop(time + 0.4);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc A burst of filtered noise: a snare with a lower cutoff, a hi-hat with a high one.
  // @param {object} options - { cutoff, duration, time, volume }: cutoff is the high-pass frequency in hertz.
  _playNoise({ cutoff, duration, time, volume }) {
    const context = this.audioContext;
    const source = context.createBufferSource();
    source.buffer = this._noise();
    const filter = context.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = cutoff;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(volume, time);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(this.masterGain);
    source.start(time);
    source.stop(time + duration + 0.02);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc One second of white noise, made once and shared by every drum hit.
  // @returns {AudioBuffer} The noise.
  _noise() {
    if (this.noiseBuffer) return this.noiseBuffer;
    const sampleRate = this.audioContext.sampleRate;
    const buffer = this.audioContext.createBuffer(1, Math.floor(sampleRate * NOISE_BUFFER_SECONDS), sampleRate);
    const samples = buffer.getChannelData(0);
    for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) samples[sampleIndex] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
    return buffer;
  }
}
