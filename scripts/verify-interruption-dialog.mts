import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JoinOverlay } from '@/components/JoinOverlay';

const common = {
  holdsFloor: true,
  askerName: 'Alex',
  liveTranscript: '',
  micTrack: null,
  error: null,
  requestingFloor: false,
  onTranscript: () => undefined,
  onReady: () => undefined,
  onSubmitted: () => undefined,
  onClose: () => undefined,
};

const thinking = renderToStaticMarkup(createElement(JoinOverlay, {
  ...common,
  phase: 'thinking',
  submitted: true,
}));
assert.match(thinking, /role="dialog"/, 'the dialog disappeared while the hosts were thinking');
assert.match(thinking, /aria-label="Close interruption dialog"/, 'the dialog cannot be closed after submission');
assert.match(thinking, /The hosts are thinking/, 'the submitted-question progress is missing');

const waiting = renderToStaticMarkup(createElement(JoinOverlay, {
  ...common,
  phase: 'listening',
  submitted: false,
}));
assert.match(waiting, /Requesting microphone access/, 'microphone permission wait is mislabeled');
assert.doesNotMatch(waiting, /Waiting for the microphone/, 'the UI still hides which connection step is slow');

console.log('✓ interruption dialog stays user-controlled and labels microphone startup clearly');
