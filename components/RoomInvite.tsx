'use client';

import { Headphones, Radio } from 'lucide-react';
import { useState } from 'react';
import { MAX_DISPLAY_NAME_LENGTH } from '@/lib/room-messages';
import { Button } from '@/components/ui/button';
import { PoweredBy, Wordmark } from '@/components/Wordmark';

/**
 * Landing screen for a shared room link.
 *
 * The tap is not just ceremony: browsers require a user gesture before audio may play, so
 * this is where a listener's playback permission is actually established. Asking for a name
 * at the same time means the trip from link to live audio is one screen and one tap.
 */
export function RoomInvite({
  channel,
  onEnter,
}: {
  channel: string;
  onEnter: (displayName: string) => void;
}) {
  const [displayName, setDisplayName] = useState('');

  const enter = () => onEnter(displayName.trim() || 'Listener');

  return (
    <main className="notebook-page flex min-h-screen items-center justify-center bg-canvas px-5 py-12">
      <div className="paper-panel w-full max-w-lg bg-white p-7 sm:p-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Wordmark />
          <PoweredBy />
        </div>

        <span className="sticker mt-9"><Radio className="h-4 w-4" /> Live invitation</span>
        <h1 className="mt-7 display text-5xl leading-[1.02]">
          You&rsquo;re invited to
          <span className="text-cue"> listen in.</span>
        </h1>
        <p className="mt-5 text-base leading-7 text-muted">
          A two-host episode is playing in room{' '}
          <span className="font-mono text-ink/90">{channel}</span>. You&rsquo;ll hear it live —
          and you can take the floor at any point to ask the hosts a question out loud.
        </p>

        <label className="mt-8 block text-base font-extrabold text-ink">
          Your name
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') enter();
            }}
            maxLength={MAX_DISPLAY_NAME_LENGTH}
            placeholder="How the hosts should address you"
            autoFocus
            className="field mt-2"
          />
        </label>

        <Button onClick={enter} className="mt-5 h-12 w-full">
          <Headphones className="h-4 w-4" /> Start listening
        </Button>

        <p className="mt-6 text-sm font-semibold leading-6 text-muted">
          Your microphone stays off until you choose to take the floor.
        </p>
      </div>
    </main>
  );
}
