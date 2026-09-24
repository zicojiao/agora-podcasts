'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ESTIMATED_CHARS_PER_SECOND,
  QUESTION_MAX_LENGTH,
  parseEpisode,
  turnBoundaries,
  type Episode,
  type Turn,
} from '@/lib/episode';
import {
  EMPTY_ROOM_STATE,
  EpisodeAssembler,
  chunkEpisode,
  sanitizeDisplayName,
  type RoomMessage,
  type RoomPhase,
  type RoomState,
} from '@/lib/room-messages';
import { publishRoomSnapshot } from '@/lib/room-sync';
import { FloorTimeoutController } from '@/lib/interruption-startup';
import { streamSpeech } from '@/lib/speech-stream';
import {
  episodeResetMessage,
  isEpisodeRestartAvailable,
  replayEpisodeAudio,
  type ReplayAudioChunk,
} from '@/lib/episode-replay';
import { useAgoraRoom, type RoomRole } from '@/hooks/useAgoraRoom';
import { useProgramEngine, type ProgramLane } from '@/hooks/useProgramEngine';

// Gemini's first SSE deltas can arrive in an uneven burst. Starting on the first delta makes
// the worklet repeatedly exhaust its queue during the opening line, which sounds like a
// broken stream. Three seconds is enough runway at the measured >2x generation rate without
// making the listener wait for the full 60–90 second segment.
const OPENING_PREBUFFER_SECONDS = 3;

export type AnswerRecord = {
  id: string;
  question: string;
  askerName: string;
  turns: Turn[];
  status: 'thinking' | 'answered';
  /** Exact transcript turn after which the live interruption occurred. */
  afterSegmentIndex: number;
  afterTurnIndex: number;
};

type SegmentSpan = {
  startSample: number;
  sampleCount: number;
  /** False while the span is still a character-count estimate. */
  settled: boolean;
  turns: Array<{ startSample: number; endSample: number }>;
};

export type DirectorPosition = {
  segmentIndex: number;
  turnIndex: number;
};

type UseEpisodeDirectorOptions = {
  role: RoomRole;
  channel: string | null;
  displayName: string;
};

/** Which segment and turn the given number of played base-lane samples lands in. */
function derivePosition(spans: SegmentSpan[], playedSamples: number): DirectorPosition {
  for (let segmentIndex = 0; segmentIndex < spans.length; segmentIndex += 1) {
    const span = spans[segmentIndex];
    const isLast = segmentIndex === spans.length - 1;
    if (playedSamples < span.startSample + span.sampleCount || isLast) {
      const offset = playedSamples - span.startSample;
      const turnIndex = span.turns.findIndex((turn) => offset < turn.endSample);
      return {
        segmentIndex,
        turnIndex: turnIndex < 0 ? Math.max(0, span.turns.length - 1) : turnIndex,
      };
    }
  }
  return { segmentIndex: 0, turnIndex: 0 };
}

