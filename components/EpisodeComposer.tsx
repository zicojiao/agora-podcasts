'use client';

import { BookOpenText, FileText, Loader2, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { SOURCE_MAX_LENGTH, SOURCE_MIN_LENGTH } from '@/lib/episode';
import { Button } from '@/components/ui/button';

const EXAMPLE_TOPIC = 'Create a lively podcast about the next generation of broadcasting. Explore what changes when an AI-generated two-host show becomes a live conversation that listeners can interrupt, question, and then rejoin. Let the hosts debate personalized curiosity and shared participation against the risk of losing editorial structure.';

export function EpisodeComposer({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (source: string) => void;
}) {
  const [source, setSource] = useState('');
  const length = source.trim().length;
  const tooShort = length > 0 && length < SOURCE_MIN_LENGTH;
  const canCreate = !busy && length >= SOURCE_MIN_LENGTH && length <= SOURCE_MAX_LENGTH;

  return (
    <section className="strip overflow-hidden bg-surface">
      <div className="border-b-2 border-ink bg-host-a/35 px-6 py-5 sm:px-8">
        <span className="sticker"><BookOpenText className="h-4 w-4" /> New podcast</span>
      </div>
      <div className="p-6 sm:p-8">
      <h2 className="display text-4xl">
        What should the hosts talk about?
      </h2>
      <p className="mt-3 max-w-2xl text-base leading-7 text-muted">
        Give them a topic, a question, or a few notes. Gemini will develop it into a two-host show.
      </p>

      <textarea
        value={source}
        onChange={(event) => setSource(event.target.value)}
        maxLength={SOURCE_MAX_LENGTH}
        rows={6}
        disabled={busy}
        placeholder="Try: How will interactive podcasts change the way we learn?"
        className="field mt-7 min-h-40 resize-y bg-canvas/60 leading-7"
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-sm font-semibold text-muted">
          <span className={tooShort ? 'text-onair' : undefined}>
            {length.toLocaleString()} / {SOURCE_MAX_LENGTH.toLocaleString()}
          </span>
          {tooShort && <span className="text-onair">add a little more detail</span>}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => setSource(EXAMPLE_TOPIC)}
          aria-label="Fill example topic: The next generation of broadcast"
          className="focus-ring inline-flex items-center gap-2 rounded-lg border-2 border-ink/70 bg-listener/70 px-3 py-1.5 text-sm font-extrabold text-ink transition hover:-translate-y-0.5 hover:bg-listener disabled:opacity-50"
        >
          <FileText className="h-4 w-4" aria-hidden="true" />
          Use example · The next generation of broadcast
        </button>
      </div>

      <Button onClick={() => onCreate(source)} disabled={!canCreate} className="mt-5 h-16 w-full text-lg shadow-card sm:h-[72px]">
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
        {busy ? 'Production in progress…' : 'Generate podcast'}
      </Button>
      </div>
    </section>
  );
}
