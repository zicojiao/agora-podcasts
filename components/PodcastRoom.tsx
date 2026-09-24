'use client';

import { AlertTriangle, Check, Link2, Loader2, LogOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ANALYTICS_EVENTS, captureProductEvent } from '@/lib/analytics';
import { buildRoomUrl, clearRoomUrl, readRoomChannel } from '@/lib/room-link';
import { sanitizeDisplayName } from '@/lib/room-messages';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { EpisodeComposer } from '@/components/EpisodeComposer';
import { PoweredBy, Wordmark } from '@/components/Wordmark';
import { JoinOverlay } from '@/components/JoinOverlay';
import { LeaveRoomDialog } from '@/components/LeaveRoomDialog';
import { ProgramStage } from '@/components/ProgramStage';
import { ProductionProgress } from '@/components/ProductionProgress';
import { RoomInvite } from '@/components/RoomInvite';
import { RoomLanding } from '@/components/RoomLanding';
import { RoomChat } from '@/components/RoomChat';
import { RestartEpisodeDialog } from '@/components/RestartEpisodeDialog';
import { TranscriptRail } from '@/components/TranscriptRail';
import { useEpisodeDirector } from '@/hooks/useEpisodeDirector';
import type { RoomRole } from '@/hooks/useAgoraRoom';

type RoomEntry = {
  role: RoomRole;
  channel: string;
  displayName: string;
};

/** `?room=<code>` on the URL means this was opened from a shared link. */
function readInvitedChannel() {
  if (typeof window === 'undefined') return null;
  return readRoomChannel(window.location.href);
}

export function PodcastRoom() {
  const [entry, setEntry] = useState<RoomEntry | null>(null);
  const [invitedChannel, setInvitedChannel] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Read on mount rather than during render: the server has no URL search params, and
  // reading them while rendering would mismatch hydration.
  useEffect(() => {
    setInvitedChannel(readInvitedChannel());
    setReady(true);
  }, []);

  const enter = (nextEntry: RoomEntry) => {
    setEntry(nextEntry);
    captureProductEvent(
      nextEntry.role === 'host' ? ANALYTICS_EVENTS.roomCreated : ANALYTICS_EVENTS.roomJoined,
      nextEntry.role === 'host'
        ? { role: 'host' }
        : { role: 'listener', entry_method: invitedChannel ? 'share_link' : 'room_code' },
    );
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', buildRoomUrl(window.location.href, nextEntry.channel));
    }
  };

  const leave = () => {
    if (entry) captureProductEvent(ANALYTICS_EVENTS.roomLeft, { role: entry.role });
    setEntry(null);
    setInvitedChannel(null);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', clearRoomUrl(window.location.href));
    }
  };

  if (!ready) return <main className="notebook-page min-h-screen bg-canvas" />;

  if (!entry && invitedChannel) {
    return (
      <RoomInvite
        channel={invitedChannel}
        onEnter={(displayName) => enter({ role: 'listener', channel: invitedChannel, displayName })}
      />
    );
  }

  if (!entry) return <RoomLanding onEnter={enter} />;
  return <ActiveRoom entry={entry} onLeave={leave} />;
}

