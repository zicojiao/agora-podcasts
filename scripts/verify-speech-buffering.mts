import assert from 'node:assert/strict';
import { streamSpeech } from '@/lib/speech-stream';
import { encodeSseEvent } from '@/lib/tts-sse';
import type { Host, Turn } from '@/lib/episode';

const hosts: [Host, Host] = [
  { id: 'host-a', name: 'Sarah', role: 'host', voice: 'Puck' },
  { id: 'host-b', name: 'Marcus', role: 'host', voice: 'Kore' },
];
const turns: Turn[] = [
  { hostId: 'host-a', text: 'A long enough opening line for the speech request.', style: 'warm' },
];

function speechResponse(audioChunks: number) {
  const body = Array.from({ length: audioChunks }, () => encodeSseEvent({
    event: 'audio',
    data: { data: 'AAA=', mimeType: 'audio/l16', sampleRate: 24_000, channels: 1 },
  })).join('') + encodeSseEvent({ event: 'complete', data: { status: 'completed' } });
  return new Response(body, { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
}

const originalFetch = globalThis.fetch;

try {
  globalThis.fetch = async () => speechResponse(4);
  const events: string[] = [];
  let acceptedChunks = 0;

  await streamSpeech(
    { hosts, turns },
    {
      prebufferSeconds: 3,
      onFirstAudio: () => events.push('first-audio'),
      onAudio: () => {
        acceptedChunks += 1;
        events.push(`audio-${acceptedChunks}`);
        return 1;
      },
      onPlaybackReady: () => events.push('playback-ready'),
    },
    new AbortController().signal,
  );

  assert.deepEqual(events, [
    'first-audio',
    'audio-1',
    'audio-2',
    'audio-3',
    'playback-ready',
    'audio-4',
  ], 'playback started before three seconds of PCM had been accepted');

  globalThis.fetch = async () => speechResponse(2);
  let shortStreamReady = 0;
  await streamSpeech(
    { hosts, turns },
    {
      prebufferSeconds: 3,
      onAudio: () => 1,
      onPlaybackReady: () => { shortStreamReady += 1; },
    },
    new AbortController().signal,
  );
  assert.equal(shortStreamReady, 1, 'a completed short clip never became playable');

  console.log('✓ streamed speech waits for a safe startup buffer.');
} finally {
  globalThis.fetch = originalFetch;
}
