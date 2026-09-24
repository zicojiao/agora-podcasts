'use client';

import { Loader2, Mic, MicOff, Radio, Send, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { QUESTION_MAX_LENGTH } from '@/lib/episode';
import { shouldPrepareLiveTranscription } from '@/lib/interruption-startup';
import type { RoomPhase } from '@/lib/room-messages';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useGeminiLiveTranscription } from '@/hooks/useGeminiLiveTranscription';

const RING_COUNT = 5;

function MicRings({ level, ready, live }: { level: number; ready: boolean; live: boolean }) {
  return (
    <div className="relative flex h-28 w-28 items-center justify-center">
      {Array.from({ length: RING_COUNT }, (_, index) => (
        <span
          key={index}
          className={cn(
            'absolute rounded-full border transition-all duration-150',
            live ? 'border-cue/50' : 'border-ink/15',
          )}
          style={{
            width: `${44 + index * 18 + (live ? level * 26 : 0)}px`,
            height: `${44 + index * 18 + (live ? level * 26 : 0)}px`,
            opacity: live ? 0.9 - index * 0.16 : 0.25,
          }}
        />
      ))}
      <span
        className={cn(
          'relative flex h-14 w-14 items-center justify-center rounded-full',
          ready ? 'border-2 border-ink bg-listener text-ink' : 'border-2 border-ink/20 bg-raised text-muted',
        )}
      >
        {ready ? <Mic className="h-6 w-6" /> : <MicOff className="h-6 w-6" />}
      </span>
    </div>
  );
}

