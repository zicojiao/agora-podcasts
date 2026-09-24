'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { decodePcm16Le, decodePcm16LeBase64, resampleLinear } from '@/lib/pcm-stream';

export type ProgramLane = 'base' | 'interrupt';

export type LaneProgress = {
  playedSamples: number;
  queuedSamples: number;
};

const EMPTY_PROGRESS: Record<ProgramLane, LaneProgress> = {
  base: { playedSamples: 0, queuedSamples: 0 },
  interrupt: { playedSamples: 0, queuedSamples: 0 },
};

type UseProgramEngineOptions = {
  /** Fires when a lane marked `end` has played everything queued. */
  onLaneDrained?: (lane: ProgramLane, playedSamples: number) => void;
};

/**
 * Owns the AudioWorklet program graph:
 *
 *   worklet ──┬─→ context.destination        (what the operator hears)
 *             └─→ MediaStreamDestination     (what Agora publishes)
 *
 * Both branches carry the identical signal, so the room hears exactly what the host hears.
 */
export function useProgramEngine({ onLaneDrained }: UseProgramEngineOptions = {}) {
  const [ready, setReady] = useState(false);
  const [level, setLevel] = useState(0);
  const [activeLane, setActiveLane] = useState<ProgramLane>('base');
  const [progress, setProgress] = useState(EMPTY_PROGRESS);
  const [programTrack, setProgramTrack] = useState<MediaStreamTrack | null>(null);

  const contextRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const destinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const drainedRef = useRef(onLaneDrained);

  useEffect(() => {
    drainedRef.current = onLaneDrained;
  }, [onLaneDrained]);

  useEffect(() => () => {
    workletRef.current?.port.postMessage({ type: 'resetAll' });
    workletRef.current?.disconnect();
    destinationRef.current?.stream.getTracks().forEach((track) => track.stop());
    const context = contextRef.current;
    contextRef.current = null;
    workletRef.current = null;
    destinationRef.current = null;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
  }, []);

  /** Must be called from a user gesture; browsers start AudioContexts suspended. */
  const ensure = useCallback(async () => {
    let context = contextRef.current;
    if (!context || context.state === 'closed') {
      context = new AudioContext({ latencyHint: 'interactive' });
      await context.audioWorklet.addModule('/program-player.worklet.js');
      const worklet = new AudioWorkletNode(context, 'program-player', { outputChannelCount: [1] });
      const destination = context.createMediaStreamDestination();
      worklet.connect(context.destination);
      worklet.connect(destination);

      worklet.port.onmessage = ({ data }) => {
        if (data?.type === 'progress') {
          const lane = data.lane as ProgramLane;
          const playedSamples = Number(data.playedSamples) || 0;
          const queuedSamples = Number(data.queuedSamples) || 0;
          // Bail on unchanged values. The worklet already suppresses idle reports; this is
          // the second line of defence against re-rendering the tree for nothing.
          setProgress((current) => {
            const previous = current[lane];
            if (previous.playedSamples === playedSamples && previous.queuedSamples === queuedSamples) {
              return current;
            }
            return { ...current, [lane]: { playedSamples, queuedSamples } };
          });
          const nextLevel = Math.min(1, (Number(data.level) || 0) * 3.2);
          setLevel((current) => (Math.abs(current - nextLevel) < 0.01 ? current : nextLevel));
          if (data.active === 'base' || data.active === 'interrupt') setActiveLane(data.active);
          return;
        }
        if (data?.type === 'drained') {
          drainedRef.current?.(data.lane as ProgramLane, Number(data.playedSamples) || 0);
        }
      };

      contextRef.current = context;
      workletRef.current = worklet;
      destinationRef.current = destination;
      setProgramTrack(destination.stream.getAudioTracks()[0] ?? null);
      setReady(true);
    }
    if (context.state === 'suspended') await context.resume();
    return context;
  }, []);

  const post = useCallback((message: Record<string, unknown>, transfer?: Transferable[]) => {
    const worklet = workletRef.current;
    if (!worklet) return;
    if (transfer) worklet.port.postMessage(message, transfer);
    else worklet.port.postMessage(message);
  }, []);

  /** Decodes one base64 PCM16 delta, matches it to the context rate, and queues it. */
  const pushAudioDelta = useCallback((lane: ProgramLane, base64: string, sourceRate: number) => {
    const context = contextRef.current;
    if (!context) return 0;
    const samples = decodePcm16LeBase64(base64);
    const converted = resampleLinear(samples, sourceRate, context.sampleRate);
    post({ type: 'push', lane, samples: converted }, [converted.buffer]);
    return samples.length / sourceRate;
  }, [post]);

  /** Queues a stored PCM16LE object through the same worklet path as live Gemini deltas. */
  const pushPcm16 = useCallback((lane: ProgramLane, bytes: ArrayBuffer | Uint8Array, sourceRate: number) => {
    const context = contextRef.current;
    if (!context) return 0;
    const samples = decodePcm16Le(bytes);
    const converted = resampleLinear(samples, sourceRate, context.sampleRate);
    post({ type: 'push', lane, samples: converted }, [converted.buffer]);
    return samples.length / sourceRate;
  }, [post]);

  const setLaneActive = useCallback((lane: ProgramLane) => {
    post({ type: 'setActive', lane });
  }, [post]);

  const setPlaying = useCallback((playing: boolean) => {
    post({ type: 'setPlaying', playing });
  }, [post]);

  const endLane = useCallback((lane: ProgramLane) => {
    post({ type: 'end', lane });
  }, [post]);

  const clearLane = useCallback((lane: ProgramLane, keepProgress = false) => {
    post({ type: 'clear', lane, keepProgress });
  }, [post]);

  const resetAll = useCallback(() => {
    post({ type: 'resetAll' });
    setProgress(EMPTY_PROGRESS);
    setLevel(0);
    setActiveLane('base');
  }, [post]);

  // Read through the ref rather than render state: callers need the real rate immediately
  // after awaiting ensure(), which is before the next render lands.
  const getSampleRate = useCallback(() => contextRef.current?.sampleRate ?? 48_000, []);

  return {
    ready,
    level,
    activeLane,
    progress,
    programTrack,
    getSampleRate,
    ensure,
    pushAudioDelta,
    pushPcm16,
    setLaneActive,
    setPlaying,
    endLane,
    clearLane,
    resetAll,
  };
}

export type ProgramEngine = ReturnType<typeof useProgramEngine>;
