// RTM protocol for the shared listening room.
//
// The host is authoritative: it owns the episode, the program audio, and the floor. Every
// other client renders what the host reports. Messages arrive from other browsers, so
// nothing here is trusted — each payload is validated before it reaches app state.

import { QUESTION_MAX_LENGTH, parseEpisode, type Episode, type Turn } from '@/lib/episode';

export type RoomPhase =
  | 'idle'
  | 'scripting'
  | 'buffering'
  | 'playing'
  | 'paused'
  | 'listening'
  | 'thinking'
  | 'answering'
  | 'resuming'
  | 'completed'
  | 'failed';

export type RoomState = {
  phase: RoomPhase;
  episodeId: string | null;
  segmentIndex: number;
  turnIndex: number;
  askerUid: string | null;
  askerName: string | null;
  note: string | null;
};

export const EMPTY_ROOM_STATE: RoomState = {
  phase: 'idle',
  episodeId: null,
  segmentIndex: 0,
  turnIndex: 0,
  askerUid: null,
  askerName: null,
  note: null,
};

export type RoomMessage =
  | { t: 'hello'; name: string }
  | ChatMessage
  | { t: 'state'; state: RoomState }
  | { t: 'episode.chunk'; id: string; index: number; total: number; data: string }
  | { t: 'floor.request'; name: string }
  | { t: 'floor.grant'; uid: string; name: string }
  | { t: 'floor.deny'; uid: string; reason: string }
  | { t: 'floor.transcript'; text: string; final: boolean }
  | { t: 'floor.ready' }
  | { t: 'floor.release' }
  | { t: 'episode.replay' }
  | { t: 'episode.restart' }
  | (InterruptionMeta & { t: 'question' })
  | (InterruptionMeta & { t: 'answer'; turns: Turn[] });

export type InterruptionMeta = {
  id: string;
  question: string;
  askerName: string;
  afterSegmentIndex: number;
  afterTurnIndex: number;
};

// RTM caps a single message well below the size of a full episode, so the episode travels
// as ordered chunks and is reassembled by each listener.
export const EPISODE_CHUNK_SIZE = 6_000;
export const MAX_DISPLAY_NAME_LENGTH = 24;
export const CHAT_MESSAGE_MAX_LENGTH = 280;
export const CHAT_HISTORY_LIMIT = 100;

export type ChatMessage = {
  t: 'chat.message';
  id: string;
  name: string;
  text: string;
  sentAt: number;
};

export type RoomChatMessage = ChatMessage & {
  publisher: string;
};

const PHASES: RoomPhase[] = [
  'idle', 'scripting', 'buffering', 'playing', 'paused',
  'listening', 'thinking', 'answering', 'resuming', 'completed', 'failed',
];

function str(value: unknown, max: number) {
  return typeof value === 'string' && value.length <= max ? value : null;
}

function index(value: unknown) {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < 10_000
    ? (value as number)
    : null;
}

export function sanitizeDisplayName(value: unknown, fallback = 'Listener') {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(/\s+/g, ' ').trim().slice(0, MAX_DISPLAY_NAME_LENGTH);
  return cleaned || fallback;
}

export function sanitizeChatText(value: unknown) {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\r\n/g, '\n').trim().slice(0, CHAT_MESSAGE_MAX_LENGTH);
  return cleaned || null;
}

export function appendChatMessage<T extends ChatMessage>(current: T[], message: T) {
  if (current.some((item) => item.id === message.id)) return current;
  return [...current, message].slice(-CHAT_HISTORY_LIMIT);
}

/** Applies the chat-visible part of a validated RTM room event. */
export function reduceRoomChatMessages(
  current: RoomChatMessage[],
  message: RoomMessage,
  publisher: string,
) {
  if (message.t === 'episode.restart') return [];
  if (message.t !== 'chat.message') return current;
  return appendChatMessage(current, { ...message, publisher });
}

function parseRoomState(value: unknown): RoomState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const phase = PHASES.find((candidate) => candidate === raw.phase);
  const segmentIndex = index(raw.segmentIndex);
  const turnIndex = index(raw.turnIndex);
  if (!phase || segmentIndex === null || turnIndex === null) return null;
  return {
    phase,
    episodeId: str(raw.episodeId, 64),
    segmentIndex,
    turnIndex,
    askerUid: str(raw.askerUid, 64),
    askerName: raw.askerName === null ? null : sanitizeDisplayName(raw.askerName),
    note: str(raw.note, 160),
  };
}

function parseAnswerTurns(value: unknown): Turn[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 6) return null;
  const turns = value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const { hostId, text, style } = entry as Record<string, unknown>;
    if (hostId !== 'host-a' && hostId !== 'host-b') return null;
    const parsedText = str(text, 600);
    if (!parsedText?.trim()) return null;
    const parsedStyle = str(style, 200);
    return { hostId, text: parsedText, ...(parsedStyle ? { style: parsedStyle } : {}) } as Turn;
  });
  return turns.some((turn) => turn === null) ? null : (turns as Turn[]);
}

