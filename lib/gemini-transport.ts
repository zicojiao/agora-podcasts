import { NextResponse } from 'next/server';

export type GeminiFetch = typeof fetch;

export const INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
export const GENERATE_CONTENT_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export type GeminiOperation = 'speech' | 'script' | 'answer';

export class GeminiProviderError extends Error {
  constructor(
    public status: number,
    public providerCode?: string,
    public providerMessage?: string,
  ) {
    super('Gemini request failed');
  }
}

function safeProviderText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return undefined;
  const sanitized = value
    .replace(/AIza[\w-]+/g, '[redacted API key]')
    .replace(/[A-Za-z0-9+/_=-]{80,}/g, '[redacted token]')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized ? sanitized.slice(0, maxLength) : undefined;
}

async function providerError(response: Response) {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    await response.body?.cancel();
  }
  const error = body && typeof body === 'object' && 'error' in body ? (body as { error?: unknown }).error : body;
  const details = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  return new GeminiProviderError(
    response.status,
    safeProviderText(details.status, 80),
    safeProviderText(details.message, 500),
  );
}

export function apiError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Maps a provider failure onto a caller-safe message. Provider bodies can echo request
 * content and key fragments, so nothing from upstream reaches the browser verbatim.
 */
export function providerFailure(error: unknown, signal: AbortSignal, operation: GeminiOperation) {
  const diagnostic = error instanceof GeminiProviderError
    ? { operation, providerStatus: error.status, providerCode: error.providerCode }
    : { operation, error: safeProviderText(error instanceof Error ? error.message : String(error), 300) };
  console.error('[gemini] request failed', diagnostic);

  if (signal.aborted) return apiError('The request was cancelled or timed out. Please try again.', 504);
  const status = error instanceof GeminiProviderError ? error.status : undefined;

  if (status === 429) return apiError('Gemini quota exceeded. Wait a moment and try again.', 429);
  if (status === 401 || status === 403 || status === 404) {
    return operation === 'speech'
      ? apiError('Gemini 3.8 Flash TTS access failed. Check the server key and model entitlement.', 502)
      : apiError('Gemini text model access failed. Check GEMINI_API_KEY and GEMINI_TEXT_MODEL.', 502);
  }
  if (status === 400) {
    return operation === 'speech'
      ? apiError('Google rejected the conversation. Check both hosts, voices, styles, and dialogue text.', 422)
      : apiError('Google rejected the writing request. Try a shorter or cleaner source text.', 422);
  }
  return operation === 'speech'
    ? apiError('Gemini did not return complete, supported conversation audio. Please try again.', 502)
    : apiError('Gemini did not return a usable script. Please try again.', 502);
}

/**
 * Raw REST, deliberately — not the public SDK.
 *
 * Keep the documented multi-speaker Interactions payload explicit here. This app normalizes
 * the upstream SSE audio response for its browser AudioWorklet pipeline.
 */
async function postInteractions(
  body: unknown,
  apiKey: string,
  signal: AbortSignal,
  fetchGoogle: GeminiFetch = fetch,
): Promise<Response> {
  signal.throwIfAborted();
  const response = await fetchGoogle(INTERACTIONS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
    signal,
    cache: 'no-store',
  });
  if (!response.ok) throw await providerError(response);
  return response;
}

export function postInteractionStream(
  body: unknown,
  apiKey: string,
  signal: AbortSignal,
  fetchGoogle: GeminiFetch = fetch,
) {
  return postInteractions(body, apiKey, signal, fetchGoogle);
}

export async function postInteraction(
  body: unknown,
  apiKey: string,
  signal: AbortSignal,
  fetchGoogle: GeminiFetch = fetch,
): Promise<unknown> {
  return (await postInteractions(body, apiKey, signal, fetchGoogle)).json();
}

export async function postGenerateContent(
  model: string,
  body: unknown,
  apiKey: string,
  signal: AbortSignal,
  fetchGoogle: GeminiFetch = fetch,
): Promise<unknown> {
  signal.throwIfAborted();
  const response = await fetchGoogle(`${GENERATE_CONTENT_BASE}/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
    signal,
    cache: 'no-store',
  });
  if (!response.ok) throw await providerError(response);
  return response.json();
}

const MODEL_ID = /^[a-z0-9][a-z0-9._-]*$/i;

export function getTtsModelId(env: Record<string, string | undefined> = process.env) {
  const value = env.GEMINI_TTS_MODEL?.trim() || 'gemini-3.8-flash-tts';
  if (!MODEL_ID.test(value)) throw new Error('Invalid GEMINI_TTS_MODEL');
  return value;
}

export function getTextModelId(env: Record<string, string | undefined> = process.env) {
  const value = env.GEMINI_TEXT_MODEL?.trim() || 'gemini-3.8-flash';
  if (!MODEL_ID.test(value)) throw new Error('Invalid GEMINI_TEXT_MODEL');
  return value;
}

/** Pulls the first JSON object out of a generateContent response. */
export function generateContentJson(value: unknown): unknown {
  const response = value as {
    candidates?: Array<{
      finishReason?: string;
      content?: { parts?: Array<{ thought?: boolean; text?: string }> };
    }>;
  };
  const candidate = response.candidates?.[0];
  if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
    // MAX_TOKENS is the one worth naming: on thinking models the budget is shared with
    // reasoning, so it means "raise maxOutputTokens", not "the source was too long".
    throw new Error(
      candidate.finishReason === 'MAX_TOKENS'
        ? 'The text model ran out of output budget before finishing. Raise maxOutputTokens or lower thinkingBudget.'
        : `Generation stopped early: ${candidate.finishReason}`,
    );
  }
  const text = candidate?.content?.parts
    ?.filter((part) => !part.thought && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
    .trim();
  if (!text) throw new Error('The text model returned no content.');

  // responseMimeType pins JSON, but a stray code fence is cheap to tolerate.
  const unfenced = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(unfenced);
  } catch {
    throw new Error('The text model did not return valid JSON.');
  }
}
