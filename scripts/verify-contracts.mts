/**
 * Contract checks that need no live credentials.
 *
 * Covers the boundaries where a mistake would be invisible in the UI but wrong on the wire:
 * the Interactions payload shape, SSE framing and validation, schema enforcement on model
 * output, the RTM protocol, room-link parsing, concurrency guards, and turn-boundary math.
 */
import { NextRequest } from 'next/server';
// Type-only imports are erased, so they do not execute a module before the env is set up.
import type { Episode } from '@/lib/episode';

process.env.GEMINI_API_KEY ??= 'test-key-for-contract-verification';
process.env.GEMINI_TTS_MODEL ??= 'test-conversation-tts';
process.env.NEXT_PUBLIC_AGORA_APP_ID ??= '0'.repeat(32);
process.env.NEXT_AGORA_APP_CERTIFICATE ??= '1'.repeat(32);

const {
  parseEpisode, turnBoundaries, SEGMENT_MAX_TEXT_LENGTH, VOCAL_TAGS,
} = await import('@/lib/episode');
const { buildSpeechPayload, parseSpeechRequest } = await import('@/lib/tts-payload');
const { getTtsModelId, getTextModelId } = await import('@/lib/gemini-transport');
const {
  SseFrameDecoder, normalizeGeminiTtsSseFrame, parseNormalizedTtsSseFrame, encodeSseEvent,
} = await import('@/lib/tts-sse');
const {
  EpisodeAssembler, chunkEpisode, decodeRoomMessage, encodeRoomMessage,
} = await import('@/lib/room-messages');
const { parseChannelName, parseUid, createAgoraTokenHandler } = await import('@/lib/agora-token-handler');
const { createRoomCode, isRoomChannel } = await import('@/lib/room-code');
const { createSingleFlight } = await import('@/lib/single-flight');
const { createTtsStreamHandler } = await import('@/lib/tts-stream-handler');
const { buildScriptPayload, createEpisodeHandler, SCRIPT_SYSTEM_INSTRUCTION } = await import('@/lib/episode-handler');
const { RoomLanding } = await import('@/components/RoomLanding');
const { EpisodeComposer } = await import('@/components/EpisodeComposer');
const { TranscriptRail } = await import('@/components/TranscriptRail');
const { ANSWER_SYSTEM_INSTRUCTION, buildAnswerPayload } = await import('@/lib/question-handler');
const { createElement } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');
const {
  LIVE_CONNECT_TIMEOUT_MS,
  LIVE_TRANSCRIPTION_API_VERSION,
  LIVE_TRANSCRIPTION_MODEL,
} = await import('@/lib/live-transcription-config');

// These checks assert on the exact wire shape of a built payload, so they index freely into
// an arbitrary JSON object rather than through the typed builder result.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PayloadProbe = Record<string, any>;

let passed = 0;
const failures: string[] = [];

