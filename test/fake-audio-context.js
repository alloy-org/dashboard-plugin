// A stand-in for the Web Audio API's AudioContext, which jsdom lacks. It records the nodes made and when sources start,
// and lets a test move the audio clock by hand, so the soundtrack's scheduling can be checked without sound.

// ----------------------------------------------------------------------------------------------
// @desc A parameter such as a gain or frequency, recording every value it is told to reach.
// @param {number} value - Its starting value.
// @returns {object} The parameter.
function fakeAudioParam(value) {
  const audioParam = { automations: [], value };
  const record = kind => (target, time) => {
    audioParam.automations.push({ kind, target, time });
    audioParam.value = target;
  };
  audioParam.cancelScheduledValues = time => audioParam.automations.push({ kind: "cancel", time });
  audioParam.setValueAtTime = record("set");
  audioParam.linearRampToValueAtTime = record("linear");
  audioParam.exponentialRampToValueAtTime = record("exponential");
  return audioParam;
}

// ----------------------------------------------------------------------------------------------
// @desc A node that can be connected and disconnected.
// @param {string} kind - Which factory made it.
// @returns {object} The node.
function fakeAudioNode(kind) {
  const audioNode = { connections: [], disconnected: false, kind };
  audioNode.connect = destination => audioNode.connections.push(destination);
  audioNode.disconnect = () => { audioNode.disconnected = true; };
  return audioNode;
}

// ----------------------------------------------------------------------------------------------
// @desc A fake AudioContext. Its clock moves only through advance().
export class FakeAudioContext {
  // ----------------------------------------------------------------------------------------------
  // @desc An idle context at time zero.
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 8000;
    this.state = "suspended";
    this.destination = fakeAudioNode("destination");
    this.nodes = [];
    this.startedSources = [];
    FakeAudioContext.instances.push(this);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Move the audio clock forward.
  // @param {number} seconds - How far.
  advance(seconds) {
    this.currentTime += seconds;
  }

  resume() {
    this.state = "running";
    return Promise.resolve();
  }

  suspend() {
    this.state = "suspended";
    return Promise.resolve();
  }

  close() {
    this.state = "closed";
    return Promise.resolve();
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Keep a node so a test can find it.
  // @param {object} audioNode - The node.
  // @returns {object} The same node.
  _track(audioNode) {
    this.nodes.push(audioNode);
    return audioNode;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc A source node whose start time is recorded, labeled with what it plays.
  // @param {string} kind - Which factory made it.
  // @returns {object} The source.
  _source(kind) {
    const source = fakeAudioNode(kind);
    source.start = time => this.startedSources.push({ kind, source, time });
    source.stop = time => { source.stoppedAt = time; };
    return this._track(source);
  }

  createGain() {
    const gainNode = fakeAudioNode("gain");
    gainNode.gain = fakeAudioParam(1);
    return this._track(gainNode);
  }

  createBiquadFilter() {
    const filterNode = fakeAudioNode("filter");
    filterNode.frequency = fakeAudioParam(350);
    return this._track(filterNode);
  }

  createOscillator() {
    const oscillator = this._source("oscillator");
    oscillator.frequency = fakeAudioParam(440);
    oscillator.detune = fakeAudioParam(0);
    return oscillator;
  }

  createBufferSource() {
    return this._source("buffer");
  }

  createBuffer(channelCount, length, sampleRate) {
    const channels = Array.from({ length: channelCount }, () => new Float32Array(length));
    return { getChannelData: channelIndex => channels[channelIndex], length, sampleRate };
  }
}

FakeAudioContext.instances = [];
