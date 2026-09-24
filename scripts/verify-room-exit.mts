import assert from 'node:assert/strict';
import { closeRealtimeRoom } from '@/lib/realtime-room-cleanup';

const events: string[] = [];
const track = (name: string) => ({
  stop: () => events.push(`${name}.stop`),
  close: () => events.push(`${name}.close`),
});

const programTrack = track('program');
const microphoneTrack = track('microphone');

await closeRealtimeRoom({
  channel: 'room-exit-test',
  client: {
    unpublish: async () => {
      events.push('rtc.unpublish');
      throw new Error('unpublish failed');
    },
    leave: async () => {
      events.push('rtc.leave');
    },
  },
  rtm: {
    unsubscribe: async (channel: string) => {
      events.push(`rtm.unsubscribe:${channel}`);
    },
    logout: async () => {
      events.push('rtm.logout');
    },
  },
  programTrack,
  microphoneTrack,
});

assert.deepEqual(events, [
  'rtc.unpublish',
  'program.stop',
  'program.close',
  'microphone.stop',
  'microphone.close',
  'rtm.unsubscribe:room-exit-test',
  'rtm.logout',
  'rtc.leave',
]);

console.log('✓ live room exit cleanup checks passed');
