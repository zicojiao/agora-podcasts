'use client';

import { Loader2, MessageCircleQuestion } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { findHost, type Episode } from '@/lib/episode';
import { transcriptScrollTarget } from '@/lib/transcript-scroll';
import { cn } from '@/lib/utils';
import type { AnswerRecord } from '@/hooks/useEpisodeDirector';

export function TranscriptRail({
  episode,
  position,
  answers,
  live,
}: {
  episode: Episode;
  position: { segmentIndex: number; turnIndex: number };
  answers: AnswerRecord[];
  live: boolean;
}) {
  const activeRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const activeTurn = activeRef.current;
    const rail = railRef.current;
    if (!live || !activeTurn || !rail) return;

    const railRect = rail.getBoundingClientRect();
    const activeRect = activeTurn.getBoundingClientRect();
    const target = transcriptScrollTarget({
      viewportTop: railRect.top,
      viewportBottom: railRect.bottom,
      itemTop: activeRect.top,
      itemBottom: activeRect.bottom,
      currentScrollTop: rail.scrollTop,
      padding: 48,
    });

    if (target !== null) rail.scrollTo({ top: target, behavior: 'auto' });
  }, [live, position.segmentIndex, position.turnIndex]);

  return (
    <aside className="strip flex min-h-0 flex-col overflow-hidden bg-white">
      <header className="border-b-2 border-ink bg-host-b/25 px-5 py-4">
        <p className="font-mono text-sm font-bold uppercase tracking-[0.12em] text-ink">Live notebook</p>
      </header>

      <div ref={railRef} className="rail-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {episode.segments.map((segment, segmentIndex) => {
          return (
            <section key={segment.id} className="mb-6 last:mb-0">
              <h3 className="sticky top-0 z-10 -mx-5 mb-4 border-y border-ink/10 bg-canvas px-5 py-2 font-mono text-sm font-bold uppercase tracking-[0.08em] text-muted">
                {segmentIndex + 1}. {segment.topic}
              </h3>
              <ol className="space-y-3">
                {segment.turns.map((turn, turnIndex) => {
                  const host = findHost(episode, turn.hostId);
                  const isCurrent = segmentIndex === position.segmentIndex && turnIndex === position.turnIndex;
                  const isPast = segmentIndex < position.segmentIndex
                    || (segmentIndex === position.segmentIndex && turnIndex < position.turnIndex);
                  const insertions = answers.filter((answer) => (
                    answer.afterSegmentIndex === segmentIndex && answer.afterTurnIndex === turnIndex
                  ));
                  return (
                    <li key={`${segment.id}-${turnIndex}`} className="space-y-3">
                      <div
                        ref={isCurrent ? activeRef : undefined}
                        className={cn(
                          'rounded-r-xl border-l-2 py-2 pl-3 pr-3 transition-colors duration-200',
                          isCurrent
                            ? turn.hostId === 'host-a'
                              ? 'border-host-a bg-host-a/10'
                              : 'border-host-b bg-host-b/10'
                            : 'border-ink/15 bg-transparent',
                        )}
                      >
                        <p
                          className={cn(
                            'text-sm font-extrabold',
                            turn.hostId === 'host-a' ? 'text-host-a' : 'text-host-b',
                          )}
                        >
                          {host.name}
                        </p>
                        <p
                          className={cn(
                            'mt-1 text-base font-medium leading-7 transition-colors duration-200',
                            isCurrent ? 'text-ink' : isPast ? 'text-muted' : 'text-muted/70',
                          )}
                        >
                          {turn.text}
                        </p>
                      </div>

                      {insertions.map((answer) => (
                        <div
                          key={answer.id}
                          className="rounded-2xl border-2 border-ink bg-listener/35 p-4 shadow-card-sm"
                        >
                          <p className="flex items-center gap-2 text-sm font-extrabold text-cue">
                            <MessageCircleQuestion className="h-3.5 w-3.5" />
                            Question from {answer.askerName}
                          </p>
                          <p className="mt-2 text-base leading-7 text-ink/80">“{answer.question}”</p>
                          {answer.status === 'thinking' ? (
                            <p className="mt-3 flex items-center gap-2 border-t-2 border-ink/15 pt-3 text-sm font-bold text-muted">
                              <Loader2 className="h-4 w-4 animate-spin text-cue" />
                              The hosts are preparing an answer for {answer.askerName}…
                            </p>
                          ) : (
                            <ol className="mt-3 space-y-3 border-t-2 border-ink/15 pt-3">
                              {answer.turns.map((answerTurn, answerTurnIndex) => (
                                <li key={answerTurnIndex}>
                                  <span
                                    className={cn(
                                      'text-sm font-extrabold',
                                      answerTurn.hostId === 'host-a' ? 'text-host-a' : 'text-host-b',
                                    )}
                                  >
                                    {findHost(episode, answerTurn.hostId).name}
                                  </span>
                                  <p className="mt-1 text-base leading-7 text-muted">{answerTurn.text}</p>
                                </li>
                              ))}
                            </ol>
                          )}
                        </div>
                      ))}
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </div>
    </aside>
  );
}
