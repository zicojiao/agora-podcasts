// Shared by the browser and the token route, so this module stays free of Node imports.

// Agora channel names allow a wider set, but restricting to this keeps a room code safe in
// a URL and unambiguous when read out loud during a demo.
export const ROOM_CHANNEL_PATTERN = /^[A-Za-z0-9_-]{3,64}$/;

// No vowels or look-alike characters: avoids accidental words and l/1, O/0 confusion.
const ROOM_CODE_ALPHABET = 'bcdfghjkmnpqrstvwxz23456789';

export function createRoomCode(random: () => number = Math.random) {
  const body = Array.from(
    { length: 6 },
    () => ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length)],
  ).join('');
  return `room-${body}`;
}

export function isRoomChannel(value: string) {
  return ROOM_CHANNEL_PATTERN.test(value);
}
