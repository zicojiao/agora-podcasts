'use client';

import { Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function RestartEpisodeDialog({
  restarting,
  onCancel,
  onConfirm,
}: {
  restarting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/45 px-5 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !restarting) onCancel();
      }}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="restart-episode-title"
        aria-describedby="restart-episode-description"
        className="w-full max-w-md rounded-[28px] border-2 border-ink bg-canvas p-6 shadow-card sm:p-7"
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-ink bg-host-a/35">
          <RotateCcw className="h-5 w-5" />
        </div>
        <h2 id="restart-episode-title" className="display mt-5 text-3xl leading-tight">
          Restart from the beginning?
        </h2>
        <p id="restart-episode-description" className="mt-3 text-base leading-7 text-muted">
          The podcast will restart from the first line for everyone. Listener questions and
          host answers will be removed. Room chat will also be removed.
        </p>
        <div className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={restarting}
            className="h-14 w-full px-6 text-base font-bold"
            autoFocus
          >
            Keep current place
          </Button>
          <Button
            onClick={onConfirm}
            disabled={restarting}
            className="h-14 w-full bg-cue px-6 text-base font-bold text-white hover:bg-cue/90"
          >
            {restarting && <Loader2 className="h-4 w-4 animate-spin" />}
            {restarting ? 'Restarting…' : 'Restart episode'}
          </Button>
        </div>
      </section>
    </div>
  );
}
