import Image from 'next/image';
import { cn } from '@/lib/utils';

// Public product names only. Internal model aliases must never enter browser-facing copy.
export const TTS_PRODUCT_NAME = 'Gemini 3.8 Flash TTS';
export const RTC_PRODUCT_NAME = 'Agora RTC';

/** The on-air lamp. Dark when idle, lit red only when audio is actually going out. */
export function Tally({ live, className }: { live: boolean; className?: string }) {
  return (
    <span className={cn('relative inline-flex h-2.5 w-2.5 shrink-0', className)}>
      <span
        className={cn(
          'absolute inset-0 rounded-full transition-colors',
          live ? 'bg-onair' : 'bg-ink/20',
        )}
      />
      {live && <span className="absolute inset-0 animate-ping rounded-full bg-onair/60" />}
    </span>
  );
}

export function Wordmark({ live = false, className }: { live?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-3', className)}>
      <span className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center">
        <Image
          src="/brand/agora-podcasts-logo.png"
          alt=""
          width={44}
          height={44}
          priority
          className="h-11 w-11 object-contain"
        />
        <Tally
          live={live}
          className="absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-canvas bg-canvas"
        />
      </span>
      <span className="display text-[26px] font-bold tracking-[-0.03em]">Agora Podcasts</span>
    </span>
  );
}

/** Names both technologies explicitly — "powered by Gemini" alone told nobody anything. */
export function PoweredBy({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2.5 rounded-2xl border-2 border-ink bg-listener px-4 py-2.5 text-left text-ink shadow-card-sm',
        className,
      )}
    >
      <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-cue" aria-hidden="true" />
      <span className="flex items-baseline whitespace-nowrap text-[15px] font-extrabold leading-5 sm:text-base">
        <span className="mr-2 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-ink/60">
          Powered by
        </span>
        <span className="text-cue">{RTC_PRODUCT_NAME}</span>
        <span className="px-1.5 text-ink/45">+</span>
        <span className="text-onair">{TTS_PRODUCT_NAME}</span>
      </span>
    </span>
  );
}
