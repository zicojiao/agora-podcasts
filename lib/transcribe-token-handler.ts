import { GoogleGenAI, Modality, type LiveConnectConfig } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';
import {
  LIVE_TRANSCRIPTION_API_VERSION,
  LIVE_TRANSCRIPTION_MODEL,
} from '@/lib/live-transcription-config';
import type {
  LiveTranscriptionTokenRequest,
  LiveTranscriptionTokenResponse,
  TranscriptionError,
} from '@/types/transcription';

const SESSION_LIFETIME_MS = 30 * 60 * 1_000;
const NEW_SESSION_WINDOW_MS = 60 * 1_000;

type TokenConfiguration = {
  model: string;
  config: LiveConnectConfig;
  expireTime: string;
  newSessionExpireTime: string;
};

type IssueToken = (configuration: TokenConfiguration) => Promise<string>;

function normalizeLanguageCode(value: unknown) {
  if (value === undefined || value === 'auto') return undefined;
  if (typeof value !== 'string') return null;
  return /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(value) ? value : null;
}

function normalizeAdaptationPhrases(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  return value
    .filter((phrase): phrase is string => typeof phrase === 'string')
    .map((phrase) => phrase.trim())
    .filter(Boolean)
    .slice(0, 10)
    .map((phrase) => phrase.slice(0, 80));
}

function safeErrorDetails(error: unknown, apiKey: string) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(apiKey, '[redacted]').slice(0, 300);
}

/**
 * Mints a one-use, model-constrained ephemeral credential so the browser can open its own
 * Gemini Live session without ever holding the server API key.
 */
async function issueGoogleLiveToken(apiKey: string, configuration: TokenConfiguration) {
  const client = new GoogleGenAI({ apiKey, apiVersion: LIVE_TRANSCRIPTION_API_VERSION });
  const token = await client.authTokens.create({
    config: {
      uses: 1,
      expireTime: configuration.expireTime,
      newSessionExpireTime: configuration.newSessionExpireTime,
      liveConnectConstraints: { model: configuration.model, config: configuration.config },
      lockAdditionalFields: [],
    },
  });
  if (!token.name) throw new Error('The Gemini API did not return an ephemeral token.');
  return token.name;
}

export function createTranscribeTokenHandler({
  issueToken,
  now = Date.now,
}: { issueToken?: IssueToken; now?: () => number } = {}) {
  return async function POST(
    request: NextRequest,
  ): Promise<NextResponse<LiveTranscriptionTokenResponse | TranscriptionError>> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error: 'Live transcription is not configured',
          details: 'Set GEMINI_API_KEY in .env.local and restart the server.',
        },
        { status: 503 },
      );
    }

    let body: LiveTranscriptionTokenRequest;
    try {
      body = (await request.json()) as LiveTranscriptionTokenRequest;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const languageCode = normalizeLanguageCode(body.languageCode);
    if (languageCode === null) {
      return NextResponse.json({ error: 'Invalid language code' }, { status: 400 });
    }
    const adaptationPhrases = normalizeAdaptationPhrases(body.adaptationPhrases);
    if (adaptationPhrases === null) {
      return NextResponse.json({ error: 'Adaptation phrases must be an array' }, { status: 400 });
    }

    const config: LiveConnectConfig = {
      responseModalities: [Modality.TEXT],
      inputAudioTranscription: {
        // Omitting language codes is the current API's auto-detection mode. The old
        // languageAuto/languageHints fields are deprecated and can prevent a constrained
        // ephemeral-token setup from matching the browser's session configuration.
        languageCodes: languageCode ? [languageCode] : [],
        ...(adaptationPhrases.length > 0 ? { customVocabulary: adaptationPhrases } : {}),
      },
    };
    const issuedAt = now();
    const expireTime = new Date(issuedAt + SESSION_LIFETIME_MS).toISOString();
    const newSessionExpireTime = new Date(issuedAt + NEW_SESSION_WINDOW_MS).toISOString();

    try {
      const configuration = {
        model: LIVE_TRANSCRIPTION_MODEL,
        config,
        expireTime,
        newSessionExpireTime,
      };
      const token = issueToken
        ? await issueToken(configuration)
        : await issueGoogleLiveToken(apiKey, configuration);
      return NextResponse.json(
        { token, model: LIVE_TRANSCRIPTION_MODEL, expiresAt: expireTime },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    } catch (error) {
      console.error('Gemini ephemeral token creation failed:', safeErrorDetails(error, apiKey));
      return NextResponse.json(
        { error: 'Could not start live transcription', details: safeErrorDetails(error, apiKey) },
        { status: 502 },
      );
    }
  };
}