export function JoinOverlay({
  phase,
  holdsFloor,
  requestingFloor,
  submitted,
  askerName,
  liveTranscript,
  micTrack,
  error,
  onTranscript,
  onReady,
  onSubmitted,
  onClose,
}: {
  phase: RoomPhase;
  holdsFloor: boolean;
  requestingFloor: boolean;
  submitted: boolean;
  askerName: string;
  liveTranscript: string;
  micTrack: MediaStreamTrack | null;
  error: string | null;
  onTranscript: (text: string, final: boolean) => void;
  onReady: () => void;
  onSubmitted: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [showFallback, setShowFallback] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const readyReportedRef = useRef(false);

  const prepareTranscription = shouldPrepareLiveTranscription({
    requestingFloor,
    holdsFloor,
    phase,
    submitted,
  });

  const asr = useGeminiLiveTranscription({
    enabled: prepareTranscription,
    mediaStreamTrack: holdsFloor ? micTrack : null,
    onInterimTranscript: (text) => {
      setTyped(text);
      onTranscript(text, false);
    },
    // Never send a recognised question straight to the hosts. A final ASR result becomes an
    // editable draft so the listener can correct it and explicitly confirm before it costs a
    // live Gemini answer and interrupts the whole room.
    onFinalTranscript: (text) => {
      setTyped(text);
      setAwaitingConfirmation(true);
    },
  });

  // Offer the typed fallback the moment speech recognition is unavailable, rather than
  // leaving the floor holder with a dead microphone.
  useEffect(() => {
    if (asr.status === 'error') setShowFallback(true);
  }, [asr.status]);

  useEffect(() => {
    if (!holdsFloor) {
      readyReportedRef.current = false;
      return;
    }
    if (!micTrack || asr.status !== 'live' || readyReportedRef.current) return;
    readyReportedRef.current = true;
    onReady();
  }, [asr.status, holdsFloor, micTrack, onReady]);

  useEffect(() => {
    if (!submitted && (!holdsFloor || phase !== 'listening')) {
      setAwaitingConfirmation(false);
      setShowFallback(false);
      setTyped('');
    }
  }, [holdsFloor, phase, submitted]);

  const submitTyped = () => {
    const text = typed.trim();
    if (!text) return;
    onSubmitted();
    setAwaitingConfirmation(false);
    onTranscript(text, true);
  };

  const transcript = typed || liveTranscript || asr.interimTranscript;
  const micReady = micTrack !== null;
  const micLive = asr.status === 'live' && micReady;
  const shouldReview = holdsFloor && phase === 'listening' && (showFallback || awaitingConfirmation);

  const heading = (() => {
    if (requestingFloor) return 'Joining the conversation…';
    if (submitted && phase === 'thinking') return 'The hosts are thinking';
    if (submitted && phase === 'answering') return 'The hosts are answering';
    if (submitted) return 'Back to the episode';
    if (!holdsFloor) return `${askerName} has the floor`;
    if (phase === 'thinking') return 'The hosts are thinking';
    if (phase === 'answering') return 'The hosts are answering';
    if (phase === 'resuming') return 'Back to the episode';
    if (awaitingConfirmation) return 'Review your question';
    if (!micReady) return 'Requesting microphone access…';
    if (asr.status === 'connecting') return 'Connecting live transcription…';
    if (micLive) return "You're on — ask your question";
    if (showFallback) return 'Type your question instead';
    return 'Taking the floor…';
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/55 px-5 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Ask the hosts"
        className="w-full max-w-lg rounded-[28px] border-2 border-ink bg-canvas p-7 shadow-card sm:p-9"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="chip border-cue/25 text-cue">
              <Radio className="h-3 w-3" /> Floor open
            </p>
            <h2 className="mt-4 display text-3xl leading-tight tracking-[-0.01em]">{heading}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close interruption dialog"
            className="focus-ring rounded-full border-2 border-ink bg-white p-2 text-muted transition hover:bg-listener hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {requestingFloor && (
          <div className="mt-7 flex items-center gap-3 text-base font-semibold text-muted">
            <Loader2 className="h-4 w-4 animate-spin text-cue" />
            Asking the host for the floor.
          </div>
        )}

        {holdsFloor && phase === 'listening' && !showFallback && (
          <div className="mt-7 flex flex-col items-center">
            <MicRings level={asr.audioLevel} ready={micReady} live={micLive} />
            <p className="mt-4 text-sm font-semibold text-muted">
              {micLive
                ? 'The room can hear you.'
                : micReady
                  ? 'Microphone ready. Connecting live transcription…'
                  : 'Requesting microphone access…'}
            </p>
          </div>
        )}

        {(phase === 'thinking' || phase === 'answering' || phase === 'resuming') && (
          <div className="mt-7 flex items-center gap-3 text-base font-semibold text-muted">
            {phase === 'thinking' && <Loader2 className="h-4 w-4 animate-spin text-cue" />}
            {phase === 'thinking'
              ? 'Writing an answer from the source material.'
              : phase === 'answering'
                ? 'Playing to everyone in the room.'
                : 'Resuming from the exact spot it paused.'}
          </div>
        )}

        {submitted && phase === 'playing' && (
          <p className="mt-7 text-base font-semibold leading-7 text-muted">
            Your question is in the transcript. The episode has resumed.
          </p>
        )}

        {transcript && !shouldReview && (
          <blockquote className="mt-6 rounded-2xl border-2 border-ink bg-white p-4 text-base leading-7 text-ink/90 shadow-card-sm">
            “{transcript}”
          </blockquote>
        )}

        {!holdsFloor && !transcript && phase === 'listening' && (
          <p className="mt-6 text-base leading-7 text-muted">
            {askerName} is asking the hosts a question. The episode is paused for everyone and
            will pick up exactly where it stopped.
          </p>
        )}

        {shouldReview && (
          <div className="mt-6">
            <label className="text-sm font-extrabold text-ink" htmlFor="question-draft">
              {awaitingConfirmation ? 'Your recognised question — edit if needed' : 'Your question'}
              <textarea
                id="question-draft"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    submitTyped();
                  }
                }}
                maxLength={QUESTION_MAX_LENGTH}
                rows={3}
                autoFocus
                className="field mt-2 resize-none"
              />
            </label>
            <Button onClick={submitTyped} disabled={!typed.trim()} className="mt-3 h-11 w-full">
              <Send className="h-4 w-4" /> Confirm and ask the hosts
            </Button>
          </div>
        )}

        {holdsFloor && !showFallback && phase === 'listening' && (
          <button
            type="button"
            onClick={() => setShowFallback(true)}
            className="focus-ring mt-6 rounded-lg px-2 py-1 text-sm font-bold text-muted underline decoration-dotted underline-offset-4 transition hover:text-ink"
          >
            Type it instead
          </button>
        )}

        {(error || asr.error) && (
          <p className="mt-5 rounded-xl border-2 border-ink bg-onair/20 p-3 text-sm font-semibold leading-6 text-ink" role="alert">
            {error ?? asr.error}
          </p>
        )}
      </section>
    </div>
  );
}
