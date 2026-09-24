import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transcriptScrollTarget } from '@/lib/transcript-scroll';

const source = await readFile(new URL('../components/TranscriptRail.tsx', import.meta.url), 'utf8');

assert.doesNotMatch(
  source,
  /scrollIntoView\([\s\S]*?behavior:\s*['"]smooth['"]/,
  'the active transcript turn must not start a smooth scroll on every turn change',
);
assert.match(
  source,
  /transcriptScrollTarget/,
  'the transcript rail must decide whether the active turn is outside its visible viewport',
);
assert.doesNotMatch(
  source,
  /!isCurrent\s*&&\s*!isPast\s*&&\s*['"]opacity-50['"]/,
  'future speaker labels must not flash from translucent to opaque',
);
assert.doesNotMatch(
  source,
  /backdrop-blur/,
  'the scrolling transcript must not repaint a backdrop blur while moving',
);

assert.equal(transcriptScrollTarget({
  viewportTop: 100,
  viewportBottom: 500,
  itemTop: 180,
  itemBottom: 280,
  currentScrollTop: 300,
}), null, 'a fully visible active turn must not move the transcript');

assert.equal(transcriptScrollTarget({
  viewportTop: 100,
  viewportBottom: 500,
  itemTop: 560,
  itemBottom: 640,
  currentScrollTop: 300,
}), 600, 'an offscreen active turn should be centered with one direct scroll');

assert.equal(transcriptScrollTarget({
  viewportTop: 100,
  viewportBottom: 500,
  itemTop: 0,
  itemBottom: 40,
  currentScrollTop: 50,
}), 0, 'an upward correction must not produce a negative scroll position');

console.log('✓ transcript motion checks passed');
