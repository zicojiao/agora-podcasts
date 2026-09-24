import assert from 'node:assert/strict';

const startupModule = await import('@/lib/interruption-startup').catch(() => null) as null | {
  FLOOR_SETUP_TIMEOUT_MS: number;
  NO_SPEECH_TIMEOUT_MS: number;
  FloorTimeoutController: new (options: {
    schedule: (callback: () => void, delayMs: number) => number;
    cancel: (id: number) => void;
    onExpire: (reason: 'setup' | 'silence') => void;
  }) => {
    granted: () => void;
    ready: () => void;
    activity: () => void;
    clear: () => void;
  };
  shouldPrepareLiveTranscription: (input: {
    requestingFloor: boolean;
    holdsFloor: boolean;
    phase: string;
    submitted: boolean;
  }) => boolean;
};

assert(startupModule, 'the interruption startup coordinator is missing');

const scheduled: Array<{ id: number; delayMs: number; callback: () => void; cancelled: boolean }> = [];
const expired: string[] = [];
const controller = new startupModule.FloorTimeoutController({
  schedule: (callback, delayMs) => {
    const entry = { id: scheduled.length + 1, delayMs, callback, cancelled: false };
    scheduled.push(entry);
    return entry.id;
  },
  cancel: (id) => {
    const entry = scheduled.find((candidate) => candidate.id === id);
    if (entry) entry.cancelled = true;
  },
  onExpire: (reason) => expired.push(reason),
});

controller.granted();
assert.equal(scheduled.at(-1)?.delayMs, startupModule.FLOOR_SETUP_TIMEOUT_MS,
  'floor grant still starts the short no-speech timeout before transcription is ready');

controller.ready();
assert.equal(scheduled[0]?.cancelled, true, 'the setup deadline survived after transcription became ready');
assert.equal(scheduled.at(-1)?.delayMs, startupModule.NO_SPEECH_TIMEOUT_MS,
  'ready transcription did not start the real no-speech deadline');

controller.activity();
assert.equal(scheduled[1]?.cancelled, true, 'speech activity did not replace the previous silence deadline');
assert.equal(scheduled.at(-1)?.delayMs, startupModule.NO_SPEECH_TIMEOUT_MS,
  'speech activity did not extend the floor');

scheduled.at(-1)?.callback();
assert.deepEqual(expired, ['silence'], 'the active deadline expired with the wrong reason');

assert.equal(startupModule.shouldPrepareLiveTranscription({
  requestingFloor: true,
  holdsFloor: false,
  phase: 'playing',
  submitted: false,
}), true, 'Live transcription does not preconnect while the floor request is in flight');
assert.equal(startupModule.shouldPrepareLiveTranscription({
  requestingFloor: false,
  holdsFloor: true,
  phase: 'listening',
  submitted: false,
}), true, 'Live transcription disconnects after the floor is granted');
assert.equal(startupModule.shouldPrepareLiveTranscription({
  requestingFloor: false,
  holdsFloor: true,
  phase: 'thinking',
  submitted: true,
}), false, 'Live transcription remains open after the question is submitted');

const floorReady = {
  t: 'floor.ready' as const,
};
const { decodeRoomMessage, encodeRoomMessage } = await import('@/lib/room-messages');
assert.deepEqual(decodeRoomMessage(encodeRoomMessage(floorReady)), floorReady,
  'the floor holder cannot tell the host that transcription is ready');

console.log('✓ interruption startup prewarms transcription and starts silence timing only when ready');
