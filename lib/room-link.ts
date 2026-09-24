import { isRoomChannel } from '@/lib/room-code';

export function readRoomChannel(url: string) {
  try {
    const room = new URL(url).searchParams.get('room');
    return room && isRoomChannel(room) ? room : null;
  } catch {
    return null;
  }
}

export function buildRoomUrl(currentUrl: string, channel: string) {
  if (!isRoomChannel(channel)) throw new Error('Invalid room channel.');

  const url = new URL(currentUrl);
  url.searchParams.set('room', channel);
  return url.toString();
}

export function clearRoomUrl(currentUrl: string) {
  const url = new URL(currentUrl);
  url.searchParams.delete('room');
  return url.toString();
}
