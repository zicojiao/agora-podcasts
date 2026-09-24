// Two-lane PCM program player.
//
// The room's program has two independent audio flows: `base` (the generated episode) and
// `interrupt` (the hosts answering a listener). Only one is ever audible. Keeping both
// queues inside the worklet is what makes "resume exactly where we left off" trivially
// correct — switching lanes leaves the inactive lane's read cursor untouched at the sample,
// so there is no cursor arithmetic on the main thread to drift or round.
//
// Lane switches and pause/resume run through a short gain ramp; a hard cut between PCM
// buffers is audible as a click.

const FADE_SECONDS = 0.012;
const REPORT_INTERVAL_SAMPLES = 2048;
const SILENCE_LEVEL = 0.0005;

function createLane() {
  return {
    chunks: [],
    offset: 0,
    queuedSamples: 0,
    playedSamples: 0,
    ended: false,
    drainReported: false,
    // Last values actually posted, so an idle lane stops re-posting the same numbers.
    reportedPlayed: -1,
    reportedQueued: -1,
  };
}

class ProgramPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.lanes = { base: createLane(), interrupt: createLane() };
    this.active = 'base';
    this.pendingLane = null;
    this.playing = false;
    this.gain = 0;
    this.fadeStep = 1 / Math.max(1, Math.round(FADE_SECONDS * sampleRate));
    this.samplesSinceReport = 0;
    this.sumSquares = 0;
    this.reportedSilent = false;
    this.port.onmessage = ({ data }) => this.handleMessage(data);
  }

  handleMessage(data) {
    const lane = data && this.lanes[data.lane];

    switch (data?.type) {
      case 'push':
        if (lane && data.samples instanceof Float32Array && data.samples.length) {
          lane.chunks.push(data.samples);
          lane.queuedSamples += data.samples.length;
          lane.drainReported = false;
        }
        break;

      case 'setActive':
        if (this.lanes[data.lane] && data.lane !== this.active) {
          // Ramp to silence first; the switch completes inside process().
          this.pendingLane = data.lane;
        } else if (data.lane === this.active) {
          this.pendingLane = null;
        }
        break;

      case 'setPlaying':
        this.playing = data.playing === true;
        break;

      case 'end':
        if (lane) lane.ended = true;
        break;

      case 'clear':
        if (lane) {
          const played = lane.playedSamples;
          this.lanes[data.lane] = createLane();
          // Keep the played count when only flushing buffered audio, so progress reporting
          // for a still-live lane does not jump backwards.
          if (data.keepProgress) this.lanes[data.lane].playedSamples = played;
          this.report(data.lane, true);
        }
        break;

      case 'resetAll':
        this.lanes = { base: createLane(), interrupt: createLane() };
        this.active = 'base';
        this.pendingLane = null;
        this.playing = false;
        this.gain = 0;
        this.report('base', true);
        this.report('interrupt', true);
        break;

      default:
        break;
    }
  }

  targetGain() {
    if (this.pendingLane) return 0;
    return this.playing ? 1 : 0;
  }

  readActiveSample() {
    const lane = this.lanes[this.active];
    while (lane.chunks.length) {
      const head = lane.chunks[0];
      if (lane.offset < head.length) {
        const sample = head[lane.offset];
        lane.offset += 1;
        lane.queuedSamples -= 1;
        lane.playedSamples += 1;
        if (lane.offset >= head.length) {
          lane.chunks.shift();
          lane.offset = 0;
        }
        return sample;
      }
      lane.chunks.shift();
      lane.offset = 0;
    }
    return 0;
  }

  report(laneName, force = false) {
    const lane = this.lanes[laneName];
    if (!lane) return;
    const level = force ? 0 : Math.sqrt(this.sumSquares / REPORT_INTERVAL_SAMPLES);

    // An idle graph still calls process() forever. Posting unchanged numbers ~23 times a
    // second would re-render the entire UI while nothing is happening, which is enough to
    // destabilize effects on the main thread.
    const unchanged = lane.playedSamples === lane.reportedPlayed
      && lane.queuedSamples === lane.reportedQueued
      && level < SILENCE_LEVEL
      && this.reportedSilent;
    if (unchanged && !force) return;

    lane.reportedPlayed = lane.playedSamples;
    lane.reportedQueued = lane.queuedSamples;
    this.reportedSilent = level < SILENCE_LEVEL;

    this.port.postMessage({
      type: 'progress',
      lane: laneName,
      playedSamples: lane.playedSamples,
      queuedSamples: lane.queuedSamples,
      level,
      active: this.active,
    });
  }

  process(_inputs, outputs) {
    const channel = outputs[0]?.[0];
    if (!channel) return true;

    for (let index = 0; index < channel.length; index += 1) {
      const target = this.targetGain();
      if (this.gain < target) this.gain = Math.min(target, this.gain + this.fadeStep);
      else if (this.gain > target) this.gain = Math.max(target, this.gain - this.fadeStep);

      if (this.pendingLane && this.gain <= 0) {
        this.active = this.pendingLane;
        this.pendingLane = null;
      }

      // Only consume a sample when it will actually be heard. While fully faded out the
      // active lane's cursor must not advance, or pausing would silently eat audio.
      const audible = this.gain > 0 || target > 0;
      const sample = audible ? this.readActiveSample() * this.gain : 0;
      channel[index] = sample;
      this.sumSquares += sample * sample;
    }

    this.samplesSinceReport += channel.length;
    if (this.samplesSinceReport >= REPORT_INTERVAL_SAMPLES) {
      this.report(this.active);
      this.samplesSinceReport = 0;
      this.sumSquares = 0;
    }

    for (const laneName of ['base', 'interrupt']) {
      const lane = this.lanes[laneName];
      if (lane.ended && lane.queuedSamples === 0 && !lane.drainReported) {
        lane.drainReported = true;
        this.port.postMessage({ type: 'drained', lane: laneName, playedSamples: lane.playedSamples });
      }
    }

    return true;
  }
}

registerProcessor('program-player', ProgramPlayerProcessor);
