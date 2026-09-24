import assert from 'node:assert/strict';

const microphoneModule = await import('@/lib/microphone-publish').catch(() => null) as null | {
  acquireAndPublishMicrophone: (options: {
    createTrack: () => Promise<{
      getMediaStreamTrack: () => { id: string };
      close: () => void;
    }>;
    publishTrack: (track: unknown) => Promise<void>;
    isRoomActive: () => boolean;
    onTrackReady: (track: { id: string }) => void;
  }) => Promise<{ id: string }>;
};

assert(microphoneModule, 'the microphone startup coordinator is missing');

const events: string[] = [];
let finishPublishing: () => void = () => undefined;
const publishing = new Promise<void>((resolve) => { finishPublishing = resolve; });
const mediaTrack = { id: 'native-microphone-track' };

const resultPromise = microphoneModule.acquireAndPublishMicrophone({
  createTrack: async () => {
    events.push('created');
    return {
      getMediaStreamTrack: () => mediaTrack,
      close: () => events.push('closed'),
    };
  },
  publishTrack: async () => {
    events.push('publish-started');
    await publishing;
    events.push('publish-finished');
  },
  isRoomActive: () => true,
  onTrackReady: (track) => events.push(`ready:${track.id}`),
});

await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(events, [
  'created',
  'ready:native-microphone-track',
  'publish-started',
], 'the local microphone was hidden until Agora publication finished');

finishPublishing();
assert.equal(await resultPromise, mediaTrack);
assert.deepEqual(events, [
  'created',
  'ready:native-microphone-track',
  'publish-started',
  'publish-finished',
]);

console.log('✓ microphone becomes locally available before RTC publication completes');
