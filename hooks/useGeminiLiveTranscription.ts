'use client';

import { GoogleGenAI, Modality, type LiveConnectConfig, type Session } from '@google/genai';
import { useEffect, useRef, useState } from 'react';
import {
  LIVE_CONNECT_TIMEOUT_MS,
  LIVE_TRANSCRIPTION_API_VERSION,
} from '@/lib/live-transcription-config';
import type { LiveTranscriptionTokenResponse, TranscriptionError } from '@/types/transcription';

export type AsrStatus = 'idle' | 'connecting' | 'live' | 'error';

type UseGeminiLiveTranscriptionOptions = {
  enabled: boolean;
  /** The floor holder's microphone track, taken from the published Agora track. */
  mediaStreamTrack: MediaStreamTrack | null;
  onInterimTranscript?: (text: string) => void;
  onFinalTranscript: (text: string) => Promise<void> | void;
  onSpeechStart?: () => void;
};

function pcmToBase64(pcm: Int16Array) {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 1_024) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 1_024));
  }
  return window.btoa(binary);
}

function mergeFinalTranscript(current: string, nextValue: string) {
  const next = nextValue.trim();
  if (!next) return current;
  if (!current) return next;
  if (current === next || current.endsWith(next)) return current;
  if (next.startsWith(current)) return next;
  return `${current.trimEnd()} ${next}`;
}

/**
 * Streams the floor holder's microphone to Gemini Live for transcription only.
 *
 * The browser never sees the server API key: `/api/transcribe-token` mints a one-use,
 * model-constrained ephemeral credential per session. Audio goes to Gemini for ASR and to
 * the room over Agora; it is never monitored back through local speakers.
 */
