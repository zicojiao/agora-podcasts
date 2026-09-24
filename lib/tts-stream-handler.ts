import { NextRequest } from 'next/server';
import {
  apiError,
  getTtsModelId,
  postInteractionStream,
  providerFailure,
  type GeminiFetch,
} from '@/lib/gemini-transport';
import { buildSpeechPayload, parseSpeechRequest } from '@/lib/tts-payload';
import { normalizeTtsInteractionStream } from '@/lib/tts-sse';

// A ~90 second segment generates well inside this; the ceiling exists so a stalled upstream
// connection cannot hold a route handler open indefinitely.
const SPEECH_TIMEOUT_MS = 150_000;

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-store, no-transform',
  'X-Accel-Buffering': 'no',
  'X-Content-Type-Options': 'nosniff',
} as const;

export function createTtsStreamHandler({ fetchGoogle }: { fetchGoogle?: GeminiFetch } = {}) {
  return async function POST(request: NextRequest) {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) return apiError('Set GEMINI_API_KEY on the server to stream speech.', 503);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiError('Invalid JSON body', 400);
    }
    const parsed = parseSpeechRequest(body);
    if (typeof parsed === 'string') return apiError(parsed, 400);

    let model: string;
    try {
      model = getTtsModelId();
    } catch {
      return apiError('Set a valid GEMINI_TTS_MODEL on the server to stream speech.', 503);
    }
    const payload = buildSpeechPayload(parsed, model, true);

    // Aborting the browser fetch propagates here and cancels the upstream generation.
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(SPEECH_TIMEOUT_MS)]);

    try {
      const upstream = await postInteractionStream(payload, apiKey, signal, fetchGoogle);
      if (!upstream.body || !upstream.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) {
        throw new Error('Gemini did not return an SSE audio stream.');
      }
      const normalized = normalizeTtsInteractionStream(upstream.body);
      return new Response(normalized, {
        headers: SSE_HEADERS,
      });
    } catch (error) {
      return providerFailure(error, signal, 'speech');
    }
  };
}