function parseInterruption(value: Record<string, unknown>) {
  const id = str(value.id, 80);
  const question = str(value.question, QUESTION_MAX_LENGTH);
  const afterSegmentIndex = index(value.afterSegmentIndex);
  const afterTurnIndex = index(value.afterTurnIndex);
  if (!id?.trim() || !question?.trim() || afterSegmentIndex === null || afterTurnIndex === null) return null;
  return {
    id,
    question,
    askerName: sanitizeDisplayName(value.askerName),
    afterSegmentIndex,
    afterTurnIndex,
  };
}

export function encodeRoomMessage(message: RoomMessage) {
  return JSON.stringify(message);
}

/** Validates one inbound RTM payload. Returns null for anything unrecognized. */
export function decodeRoomMessage(raw: string | Uint8Array): RoomMessage | null {
  if (typeof raw !== 'string' || raw.length > 64_000) return null;
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;

  switch (value.t) {
    case 'hello':
      return { t: 'hello', name: sanitizeDisplayName(value.name) };
    case 'chat.message': {
      const id = str(value.id, 64);
      const text = sanitizeChatText(value.text);
      const sentAt = value.sentAt;
      if (!id?.trim() || !text || !Number.isSafeInteger(sentAt) || (sentAt as number) < 0) return null;
      return {
        t: 'chat.message',
        id,
        name: sanitizeDisplayName(value.name),
        text,
        sentAt: sentAt as number,
      };
    }
    case 'state': {
      const state = parseRoomState(value.state);
      return state ? { t: 'state', state } : null;
    }
    case 'episode.chunk': {
      const id = str(value.id, 64);
      const chunkIndex = index(value.index);
      const total = index(value.total);
      const data = str(value.data, EPISODE_CHUNK_SIZE * 2);
      if (!id || chunkIndex === null || total === null || total < 1 || chunkIndex >= total || data === null) return null;
      return { t: 'episode.chunk', id, index: chunkIndex, total, data };
    }
    case 'floor.request':
      return { t: 'floor.request', name: sanitizeDisplayName(value.name) };
    case 'floor.grant': {
      const uid = str(value.uid, 64);
      return uid ? { t: 'floor.grant', uid, name: sanitizeDisplayName(value.name) } : null;
    }
    case 'floor.deny': {
      const uid = str(value.uid, 64);
      return uid ? { t: 'floor.deny', uid, reason: str(value.reason, 160) ?? 'Someone else has the floor.' } : null;
    }
    case 'floor.transcript': {
      const text = str(value.text, QUESTION_MAX_LENGTH);
      return text === null ? null : { t: 'floor.transcript', text, final: value.final === true };
    }
    case 'floor.ready':
      return { t: 'floor.ready' };
    case 'floor.release':
      return { t: 'floor.release' };
    case 'episode.replay':
      return { t: 'episode.replay' };
    case 'episode.restart':
      return { t: 'episode.restart' };
    case 'question': {
      const interruption = parseInterruption(value);
      return interruption ? { t: 'question', ...interruption } : null;
    }
    case 'answer': {
      const turns = parseAnswerTurns(value.turns);
      const interruption = parseInterruption(value);
      return turns && interruption ? { t: 'answer', ...interruption, turns } : null;
    }
    default:
      return null;
  }
}

export function chunkEpisode(episode: Episode): RoomMessage[] {
  const serialized = JSON.stringify(episode);
  const total = Math.max(1, Math.ceil(serialized.length / EPISODE_CHUNK_SIZE));
  return Array.from({ length: total }, (_, chunkIndex) => ({
    t: 'episode.chunk' as const,
    id: episode.id,
    index: chunkIndex,
    total,
    data: serialized.slice(chunkIndex * EPISODE_CHUNK_SIZE, (chunkIndex + 1) * EPISODE_CHUNK_SIZE),
  }));
}

/** Accumulates episode chunks until one complete, valid episode can be produced. */
export class EpisodeAssembler {
  private id: string | null = null;
  private total = 0;
  private parts = new Map<number, string>();

  accept(message: Extract<RoomMessage, { t: 'episode.chunk' }>): Episode | null {
    if (message.id !== this.id) {
      this.id = message.id;
      this.total = message.total;
      this.parts.clear();
    }
    this.parts.set(message.index, message.data);
    if (this.parts.size !== this.total) return null;

    const ordered = Array.from({ length: this.total }, (_, index) => this.parts.get(index) ?? '').join('');
    this.parts.clear();
    this.id = null;
    try {
      const parsed = parseEpisode(JSON.parse(ordered));
      return typeof parsed === 'string' ? null : parsed;
    } catch {
      return null;
    }
  }
}