function ActiveRoom({ entry, onLeave }: { entry: RoomEntry; onLeave: () => void }) {
  const director = useEpisodeDirector({
    role: entry.role,
    channel: entry.channel,
    displayName: entry.displayName,
  });
  const [copied, setCopied] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [confirmingRestart, setConfirmingRestart] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [interruptionDialog, setInterruptionDialog] = useState({
    open: false,
    submitted: false,
    replayRevision: 0,
  });
  const floorGrantedRef = useRef(false);

  const {
    isHost, episode, phase, note, error, answers, liveTranscript, asker, holdsFloor,
    micTrack, position, engine, room, openMicrophone, closeMicrophone,
    giveUpFloor, markFloorReady, replayRevision,
    leaveRoom: disconnectRoom,
  } = director;
  const interruptionDialogOpen = interruptionDialog.open
    && interruptionDialog.replayRevision === replayRevision;

  // The floor holder — and only the floor holder — opens a microphone.
  useEffect(() => {
    if (interruptionDialogOpen && holdsFloor && phase === 'listening') {
      void openMicrophone();
      return;
    }
    void closeMicrophone();
  }, [interruptionDialogOpen, holdsFloor, phase, openMicrophone, closeMicrophone]);

  // A close can race with the RTM floor grant. If the grant arrives after the user has
  // dismissed the dialog, release it immediately instead of opening a hidden microphone.
  useEffect(() => {
    if (!interruptionDialogOpen && holdsFloor && phase === 'listening') {
      void giveUpFloor();
    }
  }, [interruptionDialogOpen, holdsFloor, phase, giveUpFloor]);

  // If setup genuinely times out, close the stale dialog. Without this, `asker` becomes
  // null and the old dialog falsely claims it is requesting the floor a second time.
  useEffect(() => {
    if (holdsFloor) {
      floorGrantedRef.current = true;
      return;
    }
    if (!interruptionDialogOpen) {
      floorGrantedRef.current = false;
      return;
    }
    if (floorGrantedRef.current && !interruptionDialog.submitted && !asker && phase === 'playing') {
      floorGrantedRef.current = false;
      setInterruptionDialog({ open: false, submitted: false, replayRevision });
    }
  }, [asker, holdsFloor, interruptionDialogOpen, interruptionDialog.submitted, phase, replayRevision]);

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const leaveOnPageHide = () => {
      void disconnectRoom();
    };

    window.addEventListener('beforeunload', warnBeforeUnload);
    window.addEventListener('pagehide', leaveOnPageHide);
    return () => {
      window.removeEventListener('beforeunload', warnBeforeUnload);
      window.removeEventListener('pagehide', leaveOnPageHide);
    };
  }, [disconnectRoom]);

  const confirmLeave = async () => {
    if (leaving) return;
    setLeaving(true);
    await disconnectRoom();
    onLeave();
  };

  const confirmRestart = async () => {
    if (restarting) return;
    setRestarting(true);
    try {
      const restarted = await director.restartEpisode();
      if (restarted) setConfirmingRestart(false);
    } finally {
      setRestarting(false);
    }
  };

  // Share a link, not a code: anyone who opens it lands on a one-tap join screen.
  const shareUrl = typeof window === 'undefined'
    ? ''
    : buildRoomUrl(window.location.href, entry.channel);

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      captureProductEvent(ANALYTICS_EVENTS.inviteLinkCopied, { role: entry.role });
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_800);
    } catch {
      setCopied(false);
    }
  };

  const productionPhase = phase === 'scripting' || phase === 'buffering' ? phase : null;
  const producing = productionPhase !== null;
  const canTakeFloor = Boolean(episode)
    && !asker
    && (phase === 'playing' || phase === 'paused')
    && room.connection === 'connected';

  return (
    <main className="notebook-page flex min-h-screen flex-col bg-canvas">
      <header className="flex flex-wrap items-center gap-4 border-b-2 border-ink bg-canvas/95 px-5 py-5 sm:px-8">
        <Wordmark live={phase === 'playing' || phase === 'answering'} />

        <button
          type="button"
          onClick={copyShareLink}
          className={cn(
            'chip transition',
            copied
              ? 'border-ink bg-listener text-ink'
              : 'border-ink bg-white text-muted hover:bg-listener hover:text-ink',
          )}
          aria-label="Copy the invite link for this room"
        >
          {copied ? <Check className="h-3 w-3" /> : <Link2 className="h-3 w-3" />}
          {copied ? 'Link copied' : `${entry.channel} · copy invite`}
        </button>

        <span
          className={cn(
            'chip',
            room.connection === 'connected'
              ? 'border-ink bg-host-a/40 text-ink'
              : room.connection === 'failed'
                ? 'border-ink bg-onair/30 text-ink'
                : 'border-ink bg-white text-muted',
          )}
        >
          {room.connection === 'connecting' && <Loader2 className="h-3 w-3 animate-spin" />}
          {room.connection === 'connected'
            ? isHost ? 'Broadcasting' : 'Listening'
            : room.connection === 'failed' ? 'Room offline' : 'Connecting'}
        </span>

        <span className="chip border-ink bg-white text-muted">
          {isHost ? 'Host' : 'Listener'} · {sanitizeDisplayName(entry.displayName)}
        </span>

        <div className="ml-auto flex items-center gap-4">
          <PoweredBy className="hidden lg:block" />
          <Button variant="ghost" onClick={() => setConfirmingLeave(true)} className="h-9">
            <LogOut className="h-3.5 w-3.5" /> Leave
          </Button>
        </div>
      </header>

      {(room.error || error) && (
        <div className="mx-5 mt-5 flex items-start gap-3 rounded-2xl border-2 border-ink bg-onair/25 p-4 text-base font-semibold leading-7 text-ink shadow-card-sm sm:mx-8" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="flex-1">{room.error ?? error}</p>
          {error && (
            <button
              type="button"
              onClick={() => director.setError(null)}
              className="focus-ring rounded-lg px-2 text-ink/60 transition hover:bg-white hover:text-ink"
              aria-label="Dismiss"
            >
              ✕
            </button>
          )}
        </div>
      )}

      <div className="flex-1 px-5 py-6 sm:px-8">
        {!episode && isHost && (
          <div className="mx-auto max-w-3xl">
            <EpisodeComposer
              busy={producing}
              onCreate={(source) => {
                captureProductEvent(ANALYTICS_EVENTS.episodeGenerationStarted, { role: 'host' });
                director.createEpisode(source);
              }}
            />
            {productionPhase && (
              <div className="mt-5">
                <ProductionProgress phase={productionPhase} note={note} />
              </div>
            )}
          </div>
        )}

        {!episode && !isHost && (
          <div className="mx-auto flex max-w-md flex-col items-center py-24 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-cue" />
            <h2 className="mt-5 display text-2xl tracking-[-0.01em]">Waiting for the host</h2>
            <p className="mt-3 text-base leading-7 text-muted">
              You&rsquo;re in the room. The episode will appear here as soon as the host starts
              producing it, and you&rsquo;ll hear it live.
            </p>
          </div>
        )}

        {episode && (
          <>
            {productionPhase && (
              <div className="mx-auto mb-5 max-w-5xl">
                <ProductionProgress phase={productionPhase} note={note} />
              </div>
            )}
            <div className="grid items-stretch gap-5 lg:grid-cols-[minmax(280px,0.78fr)_minmax(360px,1.22fr)] xl:grid-cols-[minmax(280px,320px)_minmax(420px,1fr)_minmax(300px,350px)]">
            <div className="min-w-0 space-y-5">
              <ProgramStage
                episode={episode}
                phase={phase}
                note={note}
                level={engine.level}
                position={position}
                isHost={isHost}
                canTakeFloor={canTakeFloor}
                floorHolderName={asker?.name ?? null}
                canRestart={director.canRestartEpisode}
                published={isHost ? room.programPublished : room.remoteAudioCount > 0}
                connected={room.connection === 'connected'}
                listenerCount={room.members.length}
                onTogglePlayback={() => {
                  if (phase === 'completed') {
                    void director.replayEpisode();
                    return;
                  }
                  void director.togglePlayback();
                }}
                onRequestFloor={() => {
                  captureProductEvent(ANALYTICS_EVENTS.takeFloorRequested, { role: entry.role });
                  setInterruptionDialog({ open: true, submitted: false, replayRevision });
                  void director.requestFloor();
                }}
                onRestartRequest={() => setConfirmingRestart(true)}
              />

              {isHost && phase === 'completed' && (
                <div className="strip flex flex-wrap items-center justify-between gap-4 bg-listener/30 p-5">
                  <p className="text-base font-semibold text-muted">
                    That&rsquo;s the end of the episode. {director.firstAudioMs !== null
                      && `First audio arrived ${(director.firstAudioMs / 1_000).toFixed(1)}s after submitting.`}
                  </p>
                  <Button variant="outline" onClick={director.reset} className="h-10">
                    New episode
                  </Button>
                </div>
              )}
            </div>

            <div className="flex min-h-[500px] min-w-0 flex-col lg:h-[calc(100vh-10.75rem)] lg:min-h-[560px]">
              <TranscriptRail
                episode={episode}
                position={position}
                answers={answers}
                live={phase === 'playing'}
              />
            </div>

            <div className="min-w-0 lg:col-span-2 xl:col-span-1">
              <RoomChat
                messages={room.chatMessages}
                currentUid={room.uid}
                participantCount={room.connection === 'connected' ? room.members.length + 1 : room.members.length}
                connected={room.connection === 'connected'}
                onSend={room.sendChat}
                onClear={room.clearChat}
              />
            </div>
            </div>
          </>
        )}
      </div>

      {interruptionDialogOpen && (
        <JoinOverlay
          phase={phase}
          holdsFloor={holdsFloor}
          requestingFloor={!asker && !holdsFloor}
          submitted={interruptionDialog.submitted}
          askerName={asker?.name ?? entry.displayName}
          liveTranscript={liveTranscript}
          micTrack={micTrack}
          error={error}
          onTranscript={(text, final) => {
            if (final) {
              captureProductEvent(ANALYTICS_EVENTS.questionSubmitted, { role: entry.role });
            }
            director.publishTranscript(text, final);
          }}
          onReady={() => void markFloorReady()}
          onSubmitted={() => setInterruptionDialog((current) => ({ ...current, submitted: true }))}
          onClose={() => {
            setInterruptionDialog({ open: false, submitted: false, replayRevision });
            if (holdsFloor && phase === 'listening') void giveUpFloor();
          }}
        />
      )}

      {confirmingLeave && (
        <LeaveRoomDialog
          role={entry.role}
          leaving={leaving}
          onCancel={() => setConfirmingLeave(false)}
          onConfirm={() => void confirmLeave()}
        />
      )}

      {confirmingRestart && (
        <RestartEpisodeDialog
          restarting={restarting}
          onCancel={() => setConfirmingRestart(false)}
          onConfirm={() => void confirmRestart()}
        />
      )}
    </main>
  );
}
