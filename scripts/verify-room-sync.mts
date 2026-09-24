import type { Episode } from '@/lib/episode';
import type { RoomMessage, RoomState } from '@/lib/room-messages';

const roomSync = await import('@/lib/room-sync').catch(() => null) as null | {
  publishRoomSnapshot: (options: {
    isHost: boolean;
    connection: 'idle' | 'connecting' | 'connected' | 'failed';
    episode: Episode | null;
    state: RoomState;
    send: (message: RoomMessage) => Promise<void>;
  }) => Promise<boolean>;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const episode: Episode = {
  id: 'ep-sync-test',
  title: 'Room synchronization',
  summary: 'A regression fixture for a host that produces before RTM connects.',
  hosts: [
    { id: 'host-a', name: 'Ada', role: 'Host', voice: 'Puck' },
    { id: 'host-b', name: 'Miles', role: 'Co-host', voice: 'Kore' },
  ],
  segments: [
    {
      id: 'seg-1',
      topic: 'Before connection',
      turns: Array.from({ length: 4 }, (_, index) => ({
        hostId: index % 2 === 0 ? 'host-a' as const : 'host-b' as const,
        text: `This is synchronization test turn ${index + 1}, with enough text to pass validation.`,
        style: 'natural',
      })),
    },
    {
      id: 'seg-2',
      topic: 'After connection',
      turns: Array.from({ length: 4 }, (_, index) => ({
        hostId: index % 2 === 0 ? 'host-a' as const : 'host-b' as const,
        text: `This is the second synchronization segment turn ${index + 1}, also valid.`,
        style: 'natural',
      })),
    },
  ],
};

const state: RoomState = {
  phase: 'playing',
  episodeId: episode.id,
  segmentIndex: 0,
  turnIndex: 1,
  askerUid: null,
  askerName: null,
  note: null,
};

assert(roomSync, 'room snapshot publisher is missing');

const sent: RoomMessage[] = [];
const send = async (message: RoomMessage) => {
  sent.push(message);
};

const whileConnecting = await roomSync.publishRoomSnapshot({
  isHost: true,
  connection: 'connecting',
  episode,
  state,
  send,
});
assert(whileConnecting === false, 'a connecting host reported a successful room sync');
assert(sent.length === 0, 'a connecting host attempted to publish before RTM was ready');

const afterConnection = await roomSync.publishRoomSnapshot({
  isHost: true,
  connection: 'connected',
  episode,
  state,
  send,
});
assert(afterConnection === true, 'a connected host did not publish its existing episode');
assert(sent.some((message) => message.t === 'episode.chunk'), 'the existing episode was not replayed');
assert(sent.at(-1)?.t === 'state', 'the current room state was not published after the episode');

console.log(`Room sync verification passed (${sent.length} messages).`);
