import type { Episode } from '@/lib/episode';
import { chunkEpisode, type RoomMessage, type RoomState } from '@/lib/room-messages';

type RoomConnection = 'idle' | 'connecting' | 'connected' | 'failed';

/**
 * Publishes a complete host snapshot once RTM is ready.
 *
 * Episode production is allowed to finish while Agora is still connecting. Replaying the
 * snapshot on the connection transition closes that race: a listener no longer depends on
 * either the original episode publish or its one-time `hello` arriving at exactly the right
 * moment.
 */
export async function publishRoomSnapshot({
  isHost,
  connection,
  episode,
  state,
  send,
}: {
  isHost: boolean;
  connection: RoomConnection;
  episode: Episode | null;
  state: RoomState;
  send: (message: RoomMessage) => Promise<void>;
}) {
  if (!isHost || connection !== 'connected' || !episode) return false;

  // Preserve chunk order and put state last, so listeners can render the episode before
  // applying a playing/paused position that refers to it.
  for (const chunk of chunkEpisode(episode)) await send(chunk);
  await send({ t: 'state', state });
  return true;
}