export function useGeminiLiveTranscription({
  enabled,
  mediaStreamTrack,
  onInterimTranscript,
  onFinalTranscript,
  onSpeechStart,
}: UseGeminiLiveTranscriptionOptions) {
  const [status, setStatus] = useState<AsrStatus>('idle');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const finalRef = useRef(onFinalTranscript);
  const interimRef = useRef(onInterimTranscript);
  const speechStartRef = useRef(onSpeechStart);
  const sessionRef = useRef<Session | null>(null);

  useEffect(() => {
    finalRef.current = onFinalTranscript;
    interimRef.current = onInterimTranscript;
    speechStartRef.current = onSpeechStart;
  }, [onFinalTranscript, onInterimTranscript, onSpeechStart]);

  // Establish the expensive token + Gemini Live connection as soon as the listener asks
  // for the floor. The microphone track arrives later, after the host grants it; keeping
  // these lifecycles separate removes provider setup time from the on-mic experience.
  useEffect(() => {
    if (!enabled) {
      setStatus('idle');
      setInterimTranscript('');
      setAudioLevel(0);
      return;
    }

    let active = true;
    let session: Session | null = null;
    let connected = false;
    let flushTimer: number | null = null;
    let pendingFinal = '';
    let utteranceActive = false;
    const connectAbort = new AbortController();
    let connectTimer: number | null = null;
    let rejectConnect: (error: Error) => void = () => undefined;

    const reportError = (message: string) => {
      if (!active) return;
      sessionRef.current = null;
      setError(message);
      setStatus('error');
    };

    const flushFinal = () => {
      if (flushTimer !== null) {
        window.clearTimeout(flushTimer);
        flushTimer = null;
      }
      const text = pendingFinal.trim();
      pendingFinal = '';
      utteranceActive = false;
      if (!text || !active) return;
      void Promise.resolve(finalRef.current(text)).catch(() => undefined);
    };

    const start = async () => {
      setStatus('connecting');
      setError(null);
      setInterimTranscript('');

      try {
        const tokenResponse = await fetch('/api/transcribe-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ languageCode: 'auto' }),
        });
        const tokenPayload = (await tokenResponse.json()) as
          | LiveTranscriptionTokenResponse
          | TranscriptionError;
        if (!tokenResponse.ok || 'error' in tokenPayload) {
          const details = 'details' in tokenPayload ? tokenPayload.details : undefined;
          throw new Error(
            details || ('error' in tokenPayload ? tokenPayload.error : 'Could not start transcription.'),
          );
        }
        if (!active) return;

        const config: LiveConnectConfig = {
          responseModalities: [Modality.TEXT],
          inputAudioTranscription: {},
          abortSignal: connectAbort.signal,
        };

        const connectFailure = new Promise<never>((_, reject) => {
          rejectConnect = reject;
        });

        const liveClient = new GoogleGenAI({
          apiKey: tokenPayload.token,
          apiVersion: LIVE_TRANSCRIPTION_API_VERSION,
        });
        connectTimer = window.setTimeout(() => {
          connectAbort.abort();
          rejectConnect(new Error('Live transcription could not connect. Check your network and try again.'));
        }, LIVE_CONNECT_TIMEOUT_MS);
        session = await Promise.race([
          liveClient.live.connect({
            model: tokenPayload.model,
            config,
            callbacks: {
              onmessage: (message) => {
                if (!active) return;

                const interim = message.serverContent?.interimInputTranscription?.text?.trim();
                if (interim) {
                  setInterimTranscript(interim);
                  interimRef.current?.(interim);
                  if (!utteranceActive) {
                    utteranceActive = true;
                    speechStartRef.current?.();
                  }
                }

                const final = message.serverContent?.inputTranscription?.text?.trim();
                if (final) {
                  pendingFinal = mergeFinalTranscript(pendingFinal, final);
                  setInterimTranscript('');
                  if (flushTimer !== null) window.clearTimeout(flushTimer);
                  // Coalesce adjacent final fragments into one question.
                  flushTimer = window.setTimeout(flushFinal, 220);
                }
              },
              onerror: (event) => {
                const sessionError = new Error(event.message || 'The transcription connection failed.');
                rejectConnect(sessionError);
                if (connected) reportError(sessionError.message);
              },
              onclose: () => {
                if (!connected) {
                  rejectConnect(new Error('The transcription connection closed before it started.'));
                } else if (active) {
                  reportError('The transcription connection closed.');
                }
              },
            },
          }),
          connectFailure,
        ]);
        if (connectTimer !== null) {
          window.clearTimeout(connectTimer);
          connectTimer = null;
        }
        if (!active) {
          session.close();
          return;
        }
        connected = true;
        sessionRef.current = session;
        setStatus('live');
      } catch (startError) {
        reportError(
          startError instanceof Error ? startError.message : 'Transcription could not start.',
        );
      }
    };

    void start();

    return () => {
      active = false;
      connectAbort.abort();
      if (connectTimer !== null) window.clearTimeout(connectTimer);
      if (flushTimer !== null) window.clearTimeout(flushTimer);
      if (session) {
        try {
          session.sendRealtimeInput({ audioStreamEnd: true });
        } catch {
          // The session may already be closed; nothing to recover here.
        }
        session.close();
      }
      if (sessionRef.current === session) sessionRef.current = null;
      setAudioLevel(0);
    };
  }, [enabled]);

  // Attach microphone audio only after both independent prerequisites are ready. A change
  // in the MediaStreamTrack no longer tears down and recreates the Gemini Live session.
  useEffect(() => {
    const session = sessionRef.current;
    if (!enabled || status !== 'live' || !mediaStreamTrack || !session) return;

    let active = true;
    let lastLevelUpdate = 0;
    const audioContext = new AudioContext({ sampleRate: 16_000 });
    const source = audioContext.createMediaStreamSource(new MediaStream([mediaStreamTrack]));
    const processor = audioContext.createScriptProcessor(1_024, 1, 1);
    const silentGain = audioContext.createGain();
    silentGain.gain.value = 0;

    processor.onaudioprocess = (event) => {
      if (!active || sessionRef.current !== session) return;
      const floats = event.inputBuffer.getChannelData(0);
      const pcm = new Int16Array(floats.length);
      let sumSquares = 0;
      for (let index = 0; index < floats.length; index += 1) {
        const sample = Math.max(-1, Math.min(1, floats[index]));
        pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        sumSquares += sample * sample;
      }
      try {
        session.sendRealtimeInput({
          audio: {
            data: pcmToBase64(pcm),
            mimeType: `audio/pcm;rate=${audioContext.sampleRate}`,
          },
        });
      } catch {
        setError('The microphone stream could not be sent for transcription.');
        setStatus('error');
      }
      const now = performance.now();
      if (now - lastLevelUpdate >= 50) {
        lastLevelUpdate = now;
        setAudioLevel(Math.min(1, Math.sqrt(sumSquares / floats.length) * 4));
      }
    };

    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(audioContext.destination);
    void audioContext.resume().catch(() => {
      if (!active) return;
      setError('The browser could not start microphone processing.');
      setStatus('error');
    });

    return () => {
      active = false;
      processor.onaudioprocess = null;
      processor.disconnect();
      source.disconnect();
      silentGain.disconnect();
      void audioContext.close().catch(() => undefined);
      setAudioLevel(0);
    };
  }, [enabled, mediaStreamTrack, status]);

  return { status, interimTranscript, audioLevel, error };
}