function check(name: string, assertion: () => void) {
  try {
    assertion();
    passed += 1;
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function checkAsync(name: string, assertion: () => Promise<void>) {
  try {
    await assertion();
    passed += 1;
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message}\n  expected: ${b}\n  actual:   ${a}`);
}

function jsonRequest(url: string, body: unknown) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

check('episode writing prompt directs contextual vocal performance', () => {
  for (const tag of VOCAL_TAGS) {
    assert(SCRIPT_SYSTEM_INSTRUCTION.includes(tag), `script prompt omitted ${tag}`);
  }
  assert(
    /opening exchange[\s\S]*2[–-]3 different vocal events/i.test(SCRIPT_SYSTEM_INSTRUCTION),
    'script prompt does not deliberately showcase vocal events in the opening exchange',
  );
  assert(
    SCRIPT_SYSTEM_INSTRUCTION.includes('<sigh> only for genuine frustration, tension, or resignation'),
    'script prompt does not reserve sighs for a meaningful emotional context',
  );
  assert(SCRIPT_SYSTEM_INSTRUCTION.includes('Never stack tags'), 'script prompt allows stacked vocal tags');
  assert(
    SCRIPT_SYSTEM_INSTRUCTION.includes('repeat the same event in adjacent turns'),
    'script prompt allows mechanical adjacent vocal-event repetition',
  );
});

check('the script request assigns each fixed host the intended identity', () => {
  const instruction = buildScriptPayload('A topic for a podcast').systemInstruction.parts[0].text;
  assert(/host-a[^\n]*Marcus[^\n]*man/i.test(instruction), 'host-a is not Marcus, the male host');
  assert(/host-b[^\n]*Elena[^\n]*woman/i.test(instruction), 'host-b is not Elena, the female host');
});

check('live transcription uses the current ephemeral-token-compatible API contract', () => {
  assertEqual(LIVE_TRANSCRIPTION_MODEL, 'gemini-3.5-transcribe-live', 'wrong Live transcription model');
  assertEqual(LIVE_TRANSCRIPTION_API_VERSION, 'v1alpha', 'the installed SDK requires v1alpha for ephemeral tokens');
  assert(LIVE_CONNECT_TIMEOUT_MS >= 5_000 && LIVE_CONNECT_TIMEOUT_MS <= 20_000,
    'Live connection timeout is missing or unreasonable');
});

await checkAsync('podcast production progress follows real generation phases with changing copy', async () => {
  const progressModulePath = '@/lib/production-progress';
  const progressModule = await import(progressModulePath).catch(() => null) as null | {
    PRODUCTION_STEPS: Array<{ label: string }>;
    productionProgressFor: (phase: 'scripting' | 'buffering', copyIndex: number) => {
      activeStep: number;
      title: string;
      detail: string;
    };
  };
  assert(progressModule !== null, 'production progress helper is missing');
  if (!progressModule) return;

  assertEqual(
    progressModule.PRODUCTION_STEPS.map(({ label }) => label),
    ['Write the show', 'Create the voices', 'Go live'],
    'the production rundown changed',
  );
  const firstWritingMessage = progressModule.productionProgressFor('scripting', 0);
  const laterWritingMessage = progressModule.productionProgressFor('scripting', 1);
  const voiceMessage = progressModule.productionProgressFor('buffering', 0);
  assertEqual(firstWritingMessage.activeStep, 0, 'scripting did not select the writing step');
  assertEqual(voiceMessage.activeStep, 1, 'buffering did not select the voice step');
  assert(firstWritingMessage.detail !== laterWritingMessage.detail, 'waiting copy does not change over time');
  assert(voiceMessage.title.includes('two-host audio'), 'buffering does not explain the TTS work');
});

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────

const hosts: Episode['hosts'] = [
  { id: 'host-a', name: 'Ada', role: 'Host', voice: 'Puck' },
  { id: 'host-b', name: 'Miles', role: 'Co-host', voice: 'Kore' },
];

const segmentTurns = Array.from({ length: 4 }, (_, index) => ({
  hostId: (index % 2 === 0 ? 'host-a' : 'host-b') as 'host-a' | 'host-b',
  text: `This is turn number ${index + 1}, and it carries one speakable idea about the source.`,
  style: 'warm, curious',
}));

const validEpisode: Episode = {
  id: 'ep-test',
  title: 'The Lighthouse Puzzle',
  summary: 'Two hosts talk through what the record actually supports.',
  hosts,
  segments: [
    { id: 'seg-1', topic: 'What was found', turns: segmentTurns },
    { id: 'seg-2', topic: 'What was invented later', turns: segmentTurns },
  ],
};

// ── Episode schema ────────────────────────────────────────────────────────────────────────

check('accepts a well-formed episode', () => {
  const parsed = parseEpisode(validEpisode);
  assert(typeof parsed !== 'string', `rejected a valid episode: ${parsed}`);
});

check('rejects an episode with one host', () => {
  const parsed = parseEpisode({ ...validEpisode, hosts: [hosts[0]] });
  assert(typeof parsed === 'string', 'accepted a single-host episode');
});

check('rejects two hosts sharing one voice', () => {
  const parsed = parseEpisode({
    ...validEpisode,
    hosts: [hosts[0], { ...hosts[1], voice: 'Puck' }],
  });
  assert(typeof parsed === 'string', 'accepted duplicate voices');
});

check('rejects two hosts sharing one name', () => {
  // The Interactions API addresses speakers by name, so identical names are unusable.
  const parsed = parseEpisode({
    ...validEpisode,
    hosts: [hosts[0], { ...hosts[1], name: 'ada' }],
  });
  assert(typeof parsed === 'string', 'accepted duplicate speaker names');
});

check('rejects an episode where only one host speaks', () => {
  const parsed = parseEpisode({
    ...validEpisode,
    segments: validEpisode.segments.map((segment) => ({
      ...segment,
      turns: segment.turns.map((turn) => ({ ...turn, hostId: 'host-a' as const })),
    })),
  });
  assert(typeof parsed === 'string', 'accepted a one-sided episode');
});

check('rejects a single-segment episode', () => {
  const parsed = parseEpisode({ ...validEpisode, segments: [validEpisode.segments[0]] });
  assert(typeof parsed === 'string', 'accepted fewer segments than the minimum');
});

check('rejects an oversized segment', () => {
  const parsed = parseEpisode({
    ...validEpisode,
    segments: [
      {
        id: 'seg-1',
        topic: 'Too long',
        turns: Array.from({ length: 8 }, () => ({
          hostId: 'host-a' as const,
          text: 'x'.repeat(400),
        })),
      },
      validEpisode.segments[1],
    ],
  });
  assert(typeof parsed === 'string', `accepted a segment above ${SEGMENT_MAX_TEXT_LENGTH} characters`);
});

check('rejects an unknown voice', () => {
  const parsed = parseEpisode({
    ...validEpisode,
    hosts: [{ ...hosts[0], voice: 'NotAVoice' }, hosts[1]],
  });
  assert(typeof parsed === 'string', 'accepted a voice outside the catalog');
});

// ── Interactions payload ──────────────────────────────────────────────────────────────────

check('the default model IDs match Google’s published Gemini 3.8 models', () => {
  assertEqual(getTtsModelId({}), 'gemini-3.8-flash-tts', 'wrong default TTS model');
  assertEqual(getTextModelId({}), 'gemini-3.8-flash', 'wrong default text model');
});

check('speech payload matches the published multi-speaker request shape', () => {
  const payload = buildSpeechPayload(
    { hosts, turns: [{ hostId: 'host-a', text: 'Hows it going today Miles?', style: 'cheerful and friendly' }] },
    'test-conversation-tts',
  ) as PayloadProbe;

  assertEqual(payload.model, 'test-conversation-tts', 'Interactions model ID must not be prefixed');
  assertEqual(payload.response_format, { type: 'audio' }, 'response_format mismatch');
  assertEqual(payload.input[0].type, 'user_input', 'input type mismatch');
  assertEqual(payload.input[0].content[0].type, 'text', 'content blocks must be text');
  assertEqual(
    payload.input[0].content[0].annotations[0],
    { type: 'speech_metadata', speaker: 'Ada', style: 'cheerful and friendly' },
    'speech_metadata annotation mismatch',
  );
  assertEqual(payload.generation_config.speech_config.mode, 'conversational', 'speech mode must be conversational');
  assertEqual(
    payload.generation_config.speech_config.speakers,
    [{ speaker: 'Ada', voice: 'Puck' }, { speaker: 'Miles', voice: 'Kore' }],
    'speaker config mismatch',
  );
  assert(!('stream' in payload), 'stream must be omitted unless requested');
});

check('speech payload sets stream only when asked', () => {
  const payload = buildSpeechPayload({ hosts, turns: segmentTurns }, 'test-conversation-tts', true) as PayloadProbe;
  assertEqual(payload.stream, true, 'stream flag missing');
});

check('speech payload supplies a default style', () => {
  const payload = buildSpeechPayload(
    { hosts, turns: [{ hostId: 'host-b', text: 'A turn with no acting direction at all.' }] },
    'test-conversation-tts',
  ) as PayloadProbe;
  const annotation = payload.input[0].content[0].annotations[0];
  assert(typeof annotation.style === 'string' && annotation.style.length > 0, 'style must never be empty');
});

check('speech request rejects a single host', () => {
  assert(typeof parseSpeechRequest({ hosts: [hosts[0]], turns: segmentTurns }) === 'string', 'accepted one host');
});

check('speech request rejects an unknown hostId in a turn', () => {
  const result = parseSpeechRequest({ hosts, turns: [{ hostId: 'host-c', text: 'A turn from nobody at all.' }] });
  assert(typeof result === 'string', 'accepted an unknown hostId');
});

check('speech request rejects empty turns', () => {
  assert(typeof parseSpeechRequest({ hosts, turns: [] }) === 'string', 'accepted zero turns');
});

// ── SSE framing and validation ────────────────────────────────────────────────────────────

check('reassembles SSE frames split at arbitrary byte boundaries', () => {
  const stream = [
    'event: meta\ndata: {"interactionId":"abc","model":"m"}\n\n',
    'event: audio\ndata: {"data":"AAAA","mimeType":"audio/l16","sampleRate":24000,"channels":1}\n\n',
    'event: complete\ndata: {"status":"completed"}\n\n',
  ].join('');

  for (const size of [1, 3, 7, 29, 512]) {
    const decoder = new SseFrameDecoder();
    const events: string[] = [];
    for (let offset = 0; offset < stream.length; offset += size) {
      for (const frame of decoder.push(stream.slice(offset, offset + size))) {
        const parsed = parseNormalizedTtsSseFrame(frame);
        if (parsed) events.push(parsed.event);
      }
    }
    for (const frame of decoder.finish()) {
      const parsed = parseNormalizedTtsSseFrame(frame);
      if (parsed) events.push(parsed.event);
    }
    assertEqual(events, ['meta', 'audio', 'complete'], `chunk size ${size} lost events`);
  }
});

check('handles CRLF line endings', () => {
  const decoder = new SseFrameDecoder();
  const frames = decoder.push('event: complete\r\ndata: {"status":"completed"}\r\n\r\n');
  assertEqual(frames.length, 1, 'CRLF frame not split');
  assertEqual(parseNormalizedTtsSseFrame(frames[0])?.event, 'complete', 'CRLF frame not parsed');
});

check('normalizes a Gemini audio delta', () => {
  const frame = `data: ${JSON.stringify({
    event_type: 'step.delta',
    delta: { type: 'audio', data: 'AAAA', mime_type: 'audio/l16', sample_rate: 24000, channels: 1 },
  })}`;
  const normalized = normalizeGeminiTtsSseFrame(frame);
  assert(normalized !== null && normalized !== 'done' && normalized.event === 'audio', 'audio delta not normalized');
});

check('drops step.start, step.stop, and status updates', () => {
  for (const eventType of ['step.start', 'step.stop', 'interaction.status_update']) {
    const frame = `data: ${JSON.stringify({ event_type: eventType, index: 0 })}`;
    assertEqual(normalizeGeminiTtsSseFrame(frame), null, `${eventType} should be dropped`);
  }
});

check('recognizes the [DONE] sentinel', () => {
  assertEqual(normalizeGeminiTtsSseFrame('data: [DONE]'), 'done', '[DONE] not recognized');
});

check('rejects non-base64 audio payloads', () => {
  const frame = `data: ${JSON.stringify({
    event_type: 'step.delta',
    delta: { type: 'audio', data: 'not base64!!', mime_type: 'audio/l16', sample_rate: 24000, channels: 1 },
  })}`;
  let threw = false;
  try {
    normalizeGeminiTtsSseFrame(frame);
  } catch {
    threw = true;
  }
  assert(threw, 'accepted invalid base64');
});

check('rejects stereo and unsupported audio formats', () => {
  const cases = [
    { mime_type: 'audio/l16', sample_rate: 24000, channels: 2 },
    { mime_type: 'audio/mp3', sample_rate: 24000, channels: 1 },
    { mime_type: 'audio/l16', sample_rate: 999, channels: 1 },
  ];
  for (const delta of cases) {
    const frame = `data: ${JSON.stringify({
      event_type: 'step.delta',
      delta: { type: 'audio', data: 'AAAA', ...delta },
    })}`;
    let threw = false;
    try {
      normalizeGeminiTtsSseFrame(frame);
    } catch {
      threw = true;
    }
    assert(threw, `accepted unsupported audio: ${JSON.stringify(delta)}`);
  }
});

check('ignores the deprecated rate field in favour of sample_rate', () => {
  const frame = `data: ${JSON.stringify({
    event_type: 'step.delta',
    delta: { type: 'audio', data: 'AAAA', mime_type: 'audio/l16', rate: 16000, sample_rate: 24000, channels: 1 },
  })}`;
  const normalized = normalizeGeminiTtsSseFrame(frame);
  if (normalized === null || normalized === 'done' || normalized.event !== 'audio') {
    throw new Error('delta rejected');
  }
  assertEqual(normalized.data.sampleRate, 24000, 'deprecated rate field was used');
});

check('round-trips a normalized event through the encoder', () => {
  const encoded = encodeSseEvent({ event: 'complete', data: { status: 'completed' } });
  const decoder = new SseFrameDecoder();
  const [frame] = decoder.push(encoded);
  assertEqual(parseNormalizedTtsSseFrame(frame), { event: 'complete', data: { status: 'completed' } }, 'round-trip failed');
});

// ── RTM protocol ──────────────────────────────────────────────────────────────────────────

check('round-trips every room message', () => {
  const messages = [
    { t: 'hello' as const, name: 'Zico' },
    { t: 'floor.request' as const, name: 'Zico' },
    { t: 'floor.grant' as const, uid: '1234', name: 'Zico' },
    { t: 'floor.deny' as const, uid: '1234', reason: 'Someone else has the floor.' },
    { t: 'floor.transcript' as const, text: 'What did the logbook actually say?', final: true },
    { t: 'floor.release' as const },
    {
      t: 'question' as const,
      id: 'listener-123',
      question: 'Why?',
      askerName: 'Zico',
      afterSegmentIndex: 0,
      afterTurnIndex: 1,
    },
    {
      t: 'answer' as const,
      id: 'listener-123',
      question: 'Why?',
      askerName: 'Zico',
      afterSegmentIndex: 0,
      afterTurnIndex: 1,
      turns: [{ hostId: 'host-a' as const, text: 'Because.' }],
    },
  ];
  for (const message of messages) {
    assertEqual(decodeRoomMessage(encodeRoomMessage(message)), message, `round-trip failed for ${message.t}`);
  }
});

check('renders an interruption directly after the turn where it happened', () => {
  const markup = renderToStaticMarkup(createElement(TranscriptRail, {
    episode: validEpisode,
    position: { segmentIndex: 0, turnIndex: 2 },
    answers: [{
      id: 'listener-123',
      question: 'What did the logbook actually say?',
      askerName: 'Zico',
      turns: [{ hostId: 'host-a', text: 'Zico, you are asking what the surviving record says.' }],
      afterSegmentIndex: 0,
      afterTurnIndex: 0,
      status: 'answered',
    }],
    live: false,
  }));
  const firstTurn = markup.indexOf('This is turn number 1');
  const question = markup.indexOf('What did the logbook actually say?');
  const secondTurn = markup.indexOf('This is turn number 2');
  assert(firstTurn >= 0 && question > firstTurn && secondTurn > question,
    'the listener question was not inserted between the interrupted turn and the next turn');
});

check('requires the first spoken answer to name the listener and restate their question', () => {
  const payload = buildAnswerPayload({
    source: 'The surviving logbook records a final ordinary meal and no explanation.',
    title: validEpisode.title,
    summary: validEpisode.summary,
    hosts,
    recentTurns: validEpisode.segments[0].turns.slice(0, 1),
    question: 'What did the logbook actually say?',
    askerName: 'Zico',
  }) as PayloadProbe;
  const userPrompt = payload.contents[0].parts[0].text as string;
  assert(userPrompt.includes('A listener named Zico asked'), 'the listener identity is missing from the answer request');
  assert(userPrompt.includes('What did the logbook actually say?'), 'the submitted question is missing from the answer request');
  assert(ANSWER_SYSTEM_INSTRUCTION.includes('restate or tightly paraphrase'),
    'the answer does not require an audible confirmation of the listener question');
});

check('rejects malformed and hostile room messages', () => {
  const hostile = [
    'not json',
    '{}',
    '{"t":"nope"}',
    '{"t":"state"}',
    '{"t":"state","state":{"phase":"not-a-phase","segmentIndex":0,"turnIndex":0}}',
    '{"t":"floor.grant"}',
    '{"t":"answer","question":"q","turns":[{"hostId":"host-z","text":"x"}]}',
    '{"t":"episode.chunk","id":"a","index":5,"total":2,"data":"x"}',
    `{"t":"hello","name":"${'x'.repeat(200)}"}`,
  ];
  for (const raw of hostile) {
    const decoded = decodeRoomMessage(raw);
    if (raw.includes('"hello"')) {
      // Over-long names are clamped rather than rejected.
      assert(decoded?.t === 'hello' && decoded.name.length <= 24, 'display name was not clamped');
    } else {
      assertEqual(decoded, null, `accepted hostile payload: ${raw.slice(0, 60)}`);
    }
  }
});

check('chunks and reassembles an episode', () => {
  const chunks = chunkEpisode(validEpisode);
  assert(chunks.length >= 1, 'no chunks produced');
  const assembler = new EpisodeAssembler();
  let assembled: Episode | null = null;
  for (const chunk of chunks) {
    assembled = assembler.accept(chunk as Extract<typeof chunk, { t: 'episode.chunk' }>);
  }
  assertEqual(assembled?.id, validEpisode.id, 'reassembled episode lost its id');
  assertEqual(assembled?.segments.length, validEpisode.segments.length, 'reassembled episode lost segments');
});

check('reassembly survives out-of-order chunks', () => {
  const chunks = chunkEpisode(validEpisode).reverse();
  const assembler = new EpisodeAssembler();
  let assembled: Episode | null = null;
  for (const chunk of chunks) {
    assembled = assembler.accept(chunk as Extract<typeof chunk, { t: 'episode.chunk' }>);
  }
  assertEqual(assembled?.title, validEpisode.title, 'out-of-order reassembly failed');
});

// ── Turn boundaries ───────────────────────────────────────────────────────────────────────

check('turn boundaries are contiguous and ordered', () => {
  const boundaries = turnBoundaries(segmentTurns, 48_000);
  assertEqual(boundaries.length, segmentTurns.length, 'boundary count mismatch');
  assertEqual(boundaries[0].startSample, 0, 'first turn must start at zero');
  for (let index = 1; index < boundaries.length; index += 1) {
    assertEqual(boundaries[index].startSample, boundaries[index - 1].endSample, `gap before turn ${index}`);
  }
});

check('turn boundaries rescale onto real audio length', () => {
  const actualSamples = 48_000 * 37;
  const boundaries = turnBoundaries(segmentTurns, 48_000, actualSamples);
  const last = boundaries[boundaries.length - 1].endSample;
  assert(Math.abs(last - actualSamples) <= 2, `boundaries end at ${last}, expected ~${actualSamples}`);
});

check('longer turns get proportionally more time', () => {
  const [short, long] = turnBoundaries(
    [
      { hostId: 'host-a', text: 'Short turn here.' },
      { hostId: 'host-b', text: 'A turn that is quite a lot longer than the first one by design.' },
    ],
    48_000,
  );
  assert(
    long.endSample - long.startSample > short.endSample - short.startSample,
    'longer text did not get a longer span',
  );
});

// ── Route contracts ───────────────────────────────────────────────────────────────────────

await checkAsync('the streaming route validates before calling upstream', async () => {
  let called = false;
  const handler = createTtsStreamHandler({
    fetchGoogle: async () => {
      called = true;
      return new Response('', { status: 200 });
    },
  });
  const response = await handler(jsonRequest('http://localhost/api/tts/stream', { hosts: [hosts[0]], turns: segmentTurns }));
  assertEqual(response.status, 400, 'expected 400');
  assert(!called, 'called upstream with an invalid request');
});

await checkAsync('the streaming route proxies a normalized SSE stream with no-store headers', async () => {
  const upstreamBody = [
    `data: ${JSON.stringify({ event_type: 'interaction.created', interaction: { id: 'i1', model: 'test-conversation-tts' } })}\n\n`,
    `data: ${JSON.stringify({ event_type: 'step.delta', delta: { type: 'audio', data: 'AAAA', mime_type: 'audio/l16', sample_rate: 24000, channels: 1 } })}\n\n`,
    `data: ${JSON.stringify({ event_type: 'interaction.completed', interaction: { status: 'completed' } })}\n\n`,
  ].join('');

  const handler = createTtsStreamHandler({
    fetchGoogle: async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body));
      assertEqual(body.stream, true, 'upstream request must set stream');
      assertEqual(body.model, 'test-conversation-tts', 'upstream model mismatch');
      return new Response(upstreamBody, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    },
  });

  const response = await handler(jsonRequest('http://localhost/api/tts/stream', { hosts, turns: segmentTurns }));
  assertEqual(response.status, 200, 'expected 200');
  assertEqual(response.headers.get('cache-control'), 'no-store, no-transform', 'missing no-store');
  assert(
    response.headers.get('content-type')?.startsWith('text/event-stream'),
    'response is not an event stream',
  );

  const text = await response.text();
  const decoder = new SseFrameDecoder();
  const events = decoder.push(text).concat(decoder.finish())
    .map((frame) => parseNormalizedTtsSseFrame(frame)?.event)
    .filter(Boolean);
  assertEqual(events, ['meta', 'audio', 'complete'], 'normalized event sequence mismatch');
});

await checkAsync('repeating a TTS request still calls Gemini each time', async () => {
  let upstreamCalls = 0;
  const handler = createTtsStreamHandler({
    fetchGoogle: async () => {
      upstreamCalls += 1;
      return new Response('data: {"event_type":"interaction.completed","interaction":{"status":"completed"}}\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    },
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await handler(jsonRequest('http://localhost/api/tts/stream', { hosts, turns: segmentTurns }));
    assertEqual(response.status, 200, 'TTS request failed');
    await response.text();
  }
  assertEqual(upstreamCalls, 2, 'a repeated TTS request was served from a preset or cache');
});

await checkAsync('provider errors never leak the API key', async () => {
  const handler = createTtsStreamHandler({
    fetchGoogle: async () => new Response(
      JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: `key ${process.env.GEMINI_API_KEY} is not allowed` } }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    ),
  });
  const response = await handler(jsonRequest('http://localhost/api/tts/stream', { hosts, turns: segmentTurns }));
  const body = await response.text();
  assert(!body.includes(process.env.GEMINI_API_KEY!), 'the API key leaked into the response body');
  assertEqual(response.status, 502, 'expected 502 for a permission failure');
});

await checkAsync('the episode route rejects a one-character topic', async () => {
  const handler = createEpisodeHandler({
    fetchGoogle: async () => {
      throw new Error('upstream must not be called for invalid input');
    },
  });
  const response = await handler(jsonRequest('http://localhost/api/episode', { source: 'x' }));
  assertEqual(response.status, 400, 'expected 400');
});

await checkAsync('the episode route accepts a concise topic brief', async () => {
  const handler = createEpisodeHandler({
    fetchGoogle: async () => new Response(
      JSON.stringify({
        candidates: [{
          finishReason: 'STOP',
          content: { parts: [{ text: JSON.stringify({
            title: 'AI tutors',
            summary: 'A conversation about how AI tutors may change learning.',
            hosts: [{ id: 'host-a', name: 'Ada', role: 'Host' }, { id: 'host-b', name: 'Miles', role: 'Co-host' }],
            segments: [
              { topic: 'Promise', turns: segmentTurns },
              { topic: 'Trade-offs', turns: segmentTurns },
            ],
          }) }] },
        }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  });
  const response = await handler(jsonRequest('http://localhost/api/episode', { source: 'AI tutors' }));
  assertEqual(response.status, 200, 'a short topic brief was rejected');
});

check('the landing keeps Open a studio active before a name is entered', () => {
  const markup = renderToStaticMarkup(createElement(RoomLanding, { onEnter: () => undefined }));
  assert(!markup.includes('disabled=""'), 'the primary studio button rendered disabled');
  assert(!markup.includes('Enter your name to open a studio.'), 'the name error appeared before the user tried to enter');
});

check('the composer offers a topic example without a prerecorded sample action', () => {
  const markup = renderToStaticMarkup(createElement(EpisodeComposer, {
    busy: false,
    onCreate: () => undefined,
  }));
  assert(markup.includes('The next generation of broadcast'), 'the topic example is missing');
  assert(markup.includes('type="button"'), 'the example must be a button that fills the editor');
  assert(!markup.includes('Play studio sample'), 'the composer still advertises prerecorded playback');
});

check('the landing exposes an accessible How it works control without opening the dialog by default', () => {
  const markup = renderToStaticMarkup(createElement(RoomLanding, { onEnter: () => undefined }));
  assert(markup.includes('aria-haspopup="dialog"'), 'the How it works control is not identified as a dialog trigger');
  assert(markup.includes('How it works'), 'the How it works control is missing');
  assert(!markup.includes('role="dialog"'), 'the technical explainer dialog rendered open by default');
});

check('the landing uses Gemini product names without exposing an API route ID', () => {
  const markup = renderToStaticMarkup(createElement(RoomLanding, { onEnter: () => undefined }));
  assert(markup.includes('Gemini 3.8 Flash'), 'the current script model name is missing');
  assert(markup.includes('Gemini 3.8 Flash TTS'), 'the public TTS product name is missing');
  assert(!markup.includes('test-conversation-tts'), 'the TTS route ID leaked into the landing page');
});

await checkAsync('the episode route rejects model output that breaks the schema', async () => {
  const handler = createEpisodeHandler({
    fetchGoogle: async () => new Response(
      JSON.stringify({
        candidates: [{
          finishReason: 'STOP',
          // One segment, which is below the minimum.
          content: { parts: [{ text: JSON.stringify({ title: 'T', summary: 'S', hosts: [{ id: 'host-a', name: 'A', role: 'Host' }, { id: 'host-b', name: 'B', role: 'Co-host' }], segments: [{ topic: 'One', turns: segmentTurns }] }) }] },
        }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  });
  const response = await handler(jsonRequest('http://localhost/api/episode', { source: 'x'.repeat(500) }));
  assertEqual(response.status, 502, 'expected 502 for unusable model output');
});

await checkAsync('the episode route fixes names and voices despite model-supplied identities', async () => {
  const handler = createEpisodeHandler({
    fetchGoogle: async () => new Response(
      JSON.stringify({
        candidates: [{
          finishReason: 'STOP',
          content: { parts: [{ text: JSON.stringify({
            title: 'Title',
            summary: 'Summary',
            // The model swaps the intended names and picks an unverified voice; both are ignored.
            hosts: [{ id: 'host-a', name: 'Elena', role: 'Host', voice: 'Sulafat' }, { id: 'host-b', name: 'Marcus', role: 'Co-host', voice: 'Sulafat' }],
            segments: [
              { topic: 'One', turns: segmentTurns },
              { topic: 'Two', turns: segmentTurns },
            ],
          }) }] },
        }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  });
  const response = await handler(jsonRequest('http://localhost/api/episode', { source: 'x'.repeat(500) }));
  assertEqual(response.status, 200, 'expected 200');
  const payload = await response.json();
  assertEqual(
    payload.episode.hosts.map((host: { voice: string }) => host.voice),
    ['Puck', 'Kore'],
    'server-side voice assignment was not applied',
  );
  assertEqual(
    payload.episode.hosts.map((host: { name: string }) => host.name),
    ['Marcus', 'Elena'],
    'model-supplied names were not replaced with the fixed male/female hosts',
  );
  assertEqual(payload.episode.segments[0].turns[0].text, segmentTurns[0].text,
    'the server replaced model-authored opening dialogue');
  assertEqual(payload.episode.segments[1].turns.at(-1).text, segmentTurns.at(-1)?.text,
    'the server replaced model-authored closing dialogue');
  assertEqual(response.headers.get('cache-control'), 'no-store', 'missing no-store');
});

await checkAsync('the episode route rejects a voice override that would swap host identities', async () => {
  const handler = createEpisodeHandler({
    fetchGoogle: async () => { throw new Error('voice override must be rejected before calling Gemini'); },
  });
  const response = await handler(jsonRequest('http://localhost/api/episode', {
    source: 'A topic with enough detail',
    voices: ['Kore', 'Puck'],
  }));
  assertEqual(response.status, 400, 'a caller could reverse the fixed voice-to-host pairing');
});

await checkAsync('repeating a topic still asks Gemini for a new script', async () => {
  let upstreamCalls = 0;
  const handler = createEpisodeHandler({
    fetchGoogle: async () => {
      upstreamCalls += 1;
      return new Response(JSON.stringify({ candidates: [{
        finishReason: 'STOP',
        content: { parts: [{ text: JSON.stringify({
          title: `Generated ${upstreamCalls}`,
          summary: 'A live-generated conversation.',
          hosts: [{ id: 'host-a', name: 'Ada', role: 'Host' }, { id: 'host-b', name: 'Miles', role: 'Co-host' }],
          segments: [
            { topic: 'First', turns: segmentTurns },
            { topic: 'Second', turns: segmentTurns },
          ],
        }) }] },
      }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const response = await handler(jsonRequest('http://localhost/api/episode', { source: 'A topic with enough detail' }));
    assertEqual(response.status, 200, 'episode request failed');
    const payload = await response.json();
    assertEqual(payload.episode.title, `Generated ${attempt}`, 'a repeated topic reused a script');
  }
  assertEqual(upstreamCalls, 2, 'a repeated topic skipped Gemini');
});

// ── Agora token inputs ────────────────────────────────────────────────────────────────────

check('channel names are validated', () => {
  assertEqual(parseChannelName('room-abc123'), 'room-abc123', 'rejected a valid room code');
  assertEqual(parseChannelName('bad channel!'), null, 'accepted an invalid channel');
  assertEqual(parseChannelName('ab'), null, 'accepted a too-short channel');
  assert(parseChannelName(null)?.startsWith('room-'), 'did not generate a fallback room code');
});

await checkAsync('the Agora token route issues an RTC+RTM token', async () => {
  const response = await createAgoraTokenHandler()(
    new NextRequest('http://localhost/api/agora-token?channel=room-abc123&uid=4242'),
  );
  assertEqual(response.status, 200, 'expected 200');
  assertEqual(response.headers.get('cache-control'), 'no-store', 'missing no-store');
  const payload = await response.json();
  assertEqual(payload.channel, 'room-abc123', 'channel mismatch');
  assertEqual(payload.uid, '4242', 'uid mismatch');
  // AccessToken2 is the "007" format; buildTokenWithRtm must not silently fall back.
  assert(
    typeof payload.token === 'string' && payload.token.startsWith('007') && payload.token.length > 80,
    'token is not a well-formed AccessToken2',
  );
});

await checkAsync('the Agora token route rejects a malformed channel', async () => {
  const response = await createAgoraTokenHandler()(
    new NextRequest('http://localhost/api/agora-token?channel=not%20a%20channel'),
  );
  assertEqual(response.status, 400, 'expected 400');
});

check('uids are validated', () => {
  assertEqual(parseUid('4242'), 4242, 'rejected a valid uid');
  assertEqual(parseUid('0'), null, 'accepted zero');
  assertEqual(parseUid('-5'), null, 'accepted a negative uid');
  assertEqual(parseUid('not-a-number'), null, 'accepted a non-numeric uid');
  assert(typeof parseUid(null) === 'number', 'did not generate a fallback uid');
});

// ── Shareable room links ──────────────────────────────────────────────────────────────────

check('generated room codes are valid channels', () => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const code = createRoomCode();
    assert(isRoomChannel(code), `generated an invalid room code: ${code}`);
    assert(code.startsWith('room-'), `room code lost its prefix: ${code}`);
  }
});

check('room codes avoid look-alike characters', () => {
  // A room code gets read out loud and retyped; l/1 and O/0 confusion costs a listener.
  const body = createRoomCode().slice('room-'.length);
  assert(!/[lo01iu]/.test(body), `room code contains an ambiguous character: ${body}`);
});

check('an invite link round-trips through a URL', () => {
  const code = createRoomCode();
  const url = new URL(`https://example.com/?room=${encodeURIComponent(code)}`);
  const invited = url.searchParams.get('room');
  assert(invited === code && isRoomChannel(invited), 'invite link did not round-trip');
});

check('a hostile room parameter is rejected', () => {
  for (const hostile of ['../../etc', 'a', '', 'room with spaces', 'x'.repeat(200), '<script>']) {
    assert(!isRoomChannel(hostile), `accepted a hostile room parameter: ${hostile}`);
  }
});

// ── Concurrency guard ─────────────────────────────────────────────────────────────────────

await checkAsync('concurrent callers share one in-flight attempt', async () => {
  // This is the guard that stops a re-rendering effect from opening dozens of microphones.
  const flight = createSingleFlight<number>();
  let started = 0;
  const operation = async () => {
    started += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return started;
  };

  const results = await Promise.all(Array.from({ length: 25 }, () => flight.run(operation)));
  assertEqual(started, 1, 'the operation ran more than once');
  assert(results.every((value) => value === 1), 'callers received different results');
});

await checkAsync('a settled attempt does not block the next one', async () => {
  const flight = createSingleFlight<number>();
  let runs = 0;
  const operation = async () => {
    runs += 1;
    return runs;
  };
  assertEqual(await flight.run(operation), 1, 'first run mismatch');
  assertEqual(await flight.run(operation), 2, 'second run was incorrectly deduplicated');
  assertEqual(flight.inFlight, false, 'flight did not clear after settling');
});

await checkAsync('a failed attempt clears so a retry is possible', async () => {
  const flight = createSingleFlight<number>();
  let attempts = 0;
  const operation = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('microphone denied');
    return attempts;
  };
  await flight.run(operation).then(
    () => { throw new Error('the first attempt should have rejected'); },
    () => undefined,
  );
  assertEqual(flight.inFlight, false, 'a rejected attempt stayed in flight');
  assertEqual(await flight.run(operation), 2, 'retry after failure did not run');
});

// ── Report ────────────────────────────────────────────────────────────────────────────────

if (failures.length) {
  console.error(`\n✗ ${failures.length} contract check(s) failed (${passed} passed):\n`);
  for (const failure of failures) console.error(`  • ${failure}\n`);
  process.exit(1);
}

console.log(`✓ ${passed} contract checks passed.`);
