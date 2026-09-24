import assert from 'node:assert/strict';
import { decodeRoomMessage } from '@/lib/room-messages';

assert.deepEqual(
  decodeRoomMessage('{"t":"episode.replay"}'),
  { t: 'episode.replay' },
  'listeners cannot receive the host replay reset',
);

const replayModule = await import('@/lib/episode-replay').catch(() => null) as null | {
  episodeResetMessage?: (kind: 'replay' | 'restart') => { t: 'episode.replay' | 'episode.restart' };
  isEpisodeRestartAvailable: (options: {
    isHost: boolean;
    audioReady: boolean;
    phase: string;
  }) => boolean;
  replayEpisodeAudio: (
    chunks: Array<
      | { encoding: 'base64-pcm16'; data: string; sampleRate: number }
      | { encoding: 'pcm16'; bytes: Uint8Array; sampleRate: number }
    >,
    engine: {
      resetAll: () => void;
      setLaneActive: (lane: 'base' | 'interrupt') => void;
      pushAudioDelta: (lane: 'base' | 'interrupt', data: string, sampleRate: number) => number;
      pushPcm16: (lane: 'base' | 'interrupt', bytes: Uint8Array, sampleRate: number) => number;
      endLane: (lane: 'base' | 'interrupt') => void;
      setPlaying: (playing: boolean) => void;
    },
  ) => boolean;
};

assert(replayModule, 'the replay queue coordinator is missing');
assert.equal(
  typeof replayModule.episodeResetMessage,
  'function',
  'Replay and Restart need distinct RTM events',
);
if (replayModule.episodeResetMessage) {
  assert.deepEqual(replayModule.episodeResetMessage('replay'), { t: 'episode.replay' });
  assert.deepEqual(replayModule.episodeResetMessage('restart'), { t: 'episode.restart' });
}

for (const phase of ['playing', 'paused', 'listening', 'thinking', 'answering', 'resuming', 'completed']) {
  assert.equal(
    replayModule.isEpisodeRestartAvailable({ isHost: true, audioReady: true, phase }),
    true,
    `the host cannot restart during ${phase}`,
  );
}
assert.equal(
  replayModule.isEpisodeRestartAvailable({ isHost: false, audioReady: true, phase: 'playing' }),
  false,
  'a listener can access the demo restart control',
);
assert.equal(
  replayModule.isEpisodeRestartAvailable({ isHost: true, audioReady: false, phase: 'playing' }),
  false,
  'restart is enabled before the full original audio is cached',
);
assert.equal(
  replayModule.isEpisodeRestartAvailable({ isHost: true, audioReady: true, phase: 'buffering' }),
  false,
  'restart interrupts initial episode production',
);

const calls: string[] = [];
const replayed = replayModule.replayEpisodeAudio([
  { encoding: 'base64-pcm16', data: 'first-delta', sampleRate: 24_000 },
  { encoding: 'pcm16', bytes: new Uint8Array([1, 2, 3, 4]), sampleRate: 48_000 },
], {
  resetAll: () => calls.push('reset'),
  setLaneActive: (lane) => calls.push(`active:${lane}`),
  pushAudioDelta: (lane, data, sampleRate) => {
    calls.push(`delta:${lane}:${data}:${sampleRate}`);
    return 1;
  },
  pushPcm16: (lane, bytes, sampleRate) => {
    calls.push(`pcm:${lane}:${bytes.byteLength}:${sampleRate}`);
    return 1;
  },
  endLane: (lane) => calls.push(`end:${lane}`),
  setPlaying: (playing) => calls.push(`playing:${playing}`),
});

assert.equal(replayed, true, 'a cached episode did not start replaying');
assert.deepEqual(calls, [
  'reset',
  'active:base',
  'delta:base:first-delta:24000',
  'pcm:base:4:48000',
  'end:base',
  'playing:true',
], 'replay did not rebuild the original base lane from the beginning');

calls.length = 0;
assert.equal(replayModule.replayEpisodeAudio([], {
  resetAll: () => calls.push('reset'),
  setLaneActive: () => calls.push('active'),
  pushAudioDelta: () => 0,
  pushPcm16: () => 0,
  endLane: () => calls.push('end'),
  setPlaying: () => calls.push('playing'),
}), false, 'an empty audio cache reported a successful replay');
assert.deepEqual(calls, [], 'an empty audio cache destroyed the finished program');

console.log('✓ episode replay rebuilds the base lane and clears the room through RTM');
