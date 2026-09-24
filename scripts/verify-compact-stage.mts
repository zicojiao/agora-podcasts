import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProgramStage } from '@/components/ProgramStage';
import type { Episode } from '@/lib/episode';

const episode: Episode = {
  id: 'compact-stage-test',
  title: 'A better live podcast',
  summary: 'Debating the tension between personalized listener curiosity and editorial structure.',
  hosts: [
    { id: 'host-a', name: 'Sarah', role: 'Guide', voice: 'Puck' },
    { id: 'host-b', name: 'Marcus', role: 'Challenger', voice: 'Kore' },
  ],
  segments: [
    {
      id: 'segment-1',
      topic: 'Editorial tension',
      turns: [{ hostId: 'host-a', text: 'Hello.' }],
    },
  ],
};

const html = renderToStaticMarkup(
  createElement(ProgramStage, {
    episode,
    phase: 'playing',
    note: 'On air',
    level: 0.5,
    position: { segmentIndex: 0, turnIndex: 0 },
    isHost: true,
    canTakeFloor: true,
    floorHolderName: null,
    canRestart: false,
    published: true,
    connected: true,
    listenerCount: 2,
    onTogglePlayback: () => undefined,
    onRequestFloor: () => undefined,
    onRestartRequest: () => undefined,
  }),
);

assert.match(html, /A better live podcast/);
assert.match(html, /Join conversation/);
assert.doesNotMatch(html, /personalized listener curiosity/i);
assert.doesNotMatch(html, /Live via Agora/i);
assert.doesNotMatch(html, />On air</i);
assert.doesNotMatch(html, /Sarah|Marcus|Puck|Kore/);
assert.doesNotMatch(html, /Editorial tension/);

const completedHtml = renderToStaticMarkup(
  createElement(ProgramStage, {
    episode,
    phase: 'completed',
    note: null,
    level: 0,
    position: { segmentIndex: 0, turnIndex: 0 },
    isHost: true,
    canTakeFloor: false,
    floorHolderName: null,
    canRestart: false,
    published: true,
    connected: true,
    listenerCount: 2,
    onTogglePlayback: () => undefined,
    onRequestFloor: () => undefined,
    onRestartRequest: () => undefined,
  }),
);

assert.match(completedHtml, /aria-label="Replay episode"/, 'the finished play control did not become replay');
assert.doesNotMatch(completedHtml, /aria-label="Replay episode"[^>]*disabled/, 'the replay control is disabled');

console.log('✓ compact program stage checks passed.');