export function useEpisodeDirector({ role, channel, displayName }: UseEpisodeDirectorOptions) {
  const isHost = role === 'host';

  const [episode, setEpisode] = useState<Episode | null>(null);
  const [phase, setPhaseState] = useState<RoomPhase>('idle');
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [asker, setAsker] = useState<{ uid: string; name: string } | null>(null);
  const [remoteState, setRemoteState] = useState<RoomState>(EMPTY_ROOM_STATE);
  const [micTrack, setMicTrack] = useState<MediaStreamTrack | null>(null);
  const [firstAudioMs, setFirstAudioMs] = useState<number | null>(null);
  const [replayRevision, setReplayRevision] = useState(0);
  const [restartAudioReady, setRestartAudioReady] = useState(false);
  // Segment spans live in state, not a ref, so the transcript highlight derives from them
  // without reading mutable data during render.
  const [spans, setSpans] = useState<SegmentSpan[]>([]);

  const sendRef = useRef<(message: RoomMessage) => Promise<void>>(async () => undefined);
  const phaseRef = useRef<RoomPhase>('idle');
  const episodeRef = useRef<Episode | null>(null);
  const sourceRef = useRef('');
  const askerRef = useRef<{ uid: string; name: string } | null>(null);
  const positionRef = useRef<DirectorPosition>({ segmentIndex: 0, turnIndex: 0 });
  const productionRef = useRef<AbortController | null>(null);
  const answerRef = useRef<AbortController | null>(null);
  const floorTimeoutRef = useRef<FloorTimeoutController | null>(null);
  const assemblerRef = useRef(new EpisodeAssembler());
  const uidRef = useRef<string | null>(null);
  const startedAtRef = useRef(0);
  const engineRef = useRef<ProgramEngineHandle | null>(null);
  const baseReplayRef = useRef<ReplayAudioChunk[]>([]);
  const releaseFloorRef = useRef<(reason: string | null) => void>(() => undefined);
  const answerQuestionRef = useRef<(question: string) => Promise<void>>(async () => undefined);

  useEffect(() => {
    const controller = new FloorTimeoutController({
      schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
      cancel: (id) => window.clearTimeout(id),
      onExpire: (reason) => {
        if (phaseRef.current !== 'listening') return;
        releaseFloorRef.current(reason === 'setup'
          ? 'The microphone did not become ready. Back to the episode.'
          : 'No question was picked up. Back to the episode.');
      },
    });
    floorTimeoutRef.current = controller;
    return () => {
      controller.clear();
      if (floorTimeoutRef.current === controller) floorTimeoutRef.current = null;
    };
  }, []);

  const broadcastState = useCallback((next: Partial<RoomState> = {}) => {
    if (!isHost) return;
    void sendRef.current({
      t: 'state',
      state: {
        phase: phaseRef.current,
        episodeId: episodeRef.current?.id ?? null,
        segmentIndex: positionRef.current.segmentIndex,
        turnIndex: positionRef.current.turnIndex,
        askerUid: askerRef.current?.uid ?? null,
        askerName: askerRef.current?.name ?? null,
        note: null,
        ...next,
      },
    });
  }, [isHost]);

  const setPhase = useCallback((next: RoomPhase, nextNote: string | null = null) => {
    phaseRef.current = next;
    setPhaseState(next);
    setNote(nextNote);
    broadcastState({ note: nextNote });
  }, [broadcastState]);

  // ── Program engine ──────────────────────────────────────────────────────────────────

  const handleLaneDrained = useCallback((lane: ProgramLane) => {
    if (!isHost) return;
    const engine = engineRef.current;
    if (lane === 'interrupt') {
      // The answer finished. Switch back; the base lane's read cursor never moved.
      engine?.clearLane('interrupt');
      engine?.setLaneActive('base');
      askerRef.current = null;
      setAsker(null);
      setLiveTranscript('');
      setPhase('playing');
      void sendRef.current({ t: 'floor.release' });
      return;
    }
    // Only call the episode finished if it drained while actually playing. A listener who
    // grabs the floor during the last seconds leaves the base lane empty but unfinished.
    if (lane === 'base' && (phaseRef.current === 'playing' || phaseRef.current === 'paused')) {
      setPhase('completed');
    }
  }, [isHost, setPhase]);

  const engine = useProgramEngine({ onLaneDrained: handleLaneDrained });

  useEffect(() => {
    engineRef.current = engine;
  }, [engine]);

  // ── Position within the episode, derived from played samples ─────────────────────────

  // Plain derivations, not useMemo: the React Compiler caches these on their inputs, and it
  // cannot preserve a hand-written memo around the search loop.
  const basePlayedSamples = engine.progress.base.playedSamples;
  const position = derivePosition(spans, basePlayedSamples);
  const effectivePosition = isHost
    ? position
    : { segmentIndex: remoteState.segmentIndex, turnIndex: remoteState.turnIndex };

  const { segmentIndex, turnIndex } = position;

  useEffect(() => {
    positionRef.current = { segmentIndex, turnIndex };
    if (!isHost || phaseRef.current !== 'playing') return;
    broadcastState({ segmentIndex, turnIndex });
  }, [isHost, segmentIndex, turnIndex, broadcastState]);

  // ── Floor control ───────────────────────────────────────────────────────────────────

  const grantFloor = useCallback((uid: string, name: string) => {
    if (!isHost) return;
    const current = phaseRef.current;
    if (askerRef.current || (current !== 'playing' && current !== 'paused')) {
      void sendRef.current({
        t: 'floor.deny',
        uid,
        reason: askerRef.current ? 'Someone else has the floor.' : 'The episode is not playing yet.',
      });
      return;
    }
    askerRef.current = { uid, name };
    setAsker({ uid, name });
    setLiveTranscript('');
    // Freeze the base lane first, so the room goes quiet immediately.
    const activeEngine = engineRef.current;
    activeEngine?.setPlaying(false);
    activeEngine?.clearLane('interrupt');
    activeEngine?.setLaneActive('interrupt');
    setPhase('listening', `${name} has the floor`);
    void sendRef.current({ t: 'floor.grant', uid, name });

    // Provider token minting and Live connection can legitimately exceed the silence
    // window. Use a generous setup deadline until the floor holder reports ASR ready.
    floorTimeoutRef.current?.granted();
  }, [isHost, setPhase]);

  const releaseFloor = useCallback((reason: string | null) => {
    if (!isHost) return;
    floorTimeoutRef.current?.clear();
    answerRef.current?.abort();
    answerRef.current = null;
    askerRef.current = null;
    setAsker(null);
    setLiveTranscript('');
    const activeEngine = engineRef.current;
    activeEngine?.clearLane('interrupt');
    activeEngine?.setLaneActive('base');
    activeEngine?.setPlaying(true);
    setPhase('playing', reason);
    void sendRef.current({ t: 'floor.release' });
  }, [isHost, setPhase]);

  useEffect(() => {
    releaseFloorRef.current = releaseFloor;
  }, [releaseFloor]);

  const answerQuestion = useCallback(async (question: string) => {
    const currentEpisode = episodeRef.current;
    const currentAsker = askerRef.current;
    if (!isHost || !currentEpisode || !currentAsker) return;
    floorTimeoutRef.current?.clear();

    const trimmed = question.trim().slice(0, QUESTION_MAX_LENGTH);
    if (!trimmed) {
      releaseFloorRef.current('Nothing was picked up. Back to the episode.');
      return;
    }

    const controller = new AbortController();
    answerRef.current = controller;

    const { segmentIndex, turnIndex } = positionRef.current;
    const interruption = {
      id: `${currentAsker.uid}-${Date.now()}`,
      question: trimmed,
      askerName: currentAsker.name,
      afterSegmentIndex: segmentIndex,
      afterTurnIndex: turnIndex,
    };
    setAnswers((current) => [...current, { ...interruption, turns: [], status: 'thinking' }]);
    void sendRef.current({ t: 'question', ...interruption });
    setLiveTranscript('');
    setPhase('thinking', `Answering ${currentAsker.name}'s question`);

    // The host's reply is written for this question, then streamed into the interrupt lane.
    engineRef.current?.setLaneActive('interrupt');
    engineRef.current?.setPlaying(true);

    const recentTurns = currentEpisode.segments[segmentIndex]?.turns.slice(0, turnIndex + 1) ?? [];

    try {
      const response = await fetch('/api/episode/question', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question: trimmed,
          source: sourceRef.current,
          title: currentEpisode.title,
          summary: currentEpisode.summary,
          hosts: currentEpisode.hosts,
          recentTurns,
          askerName: currentAsker.name,
        }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(payload?.turns)) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Could not write an answer.');
      }
      const turns = payload.turns as Turn[];

      setAnswers((current) => current.map((answer) => (
        answer.id === interruption.id ? { ...answer, turns, status: 'answered' } : answer
      )));
      void sendRef.current({ t: 'answer', ...interruption, turns });

      setPhase('answering', `Answering ${currentAsker.name}`);

      await streamSpeech(
        { hosts: currentEpisode.hosts, turns },
        {
          onAudio: (base64, sampleRate) => {
            engineRef.current?.pushAudioDelta('interrupt', base64, sampleRate);
          },
        },
        controller.signal,
      );
      engineRef.current?.endLane('interrupt');
      // handleLaneDrained resumes the base lane once everything queued has actually played.
    } catch (answerError) {
      if (controller.signal.aborted) return;
      console.error('[director] answer failed', answerError);
      setError(answerError instanceof Error ? answerError.message : 'The answer could not be produced.');
      releaseFloorRef.current('That question could not be answered. Back to the episode.');
    } finally {
      if (answerRef.current === controller) answerRef.current = null;
    }
  }, [isHost, setPhase]);

  useEffect(() => {
    answerQuestionRef.current = answerQuestion;
  }, [answerQuestion]);

  // ── Inbound RTM ─────────────────────────────────────────────────────────────────────

  const handleMessage = useCallback((message: RoomMessage, publisher: string) => {
    switch (message.t) {
      case 'hello':
        if (isHost && episodeRef.current) {
          // Replay the episode and current state so a late arrival sees the full transcript.
          for (const chunk of chunkEpisode(episodeRef.current)) void sendRef.current(chunk);
          broadcastState();
        }
        break;

      case 'floor.request':
        grantFloor(publisher, message.name);
        break;

      case 'floor.transcript':
        // Interim text is rendered for everyone; the final text is what the host answers.
        setLiveTranscript(message.text);
        if (isHost && !message.final && askerRef.current?.uid === publisher) {
          floorTimeoutRef.current?.activity();
        }
        if (isHost && message.final && askerRef.current?.uid === publisher) {
          void answerQuestionRef.current(message.text);
        }
        break;

      case 'floor.ready':
        if (isHost && askerRef.current?.uid === publisher) floorTimeoutRef.current?.ready();
        break;

      case 'floor.grant':
        askerRef.current = { uid: message.uid, name: message.name };
        setAsker(askerRef.current);
        setLiveTranscript('');
        break;

      case 'floor.deny':
        if (message.uid === uidRef.current) setError(message.reason);
        break;

      case 'floor.release':
        if (!isHost) askerRef.current = null;
        setAsker(null);
        setLiveTranscript('');
        break;

      case 'episode.replay':
      case 'episode.restart':
        if (isHost) break;
        askerRef.current = null;
        positionRef.current = { segmentIndex: 0, turnIndex: 0 };
        phaseRef.current = 'playing';
        setAnswers([]);
        setAsker(null);
        setLiveTranscript('');
        setError(null);
        setNote(null);
        setPhaseState('playing');
        setRemoteState((current) => ({
          ...current,
          phase: 'playing',
          segmentIndex: 0,
          turnIndex: 0,
          askerUid: null,
          askerName: null,
          note: null,
        }));
        setReplayRevision((current) => current + 1);
        break;

      case 'question':
        setAnswers((current) => current.some((answer) => answer.id === message.id)
          ? current
          : [...current, { ...message, turns: [], status: 'thinking' }]);
        setLiveTranscript('');
        break;

      case 'answer':
        setAnswers((current) => {
          const completed = { ...message, status: 'answered' as const };
          return current.some((answer) => answer.id === message.id)
            ? current.map((answer) => answer.id === message.id ? completed : answer)
            : [...current, completed];
        });
        break;

      case 'state':
        if (isHost) break;
        setRemoteState(message.state);
        positionRef.current = {
          segmentIndex: message.state.segmentIndex,
          turnIndex: message.state.turnIndex,
        };
        phaseRef.current = message.state.phase;
        setPhaseState(message.state.phase);
        setNote(message.state.note);
        if (message.state.askerUid) {
          askerRef.current = {
            uid: message.state.askerUid,
            name: message.state.askerName ?? 'A listener',
          };
          setAsker(askerRef.current);
        } else {
          askerRef.current = null;
          setAsker(null);
        }
        break;

      case 'episode.chunk': {
        if (isHost) break;
        const assembled = assemblerRef.current.accept(message);
        if (assembled) {
          episodeRef.current = assembled;
          setEpisode(assembled);
        }
        break;
      }

      default:
        break;
    }
  }, [isHost, grantFloor, broadcastState]);

  const room = useAgoraRoom({ channel, role, displayName, onMessage: handleMessage });
  const { clearChat: clearRoomChat } = room;

  useEffect(() => {
    sendRef.current = room.send;
  }, [room.send]);

  useEffect(() => {
    uidRef.current = room.uid;
  }, [room.uid]);

  // The host's program output is the room's program. Publish it as soon as both the audio
  // graph and the channel are up.
  const programTrack = engine.programTrack;
  const { connection: roomConnection, publishProgram, leaveRoom: leaveAgoraRoom } = room;

  // Episode generation and Agora startup are independent. If generation wins the race,
  // the original RTM publish is impossible and a listener's early `hello` may also be lost.
  // Synchronize again at the point both prerequisites are true so listeners always converge.
  useEffect(() => {
    const currentEpisode = episodeRef.current;
    if (!currentEpisode) return;
    void publishRoomSnapshot({
      isHost,
      connection: room.rtmConnected ? 'connected' : 'connecting',
      episode: currentEpisode,
      state: {
        phase: phaseRef.current,
        episodeId: currentEpisode.id,
        segmentIndex: positionRef.current.segmentIndex,
        turnIndex: positionRef.current.turnIndex,
        askerUid: askerRef.current?.uid ?? null,
        askerName: askerRef.current?.name ?? null,
        note: null,
      },
      send: room.send,
    });
  }, [isHost, episode, room.rtmConnected, room.rtmSyncRevision, room.send]);

  useEffect(() => {
    if (!isHost || !programTrack || roomConnection !== 'connected') return;
    void publishProgram(programTrack).catch((publishError) => {
      console.error('[director] publishing the program failed', publishError);
      setError('The room is connected but the program track could not be published. Local playback only.');
    });
  }, [isHost, programTrack, roomConnection, publishProgram]);

  // ── Production ──────────────────────────────────────────────────────────────────────

  /**
   * Streams every segment into one continuous base lane, recording the real sample span for
   * each so the transcript highlight tracks actual audio rather than a character-count
   * guess. One request per segment keeps each generation long enough to hold conversational
   * momentum while staying small enough to retry on its own.
   */
  const produce = useCallback(async (currentEpisode: Episode, signal: AbortSignal) => {
    const sampleRate = engineRef.current?.getSampleRate() ?? 48_000;
    const working: SegmentSpan[] = [];
    const commit = () => setSpans(working.map((span) => ({ ...span })));

    for (const [segmentIndex, segment] of currentEpisode.segments.entries()) {
      if (signal.aborted) return;
      const previous = working[segmentIndex - 1];
      const startSample = previous ? previous.startSample + previous.sampleCount : 0;
      const estimatedSamples = segment.turns.reduce(
        (total, turn) => total + (turn.text.length / ESTIMATED_CHARS_PER_SECOND) * sampleRate,
        0,
      );
      working[segmentIndex] = {
        startSample,
        sampleCount: Math.round(estimatedSamples),
        settled: false,
        turns: turnBoundaries(segment.turns, sampleRate),
      };
      commit();

      let segmentSamples = 0;
      await streamSpeech(
        { hosts: currentEpisode.hosts, turns: segment.turns },
        {
          onFirstAudio: () => {
            if (segmentIndex !== 0) return;
            setFirstAudioMs(performance.now() - startedAtRef.current);
          },
          prebufferSeconds: segmentIndex === 0 ? OPENING_PREBUFFER_SECONDS : 0,
          onPlaybackReady: () => {
            if (segmentIndex !== 0) return;
            engineRef.current?.setPlaying(true);
            setPhase('playing');
          },
          onAudio: (base64, deltaRate) => {
            baseReplayRef.current.push({
              encoding: 'base64-pcm16',
              data: base64,
              sampleRate: deltaRate,
            });
            const seconds = engineRef.current?.pushAudioDelta('base', base64, deltaRate) ?? 0;
            segmentSamples += Math.round(seconds * sampleRate);
            return seconds;
          },
          onComplete: () => {
            const span = working[segmentIndex];
            if (!span) return;
            span.sampleCount = segmentSamples;
            span.settled = true;
            span.turns = turnBoundaries(segment.turns, sampleRate, segmentSamples);
            // Later segments start where this one really ended.
            for (let index = segmentIndex + 1; index < working.length; index += 1) {
              working[index].startSample = working[index - 1].startSample + working[index - 1].sampleCount;
            }
            commit();
          },
        },
        signal,
      );
    }

    if (!signal.aborted) {
      engineRef.current?.endLane('base');
      setRestartAudioReady(true);
    }
  }, [setPhase]);

  const createEpisode = useCallback(async (source: string) => {
    if (!isHost) return;
    productionRef.current?.abort();
    const controller = new AbortController();
    productionRef.current = controller;

    setError(null);
    setAnswers([]);
    setFirstAudioMs(null);
    setRestartAudioReady(false);
    setSpans([]);
    baseReplayRef.current = [];
    sourceRef.current = source.trim();
    startedAtRef.current = performance.now();

    engineRef.current?.resetAll();
    await engineRef.current?.ensure();

    setPhase('scripting', 'Writing the two-host conversation');

    try {
      const response = await fetch('/api/episode', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: sourceRef.current }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Could not write the episode.');
      }
      const parsed = parseEpisode(payload?.episode);
      if (typeof parsed === 'string') throw new Error(parsed);
      if (controller.signal.aborted) return;

      episodeRef.current = parsed;
      setEpisode(parsed);

      setPhase('buffering', 'Creating the opening audio with Gemini TTS');
      await produce(parsed, controller.signal);
    } catch (productionError) {
      if (controller.signal.aborted) return;
      console.error('[director] production failed', productionError);
      setError(productionError instanceof Error ? productionError.message : 'The episode could not be produced.');
      setPhase('failed');
    } finally {
      if (productionRef.current === controller) productionRef.current = null;
    }
  }, [isHost, produce, setPhase]);

  // ── Actions available to whoever is in the room ──────────────────────────────────────

  const requestFloor = useCallback(async () => {
    setError(null);
    const name = sanitizeDisplayName(displayName);
    if (isHost) {
      grantFloor(uidRef.current ?? 'host', name);
      return;
    }
    await sendRef.current({ t: 'floor.request', name });
  }, [displayName, isHost, grantFloor]);

  const markFloorReady = useCallback(async () => {
    if (!askerRef.current) return;
    if (isHost) {
      floorTimeoutRef.current?.ready();
      return;
    }
    await sendRef.current({ t: 'floor.ready' });
  }, [isHost]);

  /**
   * Hands the floor back. A listener cannot release it directly — only the host owns the
   * program — so it signals an empty final question, which the host treats as a withdrawal.
   */
  const giveUpFloor = useCallback(async () => {
    if (isHost) {
      releaseFloorRef.current('Back to the episode.');
      return;
    }
    await sendRef.current({ t: 'floor.transcript', text: '', final: true });
  }, [isHost]);

  // Depend on the stable functions, not the room object, which is rebuilt every render.
  // An unstable identity here re-runs the caller's effect on every render, which is how
  // dozens of concurrent microphone opens got started.
  const { publishMicrophone, unpublishMicrophone } = room;

  const openMicrophone = useCallback(async () => {
    try {
      const revealTrack = (track: MediaStreamTrack) => {
        setMicTrack((current) => (current === track ? current : track));
      };
      const track = await publishMicrophone(revealTrack);
      setMicTrack((current) => (current === track ? current : track));
    } catch (micError) {
      console.error('[director] microphone failed', micError);
      setError('The microphone could not be opened. Type the question instead.');
    }
  }, [publishMicrophone]);

  const closeMicrophone = useCallback(async () => {
    setMicTrack((current) => (current === null ? current : null));
    await unpublishMicrophone();
  }, [unpublishMicrophone]);

  const publishTranscript = useCallback(async (text: string, final: boolean) => {
    setLiveTranscript(text);
    await sendRef.current({ t: 'floor.transcript', text: text.slice(0, QUESTION_MAX_LENGTH), final });
    if (isHost && !final) floorTimeoutRef.current?.activity();
    if (final && isHost) void answerQuestionRef.current(text);
  }, [isHost]);

  const togglePlayback = useCallback(async () => {
    if (!isHost) return;
    await engineRef.current?.ensure();
    if (phaseRef.current === 'playing') {
      engineRef.current?.setPlaying(false);
      setPhase('paused');
      return;
    }
    if (phaseRef.current === 'paused') {
      engineRef.current?.setPlaying(true);
      setPhase('playing');
    }
  }, [isHost, setPhase]);

  const resetEpisodePlayback = useCallback(async (kind: 'replay' | 'restart') => {
    if (!isEpisodeRestartAvailable({
      isHost,
      audioReady: restartAudioReady,
      phase: phaseRef.current,
    })) return false;
    const activeEngine = engineRef.current;
    if (!activeEngine) return false;

    await activeEngine.ensure();
    answerRef.current?.abort();
    answerRef.current = null;
    floorTimeoutRef.current?.clear();

    askerRef.current = null;
    positionRef.current = { segmentIndex: 0, turnIndex: 0 };
    setAnswers([]);
    setAsker(null);
    setLiveTranscript('');
    setError(null);
    setFirstAudioMs(null);

    if (baseReplayRef.current.length === 0) {
      setError('The original episode audio is no longer available to replay.');
      return false;
    }

    // Reset connected listeners before the restarted RTC program becomes audible. RTM send
    // is awaited so the subsequent state snapshot cannot overtake the history clear.
    if (kind === 'restart') clearRoomChat();
    await sendRef.current(episodeResetMessage(kind));
    replayEpisodeAudio(baseReplayRef.current, activeEngine);
    setReplayRevision((current) => current + 1);
    setPhase('playing');
    return true;
  }, [clearRoomChat, isHost, restartAudioReady, setPhase]);

  const restartEpisode = useCallback(() => resetEpisodePlayback('restart'), [resetEpisodePlayback]);

  const replayEpisode = useCallback(async () => {
    if (phaseRef.current !== 'completed') return false;
    return resetEpisodePlayback('replay');
  }, [resetEpisodePlayback]);

  const reset = useCallback(() => {
    productionRef.current?.abort();
    answerRef.current?.abort();
    floorTimeoutRef.current?.clear();
    engineRef.current?.resetAll();
    episodeRef.current = null;
    askerRef.current = null;
    baseReplayRef.current = [];
    positionRef.current = { segmentIndex: 0, turnIndex: 0 };
    setSpans([]);
    setEpisode(null);
    setAnswers([]);
    setAsker(null);
    setLiveTranscript('');
    setError(null);
    setFirstAudioMs(null);
    setRestartAudioReady(false);
    setPhase('idle');
  }, [setPhase]);

  const leaveRoom = useCallback(async () => {
    productionRef.current?.abort();
    answerRef.current?.abort();
    floorTimeoutRef.current?.clear();
    engineRef.current?.setPlaying(false);
    engineRef.current?.resetAll();
    await leaveAgoraRoom();
  }, [leaveAgoraRoom]);

  useEffect(() => () => {
    productionRef.current?.abort();
    answerRef.current?.abort();
    floorTimeoutRef.current?.clear();
  }, []);

  const holdsFloor = Boolean(asker && room.uid && asker.uid === room.uid);
  const canRestartEpisode = isEpisodeRestartAvailable({
    isHost,
    audioReady: restartAudioReady,
    phase,
  });

  return {
    role,
    isHost,
    episode,
    phase,
    note,
    error,
    answers,
    liveTranscript,
    asker,
    holdsFloor,
    micTrack,
    firstAudioMs,
    replayRevision,
    canRestartEpisode,
    position: effectivePosition,
    engine,
    room,
    createEpisode,
    requestFloor,
    markFloorReady,
    releaseFloor,
    giveUpFloor,
    openMicrophone,
    closeMicrophone,
    publishTranscript,
    togglePlayback,
    replayEpisode,
    restartEpisode,
    reset,
    leaveRoom,
    setError,
  };
}

type ProgramEngineHandle = ReturnType<typeof useProgramEngine>;

export type EpisodeDirector = ReturnType<typeof useEpisodeDirector>;
