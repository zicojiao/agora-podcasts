import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProgramStage } from '@/components/ProgramStage';
import type { Episode } from '@/lib/episode';

const restartDialogModule = await import('@/components/RestartEpisodeDialog').catch(() => null) as null | {
  RestartEpisodeDialog: (props: {
    restarting: boolean;
    onCancel: () => void;
    onConfirm: () => void;
  }) => React.ReactNode;
};

assert(restartDialogModule, 'the restart confirmation dialog is missing');

const episode: Episode = {
  id: 'restart-controls',
  title: 'Restart controls',
  summary: 'A demo fixture.',
  hosts: [
    { id: 'host-a', name: 'Sarah', role: 'Guide', voice: 'Puck' },
    { id: 'host-b', name: 'Marcus', role: 'Challenger', voice: 'Kore' },
  ],
  segments: [{
    id: 'segment-1',
    topic: 'Controls',
    turns: [{ hostId: 'host-a', text: 'The episode is already playing.' }],
  }],
};

const stageProps = {
  episode,
  phase: 'playing' as const,
  note: null,
  level: 0.4,
  position: { segmentIndex: 0, turnIndex: 0 },
  canTakeFloor: true,
  floorHolderName: null,
  published: true,
  connected: true,
  listenerCount: 1,
  onTogglePlayback: () => undefined,
  onRequestFloor: () => undefined,
  canRestart: true,
  onRestartRequest: () => undefined,
};

const hostStage = renderToStaticMarkup(createElement(ProgramStage, { ...stageProps, isHost: true }));
assert.match(hostStage, /aria-label="Restart episode"/, 'the host-only restart entry is missing while playing');

const listenerStage = renderToStaticMarkup(createElement(ProgramStage, { ...stageProps, isHost: false }));
assert.doesNotMatch(listenerStage, /aria-label="Restart episode"/, 'the demo restart entry leaked to listeners');

const dialog = renderToStaticMarkup(createElement(restartDialogModule.RestartEpisodeDialog, {
  restarting: false,
  onCancel: () => undefined,
  onConfirm: () => undefined,
}));
assert.match(dialog, /role="alertdialog"/, 'restart is not protected by a confirmation dialog');
assert.match(dialog, /Restart from the beginning\?/, 'restart confirmation does not name the action');
assert.match(dialog, /questions and host answers will be removed/i, 'restart consequences are unclear');
assert.match(dialog, /Room chat will also be removed/i, 'restart does not warn that room chat is cleared');

console.log('✓ demo restart stays host-only and requires explicit confirmation');
