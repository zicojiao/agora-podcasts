'use client';

import { cn } from '@/lib/utils';

const SEGMENTS = 14;

/**
 * A segmented level ladder, lit from the bottom.
 *
 * Driven by the real RMS the worklet reports, so it is dark when nothing is playing rather
 * than animating on a timer. The top two segments run hot, the way a desk meter does.
 */
export function LevelMeter({
  level,
  tone = 'host-a',
  className,
}: {
  level: number;
  tone?: 'host-a' | 'host-b' | 'cue' | 'onair';
  className?: string;
}) {
  const lit = Math.round(Math.min(1, Math.max(0, level)) * SEGMENTS);

  return (
    <div className={cn('flex h-full flex-col-reverse gap-[3px]', className)} aria-hidden="true">
      {Array.from({ length: SEGMENTS }, (_, index) => {
        const isOn = index < lit;
        const isHot = index >= SEGMENTS - 2;
        return (
          <span
            key={index}
            className={cn(
              'meter-seg h-[3px] flex-1 rounded-[1px]',
              !isOn && 'bg-ink/[0.12]',
              isOn && isHot && 'bg-onair',
              isOn && !isHot && {
                'bg-host-a': tone === 'host-a',
                'bg-host-b': tone === 'host-b',
                'bg-cue': tone === 'cue',
                'bg-onair': tone === 'onair',
              },
            )}
          />
        );
      })}
    </div>
  );
}

/** Horizontal variant for the wide program meter above the transport controls. */
export function ProgramMeter({ level, live }: { level: number; live: boolean }) {
  const bars = 56;
  const lit = Math.min(1, Math.max(0, level));

  return (
    <div className="flex h-10 items-end gap-[2px]" aria-hidden="true">
      {Array.from({ length: bars }, (_, index) => {
        // A fixed profile shaped by the live level, so the shape reads as a waveform
        // rather than as a row of identical bars.
        const envelope = 0.4 + 0.6 * Math.sin((index / bars) * Math.PI);
        const grain = 0.7 + 0.3 * Math.sin(index * 2.399);
        const height = live ? Math.max(3, lit * envelope * grain * 100) : 2;
        return (
          <span
            key={index}
            className={cn(
              'meter-seg flex-1 rounded-[1px]',
              live ? 'bg-cue/80' : 'bg-ink/[0.12]',
            )}
            style={{ height: `${Math.min(100, height)}%` }}
          />
        );
      })}
    </div>
  );
}
