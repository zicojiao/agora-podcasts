'use client';

import { Hand, Mic, MoreHorizontal, Pause, Play, RotateCcw } from 'lucide-react';
import type { Episode } from '@/lib/episode';
import type { RoomPhase } from '@/lib/room-messages';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ProgramMeter } from '@/components/LevelMeter';

export function ProgramStage({
  episode,
  phase,
  level,
  position,
  isHost,
  canTakeFloor,
  floorHolderName,
  canRestart,
  onTogglePlayback,
  onRequestFloor,
  onRestartRequest,
}: {
  episode: Episode;
  phase: RoomPhase;
  note: string | null;
  level: number;
  position: { segmentIndex: number; turnIndex: number };
  isHost: boolean;
  canTakeFloor: boolean;
  floorHolderName: string | null;
  canRestart: boolean;
  published: boolean;
  connected: boolean;
  listenerCount: number;
  onTogglePlayback: () => void;
  onRequestFloor: () => void;
  onRestartRequest: () => void;
}) {
  const audioActive = phase === 'playing' || phase === 'answering';
  const replayReady = phase === 'completed';
  const totalSegments = episode.segments.length;

  return (
    <section className="strip overflow-hidden bg-white">
      <header className="flex items-start justify-between gap-3 border-b-2 border-ink bg-host-a/25 px-5 py-4">
        <h2 className="display line-clamp-2 min-w-0 text-2xl leading-tight">{episode.title}</h2>
        {isHost && canRestart && (
          <button
            type="button"
            onClick={onRestartRequest}
            aria-label="Restart episode"
            title="Restart episode"
            className="focus-ring -mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink/20 transition hover:bg-white/60 hover:text-ink focus-visible:bg-white/70 focus-visible:text-ink"
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
        )}
      </header>

      <div className="px-5 py-4">
        <div>
          <ProgramMeter level={level} live={audioActive} />
        </div>

        <div className="mt-4 flex items-center gap-1.5">
          {episode.segments.map((item, index) => (
            <div
              key={item.id}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors',
                index < position.segmentIndex
                  ? 'bg-cue/50'
                  : index === position.segmentIndex
                    ? 'bg-cue'
                    : 'bg-ink/15',
              )}
            />
          ))}
        </div>
        <p className="mt-2 font-mono text-xs font-bold uppercase tracking-[0.08em] text-muted">
          Segment {Math.min(position.segmentIndex + 1, totalSegments)} of {totalSegments}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {isHost && (
            <Button
              variant="outline"
              onClick={onTogglePlayback}
              disabled={phase !== 'playing' && phase !== 'paused' && !replayReady}
              className="h-11 w-11 rounded-full p-0"
              aria-label={replayReady ? 'Replay episode' : phase === 'playing' ? 'Pause' : 'Play'}
            >
              {replayReady
                ? <RotateCcw className="h-4 w-4" />
                : phase === 'playing'
                  ? <Pause className="h-4 w-4" />
                  : <Play className="h-4 w-4 fill-current" />}
            </Button>
          )}

          <button
            type="button"
            onClick={onRequestFloor}
            disabled={!canTakeFloor}
            className={cn(
              'group relative flex h-11 items-center justify-center gap-2 overflow-hidden rounded-xl border-2 border-ink px-4',
              'text-ink shadow-card-sm transition-all outline-none',
              'focus-visible:ring-4 focus-visible:ring-cue/40',
              canTakeFloor
                ? 'bg-listener hover:-translate-y-0.5 active:translate-y-0'
                : 'cursor-not-allowed bg-raised text-muted shadow-none',
            )}
          >
            <Hand className="relative h-4 w-4" />
            <span className="relative whitespace-nowrap text-sm font-extrabold">Join conversation</span>
          </button>

          {floorHolderName && (
            <p className="flex min-w-0 items-center gap-2 text-sm font-bold text-cue">
              <Mic className="h-4 w-4 shrink-0" />
              <span className="truncate">{floorHolderName} is speaking</span>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
