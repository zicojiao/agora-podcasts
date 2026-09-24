import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RoomChat } from '@/components/RoomChat';
import {
  appendChatMessage,
  CHAT_MESSAGE_MAX_LENGTH,
  decodeRoomMessage,
  sanitizeChatText,
} from '@/lib/room-messages';

const decoded = decodeRoomMessage(JSON.stringify({
  t: 'chat.message',
  id: 'chat-123',
  name: '  Chris  ',
  text: '  This is a good point.  ',
  sentAt: 1_789_980_000_000,
}));

assert.deepEqual(decoded, {
  t: 'chat.message',
  id: 'chat-123',
  name: 'Chris',
  text: 'This is a good point.',
  sentAt: 1_789_980_000_000,
});

assert.deepEqual(
  decodeRoomMessage(JSON.stringify({ t: 'episode.restart' })),
  { t: 'episode.restart' },
  'restart must be a distinct RTM event so Replay can preserve chat while Restart clears it',
);

assert.equal(sanitizeChatText('   '), null);
assert.equal(sanitizeChatText('x'.repeat(CHAT_MESSAGE_MAX_LENGTH + 20))?.length, CHAT_MESSAGE_MAX_LENGTH);
assert.equal(decodeRoomMessage(JSON.stringify({
  t: 'chat.message',
  id: '',
  name: 'Chris',
  text: 'Hello',
  sentAt: Date.now(),
})), null);

if (!decoded || decoded.t !== 'chat.message') throw new Error('expected decoded chat message');
assert.deepEqual(appendChatMessage([decoded], decoded), [decoded], 'duplicate RTM delivery should be ignored');

const overflowing = Array.from({ length: 105 }, (_, index) => ({
  ...decoded,
  id: `chat-${index}`,
  sentAt: decoded.sentAt + index,
}));
assert.equal(
  overflowing.reduce<typeof overflowing>(
    (current, message) => appendChatMessage(current, message),
    [],
  ).length,
  100,
  'chat history should stay bounded in memory',
);

const roomMessageModule = await import('@/lib/room-messages') as typeof import('@/lib/room-messages') & {
  reduceRoomChatMessages?: (
    current: Array<typeof decoded & { publisher: string }>,
    message: NonNullable<ReturnType<typeof decodeRoomMessage>>,
    publisher: string,
  ) => Array<typeof decoded & { publisher: string }>;
};
assert.equal(
  typeof roomMessageModule.reduceRoomChatMessages,
  'function',
  'room chat needs a reducer that can apply the host restart event',
);

if (decoded && roomMessageModule.reduceRoomChatMessages) {
  const current = [{ ...decoded, publisher: 'listener-1' }];
  assert.deepEqual(
    roomMessageModule.reduceRoomChatMessages(current, { t: 'episode.restart' }, 'host-1'),
    [],
    'Restart must clear chat for every room participant',
  );
  assert.deepEqual(
    roomMessageModule.reduceRoomChatMessages(current, { t: 'episode.replay' }, 'host-1'),
    current,
    'Replay must preserve room chat',
  );

  const chat = renderToStaticMarkup(createElement(RoomChat, {
    messages: current,
    currentUid: 'host-1',
    participantCount: 2,
    connected: true,
    onSend: async () => true,
    onClear: () => undefined,
  }));
  assert.match(
    chat,
    /aria-label="Clear chat on this device"/,
    'Room chat is missing its local-only clear control',
  );
}

console.log('✓ room chat protocol checks passed.');
