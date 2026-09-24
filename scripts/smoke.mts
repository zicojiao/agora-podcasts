/**
 * Live smoke test against the real Gemini API. Needs GEMINI_API_KEY and burns real quota,
 * so it is not part of `pnpm run verify`.
 *
 * Calls the route handlers directly rather than over HTTP: they are plain functions, and
 * this avoids standing up a server just to exercise the provider integration.
 *
 *   pnpm run smoke
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';

// Load .env.local the same way `next dev` would.
try {
  const contents = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    // Tolerate quoted values; Next's own dotenv parser strips them too.
    const value = trimmed.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    if (value) process.env[key] ??= value;
  }
} catch {
  console.error('No .env.local found.');
  process.exit(1);
}

if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY is not set.');
  process.exit(1);
}

const { parseEpisode, segmentTextLength, ESTIMATED_CHARS_PER_SECOND } = await import('@/lib/episode');
const { createEpisodeHandler } = await import('@/lib/episode-handler');
const { createQuestionHandler } = await import('@/lib/question-handler');
const { createTtsStreamHandler } = await import('@/lib/tts-stream-handler');
const { SseFrameDecoder, parseNormalizedTtsSseFrame } = await import('@/lib/tts-sse');
const smokeTopic = 'How can listeners participate in an AI-generated podcast?';

function request(url: string, body: unknown) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function seconds(start: number) {
  return `${((performance.now() - start) / 1_000).toFixed(1)}s`;
}

console.log('text model: Gemini 3.8 Flash');
console.log('tts model:  Gemini 3.8 Flash TTS\n');

// ── 1. Episode generation ─────────────────────────────────────────────────────────────────

console.log('1. Generating an episode from a topic…');
const scriptStart = performance.now();
const episodeResponse = await createEpisodeHandler()(
  request('http://localhost/api/episode', { source: smokeTopic }),
);
const episodePayload = await episodeResponse.json();

if (episodeResponse.status !== 200) {
  console.error(`   ✗ ${episodeResponse.status} — ${episodePayload?.error}`);
  process.exit(1);
}
const episode = parseEpisode(episodePayload.episode);
if (typeof episode === 'string') {
  console.error(`   ✗ returned an episode that fails validation: ${episode}`);
  process.exit(1);
}

console.log(`   ✓ "${episode.title}" in ${seconds(scriptStart)}`);
console.log(`     ${episode.hosts.map((h) => `${h.name} (${h.voice})`).join(' · ')}`);
console.log(`     ${episode.segments.length} segments:`);
for (const [index, segment] of episode.segments.entries()) {
  const chars = segmentTextLength(segment.turns);
  console.log(
    `       ${index + 1}. ${segment.topic} — ${segment.turns.length} turns, `
    + `${chars} chars (~${Math.round(chars / ESTIMATED_CHARS_PER_SECOND)}s)`,
  );
}
console.log(`     first line: "${episode.segments[0].turns[0].text.slice(0, 90)}…"\n`);

// ── 2. Two-speaker streaming TTS ──────────────────────────────────────────────────────────

async function streamFirstSegment() {
  console.log('2. Streaming the first segment through Gemini 3.8 Flash TTS…');
  const ttsStart = performance.now();
  let firstDeltaMs: number | null = null;
  let deltas = 0;
  let pcmBytes = 0;
  let sampleRate = 0;
  let completed = false;

  const ttsResponse = await createTtsStreamHandler()(
    request('http://localhost/api/tts/stream', {
      hosts: (episode as Exclude<typeof episode, string>).hosts,
      turns: (episode as Exclude<typeof episode, string>).segments[0].turns,
    }),
  );

  if (ttsResponse.status !== 200) {
    const failure = await ttsResponse.json().catch(() => null);
    console.error(`   ✗ ${ttsResponse.status} — ${failure?.error}`);
    process.exit(1);
  }

  const reader = ttsResponse.body!.getReader();
  const textDecoder = new TextDecoder();
  const frames = new SseFrameDecoder();

  const consume = (values: string[]) => {
    for (const frame of values) {
      const event = parseNormalizedTtsSseFrame(frame);
      if (!event) continue;
      if (event.event === 'audio') {
        firstDeltaMs ??= performance.now() - ttsStart;
        deltas += 1;
        // base64 → bytes, 2 bytes per PCM16 sample.
        pcmBytes += Math.floor((event.data.data.length * 3) / 4);
        sampleRate = event.data.sampleRate;
      }
      if (event.event === 'complete') completed = true;
      if (event.event === 'error') {
        console.error(`   ✗ stream error: ${event.data.error}`);
        process.exit(1);
      }
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    consume(frames.push(textDecoder.decode(value, { stream: true })));
  }
  consume(frames.push(textDecoder.decode()));
  consume(frames.finish());

  if (!deltas) {
    console.error('   ✗ no audio deltas arrived');
    process.exit(1);
  }

  const generationMs = performance.now() - ttsStart;
  const audioSeconds = pcmBytes / 2 / (sampleRate || 24_000);
  console.log(`   ✓ ${deltas} audio deltas, ${(pcmBytes / 1_024).toFixed(0)} KB PCM in ${seconds(ttsStart)}`);
  console.log(`     first delta at ${((firstDeltaMs ?? 0) / 1_000).toFixed(2)}s`);
  console.log(`     ${sampleRate} Hz mono → ${audioSeconds.toFixed(1)}s of audio`);
  // Above 1x, generation outruns playback, so the base lane never starves mid-segment.
  console.log(`     generated at ${(audioSeconds / (generationMs / 1_000)).toFixed(1)}x realtime`);
  console.log(`     completion event: ${completed ? 'yes' : 'no (stream ended without one)'}\n`);
}

// The TTS stage is the slow, expensive one; SMOKE_SKIP_TTS=1 exercises only the text paths.
if (process.env.SMOKE_SKIP_TTS === '1') {
  console.log('2. Skipping Gemini 3.8 Flash TTS (SMOKE_SKIP_TTS=1)\n');
} else {
  await streamFirstSegment();
}

// ── 3. Interruption answer ────────────────────────────────────────────────────────────────

console.log('3. Answering an interruption question…');
const answerStart = performance.now();
const question = 'Wait — which of those details actually came from the official report?';
const answerResponse = await createQuestionHandler()(
  request('http://localhost/api/episode/question', {
    question,
    source: smokeTopic,
    title: episode.title,
    summary: episode.summary,
    hosts: episode.hosts,
    recentTurns: episode.segments[0].turns.slice(0, 3),
    askerName: 'Zico',
  }),
);
const answerPayload = await answerResponse.json();

if (answerResponse.status !== 200) {
  console.error(`   ✗ ${answerResponse.status} — ${answerPayload?.error}`);
  process.exit(1);
}

console.log(`   ✓ ${answerPayload.turns.length} turns in ${seconds(answerStart)}`);
for (const turn of answerPayload.turns) {
  const host = episode.hosts.find((candidate) => candidate.id === turn.hostId);
  console.log(`     ${host?.name}: "${turn.text.slice(0, 100)}${turn.text.length > 100 ? '…' : ''}"`);
}

// ── 4. Agora token with the real project credentials ──────────────────────────────────────

console.log('\n4. Minting an Agora RTC+RTM token…');
if (!process.env.NEXT_PUBLIC_AGORA_APP_ID || !process.env.NEXT_AGORA_APP_CERTIFICATE) {
  console.log('   · skipped — Agora credentials are not set\n');
} else {
  const { createAgoraTokenHandler } = await import('@/lib/agora-token-handler');
  const tokenResponse = await createAgoraTokenHandler()(
    new NextRequest('http://localhost/api/agora-token?channel=room-smoke1&uid=4242'),
  );
  const tokenPayload = await tokenResponse.json();
  if (tokenResponse.status !== 200) {
    console.error(`   ✗ ${tokenResponse.status} — ${tokenPayload?.error}`);
    process.exit(1);
  }
  if (typeof tokenPayload.token !== 'string' || !tokenPayload.token.startsWith('007')) {
    console.error('   ✗ not a well-formed AccessToken2');
    process.exit(1);
  }
  const ttl = tokenPayload.expiresAt - Math.floor(Date.now() / 1_000);
  console.log(`   ✓ AccessToken2 for ${tokenPayload.channel} as uid ${tokenPayload.uid}`);
  console.log(`     ${tokenPayload.token.length} chars, expires in ${Math.round(ttl / 60)} min`);
  console.log('     (a real RTC join still has to be verified in a browser)\n');
}

console.log('✓ Provider integrations verified.');
