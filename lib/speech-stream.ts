'use client';

import type { Host, Turn } from '@/lib/episode';
import { SseFrameDecoder, parseNormalizedTtsSseFrame } from '@/lib/tts-sse';

export type SpeechStreamHandlers = {
  onFirstAudio?: () => void;
  /** Returns the number of seconds successfully accepted by the playback queue. */
  onAudio: (base64: string, sampleRate: number) => number | void;
  /** Defers this callback until the playback queue holds at least this much audio. */
  prebufferSeconds?: number;
  onPlaybackReady?: () => void;
  onComplete?: (status: string) => void;
};

/**
 * Streams one segment (or one inserted answer) of two-speaker audio and hands each delta to
 * the caller as it arrives. Resolves when the generation completes; rejects on any
 * transport, validation, or provider failure so the caller can retry a single segment
 * without tearing down the whole episode.
 */
export async function streamSpeech(
  request: { hosts: [Host, Host]; turns: Turn[] },
  handlers: SpeechStreamHandlers,
  signal: AbortSignal,
) {
  const response = await fetch('/api/tts/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    const failure = await response.json().catch(() => null);
    throw new Error(
      typeof failure?.error === 'string' ? failure.error : 'Could not start the Gemini audio stream.',
    );
  }
  if (!response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) {
    throw new Error('The server did not return an audio event stream.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const frames = new SseFrameDecoder();
  let sawAudio = false;
  let bufferedSeconds = 0;
  let playbackReady = false;
  let status: string | null = null;

  const consume = (values: string[]) => {
    for (const frame of values) {
      const event = parseNormalizedTtsSseFrame(frame);
      if (!event) continue;
      if (event.event === 'audio') {
        if (!sawAudio) {
          sawAudio = true;
          handlers.onFirstAudio?.();
        }
        const acceptedSeconds = handlers.onAudio(event.data.data, event.data.sampleRate);
        if (typeof acceptedSeconds === 'number' && Number.isFinite(acceptedSeconds)) {
          bufferedSeconds += Math.max(0, acceptedSeconds);
        }
        if (!playbackReady && handlers.onPlaybackReady
          && bufferedSeconds >= Math.max(0, handlers.prebufferSeconds ?? 0)) {
          playbackReady = true;
          handlers.onPlaybackReady();
        }
        continue;
      }
      if (event.event === 'complete') {
        status = event.data.status;
        continue;
      }
      if (event.event === 'error') throw new Error(event.data.error);
    }
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      consume(frames.push(decoder.decode(value, { stream: true })));
    }
    consume(frames.push(decoder.decode()));
    consume(frames.finish());
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  if (!sawAudio) throw new Error('Gemini returned no audio for this segment.');
  // Very short clips may finish before reaching the preferred runway. Once generation is
  // complete there is no starvation risk, so let the queued audio play immediately.
  if (!playbackReady && handlers.onPlaybackReady) {
    playbackReady = true;
    handlers.onPlaybackReady();
  }
  handlers.onComplete?.(status ?? 'completed');
}
