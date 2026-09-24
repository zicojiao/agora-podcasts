'use client';

import { MessageCircle, Radio, Send, Trash2, Users } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { RoomChatMessage } from '@/hooks/useAgoraRoom';
import { CHAT_MESSAGE_MAX_LENGTH } from '@/lib/room-messages';
import { cn } from '@/lib/utils';

const CHAT_TIME = new Intl.DateTimeFormat('en', {
  hour: 'numeric',
  minute: '2-digit',
});

export function RoomChat({
  messages,
  currentUid,
  participantCount,
  connected,
  onSend,
  onClear,
}: {
  messages: RoomChatMessage[];
  currentUid: string | null;
  participantCount: number;
  connected: boolean;
  onSend: (message: string) => Promise<boolean>;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastMessageId = messages.at(-1)?.id;

  useEffect(() => {
    if (!lastMessageId) return;
    endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [lastMessageId]);

  const submit = async () => {
    const message = draft.trim();
    if (!message || sending || !connected) return;
    setSending(true);
    setSendError(null);
    const sent = await onSend(message);
    setSending(false);
    if (sent) {
      setDraft('');
      return;
    }
    setSendError('Message not sent. Check the room connection and try again.');
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    void submit();
  };

  return (
    <aside className="strip flex min-h-[500px] min-w-0 flex-col overflow-hidden bg-white xl:h-[calc(100vh-10.75rem)] xl:min-h-[560px]">
      <header className="border-b-2 border-ink bg-[#DFF6E8] px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 font-mono text-sm font-bold uppercase tracking-[0.1em] text-ink">
              <MessageCircle className="h-4 w-4" /> Room chat
            </p>
            <p className="mt-1 text-sm font-semibold text-muted">The conversation beside the conversation.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {messages.length > 0 && (
              <button
                type="button"
                onClick={onClear}
                aria-label="Clear chat on this device"
                title="Clear chat on this device"
                className="focus-ring flex h-8 w-8 items-center justify-center rounded-full border border-ink/15 bg-white/45 text-muted transition hover:border-ink/30 hover:bg-white hover:text-cue"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
            <span className="flex items-center gap-1.5 rounded-full border border-ink/20 bg-white/70 px-2.5 py-1 text-sm font-bold text-ink">
              <Users className="h-3.5 w-3.5" /> {participantCount}
            </span>
          </div>
        </div>
      </header>

      <div className="rail-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
        {messages.length === 0 ? (
          <div className="flex h-full min-h-56 flex-col items-center justify-center px-5 text-center">
            <span className="flex h-14 w-14 rotate-[-4deg] items-center justify-center rounded-2xl border-2 border-ink bg-listener shadow-card-sm">
              <Radio className="h-6 w-6" />
            </span>
            <h3 className="mt-5 display text-2xl">The side channel is open.</h3>
            <p className="mt-3 max-w-[15rem] text-base leading-6 text-muted">
              React to a point, share a note, or leave a question for everyone in the room.
            </p>
          </div>
        ) : (
          <ol className="space-y-4">
            {messages.map((message) => {
              const own = message.publisher === currentUid;
              return (
                <li key={message.id} className={cn('flex', own ? 'justify-end' : 'justify-start')}>
                  <article className={cn('max-w-[88%]', own && 'text-right')}>
                    <div className={cn('mb-1 flex items-center gap-2 px-1 text-sm', own && 'justify-end')}>
                      <span className="font-extrabold text-ink">{own ? 'You' : message.name}</span>
                      <time className="font-mono text-sm text-muted" dateTime={new Date(message.sentAt).toISOString()}>
                        {CHAT_TIME.format(message.sentAt)}
                      </time>
                    </div>
                    <p
                      className={cn(
                        'whitespace-pre-wrap break-words rounded-2xl border-2 border-ink px-3.5 py-2.5 text-left text-base leading-6 shadow-[2px_3px_0_#18203C]',
                        own ? 'rounded-br-md bg-cue text-white' : 'rounded-bl-md bg-[#F2F7FF] text-ink',
                      )}
                    >
                      {message.text}
                    </p>
                  </article>
                </li>
              );
            })}
          </ol>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={onSubmit} className="border-t-2 border-ink bg-canvas/70 p-4">
        <label htmlFor="room-chat-message" className="mb-2 block text-sm font-extrabold text-ink">
          Message the room
        </label>
        <div className="relative">
          <textarea
            id="room-chat-message"
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, CHAT_MESSAGE_MAX_LENGTH))}
            onKeyDown={onKeyDown}
            maxLength={CHAT_MESSAGE_MAX_LENGTH}
            rows={3}
            disabled={!connected || sending}
            placeholder={connected ? 'Add to the conversation…' : 'Connecting to room chat…'}
            className="field min-h-[86px] resize-none pb-9 pr-14"
          />
          <button
            type="submit"
            disabled={!connected || sending || !draft.trim()}
            className="focus-ring absolute bottom-3 right-3 flex h-10 w-10 items-center justify-center rounded-xl border-2 border-ink bg-listener text-ink shadow-[2px_3px_0_#18203C] transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:cursor-not-allowed disabled:bg-raised disabled:text-muted disabled:shadow-none"
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-2 flex items-start justify-between gap-3 text-sm font-semibold text-muted">
          <span>{sendError ?? 'Enter to send · Shift + Enter for a new line'}</span>
          <span className="shrink-0 font-mono">{draft.length}/{CHAT_MESSAGE_MAX_LENGTH}</span>
        </div>
      </form>
    </aside>
  );
}
