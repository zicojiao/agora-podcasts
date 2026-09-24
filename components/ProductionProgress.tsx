'use client';

import { Check, FilePenLine, Loader2, Mic2, Radio } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  PRODUCTION_STEPS,
  productionProgressFor,
  type ProductionPhase,
} from '@/lib/production-progress';

const STEP_ICONS = [FilePenLine, Mic2, Radio] as const;
const COPY_INTERVAL_MS = 4_500;

export function ProductionProgress({
  phase,
  note,
}: {
  phase: ProductionPhase;
  note?: string | null;
}) {
  const [copyIndex, setCopyIndex] = useState(0);

  useEffect(() => {
    setCopyIndex(0);
    const timer = window.setInterval(() => setCopyIndex((current) => current + 1), COPY_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [phase]);

  const progress = productionProgressFor(phase, copyIndex);
  const completion = ((progress.activeStep + 1) / PRODUCTION_STEPS.length) * 100;

  return (
    <section
      className="strip overflow-hidden bg-white shadow-card"
      aria-live="polite"
      aria-label="Podcast production progress"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-ink bg-listener/55 px-5 py-3 sm:px-6">
        <div className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-[0.12em] text-ink">
          <Loader2 className="h-4 w-4 animate-spin text-cue" />
          Production rundown
        </div>
        <span className="font-mono text-sm font-bold text-muted">
          Step {progress.activeStep + 1} of {PRODUCTION_STEPS.length}
        </span>
      </div>

      <div className="px-5 py-5 sm:px-6 sm:py-6">
        <div className="h-2 overflow-hidden rounded-full border-2 border-ink bg-canvas" aria-hidden="true">
          <div
            className="h-full bg-cue transition-[width] duration-700 ease-out"
            style={{ width: `${completion}%` }}
          />
        </div>

        <ol className="mt-5 grid gap-3 sm:grid-cols-3">
          {PRODUCTION_STEPS.map((step, index) => {
            const Icon = STEP_ICONS[index];
            const complete = index < progress.activeStep;
            const active = index === progress.activeStep;
            return (
              <li
                key={step.label}
                className={cn(
                  'rounded-xl border-2 border-ink px-4 py-3 transition-colors',
                  complete && 'bg-host-a/35',
                  active && 'bg-host-b/35 shadow-card-sm',
                  !complete && !active && 'bg-canvas/55 text-muted',
                )}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-ink',
                      complete ? 'bg-ink text-white' : active ? 'bg-white text-ink' : 'bg-canvas text-muted',
                    )}
                  >
                    {complete ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0">
                    <p className="text-base font-extrabold leading-5 text-ink">{step.label}</p>
                    <p className="mt-1 font-mono text-sm font-bold leading-5 text-muted">{step.technicalLabel}</p>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="mt-5 border-l-4 border-cue pl-4">
          <p className="text-lg font-extrabold leading-6 text-ink">{note ?? progress.title}</p>
          <p key={`${phase}-${copyIndex}`} className="mt-1.5 text-base font-semibold leading-6 text-muted">
            {progress.detail}
          </p>
        </div>
      </div>
    </section>
  );
}
