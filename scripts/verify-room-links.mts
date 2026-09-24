import assert from 'node:assert/strict';
import { buildRoomUrl, clearRoomUrl, readRoomChannel } from '@/lib/room-link';

const room = 'room-8kd2pq';

const createdUrl = buildRoomUrl('https://agora-podcasts.vercel.app/', room);
assert.equal(createdUrl, `https://agora-podcasts.vercel.app/?room=${room}`);
assert.equal(readRoomChannel(createdUrl), room);

const joinedUrl = buildRoomUrl(
  'https://agora-podcasts.vercel.app/?utm_source=x&room=room-old#studio',
  room,
);
assert.equal(
  joinedUrl,
  `https://agora-podcasts.vercel.app/?utm_source=x&room=${room}#studio`,
);

assert.equal(
  clearRoomUrl(joinedUrl),
  'https://agora-podcasts.vercel.app/?utm_source=x#studio',
);

for (const hostile of ['', 'not a room', '../../etc', '<script>']) {
  assert.throws(() => buildRoomUrl('https://example.com/', hostile));
}

assert.equal(readRoomChannel('https://example.com/?room=not%20a%20room'), null);
assert.equal(readRoomChannel('not a URL'), null);

console.log('✓ shareable room URL checks passed');
