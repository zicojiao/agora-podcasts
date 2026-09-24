import type { ProgramLane } from '@/hooks/useProgramEngine';
import type { RoomMessage } from '@/lib/room-messages';

export type ReplayAudioChunk =
  | { encoding: 'base64-pcm16'; data: string; sampleRate: number }
  | { encoding: 'pcm16'; bytes: Uint8Array; sampleRate: number };

type ReplayProgramEngine = {
  resetAll: () => void;
  setLaneActive: (lane: ProgramLane) => void;
  pushAudioDelta: (lane: ProgramLane, data: string, sampleRate: number) => number;
  pushPcm16: (lane: ProgramLane, bytes: ArrayBuffer | Uint8Array, sampleRate: number) => number;
  endLane: (lane: ProgramLane) => void;
  setPlaying: (playing: boolean) => void;
};

const RESTARTABLE_PHASES = new Set([
  'playing',
  'paused',
  'listening',
  'thinking',
  'answering',
  'resuming',
  'completed',
]);

export function episodeResetMessage(
  kind: 'replay' | 'restart',
): Extract<RoomMessage, { t: 'episode.replay' | 'episode.restart' }> {
  return { t: kind === 'restart' ? 'episode.restart' : 'episode.replay' };
}

export function isEpisodeRestartAvailable({
  isHost,
  audioReady,
  phase,
}: {
  isHost: boolean;
  audioReady: boolean;
  phase: string;
}) {
  return isHost && audioReady && RESTARTABLE_PHASES.has(phase);
}

/** Rebuilds the consumed base lane from its in-memory source audio and starts at sample zero. */
export function replayEpisodeAudio(chunks: readonly ReplayAudioChunk[], engine: ReplayProgramEngine) {
  if (chunks.length === 0) return false;

  engine.resetAll();
  engine.setLaneActive('base');
  for (const chunk of chunks) {
    if (chunk.encoding === 'base64-pcm16') {
      engine.pushAudioDelta('base', chunk.data, chunk.sampleRate);
    } else {
      engine.pushPcm16('base', chunk.bytes, chunk.sampleRate);
    }
  }
  engine.endLane('base');
  engine.setPlaying(true);
  return true;
}
