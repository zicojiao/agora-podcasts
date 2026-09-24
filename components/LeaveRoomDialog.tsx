'use client';

import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { RoomRole } from '@/hooks/useAgoraRoom';

type LeaveRoomDialogProps = {
  role: RoomRole;
  leaving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function LeaveRoomDialog({ role, leaving, onCancel, onConfirm }: LeaveRoomDialogProps) {
  const isHost = role === 'host';

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/45 px-5 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !leaving) onCancel();
      }}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="leave-room-title"
        aria-describedby="leave-room-description"
        className="w-full max-w-md rounded-[28px] border-2 border-ink bg-canvas p-6 shadow-card sm:p-7"
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-ink bg-onair/30">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <h2 id="leave-room-title" className="display mt-5 text-3xl leading-tight">
          {isHost ? 'End the live room?' : 'Leave this live room?'}
        </h2>
        <p id="leave-room-description" className="mt-3 text-base leading-7 text-muted">
          {isHost
            ? 'The podcast will stop and this host will disconnect from Agora RTC. Listeners will no longer hear the broadcast.'
            : 'You will disconnect from Agora RTC and stop hearing this broadcast. The host and other listeners can keep going.'}
        </p>
        <div className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={leaving}
            className="h-14 w-full px-6 text-base font-bold"
            autoFocus
          >
            {isHost ? 'Keep broadcasting' : 'Stay in room'}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={leaving}
            className="h-14 w-full bg-onair px-6 text-base font-bold text-white hover:bg-onair/90"
          >
            {leaving && <Loader2 className="h-4 w-4 animate-spin" />}
            {leaving ? 'Disconnecting…' : isHost ? 'End live room' : 'Leave room'}
          </Button>
        </div>
      </section>
    </div>
  );
}
