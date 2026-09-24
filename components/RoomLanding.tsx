'use client';

import Image from 'next/image';
import {
  AudioLines,
  ArrowRight,
  FileText,
  Headphones,
  Hand,
  MessageCircleQuestion,
  Mic,
  Radio,
  RadioTower,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createRoomCode, isRoomChannel } from '@/lib/room-code';
import { MAX_DISPLAY_NAME_LENGTH } from '@/lib/room-messages';
import { cn } from '@/lib/utils';
import { PoweredBy, Wordmark } from '@/components/Wordmark';
import type { RoomRole } from '@/hooks/useAgoraRoom';

export function RoomLanding({
  onEnter,
}: {
  onEnter: (options: { role: RoomRole; channel: string; displayName: string }) => void;
}) {
  const [displayName, setDisplayName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const howItWorksTriggerRef = useRef<HTMLButtonElement>(null);
  const howItWorksCloseRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!showHowItWorks) return;
    howItWorksCloseRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowHowItWorks(false);
        window.requestAnimationFrame(() => howItWorksTriggerRef.current?.focus());
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [showHowItWorks]);

  const closeHowItWorks = () => {
    setShowHowItWorks(false);
    window.requestAnimationFrame(() => howItWorksTriggerRef.current?.focus());
  };

  const name = displayName.trim();
  const startRoom = () => {
    if (!name) {
      setNameError('Enter your name to create a podcast.');
      nameInputRef.current?.focus();
      return;
    }
    setNameError(null);
    onEnter({ role: 'host', channel: createRoomCode(), displayName: name });
  };

  const joinRoom = () => {
    const channel = joinCode.trim();
    if (!isRoomChannel(channel)) {
      setCodeError('Room codes look like room-8kd2pq.');
      return;
    }
    setCodeError(null);
    onEnter({ role: 'listener', channel, displayName: name || 'Listener' });
  };

  return (
    <main className="notebook-page min-h-screen bg-canvas lg:h-screen lg:overflow-hidden">
      <header className="flex min-h-[72px] flex-wrap items-center justify-between gap-x-8 gap-y-2 border-b-2 border-ink bg-canvas/95 px-5 py-4 sm:px-8 lg:px-10">
        <Wordmark />
        <div className="flex items-center gap-3 sm:gap-4">
          <button
            ref={howItWorksTriggerRef}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={showHowItWorks}
            onClick={() => setShowHowItWorks(true)}
            className="focus-ring rounded-full border-2 border-ink bg-white px-4 py-2 text-sm font-extrabold text-ink shadow-card-sm transition hover:-translate-y-0.5 hover:bg-host-a/30"
          >
            How it works
          </button>
          <PoweredBy className="hidden sm:block sm:text-right" />
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[1380px] gap-6 px-5 py-6 sm:px-8 lg:h-[calc(100svh-72px)] lg:grid-cols-[1.08fr_0.92fr] lg:items-stretch lg:overflow-hidden lg:px-10 lg:py-5 xl:py-7">
        <section className="flex min-h-0 flex-col gap-4" aria-labelledby="landing-title">
          <div className="max-w-3xl">
            <h1 id="landing-title" className="display text-[clamp(3rem,4.6vw,4.75rem)] leading-[0.94] text-ink">
              A podcast<br />you can <span className="landing-underline text-cue">talk to.</span>
            </h1>
            <p className="mt-4 max-w-[700px] text-base font-semibold leading-7 text-muted sm:text-lg sm:leading-8">
              <span className="landing-tech-underline">Agora RTC</span> and Google Gemini turn your topic into a live, two-host podcast.{' '}
              <span className="landing-tech-underline">Gemini 3.8 Flash TTS</span> brings both hosts to life.{' '}
              When a listener interrupts, Gemini writes an answer, Flash TTS voices it, and Agora RTC plays the response inside the podcast before the original episode resumes.
            </p>
          </div>

          <div className="paper-panel flex min-h-0 flex-1 overflow-hidden bg-canvas">
            <div className="relative aspect-[3/2] min-h-[280px] overflow-hidden bg-canvas lg:aspect-auto lg:min-h-0 lg:flex-1">
              <Image
                src="/brand/agora-podcasts-hosts.png"
                alt="Two illustrated podcast hosts speaking around a microphone, with a raised hand inviting listeners to join."
                fill
                priority
                sizes="(min-width: 1024px) 52vw, 100vw"
                className="object-cover"
              />
            </div>
          </div>
        </section>

        <section className="paper-panel flex min-h-0 flex-col bg-white p-5 lg:overflow-hidden xl:p-7" aria-labelledby="desk-heading">
          <div className="flex items-start justify-between gap-5">
            <div>
              <span className="inline-flex items-center gap-2 font-mono text-sm font-medium uppercase tracking-[0.11em] text-onair">
                <span className="h-2.5 w-2.5 rounded-full bg-onair" /> Interactive podcast
              </span>
              <h2 id="desk-heading" className="display mt-2 text-4xl sm:text-5xl">Create your podcast.</h2>
              <p className="mt-2 text-base font-semibold leading-6 text-muted">Start with your name, then add a topic or a few notes.</p>
            </div>
            <span className="hidden rotate-3 rounded-full border-2 border-ink bg-host-a/50 p-3 shadow-card-sm sm:inline-flex">
              <Headphones className="h-6 w-6" />
            </span>
          </div>

          <label htmlFor="display-name" className="mt-4 block text-base font-extrabold text-ink xl:mt-6">
            What should the hosts call you?
          </label>
          <div className={cn('name-field-wrap mt-2', name && 'is-ready', nameError && 'border-onair ring-4 ring-onair/15')}>
            <Mic className="h-5 w-5 shrink-0 text-cue" />
            <input
              ref={nameInputRef}
              id="display-name"
              value={displayName}
              onChange={(event) => {
                setDisplayName(event.target.value);
                setNameError(null);
              }}
              maxLength={MAX_DISPLAY_NAME_LENGTH}
              placeholder="Your name"
              autoComplete="name"
              required
              aria-required="true"
              aria-invalid={Boolean(nameError)}
              aria-describedby={nameError ? 'display-name-required' : undefined}
              className="min-w-0 flex-1 bg-transparent text-lg font-bold text-ink outline-none placeholder:text-muted/55"
            />
            <span className={cn('font-mono text-sm font-bold uppercase tracking-[0.08em]', name ? 'text-cue' : nameError ? 'text-onair' : 'text-muted')}>
              {name ? 'Ready' : nameError ? 'Required' : 'Start here'}
            </span>
          </div>
          {nameError && <p id="display-name-required" className="mt-2 text-sm font-bold text-onair" role="alert">{nameError}</p>}

          <div className="mt-4 rounded-[20px] border-2 border-ink bg-cue p-4 text-white shadow-card-sm xl:mt-5 xl:p-5">
            <div className="flex items-start gap-4">
              <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-cue">
                <Radio className="h-5 w-5" />
              </span>
              <div>
                <h3 className="text-xl font-extrabold">Make a two-host show</h3>
                <p className="mt-1 text-base font-semibold leading-6 text-white/85">Gemini writes and voices it. You can listen, interrupt, and ask questions.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={startRoom}
              className="focus-ring mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-ink bg-listener px-6 text-base font-extrabold text-ink shadow-card-sm transition hover:-translate-y-0.5 hover:bg-[#ffe474] xl:mt-5 xl:h-13"
            >
              Create your podcast <ArrowRight className="h-4 w-4" />
            </button>
          </div>

          <div className="my-3 flex items-center gap-3 xl:my-5" aria-hidden="true">
            <span className="h-px flex-1 bg-ink/20" />
            <span className="font-mono text-sm font-medium uppercase tracking-[0.08em] text-muted">or join a live one</span>
            <span className="h-px flex-1 bg-ink/20" />
          </div>

          <div>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <MessageCircleQuestion className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-cue" />
              <input
                value={joinCode}
                onChange={(event) => {
                  setJoinCode(event.target.value);
                  setCodeError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') joinRoom();
                }}
                placeholder="Room code · room-8kd2pq"
                aria-label="Room code"
                autoCapitalize="none"
                spellCheck={false}
                className="field h-12 min-w-0 pl-11 font-mono"
              />
              </div>
              <button
                type="button"
                onClick={joinRoom}
                className="focus-ring h-12 shrink-0 rounded-xl border-2 border-ink bg-host-a px-5 text-base font-extrabold shadow-card-sm transition hover:-translate-y-0.5"
              >
                Join
              </button>
            </div>
            {codeError && <p className="mt-3 text-sm font-bold text-onair" role="alert">{codeError}</p>}
          </div>
        </section>
      </div>

      {showHowItWorks && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-4 backdrop-blur-sm sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeHowItWorks();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="how-it-works-title"
            className="paper-panel relative max-h-[calc(100svh-2rem)] w-full max-w-4xl overflow-y-auto bg-canvas p-5 sm:p-8"
          >
            <button
              ref={howItWorksCloseRef}
              type="button"
              aria-label="Close How it works"
              onClick={closeHowItWorks}
              className="focus-ring absolute right-4 top-4 inline-flex h-11 w-11 items-center justify-center rounded-full border-2 border-ink bg-white shadow-card-sm transition hover:-translate-y-0.5 hover:bg-listener sm:right-6 sm:top-6"
            >
              <X className="h-5 w-5" />
            </button>

            <span className="strip-label">Inside the broadcast</span>
            <h2 id="how-it-works-title" className="display mt-3 max-w-2xl pr-14 text-4xl sm:text-5xl">
              One AI show. One shared room.
            </h2>
            <p className="mt-3 max-w-2xl text-base font-semibold leading-7 text-muted sm:text-lg">
              The episode is generated once, streamed once, and heard together. A listener can interrupt without turning it into a separate private chat.
            </p>

            <ol className="mt-7 grid gap-3 md:grid-cols-2">
              <li className="rounded-[18px] border-2 border-ink bg-white p-4 shadow-card-sm">
                <div className="flex items-start gap-3">
                  <span className="role-icon bg-listener"><FileText className="h-4 w-4" /></span>
                  <div>
                    <p className="strip-label">01 · Topic</p>
                    <h3 className="mt-1 text-xl font-extrabold">Give it an idea</h3>
                    <p className="mt-1 font-semibold leading-6 text-muted">A topic, a question, or a few notes is enough.</p>
                  </div>
                </div>
              </li>
              <li className="rounded-[18px] border-2 border-ink bg-host-a/30 p-4 shadow-card-sm">
                <div className="flex items-start gap-3">
                  <span className="role-icon bg-white"><FileText className="h-4 w-4" /></span>
                  <div>
                    <p className="strip-label">02 · Script</p>
                    <h3 className="mt-1 text-xl font-extrabold">Gemini writes the show</h3>
                    <p className="mt-1 font-semibold leading-6 text-muted">Gemini 3.8 Flash builds a structured two-host conversation.</p>
                  </div>
                </div>
              </li>
              <li className="rounded-[18px] border-2 border-ink bg-host-b/35 p-4 shadow-card-sm">
                <div className="flex items-start gap-3">
                  <span className="role-icon bg-white"><AudioLines className="h-4 w-4" /></span>
                  <div>
                    <p className="strip-label">03 · Voice</p>
                    <h3 className="mt-1 text-xl font-extrabold">Two hosts come alive</h3>
                    <p className="mt-1 font-semibold leading-6 text-muted">Gemini 3.8 Flash TTS performs both voices as streaming audio.</p>
                  </div>
                </div>
              </li>
              <li className="rounded-[18px] border-2 border-ink bg-cue p-4 text-white shadow-card-sm">
                <div className="flex items-start gap-3">
                  <span className="role-icon bg-listener"><RadioTower className="h-4 w-4" /></span>
                  <div>
                    <p className="font-mono text-sm font-medium uppercase tracking-[0.13em] text-white/70">04 · Live room</p>
                    <h3 className="mt-1 text-xl font-extrabold">Agora shares one broadcast</h3>
                    <p className="mt-1 font-semibold leading-6 text-white/80">RTC carries the program audio; RTM keeps playback, rooms, and floor control in sync.</p>
                  </div>
                </div>
              </li>
            </ol>

            <div className="mt-5 flex items-start gap-4 rounded-[18px] border-2 border-ink bg-listener p-4 sm:p-5">
              <span className="role-icon shrink-0 bg-white"><Hand className="h-4 w-4" /></span>
              <div>
                <h3 className="text-xl font-extrabold">Then a listener speaks up.</h3>
                <p className="mt-1 font-semibold leading-6 text-ink/75">
                  Their mic goes live through Agora. Gemini Live transcribes the question, the same hosts answer it, and the episode resumes from the exact point where it paused.
                </p>
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
